import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApp, type App } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { MockDecoApi } from "../src/deco-client/mock.js";
import { DecoApiError, DecoTimeoutError } from "../src/deco-client/errors.js";
import { silentLogger } from "../src/log.js";
import { buildServer } from "../src/server/http.js";

const opened: { app: App; dir: string }[] = [];
afterEach(async () => {
  for (const { app, dir } of opened.splice(0)) {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

const DANGEROUS = { DECO_ALLOW_WRITE: "1", DECO_ALLOW_DANGEROUS: "1" };

async function setup(env: Record<string, string> = DANGEROUS) {
  const dir = mkdtempSync(join(tmpdir(), "deco-web-sys-"));
  const api = new MockDecoApi();
  const app = createApp(loadConfig({ DECO_MOCK: "1", DATA_DIR: dir, ...env }), silentLogger, { api, channels: [] });
  opened.push({ app, dir });
  const server = await buildServer({ app, webDist: join(dir, "x") });
  await app.poller.pollNow();
  const nodes = app.poller.cache.snapshot!.nodes;
  const gateway = nodes.find((n) => n.role === "master")!;
  const satellite = nodes.find((n) => n.role === "slave")!;
  const post = (url: string, payload: object) =>
    server.inject({ method: "POST", url, payload, headers: { "content-type": "application/json" } });
  const audit = async () => (await server.inject("/api/audit")).json().entries;
  return { app, api, server, post, audit, gateway, satellite };
}

describe("permissões", () => {
  it("sem DECO_ALLOW_DANGEROUS: 403 e nada chega ao Deco", async () => {
    const { api, post, satellite } = await setup({ DECO_ALLOW_WRITE: "1" });
    const calls = api.calls;
    expect((await post("/api/nodes/reboot", { macs: [satellite.mac], confirm: true })).statusCode).toBe(403);
    expect((await post("/api/wifi", { network: "guest", enabled: true, confirm: true })).statusCode).toBe(403);
    expect(api.calls).toBe(calls);
    expect(api.writes).toEqual([]);
  });

  it("exige confirm: true", async () => {
    const { post, satellite } = await setup();
    expect((await post("/api/nodes/reboot", { macs: [satellite.mac] })).statusCode).toBe(400);
    expect((await post("/api/wifi", { network: "guest", enabled: true })).statusCode).toBe(400);
  });
});

describe("reiniciar", () => {
  it("satélite: uma chamada, auditada; leituras seguem normais", async () => {
    const { app, api, post, audit, satellite } = await setup();
    const res = await post("/api/nodes/reboot", { macs: [satellite.mac], confirm: true });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ outcome: "sent", ok: true, nodes: [{ mac: satellite.mac, role: "slave" }] });
    expect(api.writes).toEqual([`reboot ${satellite.mac}`]);
    expect((await audit())[0]).toMatchObject({ action: "node.reboot", result: "ok" });
    expect(app.poller.cache.pausedUntil).toBeNull();
  });

  it("gateway: suspende as leituras por 3 minutos", async () => {
    const { app, api, post, gateway } = await setup();
    await post("/api/nodes/reboot", { macs: [gateway.mac], confirm: true });
    expect(app.poller.cache.pausedUntil).not.toBeNull();
    const calls = api.calls;
    expect(await app.poller.pollNow()).toBeNull();
    expect(api.calls).toBe(calls);
  });

  it("de novo em menos de 5 minutos: 409, sem chamar o Deco", async () => {
    const { api, post, satellite } = await setup();
    await post("/api/nodes/reboot", { macs: [satellite.mac], confirm: true });
    const res = await post("/api/nodes/reboot", { macs: [satellite.mac], confirm: true });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatch(/reiniciado há pouco/);
    expect(api.writes).toHaveLength(1);
  });

  it("MAC que não é nó: 409 antes de abrir sessão", async () => {
    const { api, post } = await setup();
    const calls = api.calls;
    const res = await post("/api/nodes/reboot", { macs: ["02-00-00-00-00-01"], confirm: true });
    expect(res.statusCode).toBe(409);
    expect(api.calls).toBe(calls);
  });

  it("resposta perdida: ambiguous, sem reenviar, e conta para o intervalo mínimo", async () => {
    const { api, post, satellite } = await setup();
    api.failNextWrite({ error: new DecoTimeoutError("timeout"), applied: true });
    const res = await post("/api/nodes/reboot", { macs: [satellite.mac], confirm: true });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ outcome: "ambiguous", ok: false });
    expect(api.writes).toHaveLength(1);
    expect((await post("/api/nodes/reboot", { macs: [satellite.mac], confirm: true })).statusCode).toBe(409);
  });

  it("recusa do firmware: rejected, e pode tentar de novo depois", async () => {
    const { api, post, satellite } = await setup();
    api.failNextWrite({ error: new DecoApiError("error_code -1", -1) });
    const res = await post("/api/nodes/reboot", { macs: [satellite.mac], confirm: true });
    expect(res.json()).toMatchObject({ outcome: "rejected" });
    expect((await post("/api/nodes/reboot", { macs: [satellite.mac], confirm: true })).statusCode).toBe(200);
  });
});

