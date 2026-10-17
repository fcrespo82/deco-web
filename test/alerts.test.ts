/**
 * Alertas: canais contra um servidor HTTP falso (ntfy e Telegram), motor de
 * alertas com relógio controlado e a API (aprovação, teste).
 */
import { createServer, type IncomingMessage, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp, type App } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { AlertEngine, formatDuration, type AlertSettings } from "../src/core/alerts.js";
import type { NetEvent } from "../src/core/events.js";
import { MockDecoApi } from "../src/deco-client/mock.js";
import type { Snapshot } from "../src/deco-client/types.js";
import { AlertRepo } from "../src/db/alerts.js";
import { Store } from "../src/db/store.js";
import { silentLogger } from "../src/log.js";
import { NtfyChannel, TelegramChannel, broadcast } from "../src/notify/channels.js";
import { buildServer } from "../src/server/http.js";

// --- servidor falso ---------------------------------------------------------

interface Hit {
  method: string;
  url: string;
  headers: IncomingMessage["headers"];
  body: any;
}

let fake: Server;
let base = "";
const hits: Hit[] = [];
/** Resposta da próxima requisição: status ou "hang" (nunca responde). */
const replies: (number | "hang")[] = [];

beforeAll(async () => {
  fake = createServer((req, res) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      hits.push({ method: req.method!, url: req.url!, headers: req.headers, body: data ? JSON.parse(data) : null });
      const reply = replies.shift() ?? 200;
      if (reply === "hang") return;
      res.writeHead(reply, { "content-type": "application/json" });
      res.end(reply === 200 ? '{"ok":true}' : `{"error":"falhou em ${req.url}"}`);
    });
  });
  await new Promise<void>((r) => fake.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`;
});
afterAll(() => {
  fake.closeAllConnections();
  fake.close();
});
beforeEach(() => {
  hits.length = 0;
  replies.length = 0;
});

const TOKEN = "123456:SEGREDO-do-bot";

describe("canais", () => {
  it("ntfy: publica JSON no servidor com tópico, título UTF-8, prioridade e token", async () => {
    const ch = new NtfyChannel(`${base}/meu-topico`, "tk_abc");
    await ch.send({ title: "Nó Escritório offline", body: "há 6 min", priority: 5, tags: ["warning"], url: "http://painel/#/" });
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      method: "POST",
      url: "/",
      headers: { authorization: "Bearer tk_abc", "content-type": "application/json" },
      body: { topic: "meu-topico", title: "Nó Escritório offline", message: "há 6 min", priority: 5, tags: ["warning"], click: "http://painel/#/" },
    });
    expect(ch.target).not.toContain("meu-topico");
  });

  it("ntfy em subcaminho (proxy): publica no prefixo", async () => {
    await new NtfyChannel(`${base}/ntfy/alertas`, null).send({ title: "t", body: "b" });
    expect(hits[0]).toMatchObject({ url: "/ntfy/", body: { topic: "alertas" } });
    expect(hits[0]!.headers.authorization).toBeUndefined();
  });

  it("telegram: sendMessage com chat_id e texto", async () => {
    await new TelegramChannel(base, TOKEN, "-100123").send({ title: "Dispositivo novo: Tablet", body: "192.168.68.120" });
    expect(hits[0]).toMatchObject({
      url: `/bot${TOKEN}/sendMessage`,
      body: { chat_id: "-100123", text: "Dispositivo novo: Tablet\n192.168.68.120", disable_web_page_preview: true },
    });
  });

  it("erro HTTP vira mensagem sem o token", async () => {
    replies.push(500);
    const err = await new TelegramChannel(base, TOKEN, "1").send({ title: "t", body: "b" }).catch((e) => e);
    expect(err.message).toMatch(/^HTTP 500/);
    expect(err.message).not.toContain(TOKEN);
    expect(err.message).toContain("***");
  });

  it("timeout: falha sem travar, uma tentativa só", async () => {
    replies.push("hang");
    const res = await broadcast([new NtfyChannel(`${base}/t`, null, { timeoutMs: 200 })], { title: "t", body: "b" });
    expect(res).toEqual([{ channel: "ntfy", ok: false, error: "falha de rede: tempo esgotado" }]);
    expect(hits).toHaveLength(1);
  });

  it("broadcast: um canal falhando não impede o outro", async () => {
    replies.push(200, 403);
    const res = await broadcast(
      [new NtfyChannel(`${base}/t`, null), new TelegramChannel(base, TOKEN, "1")],
      { title: "t", body: "b" },
    );
    expect(res.map((r) => r.ok).sort()).toEqual([false, true]);
  });
});

describe("formatDuration", () => {
  it("min, h, d", () => {
    expect(formatDuration(20_000)).toBe("1 min");
    expect(formatDuration(7 * 60_000)).toBe("7 min");
    expect(formatDuration(65 * 60_000)).toBe("1 h 5 min");
    expect(formatDuration(26 * 3600_000)).toBe("1 d 2 h");
  });
});

// --- motor --------------------------------------------------------------------

describe("AlertEngine", () => {
  let dir: string;
  let store: Store;
  let base0: Snapshot;
  let clock: number;
  const approved = new Set<string>();

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "deco-web-alert-"));
    store = new Store(join(dir, "db.sqlite"));
    base0 = await new MockDecoApi().fetchSnapshot();
    clock = Date.parse("2026-10-17T12:00:00Z");
    approved.clear();
  });
  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const engine = (settings: Partial<AlertSettings> = {}) =>
    new AlertEngine({
      settings: { newDevice: true, nodeOfflineMs: 5 * 60_000, internetDownMs: 3 * 60_000, publicUrl: "http://deco.lan", ...settings },
      channels: [new NtfyChannel(`${base}/alertas`, null)],
      repo: new AlertRepo(store.db),
      kv: store,
      isApproved: (mac) => approved.has(mac),
      aliasOf: () => null,
      logger: silentLogger,
      now: () => new Date(clock),
    });
  const at = () => new Date(clock).toISOString();
  const newClient = (mac: string, name = "Tablet"): NetEvent => ({ at: at(), type: "client_new", mac, data: { name, ip: "192.168.68.150" } });
  const slave = () => base0.nodes.find((n) => n.role === "slave")!;
  const withNode = (online: boolean): Snapshot => ({
    ...base0,
    nodes: base0.nodes.map((n) => (n.mac === slave().mac ? { ...n, online } : n)),
  });
  const withInternet = (up: boolean): Snapshot => ({ ...base0, internet: { ...base0.internet!, ipv4Online: up } });

  it("primeiro snapshot (sem anterior) é linha de base: sem alerta de novo", async () => {
    const e = engine();
    expect(await e.process([newClient("AA-00-00-00-00-01")], base0, null)).toEqual([]);
    expect(hits).toHaveLength(0);
  });

  it("dispositivo novo: alerta com IP, MAC e link; aprovado não alerta", async () => {
    approved.add("AA-00-00-00-00-02");
    const sent = await engine().process([newClient("AA-00-00-00-00-01"), newClient("AA-00-00-00-00-02", "Conhecido")], base0, base0);
    expect(sent).toHaveLength(1);
    expect(hits[0]!.body).toMatchObject({
      title: "Dispositivo novo: Tablet",
      priority: 4,
      click: "http://deco.lan/#/alertas",
    });
    expect(hits[0]!.body.message).toContain("AA-00-00-00-00-01");
    expect(sent[0]!.delivery).toEqual([{ channel: "ntfy", ok: true }]);
  });

  it("mais de 5 novos no mesmo poll: um alerta-resumo", async () => {
    const events = Array.from({ length: 8 }, (_, i) => newClient(`AA-00-00-00-00-1${i}`, `Aparelho ${i}`));
    const sent = await engine().process(events, base0, base0);
    expect(sent).toHaveLength(1);
    expect(hits[0]!.body.title).toBe("8 dispositivos novos na rede");
  });

  it("ALERT_NEW_DEVICE=0 desliga", async () => {
    expect(await engine({ newDevice: false }).process([newClient("AA-00-00-00-00-01")], base0, base0)).toEqual([]);
  });

  it("nó offline: só alerta depois do limite, uma vez; avisa a volta", async () => {
    const e = engine();
    const mac = slave().mac;
    await e.process([{ at: at(), type: "node_offline", mac, data: { name: slave().name } }], withNode(false), base0);
    clock += 3 * 60_000;
    expect(await e.process([], withNode(false), base0)).toEqual([]);
    clock += 3 * 60_000;
    const sent = await e.process([], withNode(false), base0);
    expect(sent.map((a) => a.kind)).toEqual(["node_offline"]);
    expect(hits.at(-1)!.body).toMatchObject({ title: `Nó ${slave().name} offline`, priority: 5 });
    clock += 60_000;
    expect(await e.process([], withNode(false), base0)).toEqual([]); // não repete
    clock += 60_000;
    const back = await e.process([{ at: at(), type: "node_online", mac, data: {} }], withNode(true), base0);
    expect(back.map((a) => a.kind)).toEqual(["node_online"]);
    expect(hits.at(-1)!.body.message).toBe("Ficou fora por 8 min.");
  });

  it("nó que volta antes do limite: nenhum alerta", async () => {
    const e = engine();
    const mac = slave().mac;
    await e.process([{ at: at(), type: "node_offline", mac, data: { name: "X" } }], withNode(false), base0);
    clock += 2 * 60_000;
    await e.process([{ at: at(), type: "node_online", mac, data: {} }], withNode(true), base0);
    clock += 10 * 60_000;
    await e.process([], withNode(true), base0);
    expect(hits).toHaveLength(0);
  });

  it("restart no meio de uma queda: o estado persiste e não repete alerta", async () => {
    const mac = slave().mac;
    await engine().process([{ at: at(), type: "node_offline", mac, data: { name: "X" } }], withNode(false), base0);
    clock += 6 * 60_000;
    expect(await engine().process([], withNode(false), base0)).toHaveLength(1); // instância nova, mesmo banco
    clock += 60_000;
    expect(await engine().process([], withNode(false), base0)).toHaveLength(0);
  });

  it("internet: a volta é avisada mesmo quando o alerta de queda não saiu", async () => {
    const e = engine();
    await e.process([{ at: at(), type: "internet_down", mac: null, data: {} }], withInternet(false), base0);
    clock += 4 * 60_000;
    replies.push(502); // sem internet: o canal falha
    const down = await e.process([], withInternet(false), base0);
    expect(down[0]!.delivery[0]).toMatchObject({ ok: false, error: expect.stringMatching(/^HTTP 502/) });
    clock += 60_000;
    const up = await e.process([{ at: at(), type: "internet_up", mac: null, data: {} }], withInternet(true), base0);
    expect(up.map((a) => a.kind)).toEqual(["internet_up"]);
    expect(hits.at(-1)!.body.message).toMatch(/^Ficou fora por 5 min, desde /);
  });

  it("queda curta de internet: nada", async () => {
    const e = engine();
    await e.process([{ at: at(), type: "internet_down", mac: null, data: {} }], withInternet(false), base0);
    clock += 60_000;
    await e.process([{ at: at(), type: "internet_up", mac: null, data: {} }], withInternet(true), base0);
    expect(hits).toHaveLength(0);
  });
});

// --- API ------------------------------------------------------------------------

describe("API de alertas", () => {
  const opened: { app: App; dir: string }[] = [];
  afterEach(async () => {
    for (const { app, dir } of opened.splice(0)) {
      await app.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  async function setup(channels = [new NtfyChannel(`${base}/alertas`, null)]) {
    const dir = mkdtempSync(join(tmpdir(), "deco-web-alert-api-"));
    const api = new MockDecoApi();
    const app = createApp(loadConfig({ DECO_MOCK: "1", DATA_DIR: dir }), silentLogger, { api, channels });
    opened.push({ app, dir });
    const server = await buildServer({ app, webDist: join(dir, "x") });
    return { app, api, server };
  }
  const post = (server: Awaited<ReturnType<typeof setup>>["server"], url: string, payload: object = {}) =>
    server.inject({ method: "POST", url, payload, headers: { "content-type": "application/json" } });

  it("ponta a ponta: linha de base, aprovação em massa, MAC novo alerta pelo servidor falso", async () => {
    const { app, api, server } = await setup();
    await app.poller.pollNow();
    await app.alertEngine.idle();
    expect(hits).toHaveLength(0);

    let body = (await server.inject("/api/alerts")).json();
    expect(body.channels).toEqual([{ name: "ntfy", target: expect.stringContaining("tópico configurado") }]);
    expect(body.pending.length).toBe(28);

    const res = await post(server, "/api/devices/approve", { macs: body.pending.map((c: any) => c.mac) });
    expect(res.json()).toEqual({ approved: 28 });
    expect((await server.inject("/api/alerts")).json().pending).toHaveLength(0);

    api.mutate((raw) => {
      (raw.clientList as any).client_list.push({ mac: "DE-AD-BE-EF-00-01", name: "Celular visitante", ip: "192.168.68.150", online: true, wire_type: "wireless", connection_type: "band5", interface: "main" });
    });
    await app.poller.pollNow();
    await app.alertEngine.idle();
    expect(hits).toHaveLength(1);
    expect(hits[0]!.body.title).toBe("Dispositivo novo: Celular visitante");

    body = (await server.inject("/api/alerts")).json();
    expect(body.alerts[0]).toMatchObject({ kind: "new_device", mac: "DE-AD-BE-EF-00-01", delivery: [{ channel: "ntfy", ok: true }] });
    expect(body.pending.map((c: any) => c.mac)).toEqual(["DE-AD-BE-EF-00-01"]);
  });

  it("teste: envia, registra, audita e limita a frequência", async () => {
    const { server } = await setup();
    const res = await post(server, "/api/alerts/test");
    expect(res.json()).toMatchObject({ kind: "test", delivery: [{ channel: "ntfy", ok: true }] });
    expect(hits[0]!.body.title).toBe("Deco Dashboard: teste");
    expect((await post(server, "/api/alerts/test")).statusCode).toBe(429);
    expect((await server.inject("/api/audit")).json().entries[0]).toMatchObject({ action: "alerts.test", result: "ok" });
  });

  it("teste sem canal: 400", async () => {
    const { server } = await setup([]);
    expect((await post(server, "/api/alerts/test")).statusCode).toBe(400);
  });
});

describe("config de alertas", () => {
  it("padrões, desligar com 0 e validação", () => {
    const c = loadConfig({ DECO_MOCK: "1" });
    expect(c.alerts).toEqual({ newDevice: true, nodeOfflineMs: 300_000, internetDownMs: 180_000, publicUrl: null });
    const off = loadConfig({ DECO_MOCK: "1", ALERT_NODE_OFFLINE_MINUTES: "0", ALERT_NEW_DEVICE: "0", PUBLIC_URL: "http://deco.lan:8080/" });
    expect(off.alerts).toMatchObject({ newDevice: false, nodeOfflineMs: null, publicUrl: "http://deco.lan:8080" });
    expect(() => loadConfig({ DECO_MOCK: "1", NOTIFY_NTFY_URL: "https://ntfy.sh" })).toThrow(/tópico/);
    expect(() => loadConfig({ DECO_MOCK: "1", NOTIFY_TELEGRAM_CHAT_ID: "1" })).toThrow(/juntos/);
  });
});
