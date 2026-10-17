import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApp, type App } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { checkReservationIp, suggestReservationIps } from "../src/core/reservations.js";
import { MockDecoApi } from "../src/deco-client/mock.js";
import { DecoApiError, DecoLoginError, DecoTimeoutError } from "../src/deco-client/errors.js";
import { silentLogger } from "../src/log.js";
import { buildServer } from "../src/server/http.js";
import type { IpPlan } from "../src/server/api-types.js";

const opened: { app: App; dir: string }[] = [];
afterEach(async () => {
  for (const { app, dir } of opened.splice(0)) {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

async function setup(env: Record<string, string> = { DECO_ALLOW_WRITE: "1" }) {
  const dir = mkdtempSync(join(tmpdir(), "deco-web-res-"));
  const config = loadConfig({ DECO_MOCK: "1", DATA_DIR: dir, ...env });
  const api = new MockDecoApi();
  const app = createApp(config, silentLogger, api);
  opened.push({ app, dir });
  const server = await buildServer({ app, webDist: join(dir, "sem-web") });
  await app.poller.pollNow();
  const snap = app.poller.cache.snapshot!;
  const reserved = new Set(snap.reservations.map((r) => r.mac));
  /** Cliente online sem reserva. */
  const free = snap.clients.find((c) => !reserved.has(c.mac))!;
  const withRes = snap.reservations[0]!;
  return { app, api, server, snap, free, withRes };
}

const FREE_IP = "192.168.68.250";

const post = (server: Awaited<ReturnType<typeof setup>>["server"], method: "POST" | "PUT" | "DELETE", url: string, payload: object) =>
  server.inject({ method, url, payload, headers: { "content-type": "application/json" } });

describe("applyReservationChange (via mock)", () => {
  it("add: escreve uma vez e confirma pela releitura", async () => {
    const { api, free } = await setup();
    const r = await api.changeReservation({ op: "add", mac: free.mac, ip: FREE_IP });
    expect(r).toMatchObject({ outcome: "applied", ok: true, before: null, after: { mac: free.mac, ip: FREE_IP } });
    expect(api.writes).toEqual([`add ${free.mac}=${FREE_IP}`]);
  });

  it("recusa do firmware: rejected, sem reenviar", async () => {
    const { api, free } = await setup();
    api.failNextWrite({ error: new DecoApiError("IP_CONFLICT", "IP_CONFLICT") });
    const r = await api.changeReservation({ op: "add", mac: free.mac, ip: FREE_IP });
    expect(r).toMatchObject({ outcome: "rejected", ok: false, after: null });
    expect(api.writes).toHaveLength(1);
  });

  it("resposta perdida, mas aplicada: a releitura confirma", async () => {
    const { api, free } = await setup();
    api.failNextWrite({ error: new DecoTimeoutError("timeout"), applied: true });
    const r = await api.changeReservation({ op: "add", mac: free.mac, ip: FREE_IP });
    expect(r.outcome).toBe("applied");
    expect(api.writes).toHaveLength(1);
  });

  it("resposta perdida e releitura falha: ambiguous, nada reenviado", async () => {
    const { api, free } = await setup();
    api.failNextWrite({ error: new DecoTimeoutError("timeout"), applied: true });
    // O 1º getlist (pré-condição) passa; o da verificação falha.
    const r = await api.changeReservation({ op: "add", mac: free.mac, ip: FREE_IP });
    expect(r.outcome).toBe("applied"); // controle: com releitura, confirma
    const p = await import("../src/deco-client/reservations.js");
    let lists = 0;
    const writes: string[] = [];
    const res = await p.applyReservationChange(
      {
        list: async () => {
          lists += 1;
          if (lists > 1) throw new DecoTimeoutError("timeout");
          return { reservations: [], max: 64 };
        },
        add: async () => {
          writes.push("add");
          throw new DecoTimeoutError("timeout");
        },
        remove: async () => undefined,
      },
      { op: "add", mac: free.mac, ip: FREE_IP },
    );
    expect(res).toMatchObject({ outcome: "ambiguous", ok: false, state: null });
    expect(writes).toEqual(["add"]);
  });

  it("move: remove + add", async () => {
    const { api, withRes } = await setup();
    const r = await api.changeReservation({ op: "move", mac: withRes.mac, ip: FREE_IP });
    expect(r).toMatchObject({ outcome: "applied", before: withRes, after: { mac: withRes.mac, ip: FREE_IP } });
    expect(api.writes).toEqual([`remove ${withRes.mac}`, `add ${withRes.mac}=${FREE_IP}`]);
  });

  it("move com remove recusado: nada muda", async () => {
    const { api, withRes } = await setup();
    api.failNextWrite({ error: new DecoApiError("erro", 1) });
    const r = await api.changeReservation({ op: "move", mac: withRes.mac, ip: FREE_IP });
    expect(r).toMatchObject({ outcome: "rejected", after: withRes });
    expect(api.writes).toEqual([`remove ${withRes.mac}`]);
  });

  it("move com add recusado: restaura a reserva antiga uma vez", async () => {
    const { app, api, withRes } = await setup();
    // O remove passa; o add do IP novo é recusado (IP em uso por outro cliente).
    const reservedIps = new Set(app.poller.cache.snapshot!.reservations.map((x) => x.ip));
    const other = app.poller.cache.snapshot!.clients.find((c) => c.mac !== withRes.mac && c.ip && !reservedIps.has(c.ip))!;
    const r = await api.changeReservation({ op: "move", mac: withRes.mac, ip: other.ip! });
    expect(r).toMatchObject({ outcome: "rolled-back", ok: false, after: withRes });
    expect(api.writes).toEqual([`remove ${withRes.mac}`, `add ${withRes.mac}=${other.ip}`, `add ${withRes.mac}=${withRes.ip}`]);
  });

  it("move com add e restauração falhando: lost, com instrução", async () => {
    const p = await import("../src/deco-client/reservations.js");
    const mac = "AA-BB-CC-DD-EE-01";
    let state = { reservations: [{ mac, ip: "192.168.68.20" }], max: 64 };
    const res = await p.applyReservationChange(
      {
        list: async () => structuredClone(state),
        add: async () => {
          throw new DecoApiError("erro", 1);
        },
        remove: async () => {
          state = { ...state, reservations: [] };
        },
      },
      { op: "move", mac, ip: FREE_IP },
    );
    expect(res.outcome).toBe("lost");
    expect(res.message).toContain("192.168.68.20");
  });

  it("pré-condição na lista fresca: conflito sem escrever", async () => {
    const { api, free, withRes } = await setup();
    const r = await api.changeReservation({ op: "add", mac: free.mac, ip: withRes.ip });
    expect(r.outcome).toBe("conflict");
    expect(api.writes).toEqual([]);
  });

  it("erro de login sobe (para o breaker)", async () => {
    const p = await import("../src/deco-client/reservations.js");
    await expect(
      p.applyReservationChange(
        {
          list: async () => ({ reservations: [], max: null }),
          add: async () => {
            throw new DecoLoginError("Wrong password", 4);
          },
          remove: async () => undefined,
        },
        { op: "add", mac: "AA-BB-CC-DD-EE-01", ip: FREE_IP },
      ),
    ).rejects.toBeInstanceOf(DecoLoginError);
  });
});

describe("checkReservationIp", () => {
  it("recusa gateway, nó, IP de outro cliente, fora da LAN e malformado", async () => {
    const { snap, free } = await setup();
    const node = snap.nodes.find((n) => n.role === "slave" && n.ip)!;
    const reservedIps = new Set(snap.reservations.map((r) => r.ip));
    const other = snap.clients.find((c) => c.mac !== free.mac && c.ip && !reservedIps.has(c.ip))!;
    expect(() => checkReservationIp(snap, free.mac, "192.168.68.1")).toThrow(/Deco principal/);
    expect(() => checkReservationIp(snap, free.mac, node.ip)).toThrow(/nó/);
    expect(() => checkReservationIp(snap, free.mac, other.ip)).toThrow(/em uso/);
    expect(() => checkReservationIp(snap, free.mac, "10.0.0.5")).toThrow(/fora da rede/);
    expect(() => checkReservationIp(snap, free.mac, "192.168.68.255")).toThrow(/broadcast/);
    expect(() => checkReservationIp(snap, free.mac, "192.168.68.300")).toThrow(/inválido/);
    // O IP que o próprio aparelho usa é aceito (fixar o IP atual).
    expect(checkReservationIp(snap, free.mac, free.ip)).toBe(free.ip);
  });
});

describe("suggestReservationIps", () => {
  const plan = (ranges: Partial<IpPlan["ranges"][number]>[]): IpPlan => ({
    network: { address: "192.168.68.0", prefix: 24, gateway: "192.168.68.1" },
    message: null,
    cells: [{ ip: "192.168.68.2", octet: 2, status: "free", rangeId: null, mac: null, name: null, anomalies: [] }],
    anomalies: [],
    ranges: ranges.map((r, i) => ({
      id: i + 1, name: `F${i}`, start: 0, end: 0, label: "", kind: "static", types: [], notes: null, position: i,
      size: 1, reserved: 0, inUse: 0, free: 1, suggestion: null, ...r,
    })),
  });

  it("prioriza faixa do tipo, depois sem tipo; ignora dinâmicas e cheias", () => {
    const s = suggestReservationIps(
      plan([
        { name: "IoT", start: 200, types: ["iot"], suggestion: "192.168.68.200" },
        { name: "Geral", start: 40, suggestion: "192.168.68.40" },
        { name: "Servidores", start: 20, types: ["servidor"], suggestion: "192.168.68.20" },
        { name: "Pool", start: 100, kind: "dynamic", suggestion: "192.168.68.100" },
        { name: "Cheia", start: 2, types: ["servidor"], suggestion: null },
      ]),
      "servidor",
    );
    expect(s.map((x) => x.rangeName)).toEqual(["Servidores", "Geral", "IoT"]);
    expect(s[0]!.matchesType).toBe(true);
  });

  it("sem faixas fixas: primeiro IP livre", () => {
    expect(suggestReservationIps(plan([]), null)).toEqual([{ ip: "192.168.68.2", rangeId: null, rangeName: null, matchesType: false }]);
  });
});

describe("API de reservas", () => {
  it("somente leitura: 403 e nada chega ao Deco", async () => {
    const { server, api, free } = await setup({});
    const res = await post(server, "POST", "/api/reservations", { mac: free.mac, ip: FREE_IP, confirm: true });
    expect(res.statusCode).toBe(403);
    expect(api.writes).toEqual([]);
    expect((await server.inject("/api/reservations")).json().allowWrite).toBe(false);
  });

  it("exige confirm: true", async () => {
    const { server, api, free } = await setup();
    const res = await post(server, "POST", "/api/reservations", { mac: free.mac, ip: FREE_IP });
    expect(res.statusCode).toBe(400);
    expect(api.writes).toEqual([]);
  });

  it("cria, move e remove; cache atualizado e auditoria com antes/depois", async () => {
    const { server, app, free } = await setup();
    let res = await post(server, "POST", "/api/reservations", { mac: free.mac, ip: FREE_IP, confirm: true });
    expect(res.statusCode).toBe(200);
    expect(app.poller.cache.snapshot!.reservations.find((r) => r.mac === free.mac)?.ip).toBe(FREE_IP);

    res = await post(server, "PUT", `/api/reservations/${free.mac}`, { ip: "192.168.68.251", confirm: true });
    expect(res.json()).toMatchObject({ outcome: "applied", before: { ip: FREE_IP }, after: { ip: "192.168.68.251" } });

    res = await post(server, "DELETE", `/api/reservations/${free.mac}`, { confirm: true });
    expect(res.json()).toMatchObject({ outcome: "applied", after: null });

    const { entries } = (await server.inject("/api/audit")).json();
    expect(entries.slice(0, 3).map((e: any) => [e.action, e.result])).toEqual([
      ["reservation.remove", "ok"],
      ["reservation.move", "ok"],
      ["reservation.add", "ok"],
    ]);
    expect(entries[1]).toMatchObject({ target: free.mac, before: { ip: FREE_IP }, after: { ip: "192.168.68.251" } });
  });

  it("IP ocupado no cache: 409 sem abrir sessão", async () => {
    const { server, api, free, withRes } = await setup();
    const calls = api.calls;
    const res = await post(server, "POST", "/api/reservations", { mac: free.mac, ip: withRes.ip, confirm: true });
    expect(res.statusCode).toBe(409);
    expect(api.calls).toBe(calls);
  });

  it("recusa do Deco: 502 com a mensagem, auditada com o resultado", async () => {
    const { server, api, free } = await setup();
    api.failNextWrite({ error: new DecoApiError("returned error_code -40210", -40210) });
    const res = await post(server, "POST", "/api/reservations", { mac: free.mac, ip: FREE_IP, confirm: true });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ outcome: "rejected" });
    const { entries } = (await server.inject("/api/audit")).json();
    expect(entries[0].result).toMatch(/^rejected/);
  });

  it("breaker aberto: 503 e auditado como erro", async () => {
    const { server, app, free } = await setup();
    app.gateway.breaker.recordFailure({ kind: "other", message: "rede", attemptsLeft: null });
    const res = await post(server, "POST", "/api/reservations", { mac: free.mac, ip: FREE_IP, confirm: true });
    expect(res.statusCode).toBe(503);
    expect((await server.inject("/api/audit")).json().entries[0].result).toMatch(/^error/);
  });

  it("sugestão de IP para um cliente", async () => {
    const { server, free } = await setup();
    const res = (await server.inject(`/api/reservations/suggest?mac=${free.mac}`)).json();
    expect(res).toMatchObject({ mac: free.mac, currentIp: free.ip });
    expect(res.suggestions.length).toBeGreaterThan(0);
  });
});
