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
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Erro ${res.status}`);
  return data as T;
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

  events: (q: { limit?: number; before?: number; type?: string; mac?: string } = {}) =>
    request<{ events: EventView[]; nextBefore: number | null; types: string[] }>("GET", `/api/history/events${qs(q)}`),
  samples: (hours: number) =>
    request<{ from: string; to: string; bucketMs: number; points: SamplePoint[] }>("GET", `/api/history/samples${qs({ hours })}`),
  audit: (q: { limit?: number; before?: number } = {}) => request<{ entries: AuditView[] }>("GET", `/api/audit${qs(q)}`),
};
