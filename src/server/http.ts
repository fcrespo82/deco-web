/**
 * API REST (Fastify) + arquivos estáticos da SPA.
 *
 * Todas as rotas leem do cache do poller; nenhuma fala com o Deco diretamente.
 * A única que dispara uma leitura é POST /api/refresh, e mesmo ela passa pelo
 * poller (fila + breaker) e tem intervalo mínimo.
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import cookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import type { App } from "../app.js";
import {
  checkPassword,
  LoginRateLimiter,
  newSessionSecret,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  SessionSigner,
} from "./auth.js";
import { NotFoundError, ValidationError } from "../db/errors.js";
import { CircuitOpenError } from "../core/gateway.js";
import { ConflictError, WriteDisabledError } from "../core/reservations.js";
import { DecoError } from "../deco-client/errors.js";
import { registerDataRoutes } from "./routes.js";
import { buildClients, buildOverview, buildStatus } from "./views.js";

export const WEB_DIST = fileURLToPath(new URL("../../web/dist", import.meta.url));

/** Intervalo mínimo entre atualizações manuais: cada uma abre uma sessão no Deco. */
const MIN_REFRESH_GAP_MS = 30_000;

export interface HttpOptions {
  app: App;
  /** Senha da UI; undefined deixa a UI aberta. */
  uiPassword?: string;
  webDist?: string;
  now?: () => Date;
}

export async function buildServer(opts: HttpOptions): Promise<FastifyInstance> {
  const { app, uiPassword } = opts;
  const now = opts.now ?? (() => new Date());
  const server = Fastify({ logger: false, trustProxy: false });

  await server.register(cookie);

  server.setErrorHandler((err, _req, reply) => {
    if (err instanceof ValidationError) return reply.code(400).send({ error: err.message });
    if (err instanceof NotFoundError) return reply.code(404).send({ error: err.message });
    if (err instanceof WriteDisabledError) return reply.code(403).send({ error: err.message });
    if (err instanceof ConflictError) return reply.code(409).send({ error: err.message });
    if (err instanceof CircuitOpenError) return reply.code(503).send({ error: err.message });
    if (err instanceof DecoError) return reply.code(502).send({ error: `Falha ao falar com o Deco: ${err.message}` });
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) return reply.code(status).send({ error: (err as Error).message });
    console.error(err);
    return reply.code(500).send({ error: "Erro interno." });
  });

  let secret = app.store.getJson<string>("session_secret");
  if (!secret) {
    secret = newSessionSecret();
    app.store.setJson("session_secret", secret);
  }
  const signer = new SessionSigner(secret, () => now().getTime());
  const limiter = new LoginRateLimiter(5, 5 * 60_000, () => now().getTime());
  const authRequired = Boolean(uiPassword);
  const isAuthenticated = (req: FastifyRequest) =>
    !authRequired || signer.verify(req.cookies[SESSION_COOKIE]);

  const status = () =>
    buildStatus({
      cache: app.poller.cache,
      pollIntervalMs: app.config.pollIntervalMs,
      mode: {
        mock: app.config.mock,
        allowWrite: app.config.allowWrite,
        allowDangerous: app.config.allowDangerous,
      },
      now: now(),
    });

  // --- públicas -------------------------------------------------------

  server.get("/api/health", async (_req, reply) => {
    const s = status();
    // Saudável = processo de pé e banco acessível. Deco fora do ar não
    // derruba o container: isso é estado do Deco, não do serviço.
    app.store.getJson("session_secret");
    return reply.send({ ok: true, fetchedAt: s.fetchedAt, breaker: s.breaker });
  });

  server.get("/api/auth/me", async (req) => ({
    authRequired,
    authenticated: isAuthenticated(req),
  }));

  server.post<{ Body: { password?: unknown } }>("/api/auth/login", async (req, reply) => {
    if (!authRequired) return { ok: true };
    if (limiter.blocked(req.ip)) {
      return reply.code(429).send({ error: "Muitas tentativas. Aguarde alguns minutos." });
    }
    if (!checkPassword(req.body?.password, uiPassword!)) {
      limiter.fail(req.ip);
      return reply.code(401).send({ error: "Senha incorreta." });
    }
    limiter.succeed(req.ip);
    return reply
      .setCookie(SESSION_COOKIE, signer.issue(), {
        path: "/",
        httpOnly: true,
        sameSite: "strict",
        maxAge: SESSION_TTL_MS / 1000,
      })
      .send({ ok: true });
  });

  server.post("/api/auth/logout", async (_req, reply) =>
    reply.clearCookie(SESSION_COOKIE, { path: "/" }).send({ ok: true }),
  );

  // --- protegidas -----------------------------------------------------

  server.addHook("onRequest", async (req, reply) => {
    const path = req.url.split("?")[0]!;
    if (!path.startsWith("/api/") || path === "/api/health" || path.startsWith("/api/auth/")) return;
    if (!isAuthenticated(req)) return reply.code(401).send({ error: "Não autenticado." });
    // POST só com JSON: junto com SameSite=Strict, barra formulários de outros sites.
    if (req.method !== "GET" && !String(req.headers["content-type"] ?? "").startsWith("application/json")) {
      return reply.code(415).send({ error: "Use Content-Type: application/json." });
    }
  });

  server.get("/api/status", async () => status());

  server.get("/api/overview", async () =>
    buildOverview(app.poller.cache.snapshot, app.store.nodeSeen(), status()),
  );

  server.get("/api/clients", async () => ({
    status: status(),
    clients: buildClients(app.poller.cache.snapshot, app.store.clientSeen(), app.inventory.byMac()),
  }));

  // Sem identidade de usuário (senha única da UI): registra o IP de origem.
  const actorOf = (req: FastifyRequest) => `${authRequired ? "ui" : "ui-aberta"}@${req.ip}`;
  registerDataRoutes(server, app, actorOf);

  server.post("/api/refresh", async (_req, reply) => {
    const last = app.poller.cache.lastAttemptAt;
    if (last && now().getTime() - new Date(last).getTime() < MIN_REFRESH_GAP_MS) {
      return reply.code(429).send({ error: "Atualizado há pouco. Tente em alguns segundos." });
    }
    // Não espera: uma leitura do Deco leva de 15 a 40 s. A UI acompanha via /api/status.
    void app.poller.pollNow();
    return reply.code(202).send({ ok: true });
  });

  server.post("/api/breaker/reset", async (req) => {
    const before = app.gateway.breaker.state;
    app.gateway.breaker.reset();
    app.audit.record({ actor: actorOf(req), action: "breaker.reset", target: "deco", before, after: app.gateway.breaker.state });
    return { ok: true, breaker: app.gateway.breaker.status };
  });

  // --- SPA ------------------------------------------------------------

  const webDist = opts.webDist ?? WEB_DIST;
  if (existsSync(webDist)) {
    await server.register(fastifyStatic, { root: webDist, prefix: "/" });
  }
  server.setNotFoundHandler((req, reply) =>
    req.url.startsWith("/api/")
      ? reply.code(404).send({ error: "Rota não encontrada." })
      : existsSync(webDist)
        ? reply.sendFile("index.html")
        : reply.code(404).type("text/plain").send("Frontend não compilado: rode npm run build:web"),
  );

  return server;
}
