/**
 * Planta da casa: posição de cada Deco sobre a imagem da planta (guardada
 * como imagem "floorplan/casa") e a largura real, para a estimativa de
 * cobertura. Fica no kv do SQLite; não toca no Deco.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { App } from "../app.js";
import { ValidationError } from "../db/errors.js";
import type { FloorplanView } from "./api-types.js";

const KEY = "floorplan";
const MAC_RE = /^[0-9A-F]{2}(-[0-9A-F]{2}){5}$/;
export const DEFAULT_FLOORPLAN: FloorplanView = { nodes: {}, widthMeters: 15 };

export function parseFloorplan(body: unknown): FloorplanView {
  if (!body || typeof body !== "object") throw new ValidationError("Corpo inválido.");
  const b = body as { nodes?: unknown; widthMeters?: unknown };
  const width = Number(b.widthMeters);
  if (!Number.isFinite(width) || width < 2 || width > 200) throw new ValidationError("Largura deve estar entre 2 e 200 metros.");
  if (!b.nodes || typeof b.nodes !== "object" || Array.isArray(b.nodes)) throw new ValidationError("nodes deve ser um objeto MAC → posição.");
  const entries = Object.entries(b.nodes as Record<string, unknown>);
  if (entries.length > 64) throw new ValidationError("Nós demais.");
  const nodes: FloorplanView["nodes"] = {};
  for (const [mac, pos] of entries) {
    const key = mac.toUpperCase().replace(/:/g, "-");
    if (!MAC_RE.test(key)) throw new ValidationError(`MAC inválido: ${mac}`);
    const { x, y } = (pos ?? {}) as { x?: unknown; y?: unknown };
    if (typeof x !== "number" || typeof y !== "number" || !(x >= 0 && x <= 1 && y >= 0 && y <= 1)) {
      throw new ValidationError(`Posição inválida para ${mac} (x e y entre 0 e 1).`);
    }
    nodes[key] = { x: Math.round(x * 10_000) / 10_000, y: Math.round(y * 10_000) / 10_000 };
  }
  return { nodes, widthMeters: Math.round(width * 10) / 10 };
}

export function registerFloorplanRoutes(server: FastifyInstance, app: App, actorOf: (req: FastifyRequest) => string): void {
  server.get("/api/floorplan", async (): Promise<FloorplanView> => app.store.getJson<FloorplanView>(KEY) ?? DEFAULT_FLOORPLAN);

  server.put<{ Body: unknown }>("/api/floorplan", async (req): Promise<FloorplanView> => {
    const next = parseFloorplan(req.body);
    const before = app.store.getJson<FloorplanView>(KEY) ?? DEFAULT_FLOORPLAN;
    app.store.setJson(KEY, next);
    app.audit.record({ actor: actorOf(req), action: "floorplan.update", target: "casa", before, after: next });
    return next;
  });
}
