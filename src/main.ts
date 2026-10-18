import { type App, createApp } from "./app.js";
import { ConfigError, describeConfig, loadConfig, loadMetricsToken, loadUiPassword } from "./config.js";
import { createLogger } from "./log.js";
import { buildServer } from "./server/http.js";

function fail(err: unknown): never {
  if (err instanceof ConfigError) {
    console.error(`Configuração inválida: ${err.message}`);
    process.exit(2);
  }
  throw err;
}

let config;
let uiPassword: string | undefined;
let metricsToken: string | null;
try {
  config = loadConfig();
  uiPassword = loadUiPassword();
  metricsToken = loadMetricsToken();
} catch (err) {
  fail(err);
}

const log = createLogger(config.logLevel);
log.info(describeConfig(config));
if (!uiPassword) {
  log.warn("UI_PASSWORD não definido: a interface está aberta para qualquer um na rede.");
}

let app: App;
try {
  app = createApp(config, log);
} catch (err) {
  fail(err);
}
app.poller.on("snapshot", (snap) => {
  log.info(`snapshot: ${snap.nodes.filter((n) => n.online).length}/${snap.nodes.length} nós online, ${snap.clients.length} clientes`);
});

const server = await buildServer({ app, uiPassword, metricsToken });
await server.listen({ host: config.http.bind, port: config.http.port });
log.info(`HTTP ouvindo em http://${config.http.bind}:${config.http.port}`);
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
    void server
      .close()
      .then(() => app.close())
      .then(() => process.exit(0));
  });
}
