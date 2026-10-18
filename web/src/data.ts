/**
 * Leituras da API usadas pelas telas, com os tópicos do canal ao vivo de que
 * cada uma depende. Telas diferentes que usam a mesma leitura compartilham o
 * cache (ex.: Clientes e o seletor de "Nova reserva").
 */
import { api, type LiveTopic } from "./api";
import { useLive } from "./lib/live";
import { useQuery } from "./lib/query";

export const KEYS = {
  status: "status",
  overview: "overview",
  clients: "clients",
  reservations: "reservations",
  inventory: "inventory",
  ipPlan: "ipplan",
  alerts: "alerts",
  samples: (hours: number) => `samples:${hours}`,
  events: (types: string) => `events:${types}`,
  audit: "audit",
} as const;

const T = {
  overview: ["snapshot", "reservations"],
  clients: ["snapshot", "inventory", "reservations"],
  reservations: ["snapshot", "inventory", "reservations"],
  inventory: ["snapshot", "inventory"],
  ipPlan: ["snapshot", "inventory", "reservations", "ipplan"],
  alerts: ["snapshot", "inventory", "alerts"],
  history: ["snapshot", "reservations"],
  audit: ["audit"],
} satisfies Record<string, LiveTopic[]>;

export const useOverview = () => useQuery(KEYS.overview, api.overview, T.overview);
export const useClients = () => useQuery(KEYS.clients, api.clients, T.clients);
export const useReservations = () => useQuery(KEYS.reservations, api.reservations, T.reservations);
export const useInventory = () => useQuery(KEYS.inventory, api.inventory, T.inventory);
export const useIpPlan = () => useQuery(KEYS.ipPlan, api.ipPlan, T.ipPlan);
export const useAlerts = () => useQuery(KEYS.alerts, api.alerts, T.alerts);
export const useSamples = (hours: number) => useQuery(KEYS.samples(hours), () => api.samples(hours), T.history);
export const useAudit = () => useQuery(KEYS.audit, () => api.audit({ limit: 50 }), T.audit);

/**
 * Status do poller: vem pelo canal ao vivo; antes da primeira mensagem (ou
 * sem canal), da leitura de /api/status.
 */
export function useStatus() {
  const live = useLive();
  const { data } = useQuery(KEYS.status, api.status, ["status"]);
  return (live.state === "open" ? live.status : null) ?? data ?? live.status ?? null;
}
