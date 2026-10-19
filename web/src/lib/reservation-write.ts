/**
 * Escrita otimista de reserva de DHCP. A gravação no Deco leva 15–30 s, então:
 * - a reserva aparece na hora nas listas, com o selo "gravando…";
 * - deu certo → o selo some (o canal ao vivo traz o estado real);
 * - o Deco recusou com certeza (conflict, rejected, rolled-back, ou erro antes
 *   de chegar ao Deco) → volta ao que era;
 * - não dá para saber (unverified, ambiguous, lost) → selo "a confirmar" até
 *   a próxima leitura completa do Deco mostrar a verdade.
 * Enquanto um aparelho tem gravação pendente, ele não aceita outra.
 */
import { useEffect, useState } from "preact/hooks";
import { api, ApiError, type ClientView, type ReservationResult } from "../api";
import { KEYS } from "../data";
import { onLiveTopics } from "./live";
import { setQueryData, invalidate } from "./query";
import { toast } from "./toast";

export type ReservationOp = "add" | "move" | "remove";

export interface PendingReservation {
  op: ReservationOp;
  ip: string | null;
  phase: "saving" | "unconfirmed";
}

const pending = new Map<string, PendingReservation>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function usePendingReservations(): ReadonlyMap<string, PendingReservation> {
  const [, tick] = useState(0);
  useEffect(() => {
    const l = () => tick((n) => n + 1);
    listeners.add(l);
    return () => listeners.delete(l);
  }, []);
  return pending;
}

/** Uma leitura completa do Deco (tópico "snapshot") resolve as dúvidas. */
function onSnapshotRead() {
  let changed = false;
  for (const [mac, p] of pending) {
    if (p.phase === "unconfirmed") {
      pending.delete(mac);
      changed = true;
    }
  }
  if (changed) emit();
}

onLiveTopics((topics) => topics.includes("snapshot") && onSnapshotRead());

type Clients = { status: unknown; clients: ClientView[] };
type Reservations = { allowWrite: boolean; used: number; max: number | null; clients: ClientView[] };

const withReservation = (c: ClientView, ip: string | null): ClientView => ({
  ...c,
  reservation: ip ? { ip, matchesCurrentIp: c.online && c.ip ? c.ip === ip : null } : null,
});

/** Aplica a mudança nos caches de Clientes e Reservas; devolve o "desfazer". */
function applyOptimistic(mac: string, ip: string | null): () => void {
  let client: ClientView | undefined;
  const undoClients = setQueryData<Clients>(KEYS.clients, (d) => {
    client = d.clients.find((c) => c.mac === mac);
    return { ...d, clients: d.clients.map((c) => (c.mac === mac ? withReservation(c, ip) : c)) };
  });
  const undoReservations = setQueryData<Reservations>(KEYS.reservations, (d) => {
    const had = d.clients.some((c) => c.mac === mac);
    let clients = d.clients;
    if (!ip) clients = clients.filter((c) => c.mac !== mac);
    else if (had) clients = clients.map((c) => (c.mac === mac ? withReservation(c, ip) : c));
    else {
      const base = client ?? d.clients.find((c) => c.mac === mac);
      if (base) clients = [...clients, withReservation(base, ip)];
    }
    return { ...d, clients, used: d.used + (clients.length - d.clients.length) };
  });
  return () => {
    undoReservations();
    undoClients();
  };
}

export interface WriteEnd {
  kind: "ok" | "failed" | "unconfirmed" | "error";
  message: string;
  result: ReservationResult | null;
}

export interface WriteHandle {
  done: Promise<WriteEnd>;
  /** O diálogo fechou: a partir daqui o resultado vira aviso (toast). */
  detach(): void;
}

const UNCERTAIN = new Set(["unverified", "ambiguous", "lost"]);

export function writeReservation(p: { mac: string; name: string; op: ReservationOp; ip: string | null }): WriteHandle {
  let detached = false;
  pending.set(p.mac, { op: p.op, ip: p.ip, phase: "saving" });
  emit();
  const undo = applyOptimistic(p.mac, p.op === "remove" ? null : p.ip);

  const finish = (end: WriteEnd): WriteEnd => {
    if (end.kind === "unconfirmed") {
      pending.set(p.mac, { op: p.op, ip: p.ip, phase: "unconfirmed" });
      // Pede uma leitura completa para tirar a dúvida (o servidor limita a frequência).
      void api.refresh().catch(() => undefined);
    } else {
      pending.delete(p.mac);
    }
    if (end.kind === "failed" || end.kind === "error") undo();
    invalidate(["reservations", "ipplan"]);
    emit();
    if (detached) {
      const what = p.op === "remove" ? `Reserva de ${p.name}` : `${p.name} → ${p.ip}`;
      if (end.kind === "ok") toast(p.op === "remove" ? `Reserva de ${p.name} removida` : `${p.name} reservado em ${p.ip}`);
      else if (end.kind === "unconfirmed") toast(`${what}: não deu para confirmar`, { tone: "bad", detail: end.message, ms: 12_000 });
      else toast(`${what}: não gravado`, { tone: "bad", detail: end.message, ms: 10_000 });
    }
    return end;
  };

  const run =
    p.op === "remove" ? api.removeReservation(p.mac) : p.op === "move" ? api.moveReservation(p.mac, p.ip!) : api.addReservation(p.mac, p.ip!);

  const done = run.then(
    (r) => finish({ kind: r.ok ? "ok" : UNCERTAIN.has(r.outcome) ? "unconfirmed" : "failed", message: r.message, result: r }),
    (e: unknown) => {
      const body = e instanceof ApiError ? (e.body as ReservationResult | undefined) : undefined;
      if (body && typeof body === "object" && "outcome" in body) {
        return finish({ kind: UNCERTAIN.has(body.outcome) ? "unconfirmed" : "failed", message: body.message, result: body });
      }
      if (e instanceof ApiError) {
        // O servidor respondeu com erro: recusado antes de chegar ao Deco
        // (validação, conflito no cache, breaker). Nada foi gravado.
        return finish({ kind: "error", message: e.message, result: null });
      }
      // Sem resposta (conexão caiu): o servidor pode ter gravado antes de cair.
      return finish({ kind: "unconfirmed", message: "A conexão com o painel caiu durante a gravação.", result: null });
    },
  );
  return { done, detach: () => (detached = true) };
}
