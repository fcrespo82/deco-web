import type { ClientView } from "../api";
import { CATEGORY, categoryOf } from "../art/devices";
import { BAND_LABEL, NETWORK_LABEL } from "../format";

export type GroupBy = "node" | "category" | "band" | "network" | "vendor" | "owner";

export const GROUP_LABEL: Record<GroupBy, string> = {
  node: "Nó",
  category: "Tipo",
  band: "Banda",
  network: "Rede",
  vendor: "Fabricante",
  owner: "Dono",
};

export function groupKey(c: ClientView, by: GroupBy): string {
  switch (by) {
    case "node":
      return c.online ? (c.nodeName ?? "Sem nó") : "Offline";
    case "category":
      return CATEGORY[categoryOf(c)].label;
    case "band":
      return c.online && c.band ? BAND_LABEL[c.band] : "Offline";
    case "network":
      return c.network ? (NETWORK_LABEL[c.network] ?? c.network) : "Sem rede";
    case "vendor":
      return c.vendor ?? (c.randomMac ? "MAC privado" : "Desconhecido");
    case "owner":
      return c.device?.owner ?? "Sem dono";
  }
}

/** Grupos em ordem: maiores primeiro, "Offline"/"Sem …" no fim. */
export function groupClients(clients: ClientView[], by: GroupBy): [string, ClientView[]][] {
  const m = new Map<string, ClientView[]>();
  for (const c of clients) {
    const k = groupKey(c, by);
    const list = m.get(k);
    if (list) list.push(c);
    else m.set(k, [c]);
  }
  const last = (k: string) => /^(Offline|Sem |Desconhecido|MAC privado)/.test(k);
  return [...m].sort((a, b) => Number(last(a[0])) - Number(last(b[0])) || b[1].length - a[1].length || a[0].localeCompare(b[0], "pt-BR"));
}
