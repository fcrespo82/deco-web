import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createApp, type App } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import type { NetEventType } from "../src/core/events.js";
import { MockDecoApi } from "../src/deco-client/mock.js";
import { silentLogger } from "../src/log.js";
import { buildServer } from "../src/server/http.js";
import { buildPresence } from "../src/server/presence.js";

const T0 = Date.parse("2026-10-18T00:00:00.000Z");
const H = 3600_000;
const at = (h: number) => new Date(T0 + h * H).toISOString();
const ev = (h: number, type: NetEventType, mac = "AA") => ({ at: at(h), type, mac });

describe("buildPresence", () => {
  const base = { fromMs: T0, toMs: T0 + 24 * H, before: new Map<string, NetEventType>(), onlineNow: new Set<string>() };

  it("monta intervalos a partir de conexões e quedas", () => {
    const p = buildPresence({ ...base, events: [ev(1, "client_connected"), ev(3, "client_disconnected"), ev(5, "client_connected"), ev(8, "client_disconnected")] });
    expect(p.get("AA")).toEqual([
      [T0 + H, T0 + 3 * H],
      [T0 + 5 * H, T0 + 8 * H],
    ]);
  });

  it("usa o estado de antes da janela", () => {
    const p = buildPresence({ ...base, before: new Map([["AA", "client_connected"], ["BB", "client_disconnected"]]), events: [ev(2, "client_disconnected")] });
    expect(p.get("AA")).toEqual([[T0, T0 + 2 * H]]);
    expect(p.has("BB")).toBe(false);
  });

  it("deixa aberto quem está online agora e fecha no fim quem caiu sem evento ainda", () => {
    const p = buildPresence({ ...base, onlineNow: new Set(["AA"]), events: [ev(4, "client_new"), ev(6, "client_connected", "BB")] });
    expect(p.get("AA")).toEqual([[T0 + 4 * H, null]]);
    expect(p.get("BB")).toEqual([[T0 + 6 * H, T0 + 24 * H]]);
  });

  it("aparelho online sem nenhum evento conta desde o início da janela", () => {
    const p = buildPresence({ ...base, onlineNow: new Set(["CC"]), events: [] });
    expect(p.get("CC")).toEqual([[T0, null]]);
  });

  it("ignora conexão repetida e queda sem conexão", () => {
    const p = buildPresence({ ...base, events: [ev(1, "client_disconnected"), ev(2, "client_connected"), ev(3, "client_connected"), ev(4, "client_disconnected")] });
    expect(p.get("AA")).toEqual([[T0 + 2 * H, T0 + 4 * H]]);
  });
});

describe("GET /api/history/presence", () => {
  const opened: { app: App; server: FastifyInstance; dir: string }[] = [];
  afterEach(async () => {
    for (const { app, server, dir } of opened.splice(0)) {
      await server.close();
      await app.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("devolve os aparelhos online da leitura atual", async () => {
    const dir = mkdtempSync(join(tmpdir(), "deco-web-presence-"));
    const app = createApp(loadConfig({ DECO_MOCK: "1", DATA_DIR: dir }), silentLogger, new MockDecoApi());
    await app.poller.pollNow();
    const server = await buildServer({ app, webDist: join(dir, "sem-web") });
    opened.push({ app, server, dir });

    const res = await server.inject("/api/history/presence?hours=24");
    expect(res.statusCode).toBe(200);
    const body = res.json() as { devices: { mac: string; intervals: [string, string | null][] }[] };
    const online = app.poller.cache.snapshot!.clients.map((c) => c.mac);
    expect(body.devices.map((d) => d.mac).sort()).toEqual([...online].sort());
    expect(body.devices.every((d) => d.intervals.at(-1)![1] === null)).toBe(true);

    const samples = await server.inject("/api/history/samples?hours=720&points=720");
    expect(samples.json().bucketMs).toBe(3600_000);
  });
});
