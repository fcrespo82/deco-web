/**
 * Ponto único de acesso ao Deco: fila serial + circuit breaker em volta de
 * qualquer DecoApi. Nada no servidor deve chamar a DecoApi diretamente.
 */
import { classifyError } from "../deco-client/errors.js";
import type { ReservationChange, ReservationWriteResult } from "../deco-client/reservations.js";
import type { DecoApi, Snapshot } from "../deco-client/types.js";
import type { CircuitBreaker } from "./breaker.js";
import { SerialQueue } from "./queue.js";

export class CircuitOpenError extends Error {
  constructor(
    readonly status: "open" | "locked",
    readonly retryAt: number | null,
  ) {
    super(
      status === "locked"
        ? "Acesso ao Deco travado após falhas de login. Corrija a senha e destrave manualmente."
        : `Acesso ao Deco em espera após falha; nova tentativa a partir de ${new Date(retryAt ?? 0).toISOString()}.`,
    );
    this.name = "CircuitOpenError";
  }
}

export class DecoGateway {
  readonly queue = new SerialQueue();

  constructor(
    private readonly api: DecoApi,
    readonly breaker: CircuitBreaker,
  ) {}

  fetchSnapshot(): Promise<Snapshot> {
    return this.run((api) => api.fetchSnapshot());
  }

  /** Recusas do firmware voltam no resultado; só falhas de acesso contam no breaker. */
  changeReservation(change: ReservationChange): Promise<ReservationWriteResult> {
    return this.run((api) => api.changeReservation(change));
  }

  /**
   * Roda `fn` na fila. O breaker é consultado ao sair da fila (não ao entrar),
   * para que tarefas enfileiradas atrás de uma falha de login não tentem logar.
   */
  run<T>(fn: (api: DecoApi) => Promise<T>): Promise<T> {
    return this.queue.run(async () => {
      const permit = this.breaker.permit();
      if (!permit.ok) throw new CircuitOpenError(permit.status, permit.retryAt);
      try {
        const result = await fn(this.api);
        this.breaker.recordSuccess();
        return result;
      } catch (err) {
        this.breaker.recordFailure(classifyError(err));
        throw err;
      }
    });
  }
}