describe("Wi-Fi", () => {
  const guest = (app: App) => app.poller.cache.snapshot!.wifi!.filter((w) => w.kind === "guest");

  it("liga a rede de convidados nas duas bandas, só com o campo que muda", async () => {
    const { app, api, post, audit } = await setup();
    const res = await post("/api/wifi", { network: "guest", enabled: true, confirm: true });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      outcome: "applied",
      before: { network: "guest", enabled: false },
      after: { network: "guest", enabled: true, bands: ["5GHz", "2.4GHz"] },
      passwordChanged: false,
    });
    expect(api.wifiWrites).toEqual([{ band5_1: { guest: { enable: true } }, band2_4: { guest: { enable: true } } }]);
    expect(guest(app).every((w) => w.enabled)).toBe(true); // cache atualizado sem novo poll
    expect((await audit())[0]).toMatchObject({ action: "wifi.change", target: "wifi:guest", before: { enabled: false }, after: { enabled: true } });
  });

  it("SSID e senha vão em base64, como o firmware guarda; a senha não volta nem vai para a auditoria", async () => {
    const { api, server, post, audit } = await setup();
    const password = "nova-senha-convidados";
    const res = await post("/api/wifi", { network: "guest", ssid: "Visitas Ç", password, confirm: true });
    expect(res.json()).toMatchObject({ outcome: "applied", after: { ssid: "Visitas Ç" }, passwordChanged: true });
    const sent = api.wifiWrites[0] as Record<string, { guest: Record<string, string> }>;
    expect(sent.band2_4!.guest).toEqual({
      ssid: Buffer.from("Visitas Ç").toString("base64"),
      password: Buffer.from(password).toString("base64"),
    });
    expect(api.wifiPasswords.get("band5_1/guest")).toBe(password);
    const entries = await audit();
    expect(entries[0].after).toMatchObject({ ssid: "Visitas Ç", passwordChanged: true });
    const everything = res.body + JSON.stringify(entries) + (await server.inject("/api/overview")).body;
    expect(everything).not.toContain(password);
    expect(everything).not.toContain(Buffer.from(password).toString("base64"));
  });

  it("nada a mudar: noop, sem escrita", async () => {
    const { api, post } = await setup();
    const res = await post("/api/wifi", { network: "guest", enabled: false, confirm: true });
    expect(res.json()).toMatchObject({ outcome: "noop", ok: true });
    expect(api.wifiWrites).toEqual([]);
  });

  it("IoT: escreve em iot.host", async () => {
    const { api, post } = await setup();
    await post("/api/wifi", { network: "iot", ssid: "Casa IoT", confirm: true });
    expect(api.wifiWrites).toEqual([{ iot: { host: { ssid: Buffer.from("Casa IoT").toString("base64") } } }]);
  });

  it("não deixa desligar a rede principal", async () => {
    const { api, post } = await setup();
    const res = await post("/api/wifi", { network: "host", enabled: false, confirm: true });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/rede principal não pode ser desligada/);
    expect(api.calls).toBe(1);
  });

  it("valida SSID e senha sem ecoar a senha", async () => {
    const { post } = await setup();
    const bad = async (body: object) => (await post("/api/wifi", { network: "guest", confirm: true, ...body })).json().error as string;
    expect(await bad({ ssid: "" })).toMatch(/SSID vazio/);
    expect(await bad({ ssid: "x".repeat(33) })).toMatch(/32 bytes/);
    expect(await bad({ ssid: " Casa" })).toMatch(/espaço/);
    const short = await bad({ password: "curta12" });
    expect(short).toMatch(/8 a 63/);
    expect(short).not.toContain("curta12");
    expect(await bad({ password: "çççççççççç" })).toMatch(/sem acentos/);
    expect(await bad({})).toMatch(/Nada a alterar/);
    expect(await bad({ network: "mesh" })).toMatch(/Rede inválida/);
  });

  it("resposta perdida, mas aplicada: a releitura confirma", async () => {
    const { api, post } = await setup();
    api.failNextWrite({ error: new DecoTimeoutError("timeout"), applied: true });
    const res = await post("/api/wifi", { network: "guest", enabled: true, confirm: true });
    expect(res.json()).toMatchObject({ outcome: "applied", ok: true });
    expect(api.wifiWrites).toHaveLength(1);
  });

  it("recusa do firmware: rejected, nada mudou", async () => {
    const { app, api, post } = await setup();
    api.failNextWrite({ error: new DecoApiError("error_code -40210", -40210) });
    const res = await post("/api/wifi", { network: "guest", enabled: true, confirm: true });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ outcome: "rejected", passwordChanged: false });
    expect(guest(app).every((w) => !w.enabled)).toBe(true);
  });

  it("sem releitura: ambiguous, nada reenviado", async () => {
    const { api, post } = await setup();
    api.failNextWrite({ error: new DecoTimeoutError("timeout"), applied: true });
    // Leitura inicial ok; as duas releituras falham.
    const mock = api as unknown as { encodedWlan(): Record<string, unknown> };
    const read = mock.encodedWlan.bind(api);
    let n = 0;
    mock.encodedWlan = () => {
      n += 1;
      if (n > 1) throw new DecoTimeoutError("timeout");
      return read();
    };
    const res = await post("/api/wifi", { network: "guest", enabled: true, confirm: true });
    expect(res.json()).toMatchObject({ outcome: "ambiguous", ok: false, after: null });
    expect(api.wifiWrites).toHaveLength(1);
    expect(n).toBe(3);
  });
});
