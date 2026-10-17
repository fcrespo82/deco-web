import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApp, type App } from "../src/app.js";
import { orderReservationChanges, parseBackup, type BackupFile } from "../src/core/backup.js";
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

async function setup(env: Record<string, string> = { DECO_ALLOW_WRITE: "1" }) {
  const dir = mkdtempSync(join(tmpdir(), "deco-web-backup-"));
  const api = new MockDecoApi();
  const app = createApp(loadConfig({ DECO_MOCK: "1", DATA_DIR: dir, ...env }), silentLogger, { api, channels: [] });
  opened.push({ app, dir });
  const server = await buildServer({ app, webDist: join(dir, "x") });
  await app.poller.pollNow();
  const send = (method: "POST" | "PATCH", url: string, payload: object) =>
    server.inject({ method, url, payload, headers: { "content-type": "application/json" } });
  return { app, api, server, send };
}

/** Painel com um pouco de tudo: 2 dispositivos, 2 faixas. */
async function seeded() {
  const s = await setup();
  const [c1, c2] = s.app.poller.cache.snapshot!.clients;
  await s.send("POST", "/api/devices", { alias: "NAS", type: "servidor", tags: ["casa"], macs: [c1!.mac], approved: true });
  await s.send("POST", "/api/devices", { alias: "TV", type: "tv", macs: [c2!.mac] });
  await s.send("POST", "/api/ipplan/ranges", { name: "Servidores", spec: ".40-.59", kind: "static", types: ["servidor"] });
  await s.send("POST", "/api/ipplan/ranges", { name: "Pool", spec: ".100-.199", kind: "dynamic" });
  return { ...s, c1: c1!, c2: c2! };
}

describe("exportar", () => {
  it("JSON com reservas, dispositivos e faixas; sem segredos", async () => {
    const { server } = await seeded();
    const res = await server.inject("/api/backup");
    expect(res.headers["content-disposition"]).toMatch(/attachment; filename="deco-web-backup-\d{4}-\d{2}-\d{2}\.json"/);
    const b = res.json() as BackupFile;
    expect(b).toMatchObject({ format: "deco-web-backup", version: 1, network: "192.168.68.0/24" });
    expect(b.reservations).toHaveLength(20);
    expect(b.devices.map((d) => d.alias).sort()).toEqual(["NAS", "TV"]);
    expect(b.ranges).toEqual([
      { name: "Servidores", spec: "192.168.68.40-192.168.68.59", kind: "static", types: ["servidor"], notes: null },
      { name: "Pool", spec: "192.168.68.100-192.168.68.199", kind: "dynamic", types: [], notes: null },
    ]);
    expect(res.body).not.toMatch(/password|psk|token/i);
  });
});

describe("validação", () => {
  it("recusa arquivo de outro formato, versão desconhecida, MAC e tipo inválidos", () => {
    const ok = { format: "deco-web-backup", version: 1, exportedAt: "x", network: null, reservations: [], devices: [], ranges: [] };
    expect(() => parseBackup({ foo: 1 })).toThrow(/Não é um backup/);
    expect(() => parseBackup({ ...ok, version: 2 })).toThrow(/Versão/);
    expect(() => parseBackup({ ...ok, reservations: [{ mac: "xx", ip: "1.2.3.4" }] })).toThrow(/MAC inválido/);
    expect(() => parseBackup({ ...ok, devices: [{ alias: "a", type: "nave", macs: ["AA-BB-CC-DD-EE-FF"] }] })).toThrow(/tipo inválido/);
    expect(() => parseBackup({ ...ok, devices: [{ alias: "a", macs: [] }] })).toThrow(/sem MAC/);
    expect(parseBackup({ ...ok, devices: [{ alias: "a", macs: ["aa:bb:cc:dd:ee:ff"] }] }).devices[0]!.macs).toEqual(["AA-BB-CC-DD-EE-FF"]);
  });
});

