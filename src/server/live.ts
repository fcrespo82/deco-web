/**
 * Canal ao vivo da UI: GET /api/live (Server-Sent Events).
 *
 * Cada mensagem diz quais tópicos mudaram e traz o status atual; a UI relê só
 * o que depende deles. Mudanças em sequência (início do poll, snapshot,
 * alertas) são juntadas numa mensagem só. Nada aqui fala com o Deco.
 */
import type { FastifyInstance, FastifyReply } from "fastify";
import type { App } from "../app.js";
import type { LiveMessage, LiveTopic, StatusView } from "./api-types.js";

/** Junta mudanças que chegam juntas (ex.: fim do poll + snapshot). */
const COALESCE_MS = 150;
/** Comentário periódico para proxies e o navegador não derrubarem a conexão. */
const HEARTBEAT_MS = 25_000;

/** Tópicos que uma escrita da API pode ter mudado, pelo caminho. */
export function topicsForWrite(path: string): LiveTopic[] {
  if (path.startsWith("/api/auth/")) return [];
  if (path === "/api/refresh" || path === "/api/breaker/reset") return ["status", "audit"];
  if (path.startsWith("/api/devices") || /^\/api\/clients\/[^/]+\/device$/.test(path)) return ["inventory", "audit"];
  if (path.startsWith("/api/ipplan")) return ["ipplan", "audit"];
  if (path.startsWith("/api/reservations")) return ["reservations", "audit"];
  if (path.startsWith("/api/alerts")) return ["alerts", "audit"];
  if (path.startsWith("/api/images")) return ["images", "audit"];
  if (path === "/api/nodes/reboot" || path === "/api/wifi") return ["snapshot", "status", "audit"];
  // Backup e o que vier depois: relê tudo.
  return ["inventory", "ipplan", "reservations", "alerts", "audit"];
}

export function registerLiveRoutes(server: FastifyInstance, app: App, status: () => StatusView): void {
  const streams = new Set<FastifyReply>();
  let pending = new Set<LiveTopic>();
  let timer: NodeJS.Timeout | null = null;

  const write = (reply: FastifyReply, chunk: string) => {
    if (!reply.raw.writableEnded) reply.raw.write(chunk);
  };
  const message = (topics: LiveTopic[]) => {
    const body: LiveMessage = { topics, status: status() };
    return `event: change\ndata: ${JSON.stringify(body)}\n\n`;
  };

  const flush = () => {
    timer = null;
    const topics = [...pending];
    pending = new Set();
    if (!topics.length || !streams.size) return;
    const chunk = message(topics);
    for (const reply of streams) write(reply, chunk);
  };

  const unsubscribe = app.onChange((topics) => {
    for (const t of topics) pending.add(t);
    timer ??= setTimeout(flush, COALESCE_MS);
  });

  const heartbeat = setInterval(() => {
    for (const reply of streams) write(reply, ": ping\n\n");
  }, HEARTBEAT_MS);
  heartbeat.unref();

  // Conexões abertas impediriam o servidor de fechar.
  server.addHook("preClose", async () => {
    unsubscribe();
    clearInterval(heartbeat);
    if (timer) clearTimeout(timer);
    for (const reply of streams) reply.raw.end();
    streams.clear();
  });

  server.get("/api/live", async (req, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      // nginx e afins: não segurar o stream em buffer.
      "x-accel-buffering": "no",
    });
    // Reconexão do EventSource em 3 s; a primeira mensagem já traz o status.
    write(reply, `retry: 3000\n\n${message(["status"])}`);
    streams.add(reply);
    req.raw.on("close", () => streams.delete(reply));
  });
}
