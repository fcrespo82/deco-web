/**
 * Rotas de inventário, plano de IPs, reservas, histórico e auditoria.
 * Inventário e plano são dados locais (SQLite): não tocam no Deco e não
 * dependem de DECO_ALLOW_WRITE. Reservas escrevem no Deco e exigem
 * DECO_ALLOW_WRITE=1. Toda alteração vai para o log de auditoria.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { App } from "../app.js";
import { NET_EVENT_TYPES, type NetEventType } from "../core/events.js";
import { buildIpPlan, lanSubnet } from "../core/ipplan.js";
import { suggestReservationIps, type ReservationChange } from "../core/reservations.js";
import { DEVICE_TYPES } from "../db/inventory.js";
import { requireMac, ValidationError } from "../db/errors.js";
import type { EventView } from "./api-types.js";
import { bucketSamples } from "./history.js";
import { buildClients, buildInventory } from "./views.js";

type Id = { Params: { id: string } };

const idOf = (req: FastifyRequest<Id>) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new ValidationError("id inválido");
  return id;
};

export function registerDataRoutes(server: FastifyInstance, app: App, actorOf: (req: FastifyRequest) => string): void {
  const clients = () => buildClients(app.poller.cache.snapshot, app.store.clientSeen(), app.inventory.byMac());
  const audit = (req: FastifyRequest, action: string, target: string | null, before: unknown, after: unknown) =>
    app.audit.record({ actor: actorOf(req), action, target, before, after });

  // --- inventário -----------------------------------------------------

  server.get("/api/devices", async () => buildInventory(app.inventory.list(), clients(), DEVICE_TYPES));

  server.post<{ Body: Record<string, unknown> }>("/api/devices", async (req, reply) => {
    const device = app.inventory.create(req.body ?? {});
    audit(req, "device.create", `device:${device.id}`, null, device);
    return reply.code(201).send(device);
  });

  server.patch<Id & { Body: Record<string, unknown> }>("/api/devices/:id", async (req) => {
    const id = idOf(req);
    const before = app.inventory.get(id);
    const after = app.inventory.update(id, req.body ?? {});
    audit(req, "device.update", `device:${id}`, before, after);
    return after;
  });

  server.delete<Id>("/api/devices/:id", async (req) => {
    const before = app.inventory.delete(idOf(req));
    audit(req, "device.delete", `device:${before.id}`, before, null);
    return { ok: true };
  });

  server.post<Id & { Body: { mac?: unknown } }>("/api/devices/:id/macs", async (req) => {
    const id = idOf(req);
    const mac = requireMac(req.body?.mac);
    const previous = app.inventory.findByMac(mac);
    const after = app.inventory.attachMac(id, mac);
    audit(req, "device.attach_mac", `device:${id}`, { mac, from: previous?.id ?? null }, after);
    return after;
  });

  server.delete<{ Params: { id: string; mac: string } }>("/api/devices/:id/macs/:mac", async (req) => {
    const id = idOf(req as FastifyRequest<Id>);
    const before = app.inventory.get(id);
    const after = app.inventory.detachMac(id, req.params.mac);
    audit(req, "device.detach_mac", `device:${id}`, before, after);
    return after;
  });

  /** Edição a partir de um cliente: cria o dispositivo do MAC se não existir. */
  server.put<{ Params: { mac: string }; Body: Record<string, unknown> }>("/api/clients/:mac/device", async (req) => {
    const mac = requireMac(req.params.mac);
    const before = app.inventory.findByMac(mac);
    const after = app.inventory.upsertForMac(mac, req.body ?? {});
    audit(req, before ? "device.update" : "device.create", `device:${after.id}`, before, after);
    return after;
  });

  // --- plano de IPs ---------------------------------------------------

  const plan = () =>
    buildIpPlan({
      snapshot: app.poller.cache.snapshot,
      ranges: app.ranges.list(),
      inventory: app.inventory.byMac(),
      seen: app.store.clientSeen(),
      now: new Date(),
    });
  const subnet = () => {
    const lan = lanSubnet(app.poller.cache.snapshot);
    if (!lan) throw new ValidationError("Ainda sem dados do Deco para saber a rede.");
    return lan.subnet;
  };

  server.get("/api/ipplan", async () => plan());

  server.post<{ Body: Record<string, unknown> }>("/api/ipplan/ranges", async (req, reply) => {
    const range = app.ranges.create(req.body ?? {}, subnet());
    audit(req, "range.create", `range:${range.id}`, null, range);
    return reply.code(201).send(range);
  });

  server.patch<Id & { Body: Record<string, unknown> }>("/api/ipplan/ranges/:id", async (req) => {
    const id = idOf(req);
    const before = app.ranges.get(id);
    const after = app.ranges.update(id, req.body ?? {}, subnet());
    audit(req, "range.update", `range:${id}`, before, after);
    return after;
  });

  server.delete<Id>("/api/ipplan/ranges/:id", async (req) => {
    const before = app.ranges.delete(idOf(req));
    audit(req, "range.delete", `range:${before.id}`, before, null);
    return { ok: true };
  });

  // --- reservas (escrita no Deco) --------------------------------------

  server.get("/api/reservations", async () => {
    const snap = app.poller.cache.snapshot;
    return {
      allowWrite: app.reservations.allowWrite,
      used: snap?.reservations.length ?? 0,
      max: snap?.reservationMax ?? null,
      clients: clients().filter((c) => c.reservation),
    };
  });

  server.get<{ Querystring: { mac?: string } }>("/api/reservations/suggest", async (req) => {
    const mac = requireMac(req.query.mac);
    const type = app.inventory.findByMac(mac)?.type ?? null;
    const client = app.poller.cache.snapshot?.clients.find((c) => c.mac === mac) ?? null;
    return { mac, deviceType: type, currentIp: client?.ip ?? null, suggestions: suggestReservationIps(plan(), type) };
  });

  /** Escritas exigem `confirm: true`: a UI só manda depois do diálogo de confirmação. */
  const confirmed = (body: { confirm?: unknown } | undefined) => {
    if (body?.confirm !== true) throw new ValidationError("Confirmação ausente (confirm: true).");
  };
  const write = async (req: FastifyRequest, reply: FastifyReply, change: ReservationChange) => {
    const result = await app.reservations.apply(change, actorOf(req));
    const code = result.ok ? 200 : result.outcome === "conflict" ? 409 : 502;
    return reply.code(code).send({ ...result, error: result.ok ? undefined : result.message });
  };

  server.post<{ Body: { mac?: unknown; ip?: unknown; confirm?: unknown } }>("/api/reservations", async (req, reply) => {
    confirmed(req.body);
    return write(req, reply, app.reservations.prepare("add", req.body?.mac, req.body?.ip));
  });

  server.put<{ Params: { mac: string }; Body: { ip?: unknown; confirm?: unknown } }>("/api/reservations/:mac", async (req, reply) => {
    confirmed(req.body);
    return write(req, reply, app.reservations.prepare("move", req.params.mac, req.body?.ip));
  });

  server.delete<{ Params: { mac: string }; Body: { confirm?: unknown } }>("/api/reservations/:mac", async (req, reply) => {
    confirmed(req.body);
    return write(req, reply, app.reservations.prepare("remove", req.params.mac));
  });

  // --- histórico ------------------------------------------------------

  server.get<{ Querystring: { limit?: string; before?: string; type?: string; mac?: string } }>(
    "/api/history/events",
    async (req) => {
      const types = (req.query.type ?? "")
        .split(",")
        .filter((t): t is NetEventType => (NET_EVENT_TYPES as readonly string[]).includes(t));
      const macs = (req.query.mac ?? "").split(",").filter(Boolean).map(requireMac);
      const limit = Number(req.query.limit ?? 100);
      const rows = app.events.list({
        limit: Number.isFinite(limit) ? limit : 100,
        beforeId: req.query.before ? Number(req.query.before) : undefined,
        types,
        macs,
      });
      const inventory = app.inventory.byMac();
      const seen = app.store.clientSeen();
      const events: EventView[] = rows.map((e) => ({
        ...e,
        name:
          (e.mac && inventory.get(e.mac)?.alias) ||
          (typeof e.data.name === "string" ? e.data.name : null) ||
          (e.mac && seen.get(e.mac)?.lastName) ||
          null,
      }));
      return { events, nextBefore: rows.length === limit ? rows.at(-1)?.id ?? null : null, types: NET_EVENT_TYPES };
    },
  );

  server.get<{ Querystring: { hours?: string } }>("/api/history/samples", async (req) => {
    const hours = Math.min(Math.max(Number(req.query.hours ?? 24) || 24, 1), 24 * 365);
    const to = Date.now();
    const from = to - hours * 3600_000;
    return { from: new Date(from).toISOString(), to: new Date(to).toISOString(), ...bucketSamples(app.store.samples(new Date(from).toISOString()), from, to) };
  });

  server.get<{ Querystring: { limit?: string; before?: string } }>("/api/audit", async (req) => {
    const limit = Math.min(Math.max(Number(req.query.limit ?? 100) || 100, 1), 500);
    return { entries: app.audit.list(limit, req.query.before ? Number(req.query.before) : undefined) };
  });
}
