import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createApp, type App } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { MockDecoApi } from "../src/deco-client/mock.js";
import { silentLogger } from "../src/log.js";
import { buildServer } from "../src/server/http.js";
import { topicsForWrite } from "../src/server/live.js";
import type { LiveMessage } from "../src/server/api-types.js";

const opened: { app: App; server: FastifyInstance; dir: string }[] = [];
afterEach(async () => {
  for (const { app, server, dir } of opened.splice(0)) {
    await server.close();
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

async function setup(uiPassword?: string) {
  const dir = mkdtempSync(join(tmpdir(), "deco-web-live-"));
  const app = createApp(loadConfig({ DECO_MOCK: "1", DATA_DIR: dir }), silentLogger, new MockDecoApi());
  const server = await buildServer({ app, uiPassword, webDist: join(dir, "sem-web") });
  opened.push({ app, server, dir });
  await server.listen({ host: "127.0.0.1", port: 0 });
  const base = `http://127.0.0.1:${(server.server.address() as AddressInfo).port}`;
  return { app, server, base };
}

/** Lê mensagens "change" do stream até `until` aceitar uma. */
async function readUntil(res: Response, until: (m: LiveMessage) => boolean): Promise<LiveMessage[]> {
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
  const seen: LiveMessage[] = [];
  let buf = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) throw new Error("stream terminou");
      buf += value;
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const data = block.split("\n").find((l) => l.startsWith("data: "));
        if (!data) continue;
        const msg = JSON.parse(data.slice(6)) as LiveMessage;
        seen.push(msg);
        if (until(msg)) return seen;
      }
    }
  } finally {
    await reader.cancel();
  }
}

describe("canal ao vivo", () => {
  it("abre com o status e avisa o snapshot novo", async () => {
    const { app, base } = await setup();
    const res = await fetch(`${base}/api/live`);
    expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);
    void app.poller.pollNow();
    const msgs = await readUntil(res, (m) => m.topics.includes("snapshot"));
    expect(msgs[0]!.topics).toEqual(["status"]);
    expect(msgs[0]!.status.fetchedAt).toBeNull();
    expect(msgs.at(-1)!.status.fetchedAt).not.toBeNull();
  });

  it("escrita na API avisa os tópicos dela", async () => {
    const { app, base } = await setup();
    await app.poller.pollNow();
    const res = await fetch(`${base}/api/live`);
    const created = await fetch(`${base}/api/ipplan/ranges`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Servidores", spec: ".20-.39", kind: "static" }),
    });
    expect(created.status).toBe(201);
    const msgs = await readUntil(res, (m) => m.topics.includes("ipplan"));
    expect(msgs.at(-1)!.topics).toEqual(expect.arrayContaining(["ipplan", "audit"]));
  });

  it("exige a sessão da UI", async () => {
    const { base } = await setup("segredo");
    const res = await fetch(`${base}/api/live`);
    expect(res.status).toBe(401);
  });

  it("status mostra a leitura em andamento", async () => {
    const { app, server } = await setup();
    const poll = app.poller.pollNow();
    expect((await server.inject("/api/status")).json().polling).toBe(true);
    await poll;
    expect((await server.inject("/api/status")).json().polling).toBe(false);
  });

  it("tópicos por caminho de escrita", () => {
    expect(topicsForWrite("/api/auth/login")).toEqual([]);
    expect(topicsForWrite("/api/devices/3/macs")).toContain("inventory");
    expect(topicsForWrite("/api/clients/AA-BB-CC-DD-EE-FF/device")).toContain("inventory");
    expect(topicsForWrite("/api/reservations/AA-BB-CC-DD-EE-FF")).toContain("reservations");
    expect(topicsForWrite("/api/backup/import")).toEqual(expect.arrayContaining(["inventory", "ipplan", "reservations"]));
  });
});
