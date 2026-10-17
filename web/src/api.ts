import type {
  AuditView,
  ClientView,
  EventView,
  InventoryView,
  IpPlan,
  OverviewView,
  SamplePoint,
  StatusView,
} from "../../src/server/api-types";

export type {
  Anomaly,
  AuditView,
  CellStatus,
  ClientView,
  DeviceMacView,
  DeviceSummary,
  DeviceView,
  EventView,
  InventoryView,
  IpCell,
  IpPlan,
  NodeView,
  OverviewView,
  RangeSummary,
  SamplePoint,
  StatusView,
} from "../../src/server/api-types";
export type { Band, WifiNetwork } from "../../src/deco-client/types";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** Corpo da resposta de erro (ex.: resultado de uma escrita recusada). */
    readonly body?: unknown,
  ) {
    super(message);
  }
}

type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

async function request<T>(method: Method, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: method === "GET" ? undefined : { "content-type": "application/json" },
    body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Erro ${res.status}`, data);
  return data as T;
}

export interface Reservation {
  mac: string;
  ip: string;
}

/** Resultado de uma escrita de reserva (ver src/deco-client/reservations.ts). */
export interface ReservationResult {
  outcome: "applied" | "noop" | "conflict" | "rejected" | "unverified" | "ambiguous" | "rolled-back" | "lost";
  ok: boolean;
  message: string;
  before: Reservation | null;
  after: Reservation | null;
}

export interface IpSuggestion {
  ip: string;
  rangeId: number | null;
  rangeName: string | null;
  matchesType: boolean;
}

export interface AlertEntry {
  id: number;
  at: string;
  kind: "new_device" | "node_offline" | "node_online" | "internet_down" | "internet_up" | "test";
  mac: string | null;
  title: string;
  body: string;
  delivery: { channel: string; ok: boolean; error?: string }[];
}

export interface AlertsView {
  settings: { newDevice: boolean; nodeOfflineMinutes: number | null; internetDownMinutes: number | null; publicUrl: boolean };
  channels: { name: string; target: string }[];
  alerts: AlertEntry[];
  pending: ClientView[];
}

export type { BackupDiff, BackupFile } from "../../src/core/backup";

export interface ImportResult {
  devices: { added: number; updated: number };
  ranges: { added: number; updated: number; skipped: number };
  reservations: { mac: string; ip: string | null; outcome: string; message: string }[];
}

export interface DeviceInput {
  alias?: string;
  owner?: string | null;
  type?: string | null;
  tags?: string[];
  notes?: string | null;
  approved?: boolean;
}

export interface RangeInput {
  name?: string;
  spec?: string;
  kind?: "static" | "dynamic";
  types?: string[];
  notes?: string | null;
}

const qs = (params: Record<string, string | number | undefined>) => {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== "");
  return entries.length ? `?${new URLSearchParams(entries.map(([k, v]) => [k, String(v)]))}` : "";
};

export const api = {
  me: () => request<{ authRequired: boolean; authenticated: boolean }>("GET", "/api/auth/me"),
  login: (password: string) => request<{ ok: true }>("POST", "/api/auth/login", { password }),
  logout: () => request<{ ok: true }>("POST", "/api/auth/logout"),
  status: () => request<StatusView>("GET", "/api/status"),
  overview: () => request<OverviewView>("GET", "/api/overview"),
  clients: () => request<{ status: StatusView; clients: ClientView[] }>("GET", "/api/clients"),
  refresh: () => request<{ ok: true }>("POST", "/api/refresh"),
  resetBreaker: () => request<{ ok: true }>("POST", "/api/breaker/reset"),

  inventory: () => request<InventoryView>("GET", "/api/devices"),
  createDevice: (input: DeviceInput & { macs: string[] }) => request("POST", "/api/devices", input),
  updateDevice: (id: number, input: DeviceInput) => request("PATCH", `/api/devices/${id}`, input),
  deleteDevice: (id: number) => request("DELETE", `/api/devices/${id}`),
  attachMac: (id: number, mac: string) => request("POST", `/api/devices/${id}/macs`, { mac }),
  detachMac: (id: number, mac: string) => request("DELETE", `/api/devices/${id}/macs/${mac}`),
  saveClientDevice: (mac: string, input: DeviceInput) => request("PUT", `/api/clients/${mac}/device`, input),

  ipPlan: () => request<IpPlan>("GET", "/api/ipplan"),
  createRange: (input: RangeInput) => request("POST", "/api/ipplan/ranges", input),
  updateRange: (id: number, input: RangeInput) => request("PATCH", `/api/ipplan/ranges/${id}`, input),
  deleteRange: (id: number) => request("DELETE", `/api/ipplan/ranges/${id}`),

  reservations: () =>
    request<{ allowWrite: boolean; used: number; max: number | null; clients: ClientView[] }>("GET", "/api/reservations"),
  suggestIp: (mac: string) =>
    request<{ mac: string; deviceType: string | null; currentIp: string | null; suggestions: IpSuggestion[] }>(
      "GET",
      `/api/reservations/suggest${qs({ mac })}`,
    ),
  addReservation: (mac: string, ip: string) => request<ReservationResult>("POST", "/api/reservations", { mac, ip, confirm: true }),
  moveReservation: (mac: string, ip: string) => request<ReservationResult>("PUT", `/api/reservations/${mac}`, { ip, confirm: true }),
  removeReservation: (mac: string) => request<ReservationResult>("DELETE", `/api/reservations/${mac}`, { confirm: true }),

  alerts: () => request<AlertsView>("GET", "/api/alerts"),
  testAlert: () => request<AlertEntry>("POST", "/api/alerts/test"),
  approve: (macs: string[]) => request<{ approved: number }>("POST", "/api/devices/approve", { macs }),

  exportBackup: () => request<import("../../src/core/backup").BackupFile>("GET", "/api/backup"),
  previewBackup: (backup: unknown) => request<import("../../src/core/backup").BackupDiff>("POST", "/api/backup/preview", { backup }),
  importBackup: (backup: unknown, sections: { devices: boolean; ranges: boolean; reservations: boolean }) =>
    request<ImportResult>("POST", "/api/backup/import", { backup, sections, confirm: true }),

  events: (q: { limit?: number; before?: number; type?: string; mac?: string } = {}) =>
    request<{ events: EventView[]; nextBefore: number | null; types: string[] }>("GET", `/api/history/events${qs(q)}`),
  samples: (hours: number) =>
    request<{ from: string; to: string; bucketMs: number; points: SamplePoint[] }>("GET", `/api/history/samples${qs({ hours })}`),
  audit: (q: { limit?: number; before?: number } = {}) => request<{ entries: AuditView[] }>("GET", `/api/audit${qs(q)}`),
};
