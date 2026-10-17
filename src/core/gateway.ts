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

export interface GatewayOptions {
  /**
   * Pausa mínima entre o fim de uma sessão e o início da próxima. Medido num
   * X50: logar logo após o logout anterior derruba a conexão (ECONNRESET).
   */
  minGapMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export class DecoGateway {
  readonly queue = new SerialQueue();
  private readonly minGapMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private lastEndedAt = -Infinity;

  constructor(
    private readonly api: DecoApi,
    readonly breaker: CircuitBreaker,
    opts: GatewayOptions = {},
  ) {
    this.minGapMs = opts.minGapMs ?? 0;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = opts.now ?? Date.now;
  }

  fetchSnapshot(): Promise<Snapshot> {
    return this.run((api) => api.fetchSnapshot());
  }

  /** Recusas do firmware voltam no resultado; só falhas de acesso contam no breaker. */
  changeReservation(change: ReservationChange): Promise<ReservationWriteResult> {
    return this.run((api) => api.changeReservation(change));
  }

  changeReservations(changes: ReservationChange[]): Promise<ReservationWriteResult[]> {
    return this.run((api) => api.changeReservations(changes));
  }

  /**
   * Roda `fn` na fila. O breaker é consultado ao sair da fila (não ao entrar),
   * para que tarefas enfileiradas atrás de uma falha de login não tentem logar.
   */
  run<T>(fn: (api: DecoApi) => Promise<T>): Promise<T> {
    return this.queue.run(async () => {
      const permit = this.breaker.permit();
      if (!permit.ok) throw new CircuitOpenError(permit.status, permit.retryAt);
      const wait = this.lastEndedAt + this.minGapMs - this.now();
      if (wait > 0) await this.sleep(wait);
      try {
        const result = await fn(this.api);
        this.breaker.recordSuccess();
        return result;
      } catch (err) {
        this.breaker.recordFailure(classifyError(err));
        throw err;
      } finally {
        this.lastEndedAt = this.now();
      }
    });
  }
}
