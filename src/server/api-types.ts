/**
 * Formato das respostas da API. Compartilhado com o frontend (web/), então
 * só pode importar tipos puros — nada de Node, SQLite ou Fastify.
 */
import type { Band, InternetStatus, MeshNode, WifiNetwork } from "../deco-client/types.js";

export interface StatusView {
  fetchedAt: string | null;
  detailTakenAt: string | null;
  lastAttemptAt: string | null;
  nextPollAt: string | null;
  lastError: { message: string; at: string } | null;
  breaker: "closed" | "open" | "locked";
  /** Snapshot mais velho que 3 intervalos de poll (ou inexistente). */
  stale: boolean;
  pollIntervalSeconds: number;
  mode: { mock: boolean; allowWrite: boolean; allowDangerous: boolean };
}

export interface NodeView extends MeshNode {
  onlineSince: string | null;
  parentName: string | null;
  clients: { total: number; byBand: Partial<Record<Band, number>> };
}

export interface OverviewView {
  status: StatusView;
  nodes: NodeView[];
  internet: InternetStatus | null;
  wifi: WifiNetwork[] | null;
  performance: { cpu: number; memory: number } | null;
  lan: { ip: string; mask: string } | null;
  totals: {
    clients: number;
    byBand: Partial<Record<Band, number>>;
    byNetwork: Record<string, number>;
    unassigned: number;
  };
  reservations: { used: number; max: number | null };
}

export interface ClientView {
  mac: string;
  /** Nome que o Deco dá; o apelido do inventário vem em `device`. */
  name: string;
  device: DeviceSummary | null;
  online: boolean;
  ip: string | null;
  deviceType: string | null;
  band: Band | null;
  network: string | null;
  nodeMac: string | null;
  nodeName: string | null;
  upKBps: number;
  downKBps: number;
  firstSeen: string | null;
  lastSeen: string | null;
  reservation: { ip: string; matchesCurrentIp: boolean | null } | null;
}

export interface DeviceSummary {
  id: number;
  alias: string;
  owner: string | null;
  type: string | null;
  tags: string[];
  approved: boolean;
}

export interface DeviceMacView {
  mac: string;
  online: boolean;
  ip: string | null;
  band: Band | null;
  nodeName: string | null;
  /** Nome que o Deco dá a esse MAC. */
  decoName: string | null;
  lastSeen: string | null;
}

export interface DeviceView extends DeviceSummary {
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  online: boolean;
  macs: DeviceMacView[];
}

export interface InventoryView {
  devices: DeviceView[];
  /** MACs vistos que ainda não estão em nenhum dispositivo. */
  unassigned: DeviceMacView[];
  deviceTypes: readonly string[];
}

export interface SamplePoint {
  t: string;
  avg: number;
  max: number;
}

export interface EventView {
  id: number;
  at: string;
  type: string;
  mac: string | null;
  /** Apelido do inventário, ou o nome do Deco no momento do evento. */
  name: string | null;
  data: Record<string, unknown>;
}

export interface AuditView {
  id: number;
  at: string;
  actor: string;
  action: string;
  target: string | null;
  before: unknown;
  after: unknown;
  result: string;
}
