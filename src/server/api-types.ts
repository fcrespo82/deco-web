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
  name: string;
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
