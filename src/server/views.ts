/**
 * Monta as respostas da API a partir do cache do poller e do SQLite.
 * Funções puras: nenhuma toca no Deco.
 */
import type { Band, Snapshot } from "../deco-client/types.js";
import type { ClientSeen, NodeSeen } from "../db/store.js";
import type { PollerCache } from "../core/poller.js";
import type { ClientView, NodeView, OverviewView, StatusView } from "./api-types.js";

export type * from "./api-types.js";

export interface StatusContext {
  cache: PollerCache;
  pollIntervalMs: number;
  mode: StatusView["mode"];
  now: Date;
}

export function buildStatus({ cache, pollIntervalMs, mode, now }: StatusContext): StatusView {
  const fetchedAt = cache.fetchedAt ? new Date(cache.fetchedAt).getTime() : null;
  return {
    fetchedAt: cache.fetchedAt,
    detailTakenAt: cache.snapshot?.detailTakenAt ?? null,
    lastAttemptAt: cache.lastAttemptAt,
    nextPollAt: cache.nextPollAt,
    lastError: cache.lastError,
    breaker: cache.breaker,
    stale: fetchedAt === null || now.getTime() - fetchedAt > 3 * pollIntervalMs,
    pollIntervalSeconds: pollIntervalMs / 1000,
    mode,
  };
}

const count = <T>(items: T[], key: (item: T) => string | null): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const item of items) {
    const k = key(item);
    if (k !== null) out[k] = (out[k] ?? 0) + 1;
  }
  return out;
};

export function buildOverview(
  snap: Snapshot | null,
  nodeSeen: Map<string, NodeSeen>,
  status: StatusView,
): OverviewView {
  const nodes = snap?.nodes ?? [];
  const clients = snap?.clients ?? [];
  const nameOf = new Map(nodes.map((n) => [n.mac, n.name]));
  return {
    status,
    nodes: nodes
      .map((n) => {
        const own = clients.filter((c) => c.nodeMac === n.mac);
        return {
          ...n,
          onlineSince: n.online ? (nodeSeen.get(n.mac)?.onlineSince ?? null) : null,
          parentName: n.parentMac ? (nameOf.get(n.parentMac) ?? null) : null,
          clients: { total: own.length, byBand: count(own, (c) => c.band) },
        };
      })
      // Gateway primeiro, depois por nome.
      .sort((a, b) => (a.role === b.role ? a.name.localeCompare(b.name, "pt-BR") : a.role === "master" ? -1 : 1)),
    internet: snap?.internet ?? null,
    wifi: snap?.wifi ?? null,
    performance: snap?.performance ?? null,
    lan: snap?.lan ?? null,
    totals: {
      clients: clients.length,
      byBand: count(clients, (c) => c.band),
      byNetwork: count(clients, (c) => c.network),
      unassigned: clients.filter((c) => !c.nodeMac).length,
    },
    reservations: { used: snap?.reservations.length ?? 0, max: snap?.reservationMax ?? null },
  };
}

/**
 * Clientes online (do snapshot) + conhecidos offline (do histórico) + MACs que
 * só existem como reserva. Online primeiro, depois por nome.
 */
export function buildClients(snap: Snapshot | null, seen: Map<string, ClientSeen>): ClientView[] {
  const nodes = new Map((snap?.nodes ?? []).map((n) => [n.mac, n]));
  const reservations = new Map((snap?.reservations ?? []).map((r) => [r.mac, r.ip]));
  const out = new Map<string, ClientView>();

  // O firmware não informa sinal por cliente (client_access zera tudo no X50).
  const nodeName = (nodeMac: string | null) => (nodeMac ? (nodes.get(nodeMac)?.name ?? null) : null);
  const reservationFor = (mac: string, ip: string | null) => {
    const reserved = reservations.get(mac);
    return reserved ? { ip: reserved, matchesCurrentIp: ip ? ip === reserved : null } : null;
  };

  for (const c of snap?.clients ?? []) {
    const s = seen.get(c.mac);
    out.set(c.mac, {
      mac: c.mac,
      name: c.name,
      online: true,
      ip: c.ip,
      deviceType: c.deviceType,
      band: c.band,
      network: c.network,
      nodeMac: c.nodeMac,
      nodeName: nodeName(c.nodeMac),
      upKBps: c.upKBps,
      downKBps: c.downKBps,
      firstSeen: s?.firstSeen ?? null,
      lastSeen: s?.lastSeen ?? null,
      reservation: reservationFor(c.mac, c.ip),
    });
  }

  for (const s of seen.values()) {
    if (out.has(s.mac)) continue;
    const band = (s.lastBand as Band | null) ?? null;
    out.set(s.mac, {
      mac: s.mac,
      name: s.lastName ?? s.mac,
      online: false,
      ip: s.lastIp,
      deviceType: null,
      band,
      network: null,
      nodeMac: s.lastNodeMac,
      nodeName: nodeName(s.lastNodeMac),
      upKBps: 0,
      downKBps: 0,
      firstSeen: s.firstSeen,
      lastSeen: s.lastSeen,
      reservation: reservationFor(s.mac, null),
    });
  }

  for (const [mac, ip] of reservations) {
    if (out.has(mac)) continue;
    out.set(mac, {
      mac,
      name: mac,
      online: false,
      ip: null,
      deviceType: null,
      band: null,
      network: null,
      nodeMac: null,
      nodeName: null,
      upKBps: 0,
      downKBps: 0,
      firstSeen: null,
      lastSeen: null,
      reservation: { ip, matchesCurrentIp: null },
    });
  }

  return [...out.values()].sort(
    (a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name, "pt-BR"),
  );
}
