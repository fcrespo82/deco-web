import { describe, expect, it } from "vitest";
import { loadFixture } from "../src/deco-client/mock.js";
import {
  asArray,
  canonicalMac,
  parseBand,
  parseClients,
  parseNodes,
  parseReservations,
  parseSnapshot,
  parseWifi,
  SnapshotParseError,
} from "../src/deco-client/parse.js";

const raw = loadFixture();
const at = new Date("2026-10-17T12:00:00Z");

describe("parseSnapshot com a fixture do probe (X50, fw 1.11.1)", () => {
  const snap = parseSnapshot(raw, at);

  it("lê nós, clientes e reservas", () => {
    expect(snap.takenAt).toBe(at.toISOString());
    expect(snap.nodes).toHaveLength(6);
    expect(snap.clients).toHaveLength(28);
    expect(snap.reservations).toHaveLength(20);
    expect(snap.reservationMax).toBe(200);
  });

  it("identifica o gateway e a topologia pelo campo previous", () => {
    const masters = snap.nodes.filter((n) => n.role === "master");
    expect(masters).toHaveLength(1);
    const master = masters[0]!;
    expect(master.ip).toBe("192.168.68.1");
    expect(master.parentMac).toBeNull();
    expect(master.signal).toEqual({ "2.4GHz": null, "5GHz": null });
    for (const n of snap.nodes.filter((n) => n.role === "slave")) {
      expect(n.parentMac).toBe(master.mac);
    }
  });

  it("converte sinal e backhaul dos satélites", () => {
    const wired = snap.nodes.filter((n) => n.backhaul.includes("wired"));
    const wireless = snap.nodes.filter((n) => n.backhaul.includes("5GHz"));
    expect(wired).toHaveLength(3);
    expect(wireless).toHaveLength(2);
    for (const n of wireless) expect(typeof n.signal["5GHz"]).toBe("number");
  });

  it("associa cada cliente ao nó pela lista por nó", () => {
    const nodeMacs = new Set(snap.nodes.map((n) => n.mac));
    expect(snap.clients.every((c) => c.nodeMac && nodeMacs.has(c.nodeMac))).toBe(true);
  });

  it("separa banda, cabo e rede IoT", () => {
    const count = (f: (c: (typeof snap.clients)[number]) => boolean) => snap.clients.filter(f).length;
    expect(count((c) => c.band === "wired")).toBe(13);
    expect(count((c) => c.band === "5GHz")).toBe(10);
    expect(count((c) => c.band === "2.4GHz")).toBe(5);
    expect(count((c) => c.network === "iot")).toBe(4);
  });

  it("lê internet e LAN", () => {
    expect(snap.internet).toMatchObject({
      ipv4Online: true,
      ipv6Online: false,
      connectType: "pppoe",
      cablePlugged: true,
      wanIp: "203.0.113.11",
      dns: ["1.1.1.1", "8.8.8.8"],
    });
    expect(snap.lan).toEqual({ ip: "192.168.68.1", mask: "255.255.255.0" });
  });

  it("nunca carrega senha/PSK no snapshot", () => {
    expect(JSON.stringify(snap)).not.toMatch(/password|redacted|psk/i);
  });
});

describe("tolerância a formatos do firmware", () => {
  it("lista vazia como {} vira []", () => {
    expect(asArray({})).toEqual([]);
    expect(asArray(undefined)).toEqual([]);
    expect(parseClients({ client_list: {} })).toEqual([]);
  });

  it("normaliza MAC para maiúsculo com hífen", () => {
    expect(canonicalMac("aa:bb:cc:dd:ee:ff")).toBe("AA-BB-CC-DD-EE-FF");
  });

  it("mapeia bandas conhecidas e rejeita desconhecidas", () => {
    expect(parseBand("band2_4")).toBe("2.4GHz");
    expect(parseBand("band5_1")).toBe("5GHz");
    expect(parseBand("band6")).toBe("6GHz");
    expect(parseBand("wired")).toBe("wired");
    expect(parseBand("xyz")).toBeNull();
  });

  it("aceita números como string e campos faltando", () => {
    const [node] = parseNodes({
      device_list: [{ mac: "aa-bb-cc-dd-ee-ff", role: "slave", signal_level: { band5: "2" } }],
    });
    expect(node).toMatchObject({
      mac: "AA-BB-CC-DD-EE-FF",
      name: "Deco",
      ip: null,
      online: false,
      backhaul: [],
      signal: { "2.4GHz": null, "5GHz": 2 },
    });
  });

  it("descarta clientes marcados como offline", () => {
    const clients = parseClients({
      client_list: [
        { mac: "AA-AA-AA-AA-AA-01", online: true, wire_type: "wireless", connection_type: "band5" },
        { mac: "AA-AA-AA-AA-AA-02", online: false },
      ],
    });
    expect(clients.map((c) => c.mac)).toEqual(["AA-AA-AA-AA-AA-01"]);
    expect(clients[0]!.band).toBe("5GHz");
  });

  it("reservas sem ip/mac são ignoradas", () => {
    expect(
      parseReservations({ reservation_list: [{ mac: "aa:bb:cc:dd:ee:01", ip: "192.168.68.10" }, { mac: "x" }] }),
    ).toEqual({ list: [{ mac: "AA-BB-CC-DD-EE-01", ip: "192.168.68.10" }], max: null });
  });

  it("Wi-Fi: separa principal, convidados e IoT, sem copiar senha", () => {
    const wifi = parseWifi(raw.wlan)!;
    expect(wifi.filter((w) => w.kind === "host").map((w) => w.band).sort()).toEqual(["2.4GHz", "5GHz"]);
    expect(wifi.filter((w) => w.kind === "guest").every((w) => !w.enabled)).toBe(true);
    expect(wifi.find((w) => w.kind === "iot" && w.band === "2.4GHz")?.enabled).toBe(true);
    expect(wifi.find((w) => w.kind === "iot" && w.band === "5GHz")?.enabled).toBe(false);
    expect(JSON.stringify(wifi)).not.toMatch(/password/);
  });

  it("seções opcionais ausentes viram null", () => {
    const snap = parseSnapshot(
      { deviceList: { device_list: [] }, clientList: { client_list: {} }, clientsByNode: {}, reservations: {} },
      at,
    );
    expect(snap).toMatchObject({ internet: null, wifi: null, performance: null, lan: null, reservations: [] });
  });

  it("falha se faltar uma lista central", () => {
    expect(() =>
      parseSnapshot({ deviceList: {}, clientList: { client_list: [] }, clientsByNode: {}, reservations: {} }, at),
    ).toThrow(SnapshotParseError);
    expect(() =>
      parseSnapshot(
        { deviceList: { device_list: [] }, clientList: { client_list: [] }, clientsByNode: {}, reservations: undefined },
        at,
      ),
    ).toThrow(SnapshotParseError);
  });
});
