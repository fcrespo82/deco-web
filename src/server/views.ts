/**
 * Monta as respostas da API a partir do cache do poller e do SQLite.
 * Funções puras: nenhuma toca no Deco.
 */
import type { Band, Snapshot } from "../deco-client/types.js";
import type { ClientSeen, NodeSeen } from "../db/store.js";
import type { Device } from "../db/inventory.js";
import type { PollerCache } from "../core/poller.js";
import type {
  ClientView,
  DeviceMacView,
  DeviceSummary,
  DeviceView,
  InventoryView,
  NodeView,
  OverviewView,
  StatusView,
} from "./api-types.js";

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
export const deviceSummary = (d: Device): DeviceSummary => ({
  id: d.id,
  alias: d.alias,
  owner: d.owner,
  type: d.type,
  tags: d.tags,
  approved: d.approved,
});

export function buildClients(
  snap: Snapshot | null,
  seen: Map<string, ClientSeen>,
  inventory: Map<string, Device> = new Map(),
): ClientView[] {
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
      device: null,
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
      device: null,
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
      device: null,
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

  // MACs só do inventário (cadastrados à mão, nunca vistos) também aparecem.
  for (const [mac] of inventory) {
    if (out.has(mac)) continue;
    out.set(mac, {
      mac,
      name: mac,
      device: null,
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
      reservation: null,
    });
  }
  for (const view of out.values()) {
    const d = inventory.get(view.mac);
    if (d) view.device = deviceSummary(d);
  }

  const label = (c: ClientView) => c.device?.alias ?? c.name;
  return [...out.values()].sort(
    (a, b) => Number(b.online) - Number(a.online) || label(a).localeCompare(label(b), "pt-BR"),
  );
}

/** Inventário com o estado atual de cada MAC; MACs vistos sem cadastro à parte. */
export function buildInventory(
  devices: Device[],
  clients: ClientView[],
  deviceTypes: readonly string[],
): InventoryView {
  const byMac = new Map(clients.map((c) => [c.mac, c]));
  const macView = (mac: string): DeviceMacView => {
    const c = byMac.get(mac);
    return {
      mac,
      online: c?.online ?? false,
      ip: c?.ip ?? null,
      band: c?.band ?? null,
      nodeName: c?.nodeName ?? null,
      decoName: c && c.name !== mac ? c.name : null,
      lastSeen: c?.online ? null : (c?.lastSeen ?? null),
    };
  };
  const assigned = new Set(devices.flatMap((d) => d.macs));
  const views: DeviceView[] = devices.map((d) => {
    const macs = d.macs.map(macView);
    return {
      ...deviceSummary(d),
      notes: d.notes,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
      online: macs.some((m) => m.online),
      macs,
    };
  });
  const unassigned = clients
    .filter((c) => !assigned.has(c.mac) && (c.online || c.lastSeen))
    .map((c) => macView(c.mac));
  return { devices: views, unassigned, deviceTypes };
}
