/**
 * DecoApi em memória, a partir de fixtures/snapshot.json (gerado do probe).
 * Serve para desenvolver sem o roteador e para testar poller/eventos:
 * `mutate` altera o estado cru entre polls e `failNext` injeta erros.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseSnapshot } from "./parse.js";
import type { DecoApi, RawSnapshot, Snapshot } from "./types.js";

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
  private failures: Error[] = [];
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

  async fetchSnapshot(): Promise<Snapshot> {
    this.calls += 1;
    if (this.latencyMs) await new Promise((r) => setTimeout(r, this.latencyMs));
    const failure = this.failures.shift();
    if (failure) throw failure;
    return parseSnapshot(structuredClone(this.raw), this.now());
  }
}
