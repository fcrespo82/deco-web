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
  /** Leituras suspensas até esta hora (gateway reiniciando). */
  pausedUntil: string | null;
  lastError: { message: string; at: string } | null;
  /** Há uma leitura do Deco em andamento agora. */
  polling: boolean;
  breaker: "closed" | "open" | "locked";
  /** Snapshot mais velho que 3 intervalos de poll (ou inexistente). */
  stale: boolean;
  pollIntervalSeconds: number;
  mode: { mock: boolean; allowWrite: boolean; allowDangerous: boolean; wifiWrite: boolean };
}

/**
 * O que mudou, avisado pelo canal ao vivo (GET /api/live). A UI relê só as
 * telas que dependem desses tópicos.
 */
export type LiveTopic = "status" | "snapshot" | "inventory" | "ipplan" | "reservations" | "alerts" | "audit" | "images";

export interface LiveMessage {
  topics: LiveTopic[];
  status: StatusView;
}

// --- imagens ---

export type ImageKind = "decos" | "categories" | "devices";

/** URL de cada imagem escolhida, por tipo e nome (modelo, categoria, id do dispositivo). */
export type ImagesView = Record<ImageKind, Record<string, string>>;

export interface OfficialResult {
  model: string;
  status: "ok" | "not-found" | "failed";
  page: string | null;
  url: string | null;
  error: string | null;
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
  /** Fabricante pelo MAC (base do IEEE), sem sufixos jurídicos. */
  vendor: string | null;
  vendorFull: string | null;
  /** MAC privado/aleatório (ou gerado por VM): sem fabricante. */
  randomMac: boolean;
  /** Tipo sugerido para o inventário, enquanto o aparelho não tem tipo. */
  suggestedType: string | null;
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

// --- plano de IPs ---

export type CellStatus =
  | "network"
  | "broadcast"
  | "gateway"
  | "node"
  | "reserved-online"
  | "reserved"
  | "online"
  | "recent"
  | "free";

export type AnomalyCode =
  | "outside-plan"
  /** Cliente sem reserva usando IP de faixa fixa. */
  | "dynamic-in-static"
  /** Reserva dentro da faixa dinâmica (pool do DHCP). */
  | "static-in-dynamic"
  /** Tipo do aparelho (inventário ou sugerido) não é o que a faixa espera. */
  | "type-mismatch"
  /** Aparelho numa faixa com tipos definidos, sem tipo cadastrado nem sugerido. */
  | "untyped"
  | "reservation-conflict"
  | "reservation-not-applied";

export interface Anomaly {
  code: AnomalyCode;
  ip: string;
  mac: string | null;
  name: string | null;
  message: string;
}

export interface IpCell {
  ip: string;
  octet: number;
  status: CellStatus;
  rangeId: number | null;
  /** Quem ocupa ou tem a reserva do IP. */
  mac: string | null;
  name: string | null;
  anomalies: AnomalyCode[];
}

/** Faixa como a API devolve (espelha IpRange do banco). */
export interface IpRangeView {
  id: number;
  name: string;
  start: number;
  end: number;
  label: string;
  kind: "static" | "dynamic";
  types: string[];
  notes: string | null;
  position: number;
}

export interface RangeSummary extends IpRangeView {
  size: number;
  reserved: number;
  inUse: number;
  free: number;
  /** Próximo IP livre (nem reservado, nem em uso, nem visto há pouco). */
  suggestion: string | null;
}

export interface IpPlan {
  /** null quando a LAN não é /24 (a grade só cobre /24). */
  network: { address: string; prefix: number; gateway: string | null } | null;
  message: string | null;
  cells: IpCell[];
  ranges: RangeSummary[];
  anomalies: Anomaly[];
}
