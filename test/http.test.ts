import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApp, type App } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { MockDecoApi } from "../src/deco-client/mock.js";
import { silentLogger } from "../src/log.js";
import { buildServer } from "../src/server/http.js";
import { SessionSigner, LoginRateLimiter, checkPassword } from "../src/server/auth.js";

const opened: { app: App; dir: string }[] = [];
afterEach(async () => {
  for (const { app, dir } of opened.splice(0)) {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

async function setup(opts: { uiPassword?: string; api?: MockDecoApi } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "deco-web-test-"));
  const config = loadConfig({ DECO_MOCK: "1", DATA_DIR: dir });
  const api = opts.api ?? new MockDecoApi();
  const app = createApp(config, silentLogger, api);
  opened.push({ app, dir });
  const server = await buildServer({ app, uiPassword: opts.uiPassword, webDist: join(dir, "sem-web") });
  return { app, api, server };
}

describe("API", () => {
  it("health responde sem autenticação", async () => {
    const { server } = await setup({ uiPassword: "x" });
    const res = await server.inject("/api/health");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, fetchedAt: null });
  });

  it("overview antes do primeiro poll: vazio e marcado como desatualizado", async () => {
    const { server } = await setup();
    const body = (await server.inject("/api/overview")).json();
    expect(body.status).toMatchObject({ stale: true, fetchedAt: null, mode: { mock: true, allowWrite: false } });
    expect(body.nodes).toEqual([]);
  });

  it("overview após poll: nós com contagem de clientes e 'online desde'", async () => {
    const { app, server } = await setup();
    await app.poller.pollNow();
    const body = (await server.inject("/api/overview")).json();
    expect(body.status.stale).toBe(false);
    expect(body.nodes).toHaveLength(6);
    expect(body.nodes[0].role).toBe("master");
    expect(body.nodes.reduce((sum: number, n: any) => sum + n.clients.total, 0)).toBe(28);
    expect(body.nodes.every((n: any) => n.onlineSince)).toBe(true);
    expect(body.nodes.filter((n: any) => n.role === "slave").every((n: any) => n.parentName)).toBe(true);
    expect(body.totals).toMatchObject({ clients: 28, byBand: { wired: 13, "5GHz": 10, "2.4GHz": 5 }, unassigned: 0 });
    expect(body.reservations).toEqual({ used: 20, max: 200 });
  });

  it("clientes: online, offline conhecidos e MACs só com reserva", async () => {
    const { app, api, server } = await setup();
    await app.poller.pollNow();
    const raw = api.raw.clientList as { client_list: { mac: string }[] };
    const gone = raw.client_list[0]!.mac;
    api.mutate(() => {
      raw.client_list = raw.client_list.slice(1);
    });
    await app.poller.pollNow();

    const { clients } = (await server.inject("/api/clients")).json();
    const online = clients.filter((c: any) => c.online);
    expect(online).toHaveLength(27);
    const offline = clients.find((c: any) => c.mac === gone);
    expect(offline).toMatchObject({ online: false, upKBps: 0 });
    expect(offline.lastSeen).toBeTruthy();

    const reserved = clients.filter((c: any) => c.reservation);
    expect(reserved).toHaveLength(20);
    // Reservas cujo MAC nunca foi visto aparecem só com a reserva.
    expect(reserved.some((c: any) => c.firstSeen === null && !c.online)).toBe(true);
    // Online vêm antes dos offline.
    const firstOffline = clients.findIndex((c: any) => !c.online);
    expect(clients.slice(firstOffline).every((c: any) => !c.online)).toBe(true);
  });

  it("refresh dispara poll e respeita o intervalo mínimo", async () => {
    const { api, server } = await setup();
    const post = () =>
      server.inject({ method: "POST", url: "/api/refresh", headers: { "content-type": "application/json" }, payload: "{}" });
    expect((await post()).statusCode).toBe(202);
    await new Promise((r) => setTimeout(r, 10));
    expect(api.calls).toBe(1);
    expect((await post()).statusCode).toBe(429);
    expect(api.calls).toBe(1);
  });

  it("POST sem JSON é recusado", async () => {
    const { server } = await setup();
    const res = await server.inject({ method: "POST", url: "/api/refresh", payload: "x", headers: { "content-type": "text/plain" } });
    expect(res.statusCode).toBe(415);
  });

  it("rota de API inexistente dá 404 JSON", async () => {
    const { server } = await setup();
    const res = await server.inject("/api/nao-existe");
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBeTruthy();
  });
});

