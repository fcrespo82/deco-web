import { describe, expect, it } from "vitest";
import { EventDetector } from "../src/core/events.js";
import { loadFixture } from "../src/deco-client/mock.js";
import { parseSnapshot } from "../src/deco-client/parse.js";
import type { RawSnapshot, Snapshot } from "../src/deco-client/types.js";

const BASE = Date.parse("2026-10-17T12:00:00Z");
const MIN = 60_000;

function snapAt(minutes: number, mutate?: (raw: RawSnapshot) => void): Snapshot {
  const raw = structuredClone(loadFixture());
  mutate?.(raw);
  return parseSnapshot(raw, new Date(BASE + minutes * MIN));
}

const clients = (raw: RawSnapshot) => (raw.clientList as { client_list: Record<string, unknown>[] }).client_list;
const nodes = (raw: RawSnapshot) => (raw.deviceList as { device_list: Record<string, unknown>[] }).device_list;
const base = snapAt(0);
const firstMac = base.clients[0]!.mac;
const dropFirst = (raw: RawSnapshot) => {
  (raw.clientList as { client_list: unknown[] }).client_list = clients(raw).slice(1);
};
const types = (events: { type: string }[]) => events.map((e) => e.type);

function primed(graceMs = 5 * MIN) {
  const d = new EventDetector({ graceMs, knownMacs: base.clients.map((c) => c.mac) });
  d.prime(base);
  return d;
}

describe("EventDetector", () => {
  it("snapshot idêntico não gera eventos", () => {
    expect(primed().next(snapAt(1))).toEqual([]);
  });

  it("primeiro snapshot sem estado: só 'novo' para MACs desconhecidos", () => {
    const d = new EventDetector({ graceMs: 0, knownMacs: base.clients.slice(1).map((c) => c.mac) });
    const events = d.next(base);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "client_new", mac: firstMac });
  });

  it("desconexão só após a carência, com o horário em que sumiu", () => {
    const d = primed(5 * MIN);
    expect(d.next(snapAt(2, dropFirst))).toEqual([]); // sumiu aos 2 min
    expect(d.next(snapAt(4, dropFirst))).toEqual([]); // 2 min ausente
    const events = d.next(snapAt(7, dropFirst)); // 5 min ausente
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "client_disconnected",
      mac: firstMac,
      at: new Date(BASE + 2 * MIN).toISOString(),
    });
    expect(d.next(snapAt(9, dropFirst))).toEqual([]); // não repete
  });

  it("cliente que volta dentro da carência não gera nada", () => {
    const d = primed(5 * MIN);
    d.next(snapAt(2, dropFirst));
    expect(d.next(snapAt(4))).toEqual([]);
    // e a contagem recomeça do zero
    d.next(snapAt(6, dropFirst));
    expect(d.next(snapAt(10, dropFirst))).toEqual([]);
  });

  it("carência zero: desconecta no mesmo poll; reconexão gera 'conectou'", () => {
    const d = primed(0);
    expect(types(d.next(snapAt(1, dropFirst)))).toEqual(["client_disconnected"]);
    const back = d.next(snapAt(2));
    expect(back).toEqual([expect.objectContaining({ type: "client_connected", mac: firstMac })]);
  });

  it("MAC nunca visto gera 'novo' uma vez só", () => {
    const d = primed(0);
    const add = (raw: RawSnapshot) => {
      clients(raw).push({ mac: "02-00-00-00-00-01", name: "Visitante", ip: "192.168.68.150", online: true, wire_type: "wireless", connection_type: "band5" });
    };
    expect(d.next(snapAt(1, add))).toEqual([expect.objectContaining({ type: "client_new", mac: "02-00-00-00-00-01" })]);
    d.next(snapAt(2)); // sai
    expect(types(d.next(snapAt(3, add)))).toEqual(["client_connected"]);
  });

  it("mudança de IP", () => {
    const d = primed();
    const events = d.next(
      snapAt(1, (raw) => {
        clients(raw)[0]!.ip = "192.168.68.199";
      }),
    );
    expect(events).toEqual([
      expect.objectContaining({ type: "client_ip_changed", mac: firstMac, data: expect.objectContaining({ to: "192.168.68.199" }) }),
    ]);
  });

  it("nó cai (some da lista) e volta", () => {
    const d = primed();
    const nodeMac = base.nodes[0]!.mac;
    const dropNode = (raw: RawSnapshot) => {
      (raw.deviceList as { device_list: unknown[] }).device_list = nodes(raw).slice(1);
    };
    expect(d.next(snapAt(1, dropNode))).toEqual([expect.objectContaining({ type: "node_offline", mac: nodeMac })]);
    expect(d.next(snapAt(2, dropNode))).toEqual([]);
    expect(d.next(snapAt(3))).toEqual([expect.objectContaining({ type: "node_online", mac: nodeMac })]);
  });

  it("nó marcado offline pelo firmware", () => {
    const d = primed();
    const events = d.next(
      snapAt(1, (raw) => {
        nodes(raw)[0]!.group_status = "disconnected";
        nodes(raw)[0]!.inet_status = "offline";
      }),
    );
    expect(types(events)).toEqual(["node_offline"]);
  });

  it("internet cai e volta", () => {
    const d = primed();
    const down = (raw: RawSnapshot) => {
      (raw.internet as { ipv4: { inet_status: string } }).ipv4.inet_status = "offline";
    };
    expect(types(d.next(snapAt(1, down)))).toEqual(["internet_down"]);
    expect(types(d.next(snapAt(2)))).toEqual(["internet_up"]);
  });

  it("reservas criadas, alteradas e removidas fora do painel", () => {
    const d = primed();
    const list = (raw: RawSnapshot) => (raw.reservations as { reservation_list: { mac: string; ip: string }[] }).reservation_list;
    const events = d.next(
      snapAt(1, (raw) => {
        const r = list(raw);
        r[0]!.ip = "192.168.68.201";
        r.splice(1, 1);
        r.push({ mac: "02-00-00-00-00-09", ip: "192.168.68.202" });
      }),
    );
    expect(types(events).sort()).toEqual(["reservation_added", "reservation_changed", "reservation_removed"]);
  });
});
