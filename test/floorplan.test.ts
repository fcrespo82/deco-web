import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createApp, type App } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { MockDecoApi } from "../src/deco-client/mock.js";
import { silentLogger } from "../src/log.js";
import { parseFloorplan } from "../src/server/floorplan.js";
import { buildServer } from "../src/server/http.js";
import { topicsForWrite } from "../src/server/live.js";

const opened: { app: App; server: FastifyInstance; dir: string }[] = [];
afterEach(async () => {
  for (const { app, server, dir } of opened.splice(0)) {
    await server.close();
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

async function setup() {
  const dir = mkdtempSync(join(tmpdir(), "deco-web-floorplan-"));
  const app = createApp(loadConfig({ DECO_MOCK: "1", DATA_DIR: dir }), silentLogger, new MockDecoApi());
  const server = await buildServer({ app, webDist: join(dir, "sem-web") });
  opened.push({ app, server, dir });
  return { app, server };
}

const put = (server: FastifyInstance, body: unknown) =>
  server.inject({ method: "PUT", url: "/api/floorplan", headers: { "content-type": "application/json" }, payload: JSON.stringify(body) });

describe("planta da casa", () => {
  it("começa vazia e guarda posições e escala", async () => {
    const { server, app } = await setup();
    expect((await server.inject("/api/floorplan")).json()).toEqual({ nodes: {}, widthMeters: 15 });

    const res = await put(server, { widthMeters: 12.34, nodes: { "a8:42:a1:09:35:b6": { x: 0.5, y: 0.25 } } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ widthMeters: 12.3, nodes: { "A8-42-A1-09-35-B6": { x: 0.5, y: 0.25 } } });
    expect((await server.inject("/api/floorplan")).json().nodes["A8-42-A1-09-35-B6"]).toEqual({ x: 0.5, y: 0.25 });
    expect(app.audit.list(1)[0]!.action).toBe("floorplan.update");
  });

  it("recusa posição fora da planta, MAC inválido e escala absurda", async () => {
    const { server } = await setup();
    expect((await put(server, { widthMeters: 10, nodes: { "A8-42-A1-09-35-B6": { x: 1.5, y: 0 } } })).statusCode).toBe(400);
    expect((await put(server, { widthMeters: 10, nodes: { "não-é-mac": { x: 0, y: 0 } } })).statusCode).toBe(400);
    expect((await put(server, { widthMeters: 1000, nodes: {} })).statusCode).toBe(400);
    expect(() => parseFloorplan(null)).toThrow();
  });

  it("aceita a imagem da planta e avisa o canal ao vivo", async () => {
    const { server } = await setup();
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
    const res = await server.inject({ method: "PUT", url: "/api/images/floorplan/casa", payload: png, headers: { "content-type": "image/png" } });
    expect(res.statusCode).toBe(200);
    expect((await server.inject("/api/images")).json().floorplan.casa).toMatch(/^\/api\/images\/floorplan\/casa\?/);
    expect(topicsForWrite("/api/floorplan")).toEqual(["floorplan", "audit"]);
  });
});
