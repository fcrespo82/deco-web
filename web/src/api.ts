import type { ClientView, OverviewView, StatusView } from "../../src/server/api-types";

export type { ClientView, NodeView, OverviewView, StatusView } from "../../src/server/api-types";
export type { Band, WifiNetwork } from "../../src/deco-client/types";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: method === "POST" ? { "content-type": "application/json" } : undefined,
    body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Erro ${res.status}`);
  return data as T;
}

export const api = {
  me: () => request<{ authRequired: boolean; authenticated: boolean }>("GET", "/api/auth/me"),
  login: (password: string) => request<{ ok: true }>("POST", "/api/auth/login", { password }),
  logout: () => request<{ ok: true }>("POST", "/api/auth/logout"),
  status: () => request<StatusView>("GET", "/api/status"),
  overview: () => request<OverviewView>("GET", "/api/overview"),
  clients: () => request<{ status: StatusView; clients: ClientView[] }>("GET", "/api/clients"),
  refresh: () => request<{ ok: true }>("POST", "/api/refresh"),
  resetBreaker: () => request<{ ok: true }>("POST", "/api/breaker/reset"),
};
