/**
 * Monta as peças do backend a partir da configuração: store, DecoApi
 * (live ou mock), breaker persistido, gateway, poller, detector de eventos e
 * repositórios (inventário, faixas, eventos, auditoria).
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { type Config, loadDecoPassword } from "./config.js";
import { CircuitBreaker, type BreakerState } from "./core/breaker.js";
import { DecoGateway } from "./core/gateway.js";
import { EventDetector, type NetEvent } from "./core/events.js";
import { Poller } from "./core/poller.js";
import { ReservationService } from "./core/reservations.js";
import { LiveDecoApi } from "./deco-client/live.js";
import { MockDecoApi } from "./deco-client/mock.js";
import type { DecoApi } from "./deco-client/types.js";
import { AuditRepo } from "./db/audit.js";
import { EventRepo } from "./db/events.js";
import { InventoryRepo } from "./db/inventory.js";
import { IpRangeRepo } from "./db/ipranges.js";
import { Store } from "./db/store.js";
import type { Logger } from "./log.js";

const BREAKER_KEY = "breaker_state";
const LAST_PRUNE_KEY = "last_prune";
const DAY_MS = 24 * 60 * 60 * 1000;

export interface App {
  config: Config;
  store: Store;
  gateway: DecoGateway;
  poller: Poller;
  inventory: InventoryRepo;
  ranges: IpRangeRepo;
  events: EventRepo;
  audit: AuditRepo;
  /** Escrita de reservas no Deco (exige DECO_ALLOW_WRITE). */
  reservations: ReservationService;
  /** Escuta eventos novos (alertas). */
  onEvents(listener: (events: NetEvent[]) => void): void;
  /** Para o poller, espera o poll em andamento (e o logout) e fecha o banco. */
  close(): Promise<void>;
}

export function createApp(config: Config, log: Logger, api?: DecoApi): App {
  mkdirSync(config.dataDir, { recursive: true });
  const store = new Store(join(config.dataDir, "deco-web.sqlite"));

  const deco =
    api ??
    (config.mock
      ? new MockDecoApi()
      : new LiveDecoApi({
          host: config.deco.host,
          username: config.deco.username,
          password: loadDecoPassword(),
          timeoutMs: config.deco.timeoutMs,
          detailEvery: config.detailEvery,
          logger: log,
        }));

  const initial = store.getJson<BreakerState>(BREAKER_KEY) ?? undefined;
  const breaker = new CircuitBreaker({
    initial,
    onChange: (state) => {
      store.setJson(BREAKER_KEY, state);
      if (state.locked) {
        log.error(
          `Acesso ao Deco TRAVADO após ${state.authFailures} falha(s) de login ` +
            `(${state.lastFailure?.message ?? "?"}). Corrija a senha e destrave pela UI ou com "npm run unlock".`,
        );
      }
    },
  });
  if (initial?.locked) {
    log.error("Acesso ao Deco continua TRAVADO desde a última execução. Destrave pela UI ou com \"npm run unlock\".");
  }

  // O mock não precisa de pausa entre sessões (e os testes ficam rápidos).
  const gateway = new DecoGateway(deco, breaker, { minGapMs: config.mock ? 0 : config.deco.sessionGapMs });
  const poller = new Poller({ gateway, store, intervalMs: config.pollIntervalMs, logger: log });
  const inventory = new InventoryRepo(store.db);
  const ranges = new IpRangeRepo(store.db);
  const events = new EventRepo(store.db);
  const audit = new AuditRepo(store.db);
  const reservations = new ReservationService({ allowWrite: config.allowWrite, gateway, poller, audit, logger: log });

  // O detector parte do último snapshot persistido, para um restart não gerar
  // uma enxurrada de "conectou".
  const detector = new EventDetector({
    graceMs: config.disconnectGraceMs,
    knownMacs: store.clientSeen().keys(),
  });
  detector.prime(store.latestSnapshot());
  const listeners: ((events: NetEvent[]) => void)[] = [];

  poller.on("snapshot", (snap) => {
    const found = detector.next(snap);
    events.insert(found);
    if (found.length) log.debug(`eventos: ${found.map((e) => e.type).join(", ")}`);
    for (const l of listeners) {
      try {
        l(found);
      } catch (err) {
        log.error(`ouvinte de eventos falhou: ${(err as Error).message}`);
      }
    }
    pruneIfDue(snap.takenAt);
  });

  function pruneIfDue(nowIso: string) {
    const last = store.getJson<string>(LAST_PRUNE_KEY);
    const now = Date.parse(nowIso);
    if (last && now - Date.parse(last) < DAY_MS) return;
    const cutoff = new Date(now - config.retentionDays * DAY_MS).toISOString();
    const removed = events.prune(cutoff) + store.pruneSamples(cutoff);
    store.setJson(LAST_PRUNE_KEY, nowIso);
    if (removed) log.info(`retenção: ${removed} registro(s) anteriores a ${cutoff} removidos`);
  }

  return {
    config,
    store,
    gateway,
    poller,
    inventory,
    ranges,
    events,
    audit,
    reservations,
    onEvents: (l) => listeners.push(l),
    async close() {
      await poller.stop();
      store.close();
    },
  };
}
