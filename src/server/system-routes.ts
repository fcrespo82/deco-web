/**
 * Rotas das operações perigosas: reiniciar nós e alterar Wi-Fi. Como nas
 * reservas, só com `confirm: true` (a UI manda depois do diálogo).
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { App } from "../app.js";
import { ValidationError } from "../db/errors.js";

export function registerSystemRoutes(server: FastifyInstance, app: App, actorOf: (req: FastifyRequest) => string): void {
  const confirmed = (body: { confirm?: unknown } | undefined) => {
    if (body?.confirm !== true) throw new ValidationError("Confirmação ausente (confirm: true).");
  };

  server.post<{ Body: { macs?: unknown; confirm?: unknown } }>("/api/nodes/reboot", async (req, reply) => {
    confirmed(req.body);
    const macs = app.system.prepareReboot(req.body?.macs);
    const result = await app.system.reboot(macs, actorOf(req));
    const code = result.ok ? 200 : result.outcome === "conflict" ? 409 : 502;
    return reply.code(code).send({ ...result, error: result.ok ? undefined : result.message });
  });

  server.post<{ Body: Record<string, unknown> }>("/api/wifi", async (req, reply) => {
    confirmed(req.body);
    const change = app.system.prepareWifi(req.body);
    const result = await app.system.changeWifi(change, actorOf(req));
    const code = result.ok ? 200 : result.outcome === "conflict" ? 409 : 502;
    return reply.code(code).send({ ...result, wifi: undefined, error: result.ok ? undefined : result.message });
  });
}
