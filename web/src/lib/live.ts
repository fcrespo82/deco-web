/**
 * Conexão com o canal ao vivo (GET /api/live, Server-Sent Events).
 *
 * Cada mensagem traz o status atual e os tópicos que mudaram; as leituras
 * ativas desses tópicos são relidas. Sem conexão, as telas voltam a reler a
 * cada 30 s, e ao reconectar relê tudo (pode ter perdido avisos).
 */
import { useEffect, useState } from "preact/hooks";
import type { LiveMessage, StatusView } from "../api";
import { invalidate } from "./query";

export type LiveState = "connecting" | "open" | "offline";

interface Snapshot {
  state: LiveState;
  status: StatusView | null;
}

let current: Snapshot = { state: "connecting", status: null };
const listeners = new Set<(s: Snapshot) => void>();
const set = (patch: Partial<Snapshot>) => {
  current = { ...current, ...patch };
  listeners.forEach((l) => l(current));
};

const FALLBACK_POLL_MS = 30_000;

let source: EventSource | null = null;
let retry: ReturnType<typeof setTimeout> | null = null;
let fallback: ReturnType<typeof setInterval> | null = null;
let attempts = 0;
let onClosed: (() => void) | null = null;

function startFallback() {
  fallback ??= setInterval(() => {
    if (document.visibilityState === "visible") invalidate();
  }, FALLBACK_POLL_MS);
}

function stopFallback() {
  if (fallback) clearInterval(fallback);
  fallback = null;
}

function open() {
  source?.close();
  const es = new EventSource("/api/live");
  source = es;
  es.addEventListener("open", () => {
    if (attempts > 0) invalidate();
    attempts = 0;
    stopFallback();
    set({ state: "open" });
  });
  es.addEventListener("change", (ev) => {
    const msg = JSON.parse((ev as MessageEvent<string>).data) as LiveMessage;
    set({ status: msg.status });
    const topics = msg.topics.filter((t) => t !== "status");
    if (topics.length) invalidate(topics);
  });
  es.addEventListener("error", () => {
    set({ state: "offline" });
    startFallback();
    // CLOSED: o servidor recusou (ex.: sessão expirou) — o navegador não tenta
    // de novo sozinho. Avisa o app e tenta com espera crescente.
    if (es.readyState === EventSource.CLOSED) {
      attempts++;
      onClosed?.();
      retry = setTimeout(open, Math.min(30_000, 2000 * 2 ** Math.min(attempts, 4)));
    } else attempts++;
  });
}

/** Liga o canal (depois do login). `closed` é chamado quando o servidor recusa. */
export function connectLive(closed: () => void): void {
  onClosed = closed;
  if (!source) open();
}

export function disconnectLive(): void {
  source?.close();
  source = null;
  if (retry) clearTimeout(retry);
  stopFallback();
  set({ state: "connecting", status: null });
}

/** Atualiza o status fora do canal (ex.: resposta de /api/status). */
export function setLiveStatus(status: StatusView): void {
  set({ status });
}

export function useLive(): Snapshot {
  const [s, setS] = useState(current);
  useEffect(() => {
    listeners.add(setS);
    setS(current);
    return () => void listeners.delete(setS);
  }, []);
  return s;
}
