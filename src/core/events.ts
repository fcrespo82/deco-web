/**
 * Detecção de eventos comparando snapshots consecutivos.
 *
 * Celular em repouso some da lista do Deco por um ou dois polls e volta. Para
 * não encher o histórico de conecta/desconecta, um cliente só é dado como
 * desconectado depois de ausente por `graceMs`; se voltar antes, nada é
 * registrado. O evento de desconexão leva o horário em que ele sumiu.
 */
import type { Snapshot } from "../deco-client/types.js";

export const NET_EVENT_TYPES = [
  "client_new",
  "client_connected",
  "client_disconnected",
  "client_ip_changed",
  "node_offline",
  "node_online",
  "internet_down",
  "internet_up",
  "reservation_added",
  "reservation_removed",
  "reservation_changed",
] as const;
export type NetEventType = (typeof NET_EVENT_TYPES)[number];

export interface NetEvent {
  at: string;
  type: NetEventType;
  /** MAC do cliente ou do nó; null para eventos da rede (internet). */
  mac: string | null;
  data: Record<string, unknown>;
}

interface OnlineClient {
  ip: string | null;
  name: string;
}

export interface DetectorOptions {
  graceMs: number;
  /** MACs já vistos antes (para não marcar como "novo"). */
  knownMacs?: Iterable<string>;
}

export class EventDetector {
  private readonly graceMs: number;
  private readonly known: Set<string>;
  private online = new Map<string, OnlineClient>();
  private missingSince = new Map<string, number>();
  private nodes = new Map<string, { online: boolean; name: string }>();
  private internet: boolean | null = null;
  private reservations: Map<string, string> | null = null;
  private primed = false;

  constructor(opts: DetectorOptions) {
    this.graceMs = opts.graceMs;
    this.known = new Set(opts.knownMacs ?? []);
  }

  /** Assume `snap` como estado atual sem gerar eventos (ex.: snapshot persistido). */
  prime(snap: Snapshot | null): void {
    if (!snap) return;
    this.absorb(snap);
    this.primed = true;
  }

  /** Eventos entre o estado atual e `snap`; depois `snap` vira o estado atual. */
  next(snap: Snapshot): NetEvent[] {
    if (!this.primed) {
      // Primeiro snapshot da vida do painel: só registra os desconhecidos como novos.
      const events = snap.clients
        .filter((c) => !this.known.has(c.mac))
        .map((c) => ev(snap.takenAt, "client_new", c.mac, { name: c.name, ip: c.ip }));
      this.prime(snap);
      return events;
    }

    const at = snap.takenAt;
    const t = Date.parse(at);
    const events: NetEvent[] = [];

    // --- clientes ---
    const present = new Map(snap.clients.map((c) => [c.mac, c]));
    for (const c of snap.clients) {
      this.missingSince.delete(c.mac);
      const before = this.online.get(c.mac);
      if (!before) {
        if (!this.known.has(c.mac)) {
          events.push(ev(at, "client_new", c.mac, { name: c.name, ip: c.ip }));
          this.known.add(c.mac);
        } else {
          events.push(ev(at, "client_connected", c.mac, { name: c.name, ip: c.ip }));
        }
      } else if (before.ip && c.ip && before.ip !== c.ip) {
        events.push(ev(at, "client_ip_changed", c.mac, { name: c.name, from: before.ip, to: c.ip }));
      }
      this.online.set(c.mac, { ip: c.ip, name: c.name });
    }
    for (const [mac, info] of this.online) {
      if (present.has(mac)) continue;
      const since = this.missingSince.get(mac) ?? t;
      if (t - since >= this.graceMs) {
        events.push(ev(new Date(since).toISOString(), "client_disconnected", mac, { name: info.name, ip: info.ip }));
        this.online.delete(mac);
        this.missingSince.delete(mac);
      } else {
        this.missingSince.set(mac, since);
      }
    }

    // --- nós ---
    const nodesNow = new Map(snap.nodes.map((n) => [n.mac, n]));
    for (const n of snap.nodes) {
      const before = this.nodes.get(n.mac);
      if (before && before.online !== n.online) {
        events.push(ev(at, n.online ? "node_online" : "node_offline", n.mac, { name: n.name }));
      }
    }
    for (const [mac, before] of this.nodes) {
      if (!nodesNow.has(mac) && before.online) {
        events.push(ev(at, "node_offline", mac, { name: before.name, missing: true }));
      }
    }

    // --- internet ---
    if (snap.internet && this.internet !== null && snap.internet.ipv4Online !== this.internet) {
      events.push(
        ev(at, snap.internet.ipv4Online ? "internet_up" : "internet_down", null, {
          wanIp: snap.internet.wanIp,
        }),
      );
    }

    // --- reservas (mudanças feitas fora do painel, ex.: pelo app) ---
    if (this.reservations) {
      const now = new Map(snap.reservations.map((r) => [r.mac, r.ip]));
      for (const [mac, ip] of now) {
        const before = this.reservations.get(mac);
        if (before === undefined) events.push(ev(at, "reservation_added", mac, { ip }));
        else if (before !== ip) events.push(ev(at, "reservation_changed", mac, { from: before, to: ip }));
      }
      for (const [mac, ip] of this.reservations) {
        if (!now.has(mac)) events.push(ev(at, "reservation_removed", mac, { ip }));
      }
    }

    this.absorbNetwork(snap);
    return events;
  }

  private absorb(snap: Snapshot): void {
    this.online = new Map(snap.clients.map((c) => [c.mac, { ip: c.ip, name: c.name }]));
    this.missingSince.clear();
    for (const c of snap.clients) this.known.add(c.mac);
    this.absorbNetwork(snap);
  }

  private absorbNetwork(snap: Snapshot): void {
    // Nó que sumiu e já foi reportado fica registrado como offline.
    const next = new Map(snap.nodes.map((n) => [n.mac, { online: n.online, name: n.name }]));
    for (const [mac, before] of this.nodes) {
      if (!next.has(mac)) next.set(mac, { online: false, name: before.name });
    }
    this.nodes = next;
    if (snap.internet) this.internet = snap.internet.ipv4Online;
    this.reservations = new Map(snap.reservations.map((r) => [r.mac, r.ip]));
  }
}

function ev(at: string, type: NetEventType, mac: string | null, data: Record<string, unknown>): NetEvent {
  return { at, type, mac, data };
}
