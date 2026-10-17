/**
 * Circuit breaker das chamadas ao Deco.
 *
 * O Deco bloqueia o admin depois de ~10 logins errados, então a regra é nunca
 * insistir:
 * - Qualquer falha abre o circuito com backoff exponencial (base, 2×, 4×... até max).
 * - Falhas de senha ("auth") também são contadas; ao atingir `maxAuthFailures`,
 *   ou se o firmware disser que restam poucas tentativas, o circuito TRAVA e
 *   só volta com reset manual. O estado é persistível para sobreviver a
 *   reinícios do container (senão um restart em loop gastaria as tentativas).
 * - Sucesso zera tudo.
 */
import type { ClassifiedFailure } from "../deco-client/errors.js";

export type BreakerStatus = "closed" | "open" | "locked";

export interface BreakerState {
  consecutiveFailures: number;
  authFailures: number;
  /** Epoch ms até quando nenhuma tentativa é permitida. */
  openUntil: number | null;
  locked: boolean;
  lastFailure: (ClassifiedFailure & { at: number }) | null;
}

export interface BreakerOptions {
  baseDelayMs?: number;
  maxDelayMs?: number;
  maxAuthFailures?: number;
  /** Trava se o firmware informar que restam esta quantidade de tentativas ou menos. */
  minAttemptsLeft?: number;
  now?: () => number;
  initial?: BreakerState;
  onChange?: (state: BreakerState) => void;
}

export type Permit = { ok: true } | { ok: false; status: "open" | "locked"; retryAt: number | null };

export const INITIAL_BREAKER_STATE: BreakerState = {
  consecutiveFailures: 0,
  authFailures: 0,
  openUntil: null,
  locked: false,
  lastFailure: null,
};

export class CircuitBreaker {
  private s: BreakerState;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly maxAuthFailures: number;
  private readonly minAttemptsLeft: number;
  private readonly now: () => number;
  private readonly onChange?: (state: BreakerState) => void;

  constructor(opts: BreakerOptions = {}) {
    this.baseDelayMs = opts.baseDelayMs ?? 60_000;
    this.maxDelayMs = opts.maxDelayMs ?? 60 * 60_000;
    this.maxAuthFailures = opts.maxAuthFailures ?? 3;
    this.minAttemptsLeft = opts.minAttemptsLeft ?? 5;
    this.now = opts.now ?? Date.now;
    this.onChange = opts.onChange;
    this.s = structuredClone(opts.initial ?? INITIAL_BREAKER_STATE);
  }

  get state(): BreakerState {
    return structuredClone(this.s);
  }

  get status(): BreakerStatus {
    if (this.s.locked) return "locked";
    if (this.s.openUntil !== null && this.now() < this.s.openUntil) return "open";
    return "closed";
  }

  permit(): Permit {
    const status = this.status;
    if (status === "closed") return { ok: true };
    return { ok: false, status, retryAt: status === "open" ? this.s.openUntil : null };
  }

  recordSuccess(): void {
    if (this.s.consecutiveFailures === 0 && this.s.authFailures === 0 && !this.s.lastFailure) return;
    this.s = structuredClone(INITIAL_BREAKER_STATE);
    this.onChange?.(this.state);
  }

  recordFailure(failure: ClassifiedFailure): void {
    const now = this.now();
    this.s.consecutiveFailures += 1;
    this.s.lastFailure = { ...failure, at: now };

    if (failure.kind === "auth") {
      this.s.authFailures += 1;
      const fewLeft = failure.attemptsLeft !== null && failure.attemptsLeft <= this.minAttemptsLeft;
      if (this.s.authFailures >= this.maxAuthFailures || fewLeft) this.s.locked = true;
    }

    const delay = Math.min(
      this.baseDelayMs * 2 ** (this.s.consecutiveFailures - 1),
      this.maxDelayMs,
    );
    this.s.openUntil = now + delay;
    this.onChange?.(this.state);
  }

  /** Destrava manualmente (ex.: depois de corrigir DECO_PASSWORD). */
  reset(): void {
    this.s = structuredClone(INITIAL_BREAKER_STATE);
    this.onChange?.(this.state);
  }
}
