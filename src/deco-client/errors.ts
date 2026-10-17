import { DecoLoginError } from "./vendor/errors.js";

export {
  DecoApiError,
  DecoAuthExpiredError,
  DecoError,
  DecoLoginError,
  DecoTimeoutError,
  DecoWriteBlockedError,
} from "./vendor/errors.js";

/**
 * O que uma falha significa para o circuit breaker:
 * - auth: senha recusada. Conta para o bloqueio do Deco (~10 falhas).
 * - busy: HTTP 403 no login — outra sessão admin aberta (app/web). Não é senha errada.
 * - other: rede, timeout, resposta inesperada.
 */
export type FailureKind = "auth" | "busy" | "other";

export interface ClassifiedFailure {
  kind: FailureKind;
  message: string;
  /** Tentativas restantes informadas pelo firmware, quando houver. */
  attemptsLeft: number | null;
}

export function classifyError(err: unknown): ClassifiedFailure {
  const message = err instanceof Error ? err.message : String(err);
  if (err instanceof DecoLoginError) {
    if (/HTTP 403/.test(message)) return { kind: "busy", message, attemptsLeft: null };
    const left = Number(err.attemptsAllowed);
    return {
      kind: "auth",
      message,
      attemptsLeft: err.attemptsAllowed !== undefined && Number.isFinite(left) ? left : null,
    };
  }
  return { kind: "other", message, attemptsLeft: null };
}