describe("pré-visualizar e importar", () => {
  it("round-trip num painel vazio recria tudo; reimportar não muda nada", async () => {
    const src = await seeded();
    const backup = (await src.server.inject("/api/backup")).json();

    const dst = await setup();
    const preview = (await dst.send("POST", "/api/backup/preview", { backup })).json();
    expect(preview.devices.changes.map((d: any) => d.action)).toEqual(["add", "add"]);
    expect(preview.ranges.changes.map((r: any) => [r.action, r.name])).toEqual([["add", "Servidores"], ["add", "Pool"]]);
    expect(preview.reservations).toMatchObject({ blocked: null, changes: [], unchanged: 20 });

    const res = await dst.send("POST", "/api/backup/import", { backup, sections: { devices: true, ranges: true, reservations: true }, confirm: true });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ devices: { added: 2 }, ranges: { added: 2 }, reservations: [] });

    const again = (await dst.send("POST", "/api/backup/preview", { backup })).json();
    expect(again.devices).toMatchObject({ changes: [], unchanged: 2 });
    expect(again.ranges).toMatchObject({ changes: [], unchanged: 2 });
    expect((await dst.server.inject("/api/audit")).json().entries[0].action).toBe("backup.import");
  });

  it("mostra campos alterados e mescla dispositivos que dividem MACs; o que é só local fica", async () => {
    const s = await seeded();
    const backup = (await s.server.inject("/api/backup")).json() as BackupFile;
    // Localmente: NAS renomeado; TV ganhou dono; um dispositivo só local.
    const inv = (await s.server.inject("/api/devices")).json();
    const nas = inv.devices.find((d: any) => d.alias === "NAS");
    await s.send("PATCH", `/api/devices/${nas.id}`, { alias: "NAS velho", tags: [] });
    const c3 = s.app.poller.cache.snapshot!.clients[2]!;
    await s.send("POST", "/api/devices", { alias: "Só aqui", macs: [c3.mac] });

    const p = (await s.send("POST", "/api/backup/preview", { backup })).json();
    expect(p.devices.changes).toHaveLength(1);
    expect(p.devices.changes[0]).toMatchObject({
      action: "update",
      alias: "NAS",
      changes: [
        { field: "alias", from: "NAS velho", to: "NAS" },
        { field: "tags", from: [], to: ["casa"] },
      ],
    });
    expect(p.devices).toMatchObject({ unchanged: 1, localOnly: 1 });

    await s.send("POST", "/api/backup/import", { backup, sections: { devices: true }, confirm: true });
    const after = (await s.server.inject("/api/devices")).json().devices.map((d: any) => d.alias).sort();
    expect(after).toEqual(["NAS", "Só aqui", "TV"]);
  });

  it("faixa que sobrepõe uma faixa só local: conflito, pulada na importação", async () => {
    const s = await seeded();
    const backup = (await s.server.inject("/api/backup")).json() as BackupFile;
    backup.ranges.push({ name: "IoT", spec: "192.168.68.200-192.168.68.230", kind: "static", types: [], notes: null });
    await s.send("POST", "/api/ipplan/ranges", { name: "Câmeras", spec: ".220-.229", kind: "static" });
    const p = (await s.send("POST", "/api/backup/preview", { backup })).json();
    expect(p.ranges.changes).toEqual([expect.objectContaining({ action: "conflict", name: "IoT", reason: 'sobrepõe "Câmeras"' })]);
    const r = (await s.send("POST", "/api/backup/import", { backup, sections: { ranges: true }, confirm: true })).json();
    expect(r.ranges).toEqual({ added: 0, updated: 0, skipped: 1 });
  });

  it("reservas: acrescenta e move numa sessão só, cada uma auditada; nunca remove as só locais", async () => {
    const s = await seeded();
    const backup = (await s.server.inject("/api/backup")).json() as BackupFile;
    const snap = s.app.poller.cache.snapshot!;
    const reserved = new Set(snap.reservations.map((r) => r.mac));
    const fresh = snap.clients.find((c) => !reserved.has(c.mac))!;
    const moved = backup.reservations![0]!;
    backup.reservations![0] = { mac: moved.mac, ip: "192.168.68.245" };
    backup.reservations!.push({ mac: fresh.mac, ip: "192.168.68.246" });
    backup.reservations!.splice(1, 1); // uma reserva que só existe no Deco

    const p = (await s.send("POST", "/api/backup/preview", { backup })).json();
    expect(p.reservations).toMatchObject({ blocked: null, unchanged: 18, localOnly: 1 });
    expect(p.reservations.changes.map((c: any) => [c.action, c.to])).toEqual([
      ["move", "192.168.68.245"],
      ["add", "192.168.68.246"],
    ]);

    const callsBefore = s.api.calls;
    const r = (await s.send("POST", "/api/backup/import", { backup, sections: { reservations: true }, confirm: true })).json();
    expect(r.reservations.map((x: any) => x.outcome)).toEqual(["applied", "applied"]);
    expect(s.api.calls - callsBefore).toBe(1); // uma sessão
    expect(s.app.poller.cache.snapshot!.reservations).toHaveLength(21);
    const actions = (await s.server.inject("/api/audit")).json().entries.slice(0, 2).map((e: any) => e.action);
    expect(actions.sort()).toEqual(["reservation.add", "reservation.move"]);
  });

  it("reservas bloqueadas em somente leitura e em rede diferente", async () => {
    const ro = await setup({});
    const backup = (await ro.server.inject("/api/backup")).json() as BackupFile;
    backup.reservations!.push({ mac: "02-00-00-00-00-09", ip: "192.168.68.247" });
    const p = (await ro.send("POST", "/api/backup/preview", { backup })).json();
    expect(p.reservations.blocked).toMatch(/Somente leitura/);
    const res = await ro.send("POST", "/api/backup/import", { backup, sections: { reservations: true }, confirm: true });
    expect(res.statusCode).toBe(400);

    const other = { ...backup, network: "10.0.0.0/24" };
    const p2 = (await ro.send("POST", "/api/backup/preview", { backup: other })).json();
    expect(p2.reservations.blocked).toMatch(/rede 10.0.0.0\/24/);
  });

  it("exige confirm: true", async () => {
    const s = await setup();
    const backup = (await s.server.inject("/api/backup")).json();
    expect((await s.send("POST", "/api/backup/import", { backup, sections: { devices: true } })).statusCode).toBe(400);
  });
});

describe("orderReservationChanges", () => {
  it("quem libera o IP vai antes de quem o ocupa", () => {
    const current = [{ mac: "A", ip: "10" }, { mac: "B", ip: "20" }];
    const order = orderReservationChanges(
      [
        { action: "move", mac: "B", name: null, from: "20", to: "10" },
        { action: "move", mac: "A", name: null, from: "10", to: "30" },
      ],
      current,
    );
    expect(order.map((c) => c.mac)).toEqual(["A", "B"]);
  });
});
