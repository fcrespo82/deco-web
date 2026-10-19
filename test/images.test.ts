import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createApp, type App } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { extractCandidates, pickAuto, slugsFor, sniffImage, type FetchFn } from "../src/core/official-images.js";
import { MockDecoApi } from "../src/deco-client/mock.js";
import { silentLogger } from "../src/log.js";
import { buildServer } from "../src/server/http.js";
import { modelKey } from "../src/server/images.js";
import { topicsForWrite } from "../src/server/live.js";

// PNG 1×1 transparente.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]);

const opened: { app: App; server: FastifyInstance; dir: string }[] = [];
afterEach(async () => {
  for (const { app, server, dir } of opened.splice(0)) {
    await server.close();
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

async function setup(opts: { uiPassword?: string; fetch?: FetchFn } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "deco-web-images-"));
  const app = createApp(loadConfig({ DECO_MOCK: "1", DATA_DIR: dir }), silentLogger, new MockDecoApi());
  await app.poller.pollNow();
  const server = await buildServer({ app, uiPassword: opts.uiPassword, webDist: join(dir, "sem-web"), fetch: opts.fetch });
  opened.push({ app, server, dir });
  return { app, server };
}

const put = (server: FastifyInstance, url: string, body: Buffer, type = "image/png") =>
  server.inject({ method: "PUT", url, payload: body, headers: { "content-type": type } });

describe("imagens", () => {
  it("guarda, lista, serve e remove", async () => {
    const { server, app } = await setup();
    expect((await put(server, "/api/images/decos/X50", PNG)).statusCode).toBe(200);
    const manifest = (await server.inject("/api/images")).json();
    expect(manifest.decos.X50).toMatch(/^\/api\/images\/decos\/X50\?v=\d+&t=png$/);
    expect(manifest.models).toContain("X50");

    const img = await server.inject("/api/images/decos/X50");
    expect(img.statusCode).toBe(200);
    expect(img.headers["content-type"]).toBe("image/png");
    expect(img.headers["x-content-type-options"]).toBe("nosniff");
    expect(Buffer.compare(img.rawPayload, PNG)).toBe(0);

    // Trocar por JPEG substitui o PNG.
    expect((await put(server, "/api/images/decos/X50", JPEG, "image/jpeg")).statusCode).toBe(200);
    expect((await server.inject("/api/images/decos/X50")).headers["content-type"]).toBe("image/jpeg");

    expect(app.audit.list(5).map((e) => e.action)).toContain("image.set");
    const del = await server.inject({ method: "DELETE", url: "/api/images/decos/X50", headers: { "content-type": "application/json" }, payload: "{}" });
    expect(del.statusCode).toBe(200);
    expect((await server.inject("/api/images/decos/X50")).statusCode).toBe(404);
    expect((await server.inject("/api/images")).json().decos).toEqual({});
  });

  it("recusa SVG, bytes que não são imagem e nomes inválidos", async () => {
    const { server } = await setup();
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    expect((await put(server, "/api/images/decos/X50", svg, "image/svg+xml")).statusCode).toBe(415);
    expect((await put(server, "/api/images/decos/X50", Buffer.from("não sou png"))).statusCode).toBe(400);
    expect((await put(server, "/api/images/decos/..%2F..%2Fsegredo", PNG)).statusCode).toBe(400);
    expect((await put(server, "/api/images/outros/X50", PNG)).statusCode).toBe(400);
  });

  it("recusa imagem grande demais", async () => {
    const { server } = await setup();
    const big = Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)]);
    expect((await put(server, "/api/images/decos/X50", big)).statusCode).toBe(413);
  });

  it("exige sessão quando há senha", async () => {
    const { server } = await setup({ uiPassword: "segredo" });
    expect((await server.inject("/api/images")).statusCode).toBe(401);
    expect((await put(server, "/api/images/decos/X50", PNG)).statusCode).toBe(401);
  });

  it("avisa o canal ao vivo", () => {
    expect(topicsForWrite("/api/images/decos/X50")).toEqual(["images", "audit"]);
  });

  it("busca fotos oficiais só de static.tp-link.com", async () => {
    const page = `<img src="https://static.tp-link.com/Deco_X50(3-pack)_01_large_1.jpg">
      <img src="https://static.tp-link.com/Deco_X50_02_large_2.jpg">
      <img src="https://evil.example/x_large_3.jpg">`;
    const calls: string[] = [];
    const fetchFn: FetchFn = async (url) => {
      calls.push(url);
      if (url.includes("www.tp-link.com/us/home-networking/deco/deco-x50/")) return new Response(page);
      if (url.startsWith("https://static.tp-link.com/")) return new Response(PNG);
      return new Response("", { status: 404 });
    };
    const { server } = await setup({ fetch: fetchFn });

    const cand = (await server.inject("/api/images/official/candidates?model=X50")).json();
    expect(cand.candidates).toEqual(["https://static.tp-link.com/Deco_X50(3-pack)_01_large_1.jpg", "https://static.tp-link.com/Deco_X50_02_large_2.jpg"]);

    expect((await server.inject("/api/images/official/proxy?url=https://evil.example/a.png")).statusCode).toBe(400);
    const proxied = await server.inject(`/api/images/official/proxy?url=${encodeURIComponent(cand.candidates[1])}`);
    expect(proxied.statusCode).toBe(200);
    expect(proxied.headers["content-type"]).toBe("image/png");

    const auto = await server.inject({ method: "POST", url: "/api/images/official/auto", headers: { "content-type": "application/json" }, payload: "{}" });
    const results = auto.json().results as { model: string; status: string; url: string | null }[];
    // Escolhe a foto sem "pack" para o X50; os outros modelos não têm página no fetch falso.
    expect(results.find((r) => r.model === "X50")).toMatchObject({ status: "ok", url: "https://static.tp-link.com/Deco_X50_02_large_2.jpg" });
    expect(results.find((r) => r.model === "M5")?.status).toBe("not-found");
    expect((await server.inject("/api/images")).json().decos.X50).toBeTruthy();
  });
});

describe("fotos oficiais: funções puras", () => {
  it("variações de nome da página", () => {
    expect(slugsFor("M4R")).toEqual(["deco-m4r", "deco-m4"]);
    expect(slugsFor("X50-Outdoor")).toEqual(["deco-x50-outdoor", "deco-x50"]);
    expect(modelKey("Deco X50")).toBe("X50");
  });

  it("extrai e escolhe candidatas", () => {
    const html = `"https://static.tp-link.com/A(3-pack)_large_1.jpg" 'http://static.tp-link.com/B_large_2.png' https://static.tp-link.com/C_normal_3.jpg`;
    const list = extractCandidates(html);
    expect(list).toEqual(["https://static.tp-link.com/A(3-pack)_large_1.jpg", "https://static.tp-link.com/B_large_2.png"]);
    expect(pickAuto(list)).toBe("https://static.tp-link.com/B_large_2.png");
    expect(pickAuto(["https://static.tp-link.com/X_large.jpg", "https://static.tp-link.com/Deco-M4-(1-pack)_large.jpg"])).toMatch(/1-pack/);
    expect(pickAuto([])).toBeNull();
  });

  it("reconhece o tipo pelos bytes", () => {
    expect(sniffImage(PNG)).toBe("png");
    expect(sniffImage(JPEG)).toBe("jpeg");
    expect(sniffImage(Buffer.from("RIFF\0\0\0\0WEBPVP8 "))).toBe("webp");
    expect(sniffImage(Buffer.from("<svg"))).toBeNull();
  });
});
