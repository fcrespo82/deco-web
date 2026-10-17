/**
 * Rotas de alertas (canais, histórico, aprovação de dispositivos, teste) e de
 * backup (exportar, pré-visualizar, importar).
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { App } from "../app.js";
import {
  buildBackup,
  diffBackup,
  orderReservationChanges,
  parseBackup,
  type BackupFile,
} from "../core/backup.js";
import { lanSubnet } from "../core/ipplan.js";
import { stringList, requireMac, ValidationError } from "../db/errors.js";
import type { ClientView } from "./api-types.js";
import { buildClients } from "./views.js";

/** Intervalo mínimo entre alertas de teste. */
const MIN_TEST_GAP_MS = 10_000;

export function registerOpsRoutes(server: FastifyInstance, app: App, actorOf: (req: FastifyRequest) => string): void {
  const clients = () => buildClients(app.poller.cache.snapshot, app.store.clientSeen(), app.inventory.byMac());

  // --- alertas ----------------------------------------------------------

  /** Aparelhos vistos cujo dispositivo não está aprovado. */
  const pending = (): ClientView[] =>
    clients()
      .filter((c) => !c.device?.approved && (c.online || c.firstSeen))
      .sort((a, b) => Number(b.online) - Number(a.online) || (b.firstSeen ?? "").localeCompare(a.firstSeen ?? ""));

  server.get<{ Querystring: { limit?: string } }>("/api/alerts", async (req) => {
    const s = app.config.alerts;
    const limit = Math.min(Math.max(Number(req.query.limit ?? 100) || 100, 1), 500);
    return {
      settings: {
        newDevice: s.newDevice,
        nodeOfflineMinutes: s.nodeOfflineMs === null ? null : s.nodeOfflineMs / 60_000,
        internetDownMinutes: s.internetDownMs === null ? null : s.internetDownMs / 60_000,
        publicUrl: s.publicUrl !== null,
      },
      channels: app.alertEngine.channels.map((c) => ({ name: c.name, target: c.target })),
      alerts: app.alerts.list(limit),
      pending: pending(),
    };
  });

  let lastTest = 0;
  server.post("/api/alerts/test", async (req, reply) => {
    if (app.alertEngine.channels.length === 0) {
      throw new ValidationError("Nenhum canal configurado (NOTIFY_NTFY_URL ou NOTIFY_TELEGRAM_*).");
    }
    if (Date.now() - lastTest < MIN_TEST_GAP_MS) return reply.code(429).send({ error: "Aguarde alguns segundos." });
    lastTest = Date.now();
    const entry = await app.alertEngine.test();
    app.audit.record({
      actor: actorOf(req),
      action: "alerts.test",
      target: entry.delivery.map((d) => d.channel).join(","),
      after: entry.delivery,
      result: entry.delivery.every((d) => d.ok) ? "ok" : "falhou",
    });
    return entry;
  });

  /** Aprova MACs: cria o dispositivo (com o nome do Deco) se não houver. */
  server.post<{ Body: { macs?: unknown } }>("/api/devices/approve", async (req) => {
    const macs = stringList(req.body?.macs, "MACs", 1000, 20).map(requireMac);
    if (macs.length === 0) throw new ValidationError("Informe ao menos um MAC");
    const byMac = new Map(clients().map((c) => [c.mac, c]));
    const approved = app.store.db.transaction(() =>
      macs.map((mac) => {
        const existing = app.inventory.findByMac(mac);
        const name = byMac.get(mac)?.name;
        return existing
          ? app.inventory.update(existing.id, { approved: true })
          : app.inventory.create({ alias: name && name !== mac ? name : mac, approved: true, macs: [mac] });
      }),
    )();
    app.audit.record({ actor: actorOf(req), action: "device.approve", target: `${macs.length} MAC(s)`, after: { macs } });
    return { approved: approved.length };
  });

  // --- backup -------------------------------------------------------------

  const nameOf = (mac: string) =>
    app.inventory.findByMac(mac)?.alias ??
    app.poller.cache.snapshot?.clients.find((c) => c.mac === mac)?.name ??
    app.store.clientSeen().get(mac)?.lastName ??
    null;

  const diffOf = (backup: BackupFile) =>
    diffBackup({
      backup,
      snapshot: app.poller.cache.snapshot,
      devices: app.inventory.list(),
      ranges: app.ranges.list(),
      allowWrite: app.config.allowWrite,
      nameOf,
    });

  server.get("/api/backup", async (_req, reply) => {
    const now = new Date();
    const backup = buildBackup({ snapshot: app.poller.cache.snapshot, devices: app.inventory.list(), ranges: app.ranges.list(), now });
    return reply
      .header("content-disposition", `attachment; filename="deco-web-backup-${now.toISOString().slice(0, 10)}.json"`)
      .send(backup);
  });

  server.post<{ Body: { backup?: unknown } }>("/api/backup/preview", async (req) => diffOf(parseBackup(req.body?.backup)));

  server.post<{
    Body: { backup?: unknown; sections?: { devices?: boolean; ranges?: boolean; reservations?: boolean }; confirm?: unknown };
  }>("/api/backup/import", async (req) => {
    if (req.body?.confirm !== true) throw new ValidationError("Confirmação ausente (confirm: true).");
    const backup = parseBackup(req.body.backup);
    const sections = req.body.sections ?? {};
    // O diff é refeito aqui: o que a UI mostrou pode ter mudado desde então.
    const diff = diffOf(backup);
    const actor = actorOf(req);
    const result = {
      devices: { added: 0, updated: 0 },
      ranges: { added: 0, updated: 0, skipped: 0 },
      reservations: [] as { mac: string; ip: string | null; outcome: string; message: string }[],
    };

    if (sections.devices && diff.devices.changes.length) {
      app.store.db.transaction(() => {
        for (const d of diff.devices.changes) {
          const b = backup.devices[d.index]!;
          const fields = { alias: b.alias, owner: b.owner, type: b.type, tags: b.tags, notes: b.notes, approved: b.approved };
          if (d.action === "add") {
            app.inventory.create({ ...fields, macs: b.macs });
            result.devices.added += 1;
          } else {
            const id = d.localIds[0]!;
            app.inventory.update(id, fields);
            for (const mac of b.macs) app.inventory.attachMac(id, mac);
            result.devices.updated += 1;
          }
        }
      })();
    }

    if (sections.ranges && diff.ranges.changes.length) {
      const lan = lanSubnet(app.poller.cache.snapshot);
      if (!lan) throw new ValidationError("Ainda sem dados do Deco para saber a rede.");
      app.store.db.transaction(() => {
        // Atualizações antes das inclusões: uma faixa encolhida libera espaço.
        const ordered = [...diff.ranges.changes].sort((a, b) => Number(a.action === "add") - Number(b.action === "add"));
        for (const r of ordered) {
          if (r.action === "conflict") {
            result.ranges.skipped += 1;
            continue;
          }
          const b = backup.ranges[r.index]!;
          const input = { name: b.name, spec: b.spec, kind: b.kind, types: b.types, notes: b.notes };
          if (r.action === "add") {
            app.ranges.create(input, lan.subnet);
            result.ranges.added += 1;
          } else {
            app.ranges.update(r.localId!, input, lan.subnet);
            result.ranges.updated += 1;
          }
        }
      })();
    }

    app.audit.record({
      actor,
      action: "backup.import",
      target: backup.exportedAt,
      before: {
        devices: diff.devices.changes.length,
        ranges: diff.ranges.changes.length,
        reservations: diff.reservations.changes.length,
      },
      after: { sections, devices: result.devices, ranges: result.ranges },
    });

    // Reservas por último: as mais lentas e as únicas que tocam no Deco.
    if (sections.reservations) {
      if (diff.reservations.blocked) throw new ValidationError(diff.reservations.blocked);
      const changes = orderReservationChanges(diff.reservations.changes, app.poller.cache.snapshot?.reservations ?? []);
      const results = await app.reservations.applyBatch(changes, actor);
      result.reservations = changes.map((c, i) => ({
        mac: c.mac,
        ip: c.op === "remove" ? null : c.ip,
        outcome: results[i]?.outcome ?? "skipped",
        message: results[i]?.message ?? "Não executada: o lote parou antes por um resultado incerto.",
      }));
      for (const d of diff.reservations.changes.filter((x) => x.action === "conflict")) {
        result.reservations.push({ mac: d.mac, ip: d.to, outcome: "conflict", message: d.reason ?? "conflito" });
      }
    }
    return result;
  });
}
