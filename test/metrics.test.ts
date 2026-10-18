import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApp, type App } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { MockDecoApi } from "../src/deco-client/mock.js";
import { silentLogger } from "../src/log.js";
import { buildServer } from "../src/server/http.js";

const opened: { app: App; dir: string }[] = [];
afterEach(async () => {
  for (const { app, dir } of opened.splice(0)) {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

async function setup(opts: { uiPassword?: string; metricsToken?: string; poll?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "deco-web-metrics-"));
  const api = new MockDecoApi();
  const app = createApp(loadConfig({ DECO_MOCK: "1", DATA_DIR: dir }), silentLogger, { api, channels: [] });
  opened.push({ app, dir });
  const server = await buildServer({ app, webDist: join(dir, "x"), uiPassword: opts.uiPassword, metricsToken: opts.metricsToken });
  if (opts.poll !== false) await app.poller.pollNow();
  return { app, api, server };
}

/** Valor de uma série, ex.: value(body, 'deco_clients{band="wired"}'). */
const value = (body: string, series: string) => {
  const line = body.split("\n").find((l) => l.startsWith(series + " "));
  return line === undefined ? undefined : Number(line.slice(series.length + 1));
};

describe("/metrics", () => {
  it("formato Prometheus a partir do cache, sem chamar o Deco", async () => {
    const { app, api, server } = await setup();
    const snap = app.poller.cache.snapshot!;
    const calls = api.calls;
    const res = await server.inject("/metrics");
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^text\/plain; version=0\.0\.4/);
    expect(api.calls).toBe(calls);

    const body = res.body;
    expect(body).toContain("# TYPE deco_up gauge");
    expect(value(body, "deco_up")).toBe(1);
    expect(value(body, 'deco_breaker_state{state="closed"}')).toBe(1);
    const nodeLines = body.split("\n").filter((l) => l.startsWith("deco_node_up{"));
    expect(nodeLines).toHaveLength(snap.nodes.length);
    const total = ["wired", "2.4GHz", "5GHz", "6GHz"].reduce((s, b) => s + (value(body, `deco_clients{band="${b}"}`) ?? 0), 0);
    expect(total).toBe(snap.clients.length);
    expect(value(body, "deco_reservations")).toBe(snap.reservations.length);
    expect(value(body, 'deco_internet_up{family="ipv4"}')).toBe(1);
    expect(value(body, "deco_cpu_ratio")).toBe(snap.performance!.cpu);
    expect(body).toMatch(/deco_wifi_enabled\{network="guest",band="2.4GHz",ssid="[^"]+"\} 0/);
    expect(body).not.toMatch(/password|psk/i);
  });

  it("usa o apelido do inventário e escapa aspas nos rótulos", async () => {
    const { app, server } = await setup();
    const c = app.poller.cache.snapshot!.clients[0]!;
    app.inventory.create({ alias: 'TV "sala"', macs: [c.mac] });
    const body = (await server.inject("/metrics")).body;
    expect(body).toContain(`deco_client_down_bytes_per_second{mac="${c.mac}",name="TV \\"sala\\""}`);
  });

  it("sem snapshot: só as métricas do painel, deco_up 0", async () => {
    const { server } = await setup({ poll: false });
    const body = (await server.inject("/metrics")).body;
    expect(value(body, "deco_up")).toBe(0);
    expect(body).not.toContain("deco_node_up");
  });

  it("UI com senha e sem METRICS_TOKEN: 401 explicando o que fazer", async () => {
    const { server } = await setup({ uiPassword: "segredo-da-ui" });
    const res = await server.inject("/metrics");
    expect(res.statusCode).toBe(401);
    expect(res.body).toMatch(/METRICS_TOKEN/);
  });

  it("com METRICS_TOKEN: Bearer certo passa, errado ou ausente não", async () => {
    const { server } = await setup({ uiPassword: "segredo-da-ui", metricsToken: "token-do-prometheus" });
    const get = (authorization?: string) => server.inject({ url: "/metrics", headers: authorization ? { authorization } : {} });
    expect((await get("Bearer token-do-prometheus")).statusCode).toBe(200);
    expect((await get("Bearer outro")).statusCode).toBe(401);
    expect((await get()).statusCode).toBe(401);
    // O token não abre a API.
    expect((await server.inject({ url: "/api/status", headers: { authorization: "Bearer token-do-prometheus" } })).statusCode).toBe(401);
  });
});
