/**
 * Escrita de reservas de DHCP com verificação, comum ao live e ao mock.
 *
 * Toda alteração segue o mesmo roteiro, dentro de uma única sessão:
 *   1. relê a lista (o cache pode estar velho) e reconfere a pré-condição;
 *   2. escreve;
 *   3. relê a lista e confere se o Deco ficou como pedido.
 *
 * Uma escrita nunca é repetida. Se a resposta se perde (timeout, conexão
 * caída), a escrita pode ter sido aplicada ou não; a releitura decide. Se nem
 * a releitura funciona, o resultado é "ambiguous" e quem chamou só fica
 * sabendo — não há segunda tentativa.
 *
 * O firmware não tem "modify" confiável: mudar o IP é remove + add. Se o add
 * falha depois do remove, e a releitura mostra que a reserva sumiu, a antiga
 * é recriada (uma vez). Isso não é retry: o estado foi lido e é conhecido.
 *
 * Erros de login (DecoLoginError) sobem intactos, para o circuit breaker.
 */
import { DecoLoginError } from "./vendor/errors.js";
import type { Reservation } from "./types.js";

export type ReservationChange =
  | { op: "add"; mac: string; ip: string }
  | { op: "remove"; mac: string }
  | { op: "move"; mac: string; ip: string };

export interface ReservationState {
  reservations: Reservation[];
  max: number | null;
}

/** As três operações cruas que cada implementação fornece. */
export interface ReservationPrimitives {
  list(): Promise<ReservationState>;
  add(mac: string, ip: string): Promise<void>;
  remove(mac: string): Promise<void>;
}

export type WriteOutcome =
  /** Aplicada e confirmada pela releitura. */
  | "applied"
  /** Nada a fazer: o Deco já estava como pedido. */
  | "noop"
  /** A releitura antes de escrever mostrou um conflito; nada foi enviado. */
  | "conflict"
  /** O Deco recusou; a releitura confirma que nada mudou. */
  | "rejected"
  /** O Deco disse OK, mas a releitura não mostra a mudança. */
  | "unverified"
  /** Sem resposta e sem releitura: não se sabe se aplicou. */
  | "ambiguous"
  /** Mudança de IP falhou; a reserva antiga foi recriada. */
  | "rolled-back"
  /** Mudança de IP falhou e a reserva antiga não voltou. */
  | "lost";

export interface ReservationWriteResult {
  outcome: WriteOutcome;
  ok: boolean;
  message: string;
  /** Reserva do MAC antes e depois (null = não tinha / não tem). */
  before: Reservation | null;
  after: Reservation | null;
  /** Lista completa lida por último; null quando não deu para reler. */
  state: ReservationState | null;
}

const find = (state: ReservationState, mac: string) => state.reservations.find((r) => r.mac === mac) ?? null;

const reason = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Executa uma escrita; devolve o erro em vez de lançar (exceto login). */
async function attempt(fn: () => Promise<void>): Promise<unknown> {
  try {
    await fn();
    return null;
  } catch (err) {
    if (err instanceof DecoLoginError) throw err;
    return err ?? new Error("falha desconhecida");
  }
}

/** Releitura de verificação: null se falhar (exceto login). */
async function reread(p: ReservationPrimitives): Promise<ReservationState | null> {
  try {
    return await p.list();
  } catch (err) {
    if (err instanceof DecoLoginError) throw err;
    return null;
  }
}

