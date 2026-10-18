/**
 * Monta as peças do backend a partir da configuração: store, DecoApi
 * (live ou mock), breaker persistido, gateway, poller, detector de eventos e
 * repositórios (inventário, faixas, eventos, auditoria).
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { type Config, loadDecoPassword, loadNotifySecrets } from "./config.js";
import { AlertEngine } from "./core/alerts.js";
import { CircuitBreaker, type BreakerState } from "./core/breaker.js";
import { DecoGateway } from "./core/gateway.js";
import { EventDetector, type NetEvent } from "./core/events.js";
import { Poller } from "./core/poller.js";
import { ReservationService } from "./core/reservations.js";
import { SystemService } from "./core/system.js";
import { LiveDecoApi } from "./deco-client/live.js";
import { MockDecoApi } from "./deco-client/mock.js";
import type { DecoApi } from "./deco-client/types.js";
import { AlertRepo } from "./db/alerts.js";
import { AuditRepo } from "./db/audit.js";
import { EventRepo } from "./db/events.js";
import { InventoryRepo } from "./db/inventory.js";
import { IpRangeRepo } from "./db/ipranges.js";
import { Store } from "./db/store.js";
import type { Logger } from "./log.js";
import { NtfyChannel, TelegramChannel, type Channel } from "./notify/channels.js";

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
  /** Reiniciar nós e alterar Wi-Fi (exige DECO_ALLOW_DANGEROUS). */
  system: SystemService;
  alerts: AlertRepo;
  alertEngine: AlertEngine;
  /** Escuta eventos novos (alertas). */
  onEvents(listener: (events: NetEvent[]) => void): void;
  /** Para o poller, espera o poll em andamento (e o logout) e fecha o banco. */
  close(): Promise<void>;
}

/** Canais a partir da configuração (tokens lidos aqui, nunca guardados no Config). */
export function channelsFromConfig(config: Config): Channel[] {
  const secrets = loadNotifySecrets();
  const out: Channel[] = [];
  if (config.notify.ntfyUrl) out.push(new NtfyChannel(config.notify.ntfyUrl, secrets.ntfyToken));
  if (config.notify.telegramChatId && secrets.telegramToken) {
    out.push(new TelegramChannel(config.notify.telegramApi, secrets.telegramToken, config.notify.telegramChatId));
  }
  return out;
}

export interface AppDeps {
  api?: DecoApi;
  /** Substitui os canais de notificação (testes). */
  channels?: Channel[];
}

export function createApp(config: Config, log: Logger, depsOrApi?: DecoApi | AppDeps): App {
  const deps: AppDeps = depsOrApi && "fetchSnapshot" in depsOrApi ? { api: depsOrApi } : (depsOrApi ?? {});
  const api = deps.api;
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
  const alerts = new AlertRepo(store.db);
  const alertEngine = new AlertEngine({
    settings: config.alerts,
    channels: deps.channels ?? channelsFromConfig(config),
    repo: alerts,
    kv: store,
    isApproved: (mac) => inventory.findByMac(mac)?.approved ?? false,
    aliasOf: (mac) => inventory.findByMac(mac)?.alias ?? null,
    logger: log,
  });
  const reservations = new ReservationService({ allowWrite: config.allowWrite, gateway, poller, audit, logger: log });
  const system = new SystemService({
    allowDangerous: config.allowDangerous,
    wifiWrite: config.experimentalWifiWrite,
    gateway,
    poller,
    audit,
    logger: log,
  });

  // O detector parte do último snapshot persistido, para um restart não gerar
  // uma enxurrada de "conectou".
  const detector = new EventDetector({
    graceMs: config.disconnectGraceMs,
    knownMacs: store.clientSeen().keys(),
  });
  detector.prime(store.latestSnapshot());
  const listeners: ((events: NetEvent[]) => void)[] = [];

  poller.on("snapshot", (snap, previous) => {
    const found = detector.next(snap);
    void alertEngine.process(found, snap, previous).catch(() => undefined);
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
    const removed = events.prune(cutoff) + store.pruneSamples(cutoff) + alerts.prune(cutoff);
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
    system,
    alerts,
    alertEngine,
    onEvents: (l) => listeners.push(l),
    async close() {
      await poller.stop();
      await alertEngine.idle();
      store.close();
    },
  };
}
