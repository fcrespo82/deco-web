import { type App, createApp } from "./app.js";
import { ConfigError, describeConfig, loadConfig } from "./config.js";
import { createLogger } from "./log.js";

function fail(err: unknown): never {
  if (err instanceof ConfigError) {
    console.error(`Configuração inválida: ${err.message}`);
    process.exit(2);
  }
  throw err;
}

let config;
try {
  config = loadConfig();
} catch (err) {
  fail(err);
}

const log = createLogger(config.logLevel);
log.info(describeConfig(config));

let app: App;
try {
  app = createApp(config, log);
} catch (err) {
  fail(err);
}
app.poller.on("snapshot", (snap) => {
  log.info(`snapshot: ${snap.nodes.filter((n) => n.online).length}/${snap.nodes.length} nós online, ${snap.clients.length} clientes`);
});
app.poller.start();

/** Tempo máximo esperando o poll em andamento fazer logout no Deco. */
const SHUTDOWN_GRACE_MS = 60_000;

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    log.info(`${signal} recebido, aguardando o poll em andamento e encerrando`);
    const force = setTimeout(() => {
      log.warn("encerramento forçado: a sessão no Deco pode ficar aberta até expirar");
      process.exit(1);
    }, SHUTDOWN_GRACE_MS);
    force.unref();
    void app.close().then(() => process.exit(0));
  });
}