export async function applyReservationChange(
  p: ReservationPrimitives,
  change: ReservationChange,
): Promise<ReservationWriteResult> {
  const { mac } = change;
  const initial = await p.list();
  const before = find(initial, mac);
  const result = (
    outcome: WriteOutcome,
    message: string,
    state: ReservationState | null,
  ): ReservationWriteResult => ({
    outcome,
    ok: outcome === "applied" || outcome === "noop",
    message,
    before,
    after: state ? find(state, mac) : null,
    state,
  });

  // --- 1. pré-condição contra a lista fresca ---------------------------
  if (change.op === "remove") {
    if (!before) return result("noop", "Este MAC não tem reserva no Deco.", initial);
  } else {
    const holder = initial.reservations.find((r) => r.ip === change.ip && r.mac !== mac);
    if (holder) return result("conflict", `${change.ip} já está reservado para ${holder.mac}.`, initial);
    if (before?.ip === change.ip) return result("noop", `Já reservado em ${change.ip}.`, initial);
    if (change.op === "add" && before) {
      return result("conflict", `Este MAC já tem reserva em ${before.ip}; altere a existente.`, initial);
    }
    if (change.op === "move" && !before) {
      return result("conflict", "Este MAC não tem reserva para alterar.", initial);
    }
    if (change.op === "add" && initial.max !== null && initial.reservations.length >= initial.max) {
      return result("conflict", `Limite de ${initial.max} reservas do Deco atingido.`, initial);
    }
  }

  const reached = (s: ReservationState) =>
    change.op === "remove" ? find(s, mac) === null : find(s, mac)?.ip === change.ip;

  /** Interpreta uma escrita simples (add ou remove) pela releitura. */
  async function settle(err: unknown, okMessage: string): Promise<ReservationWriteResult> {
    const state = await reread(p);
    if (state && reached(state)) {
      return result("applied", err ? `${okMessage} (o Deco acusou erro, mas a releitura confirma).` : okMessage, state);
    }
    if (!err) {
      return state
        ? result("unverified", "O Deco respondeu OK, mas a mudança não aparece na lista.", state)
        : result("applied", `${okMessage} (sem releitura para confirmar).`, null);
    }
    if (state) return result("rejected", `O Deco recusou: ${reason(err)}`, state);
    return result(
      "ambiguous",
      `Sem resposta do Deco (${reason(err)}); não dá para saber se foi aplicada. Nada será reenviado — confira na próxima leitura.`,
      null,
    );
  }

  // --- 2 e 3. escrita + verificação ---------------------------------
  if (change.op === "add") {
    return settle(await attempt(() => p.add(mac, change.ip)), `Reserva ${change.ip} criada.`);
  }
  if (change.op === "remove") {
    return settle(await attempt(() => p.remove(mac)), `Reserva ${before!.ip} removida.`);
  }

  // move = remove + add
  const oldIp = before!.ip;
  const removeErr = await attempt(() => p.remove(mac));
  if (removeErr) {
    const state = await reread(p);
    if (!state) {
      return result(
        "ambiguous",
        `Sem resposta ao remover a reserva antiga (${reason(removeErr)}); não dá para saber o estado. Nada será reenviado.`,
        null,
      );
    }
    if (find(state, mac)) return result("rejected", `O Deco recusou remover a reserva antiga: ${reason(removeErr)}`, state);
    // Removeu apesar do erro: segue para o add.
  }

  const addErr = await attempt(() => p.add(mac, change.ip));
  const state = await reread(p);
  if (state && reached(state)) return result("applied", `Reserva movida de ${oldIp} para ${change.ip}.`, state);
  if (!state) {
    return result(
      "ambiguous",
      addErr
        ? `A reserva antiga (${oldIp}) foi removida e não houve resposta ao criar ${change.ip}. Nada será reenviado; ` +
            `confira na próxima leitura e recrie se preciso.`
        : `Reserva movida para ${change.ip} (sem releitura para confirmar).`,
      null,
    );
  }
  if (find(state, mac)) {
    return result("unverified", `Estado inesperado: a reserva está em ${find(state, mac)!.ip}.`, state);
  }

  // A antiga sumiu e a nova não entrou: recria a antiga, uma vez.
  const why = addErr ? reason(addErr) : "o Deco respondeu OK, mas a reserva não apareceu";
  const restoreErr = await attempt(() => p.add(mac, oldIp));
  const afterRestore = await reread(p);
  if (afterRestore && find(afterRestore, mac)?.ip === oldIp) {
    return result("rolled-back", `Não foi possível reservar ${change.ip} (${why}). A reserva ${oldIp} foi restaurada.`, afterRestore);
  }
  return result(
    "lost",
    `FALHOU E A RESERVA ANTIGA NÃO VOLTOU: ${mac} estava em ${oldIp}, ${change.ip} falhou (${why})` +
      `${restoreErr ? `, restauração: ${reason(restoreErr)}` : ""}. Recrie a reserva em ${oldIp}.`,
    afterRestore,
  );
}
