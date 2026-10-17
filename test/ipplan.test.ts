import { describe, expect, it } from "vitest";
import { formatRange, intToIp, ipToInt, parseRangeSpec, subnetOf } from "../src/core/ipmath.js";
import { buildIpPlan } from "../src/core/ipplan.js";
import { loadFixture } from "../src/deco-client/mock.js";
import { parseSnapshot } from "../src/deco-client/parse.js";
import type { Device } from "../src/db/inventory.js";
import type { IpRange } from "../src/db/ipranges.js";
import type { ClientSeen } from "../src/db/store.js";

const lan = subnetOf("192.168.68.1", "255.255.255.0");
const ip = (octet: number) => ipToInt(`192.168.68.${octet}`);

describe("ipmath", () => {
  it("converte IP ↔ inteiro", () => {
    expect(intToIp(ipToInt("192.168.68.200"))).toBe("192.168.68.200");
    expect(() => ipToInt("192.168.68.256")).toThrow();
  });

  it("sub-rede a partir de IP e máscara", () => {
    expect(lan).toEqual({ base: ip(0), prefix: 24, size: 256 });
  });

  it.each([
    ["192.168.68.8/29", 8, 15],
    [".8/29", 8, 15],
    ["8/29", 8, 15],
    [".20-.39", 20, 39],
    ["20 - 39", 20, 39],
    ["192.168.68.20-192.168.68.39", 20, 39],
    [".100+", 100, 254],
    [".50", 50, 50],
  ])("lê %s", (spec, start, end) => {
    expect(parseRangeSpec(spec, lan)).toEqual({ start: ip(start), end: ip(end) });
  });

  it.each([
    [".9/29", /alinhado/],
    [".39-.20", /menor/],
    ["10.0.0.1-10.0.0.5", /fora da rede/],
    [".8/16", /fora da sub-rede/],
    [".300", /inválido/],
  ])("recusa %s", (spec, msg) => {
    expect(() => parseRangeSpec(spec, lan)).toThrow(msg);
  });

  it("formata faixas de forma curta", () => {
    expect(formatRange(ip(8), ip(15))).toBe(".8/29");
    expect(formatRange(ip(20), ip(39))).toBe(".20–.39");
    expect(formatRange(ip(50), ip(50))).toBe(".50");
  });
});

// Fixture: reservas em .2 .3 .6 .10 .11 .20 .28 .29 .30 .33 .45 .50 .51 .60 .61 .71 .72 .90 .91 .93;
// clientes dinâmicos em .21–.39; nós em .1 e .236–.240.
const snapshot = parseSnapshot(loadFixture(), new Date("2026-10-17T12:00:00Z"));
const now = new Date("2026-10-17T12:00:00Z");

function range(id: number, start: number, end: number, kind: "static" | "dynamic", name = `F${id}`, types: IpRange["types"] = []): IpRange {
  return { id, name, start: ip(start), end: ip(end), label: formatRange(ip(start), ip(end)), kind, types, notes: null, position: id };
}

function plan(ranges: IpRange[], inventory = new Map<string, Device>(), seen = new Map<string, ClientSeen>()) {
  return buildIpPlan({ snapshot, ranges, inventory, seen, now });
}

