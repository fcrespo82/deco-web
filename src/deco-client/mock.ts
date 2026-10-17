/**
 * DecoApi em memória, a partir de fixtures/snapshot.json (gerado do probe).
 * Serve para desenvolver sem o roteador e para testar poller/eventos:
 * `mutate` altera o estado cru entre polls e `failNext` injeta erros.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { asArray, parseReservations, parseSnapshot } from "./parse.js";
import { applyReservationChange, type ReservationChange, type ReservationWriteResult } from "./reservations.js";
import type { DecoApi, RawSnapshot, Snapshot } from "./types.js";
import { DecoApiError } from "./vendor/errors.js";

/**
 * Falha injetada numa escrita. `applied: true` simula a resposta perdida de
 * uma escrita que o Deco aplicou (o caso ambíguo).
 */
export interface WriteFailure {
  error: Error;
  applied?: boolean;
}

export const DEFAULT_FIXTURE = fileURLToPath(
  new URL("../../fixtures/snapshot.json", import.meta.url),
);

export function loadFixture(path = DEFAULT_FIXTURE): RawSnapshot {
  return JSON.parse(readFileSync(path, "utf8")) as RawSnapshot;
}

export interface MockDecoOptions {
  raw?: RawSnapshot;
  now?: () => Date;
  /** Atraso artificial por chamada, para simular a lentidão do Deco. */
  latencyMs?: number;
}

export class MockDecoApi implements DecoApi {
  raw: RawSnapshot;
  calls = 0;
  /** Escritas recebidas, na ordem: "add AA-..=192.168.68.50", "remove AA-..". */
  writes: string[] = [];
  private failures: Error[] = [];
  private writeFailures: WriteFailure[] = [];
  private listFailures: Error[] = [];
  private readonly now: () => Date;
  private readonly latencyMs: number;

  constructor(opts: MockDecoOptions = {}) {
    this.raw = structuredClone(opts.raw ?? loadFixture());
    this.now = opts.now ?? (() => new Date());
    this.latencyMs = opts.latencyMs ?? 0;
  }

  /** Altera o estado cru que o próximo fetchSnapshot vai devolver. */
  mutate(fn: (raw: RawSnapshot) => void): this {
    fn(this.raw);
    return this;
  }

  /** Enfileira erros: cada fetchSnapshot seguinte consome um. */
  failNext(...errors: Error[]): this {
    this.failures.push(...errors);
    return this;
  }

  /** Cada escrita seguinte (add/remove) consome uma falha. */
  failNextWrite(...failures: WriteFailure[]): this {
    this.writeFailures.push(...failures);
    return this;
  }

  /** Cada getlist seguinte, dentro de changeReservation, consome um erro. */
  failNextList(...errors: Error[]): this {
    this.listFailures.push(...errors);
    return this;
  }

  async changeReservation(change: ReservationChange): Promise<ReservationWriteResult> {
    this.calls += 1;
    if (this.latencyMs) await new Promise((r) => setTimeout(r, this.latencyMs));
    const failure = this.failures.shift();
    if (failure) throw failure;
    return applyReservationChange(
      {
        list: async () => {
          const err = this.listFailures.shift();
          if (err) throw err;
          const parsed = parseReservations(structuredClone(this.raw.reservations));
          return { reservations: parsed.list, max: parsed.max };
        },
        add: async (mac, ip) => this.write(`add ${mac}=${ip}`, () => this.addReservation(mac, ip)),
        remove: async (mac) => this.write(`remove ${mac}`, () => this.removeReservation(mac)),
      },
      change,
    );
  }

  private write(label: string, apply: () => void): void {
    this.writes.push(label);
    const failure = this.writeFailures.shift();
    if (failure && !failure.applied) throw failure.error;
    apply();
    if (failure) throw failure.error;
  }

  private reservationList(): Record<string, unknown>[] {
    const raw = (this.raw.reservations ??= {}) as Record<string, unknown>;
    const list = asArray(raw.reservation_list);
    raw.reservation_list = list;
    return list;
  }

  /** Imita o firmware: IP_CONFLICT para IP já reservado ou em uso por outro. */
  private addReservation(mac: string, ip: string): void {
    const list = this.reservationList();
    const clients = asArray((this.raw.clientList as Record<string, unknown> | undefined)?.client_list);
    const taken =
      list.some((r) => r.ip === ip || r.mac === mac) ||
      clients.some((c) => c.ip === ip && String(c.mac).toUpperCase().replace(/:/g, "-") !== mac);
    if (taken) throw new DecoApiError("admin/client?form=addr_reservation returned error_code IP_CONFLICT", "IP_CONFLICT");
    list.push({ mac, ip });
  }

  private removeReservation(mac: string): void {
    const raw = this.raw.reservations as Record<string, unknown>;
    raw.reservation_list = this.reservationList().filter((r) => r.mac !== mac);
  }

  async fetchSnapshot(): Promise<Snapshot> {
    this.calls += 1;
    if (this.latencyMs) await new Promise((r) => setTimeout(r, this.latencyMs));
    const failure = this.failures.shift();
    if (failure) throw failure;
    return parseSnapshot(structuredClone(this.raw), this.now());
  }
}