describe("autenticação da UI", () => {
  it("sem senha configurada, tudo aberto", async () => {
    const { server } = await setup();
    expect((await server.inject("/api/auth/me")).json()).toEqual({ authRequired: false, authenticated: true });
    expect((await server.inject("/api/status")).statusCode).toBe(200);
  });

  it("com senha: 401 sem cookie, login gera cookie que libera a API", async () => {
    const { server } = await setup({ uiPassword: "segredo" });
    expect((await server.inject("/api/status")).statusCode).toBe(401);

    const bad = await server.inject({ method: "POST", url: "/api/auth/login", payload: { password: "errada" } });
    expect(bad.statusCode).toBe(401);

    const ok = await server.inject({ method: "POST", url: "/api/auth/login", payload: { password: "segredo" } });
    expect(ok.statusCode).toBe(200);
    const cookie = ok.cookies.find((c) => c.name === "dw_session")!;
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.sameSite).toBe("Strict");

    const res = await server.inject({ url: "/api/status", cookies: { dw_session: cookie.value } });
    expect(res.statusCode).toBe(200);
    expect(JSON.stringify(res.json())).not.toContain("segredo");
  });

  it("bloqueia após 5 tentativas erradas", async () => {
    const { server } = await setup({ uiPassword: "segredo" });
    for (let i = 0; i < 5; i++) {
      await server.inject({ method: "POST", url: "/api/auth/login", payload: { password: "x" } });
    }
    const res = await server.inject({ method: "POST", url: "/api/auth/login", payload: { password: "segredo" } });
    expect(res.statusCode).toBe(429);
  });

  it("assinatura: rejeita token adulterado ou expirado", () => {
    let t = 1000;
    const s = new SessionSigner("k", () => t);
    const token = s.issue(500);
    expect(s.verify(token)).toBe(true);
    expect(s.verify(token.replace(/^\d+/, "999999"))).toBe(false);
    expect(new SessionSigner("outra", () => t).verify(token)).toBe(false);
    t = 2000;
    expect(s.verify(token)).toBe(false);
  });

  it("limitador libera depois da janela", () => {
    let t = 0;
    const l = new LoginRateLimiter(2, 1000, () => t);
    l.fail("a");
    l.fail("a");
    expect(l.blocked("a")).toBe(true);
    expect(l.blocked("b")).toBe(false);
    t = 1001;
    expect(l.blocked("a")).toBe(false);
  });

  it("checkPassword exige string igual", () => {
    expect(checkPassword("abc", "abc")).toBe(true);
    expect(checkPassword("abcd", "abc")).toBe(false);
    expect(checkPassword(undefined, "abc")).toBe(false);
  });
});

describe("API de inventário, plano e histórico", () => {
  const json = (method: "POST" | "PATCH" | "PUT" | "DELETE", url: string, payload: unknown = {}) => ({
    method,
    url,
    headers: { "content-type": "application/json" },
    payload: JSON.stringify(payload),
  });

  it("apelido pelo cliente aparece na lista e fica na auditoria", async () => {
    const { app, server } = await setup();
    await app.poller.pollNow();
    const mac = app.poller.cache.snapshot!.clients[0]!.mac;
    const res = await server.inject(json("PUT", `/api/clients/${mac}/device`, { alias: "Notebook da Ana", type: "notebook", owner: "Ana" }));
    expect(res.statusCode).toBe(200);

    const { clients } = (await server.inject("/api/clients")).json();
    expect(clients.find((c: any) => c.mac === mac).device).toMatchObject({ alias: "Notebook da Ana", owner: "Ana" });

    const inv = (await server.inject("/api/devices")).json();
    expect(inv.devices).toHaveLength(1);
    expect(inv.devices[0].macs[0]).toMatchObject({ mac, online: true });
    expect(inv.unassigned).toHaveLength(27);

    const { entries } = (await server.inject("/api/audit")).json();
    expect(entries[0]).toMatchObject({ action: "device.create", actor: expect.stringMatching(/^ui-aberta@/), before: null });
  });

  it("validação vira 400 com mensagem; inexistente vira 404", async () => {
    const { server } = await setup();
    const bad = await server.inject(json("POST", "/api/devices", { alias: "", macs: ["AA-AA-AA-AA-AA-01"] }));
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toMatch(/Apelido/);
    expect((await server.inject(json("PATCH", "/api/devices/999", { alias: "x" }))).statusCode).toBe(404);
  });

  it("faixas: exigem dados da rede; depois aparecem no plano com sugestão", async () => {
    const { app, server } = await setup();
    const early = await server.inject(json("POST", "/api/ipplan/ranges", { name: "IoT", spec: ".100+", kind: "dynamic" }));
    expect(early.statusCode).toBe(400);

    await app.poller.pollNow();
    const created = await server.inject(json("POST", "/api/ipplan/ranges", { name: "Servidores", spec: ".20-.39", kind: "static" }));
    expect(created.statusCode).toBe(201);
    const plan = (await server.inject("/api/ipplan")).json();
    expect(plan.cells).toHaveLength(256);
    expect(plan.ranges[0]).toMatchObject({ name: "Servidores", suggestion: "192.168.68.37" });
    expect(plan.anomalies.some((a: any) => a.code === "dynamic-in-static")).toBe(true);
  });

  it("histórico: eventos do poller com nome resolvido, e amostras para o gráfico", async () => {
    const { app, api, server } = await setup();
    await app.poller.pollNow();
    const raw = api.raw.clientList as { client_list: { mac: string; ip: string }[] };
    raw.client_list[0]!.ip = "192.168.68.199";
    await new Promise((r) => setTimeout(r, 5));
    await app.poller.pollNow();

    const { events } = (await server.inject("/api/history/events")).json();
    const changed = events.find((e: any) => e.type === "client_ip_changed");
    expect(changed).toMatchObject({ mac: raw.client_list[0]!.mac, data: { to: "192.168.68.199" } });
    expect(changed.name).toBeTruthy();

    const filtered = (await server.inject("/api/history/events?type=client_new")).json();
    expect(filtered.events.every((e: any) => e.type === "client_new")).toBe(true);

    const samples = (await server.inject("/api/history/samples?hours=1")).json();
    expect(samples.points.length).toBeGreaterThan(0);
    expect(samples.points[0].avg).toBe(28);
  });
});