describe("buildIpPlan", () => {
  it("grade de 256 células com estados básicos", () => {
    const p = plan([]);
    expect(p.network).toEqual({ address: "192.168.68.0", prefix: 24, gateway: "192.168.68.1" });
    expect(p.cells).toHaveLength(256);
    const at = (o: number) => p.cells[o]!;
    expect(at(0).status).toBe("network");
    expect(at(255).status).toBe("broadcast");
    expect(at(1).status).toBe("gateway");
    expect(at(236).status).toBe("node");
    expect(at(29).status).toBe("reserved-online");
    expect(at(72).status).toBe("reserved");
    expect(at(21).status).toBe("online");
    expect(at(150).status).toBe("free");
  });

  it("sem faixas não acusa 'fora do plano'", () => {
    expect(plan([]).anomalies.filter((a) => a.code === "outside-plan")).toEqual([]);
  });

  it("reserva fora de qualquer faixa", () => {
    const p = plan([range(1, 2, 15, "static")]);
    const outside = p.anomalies.filter((a) => a.code === "outside-plan").map((a) => a.ip);
    expect(outside).toContain("192.168.68.20");
    expect(outside).not.toContain("192.168.68.10");
  });

  it("cliente dinâmico dentro de faixa fixa", () => {
    const p = plan([range(1, 20, 39, "static", "Servidores")]);
    const dyn = p.anomalies.filter((a) => a.code === "dynamic-in-static");
    expect(dyn.map((a) => a.ip)).toContain("192.168.68.21");
    expect(dyn.map((a) => a.ip)).not.toContain("192.168.68.29"); // reservado
    expect(dyn[0]!.message).toMatch(/Servidores/);
  });

  it("tipo do inventário diferente do esperado pela faixa", () => {
    const mac = snapshot.reservations.find((r) => r.ip === "192.168.68.72")!.mac;
    const device: Device = {
      id: 1, alias: "Lâmpada", owner: null, type: "iot", tags: [], notes: null, approved: true,
      macs: [mac], createdAt: "", updatedAt: "",
    };
    const p = plan([range(1, 64, 95, "static", "Servidores", ["servidor"])], new Map([[mac, device]]));
    const mismatch = p.anomalies.find((a) => a.code === "type-mismatch");
    expect(mismatch).toMatchObject({ ip: "192.168.68.72", name: "Lâmpada" });
    expect(mismatch!.message).toMatch(/IoT.*Servidores.*servidor/);
  });

  it("conflito: IP reservado em uso por outro MAC, e reserva ainda não aplicada", () => {
    const raw = structuredClone(loadFixture());
    const list = (raw.reservations as { reservation_list: { mac: string; ip: string }[] }).reservation_list;
    const client = (raw.clientList as { client_list: { mac: string; ip: string }[] }).client_list.find((c) => c.ip === "192.168.68.21")!;
    // Outro aparelho reservou o .21, e o cliente do .21 tem reserva para o .150.
    list.push({ mac: "02-00-00-00-00-77", ip: "192.168.68.21" });
    list.push({ mac: client.mac, ip: "192.168.68.150" });
    const p = buildIpPlan({ snapshot: parseSnapshot(raw, now), ranges: [], inventory: new Map(), seen: new Map(), now });
    expect(p.anomalies.map((a) => a.code)).toEqual(expect.arrayContaining(["reservation-conflict", "reservation-not-applied"]));
  });

  it("sugere o primeiro IP livre, pulando reservados, em uso e vistos há pouco", () => {
    // .2 reservado/online, .3 reservado, .4 visto há 1 dia, .5 visto há 30 dias
    const seen = new Map<string, ClientSeen>([
      ["02-00-00-00-00-04", { mac: "02-00-00-00-00-04", firstSeen: "", lastSeen: "2026-10-16T12:00:00Z", lastIp: "192.168.68.4", lastName: "x", lastNodeMac: null, lastBand: null }],
      ["02-00-00-00-00-05", { mac: "02-00-00-00-00-05", firstSeen: "", lastSeen: "2026-09-17T12:00:00Z", lastIp: "192.168.68.5", lastName: "y", lastNodeMac: null, lastBand: null }],
    ]);
    const p = plan([range(1, 2, 7, "static")], new Map(), seen);
    expect(p.cells[4]!.status).toBe("recent");
    expect(p.ranges[0]).toMatchObject({ suggestion: "192.168.68.5", size: 6 });
  });

  it("faixa cheia não sugere nada", () => {
    const p = plan([range(1, 2, 3, "static")]);
    expect(p.ranges[0]!.suggestion).toBeNull();
  });

  it("sem snapshot: mensagem em vez de grade", () => {
    const p = buildIpPlan({ snapshot: null, ranges: [], inventory: new Map(), seen: new Map(), now });
    expect(p.network).toBeNull();
    expect(p.message).toBeTruthy();
  });
});
