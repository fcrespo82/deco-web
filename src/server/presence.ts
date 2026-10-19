/**
 * Intervalos em que cada aparelho esteve online, a partir dos eventos de
 * conexão. Puro: recebe os eventos da janela, o estado de cada MAC no início
 * dela (último evento antes) e quem está online agora.
 */
import type { NetEventType } from "../core/events.js";

export const PRESENCE_TYPES: NetEventType[] = ["client_new", "client_connected", "client_disconnected"];

const isUp = (t: NetEventType) => t === "client_new" || t === "client_connected";

export interface PresenceInput {
  fromMs: number;
  toMs: number;
  /** Último evento de cada MAC antes da janela. */
  before: Map<string, NetEventType>;
  /** Eventos da janela, em ordem de tempo. */
  events: { at: string; type: NetEventType; mac: string | null }[];
  /** MACs online na leitura atual. */
  onlineNow: Set<string>;
}

/** [início, fim] em ms; fim null = ainda online. */
export type Interval = [number, number | null];

export function buildPresence(input: PresenceInput): Map<string, Interval[]> {
  const out = new Map<string, Interval[]>();
  const open = new Map<string, number>();
  const push = (mac: string, iv: Interval) => {
    // Descarta intervalos de duração zero (conectou e caiu no mesmo instante).
    if (iv[1] !== null && iv[1] <= iv[0]) return;
    const list = out.get(mac);
    if (list) list.push(iv);
    else out.set(mac, [iv]);
  };

  for (const [mac, type] of input.before) if (isUp(type)) open.set(mac, input.fromMs);

  for (const e of input.events) {
    if (!e.mac) continue;
    const t = Math.min(input.toMs, Math.max(input.fromMs, Date.parse(e.at)));
    if (isUp(e.type)) {
      if (!open.has(e.mac)) open.set(e.mac, t);
    } else if (open.has(e.mac)) {
      push(e.mac, [open.get(e.mac)!, t]);
      open.delete(e.mac);
    }
  }

  for (const [mac, start] of open) {
    // Ainda aberto: se está online agora, segue em aberto; senão, a queda
    // ainda está no período de tolerância e fecha no fim da janela.
    push(mac, [start, input.onlineNow.has(mac) ? null : input.toMs]);
  }
  // Online agora sem nenhum registro de conexão (painel novo): desde o início da janela.
  for (const mac of input.onlineNow) if (!out.has(mac)) push(mac, [input.fromMs, null]);

  for (const list of out.values()) list.sort((a, b) => a[0] - b[0]);
  return out;
}
