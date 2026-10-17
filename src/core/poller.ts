/**
 * Poller: lê o Deco a cada `intervalMs` e mantém o cache que a UI consulta.
 * A UI nunca fala com o Deco; ela lê `poller.cache`.
 *
 * - Usa setTimeout encadeado: um poll nunca começa antes do anterior terminar.
 * - Com o breaker aberto, pula o ciclo sem tocar no Deco.
 * - `pollNow()` (ex.: botão "atualizar") reaproveita um poll em andamento.
 * - Ao iniciar, carrega o último snapshot do SQLite para a UI ter dados já.
 */
import { EventEmitter } from "node:events";
import type { Reservation, Snapshot } from "../deco-client/types.js";
import type { Store } from "../db/store.js";
import type { BreakerStatus } from "./breaker.js";
import { CircuitOpenError, type DecoGateway } from "./gateway.js";
import type { Logger } from "../log.js";

export interface PollerCache {
  snapshot: Snapshot | null;
  /** Quando o snapshot atual foi obtido com sucesso. */
  fetchedAt: string | null;
  lastAttemptAt: string | null;
  lastError: { message: string; at: string } | null;
  nextPollAt: string | null;
  breaker: BreakerStatus;
}

export interface PollerEvents {
  /** Snapshot novo; `previous` é o anterior (ou null no primeiro). */
  snapshot: [next: Snapshot, previous: Snapshot | null];
  error: [err: Error];
}

export interface PollerOptions {
  gateway: DecoGateway;
  store: Store;
  intervalMs: number;
  logger: Logger;
  now?: () => Date;
}

export class Poller extends EventEmitter<PollerEvents> {
  private readonly gateway: DecoGateway;
  private readonly store: Store;
  private readonly intervalMs: number;
  private readonly log: Logger;
  private readonly now: () => Date;
  private timer: NodeJS.Timeout | null = null;
  private inFlight: Promise<Snapshot | null> | null = null;
  private running = false;
  private state: Omit<PollerCache, "breaker">;

  constructor(opts: PollerOptions) {
    super();
    this.gateway = opts.gateway;
    this.store = opts.store;
    this.intervalMs = opts.intervalMs;
    this.log = opts.logger;
    this.now = opts.now ?? (() => new Date());
    const persisted = this.store.latestSnapshot();
    this.state = {
      snapshot: persisted,
      fetchedAt: persisted?.takenAt ?? null,
      lastAttemptAt: null,
      lastError: null,
      nextPollAt: null,
    };
  }

  get cache(): PollerCache {
    return { ...this.state, breaker: this.gateway.breaker.status };
  }

  /**
   * Atualiza as reservas do cache com a lista que uma escrita acabou de reler,
   * para a UI refletir a mudança sem esperar o próximo poll. O resto do
   * snapshot (e o detector de eventos) só muda no poll.
   */
  applyReservations(reservations: Reservation[], max: number | null): void {
    const snap = this.state.snapshot;
    if (!snap) return;
    this.state.snapshot = { ...snap, reservations, reservationMax: max ?? snap.reservationMax };
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    void this.tick();
  }

  /**
   * Para o agendamento e espera o poll em andamento terminar, para que a
   * sessão no Deco seja fechada com logout em vez de abandonada.
   */
  async stop(): Promise<void> {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.state.nextPollAt = null;
    await this.inFlight?.catch(() => undefined);
  }

  /** Poll imediato. Se já houver um em andamento, espera o mesmo. */
  pollNow(): Promise<Snapshot | null> {
    this.inFlight ??= this.poll().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async tick(): Promise<void> {
    await this.pollNow();
    if (!this.running) return;
    this.timer = setTimeout(() => void this.tick(), this.intervalMs);
    this.state.nextPollAt = new Date(this.now().getTime() + this.intervalMs).toISOString();
  }

  private async poll(): Promise<Snapshot | null> {
    // Breaker aberto: nem entra na fila. Evita acumular tentativas.
    const permit = this.gateway.breaker.permit();
    if (!permit.ok) {
      this.log.debug(`poll pulado: breaker ${permit.status}`);
      return null;
    }

    this.state.lastAttemptAt = this.now().toISOString();
    try {
      const snapshot = await this.gateway.fetchSnapshot();
      const previous = this.state.snapshot;
      this.store.recordSnapshot(snapshot);
      this.state.snapshot = snapshot;
      this.state.fetchedAt = snapshot.takenAt;
      this.state.lastError = null;
      this.log.debug(
        `poll ok: ${snapshot.nodes.length} nós, ${snapshot.clients.length} clientes`,
      );
      this.emit("snapshot", snapshot, previous);
      return snapshot;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.state.lastError = { message: error.message, at: this.now().toISOString() };
      if (!(err instanceof CircuitOpenError)) {
        this.log.warn(`poll falhou: ${error.message}`);
      }
      // Só emite se houver ouvinte: "error" sem ouvinte derruba o processo.
      if (this.listenerCount("error") > 0) this.emit("error", error);
      return null;
    }
  }
}
