/**
 * Monta as peças do backend a partir da configuração: store, DecoApi
 * (live ou mock), breaker persistido, gateway e poller.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { type Config, loadDecoPassword } from "./config.js";
import { CircuitBreaker, type BreakerState } from "./core/breaker.js";
import { DecoGateway } from "./core/gateway.js";
import { Poller } from "./core/poller.js";
import { LiveDecoApi } from "./deco-client/live.js";
import { MockDecoApi } from "./deco-client/mock.js";
import type { DecoApi } from "./deco-client/types.js";
import { Store } from "./db/store.js";
import type { Logger } from "./log.js";

const BREAKER_KEY = "breaker_state";

export interface App {
  config: Config;
  store: Store;
  gateway: DecoGateway;
  poller: Poller;
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

  const gateway = new DecoGateway(deco, breaker);
  const poller = new Poller({ gateway, store, intervalMs: config.pollIntervalMs, logger: log });

  return {
    config,
    store,
    gateway,
    poller,
    async close() {
      await poller.stop();
      store.close();
    },
  };
}
