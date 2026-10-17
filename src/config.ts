/**
 * Configuração 100% por variáveis de ambiente.
 *
 * A senha do Deco pode vir de DECO_PASSWORD ou de DECO_PASSWORD_FILE (Docker
 * secrets). Ela fica fora do objeto serializável: `describeConfig` e os logs
 * nunca a veem.
 */
import { readFileSync } from "node:fs";

export interface Config {
  /** true usa o mock (fixtures) em vez do roteador. */
  mock: boolean;
  deco: {
    host: string;
    username: string;
    timeoutMs: number;
    /** Pausa mínima entre sessões admin consecutivas. */
    sessionGapMs: number;
  };
  pollIntervalMs: number;
  /** Leitura detalhada (cliente→nó, Wi-Fi, CPU) a cada N polls. */
  detailEvery: number;
  allowWrite: boolean;
  allowDangerous: boolean;
  dataDir: string;
  logLevel: "debug" | "info" | "warn" | "error";
  http: { bind: string; port: number };
  /** Eventos e amostras mais velhos que isso são apagados. */
  retentionDays: number;
  /** Ausência mínima para registrar desconexão de um cliente. */
  disconnectGraceMs: number;
  alerts: {
    /** Alerta de dispositivo novo (MAC nunca visto e não aprovado). */
    newDevice: boolean;
    /** Nó offline por mais que isso gera alerta; null = desligado. */
    nodeOfflineMs: number | null;
    /** Internet fora por mais que isso gera alerta; null = desligado. */
    internetDownMs: number | null;
    /** URL do painel, para links nas notificações. */
    publicUrl: string | null;
  };
  /** Canais (sem segredos; tokens em loadNotifySecrets). */
  notify: {
    /** URL completa do tópico, ex.: https://ntfy.sh/meu-topico. */
    ntfyUrl: string | null;
    telegramChatId: string | null;
    telegramApi: string;
  };
}

export class ConfigError extends Error {}

const MIN_POLL_SECONDS = 30;

function flag(env: NodeJS.ProcessEnv, name: string): boolean {
  const raw = env[name]?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function flagDefault(env: NodeJS.ProcessEnv, name: string, fallback: boolean): boolean {
  const raw = env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  throw new ConfigError(`${name} deve ser 1 ou 0, recebido "${env[name]}"`);
}

/** Minutos → ms; 0 desliga (null). */
function minutesOrOff(env: NodeJS.ProcessEnv, name: string, fallback: number): number | null {
  const raw = env[name]?.trim();
  if (raw === "0") return null;
  return positiveNumber(env, name, fallback) * 60_000;
}

function optionalUrl(env: NodeJS.ProcessEnv, name: string): string | null {
  const raw = env[name]?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error();
    return url.toString().replace(/\/$/, "");
  } catch {
    throw new ConfigError(`${name} deve ser uma URL http(s), recebido "${raw}"`);
  }
}

function positiveNumber(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new ConfigError(`${name} deve ser um número positivo, recebido "${raw}"`);
  }
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const mock = flag(env, "DECO_MOCK");
  const host = env.DECO_HOST?.trim() ?? "";
  if (!mock && !host) {
    throw new ConfigError("DECO_HOST não definido (ex.: DECO_HOST=192.168.68.1) — ou use DECO_MOCK=1");
  }

  const pollSeconds = positiveNumber(env, "POLL_INTERVAL", 90);
  if (pollSeconds < MIN_POLL_SECONDS) {
    throw new ConfigError(
      `POLL_INTERVAL mínimo é ${MIN_POLL_SECONDS}s: cada poll abre uma sessão admin no Deco`,
    );
  }

  const allowWrite = flag(env, "DECO_ALLOW_WRITE");
  const allowDangerous = flag(env, "DECO_ALLOW_DANGEROUS");
  if (allowDangerous && !allowWrite) {
    throw new ConfigError("DECO_ALLOW_DANGEROUS=1 exige DECO_ALLOW_WRITE=1");
  }

  const logLevel = (env.LOG_LEVEL?.trim().toLowerCase() || "info") as Config["logLevel"];
  if (!["debug", "info", "warn", "error"].includes(logLevel)) {
    throw new ConfigError(`LOG_LEVEL inválido: "${env.LOG_LEVEL}"`);
  }

  const ntfyUrl = optionalUrl(env, "NOTIFY_NTFY_URL");
  if (ntfyUrl && new URL(ntfyUrl).pathname.split("/").filter(Boolean).length === 0) {
    throw new ConfigError("NOTIFY_NTFY_URL precisa incluir o tópico, ex.: https://ntfy.sh/meu-topico");
  }
  const telegramChatId = env.NOTIFY_TELEGRAM_CHAT_ID?.trim() || null;
  const hasTelegramToken = Boolean(env.NOTIFY_TELEGRAM_TOKEN?.trim() || env.NOTIFY_TELEGRAM_TOKEN_FILE?.trim());
  if (hasTelegramToken !== Boolean(telegramChatId)) {
    throw new ConfigError("Telegram precisa de NOTIFY_TELEGRAM_TOKEN e NOTIFY_TELEGRAM_CHAT_ID juntos");
  }

  return {
    mock,
    deco: {
      host,
      username: env.DECO_USERNAME?.trim() || "admin",
      timeoutMs: positiveNumber(env, "DECO_TIMEOUT_MS", 15_000),
      sessionGapMs: positiveNumber(env, "DECO_SESSION_GAP_MS", 10_000),
    },
    pollIntervalMs: pollSeconds * 1000,
    detailEvery: Math.round(positiveNumber(env, "POLL_DETAIL_EVERY", 5)),
    allowWrite,
    allowDangerous,
    dataDir: env.DATA_DIR?.trim() || "/data",
    logLevel,
    retentionDays: positiveNumber(env, "HISTORY_RETENTION_DAYS", 90),
    disconnectGraceMs: positiveNumber(env, "EVENT_DISCONNECT_GRACE", 300) * 1000,
    http: {
      bind: env.BIND?.trim() || "0.0.0.0",
      port: Math.round(positiveNumber(env, "PORT", 8080)),
    },
    alerts: {
      newDevice: flagDefault(env, "ALERT_NEW_DEVICE", true),
      nodeOfflineMs: minutesOrOff(env, "ALERT_NODE_OFFLINE_MINUTES", 5),
      internetDownMs: minutesOrOff(env, "ALERT_INTERNET_DOWN_MINUTES", 3),
      publicUrl: optionalUrl(env, "PUBLIC_URL"),
    },
    notify: {
      ntfyUrl,
      telegramChatId,
      telegramApi: optionalUrl(env, "NOTIFY_TELEGRAM_API") ?? "https://api.telegram.org",
    },
  };
}

/** Lê a senha do Deco. Separada do Config para não ser serializada por acidente. */
export function loadDecoPassword(env: NodeJS.ProcessEnv = process.env): string {
  const file = env.DECO_PASSWORD_FILE?.trim();
  if (file) {
    const fromFile = readFileSync(file, "utf8").replace(/\r?\n$/, "");
    if (fromFile) return fromFile;
    throw new ConfigError(`DECO_PASSWORD_FILE (${file}) está vazio`);
  }
  const password = env.DECO_PASSWORD;
  if (!password) throw new ConfigError("DECO_PASSWORD (ou DECO_PASSWORD_FILE) não definido");
  return password;
}

/** Senha da UI (UI_PASSWORD ou UI_PASSWORD_FILE). undefined = UI sem senha. */
export function loadUiPassword(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const file = env.UI_PASSWORD_FILE?.trim();
  if (file) {
    const fromFile = readFileSync(file, "utf8").replace(/\r?\n$/, "");
    if (!fromFile) throw new ConfigError(`UI_PASSWORD_FILE (${file}) está vazio`);
    return fromFile;
  }
  return env.UI_PASSWORD || undefined;
}

function secret(env: NodeJS.ProcessEnv, name: string): string | null {
  const file = env[`${name}_FILE`]?.trim();
  if (file) {
    const value = readFileSync(file, "utf8").trim();
    if (!value) throw new ConfigError(`${name}_FILE (${file}) está vazio`);
    return value;
  }
  return env[name]?.trim() || null;
}

/** Tokens dos canais de notificação. Fora do Config, como as senhas. */
export function loadNotifySecrets(env: NodeJS.ProcessEnv = process.env): { ntfyToken: string | null; telegramToken: string | null } {
  return { ntfyToken: secret(env, "NOTIFY_NTFY_TOKEN"), telegramToken: secret(env, "NOTIFY_TELEGRAM_TOKEN") };
}

/** Resumo legível para o log de inicialização. Sem segredos. */
export function describeConfig(c: Config): string {
  const target = c.mock ? "mock (fixtures)" : `${c.deco.host} (usuário ${c.deco.username})`;
  const mode = c.allowDangerous ? "escrita + perigosas" : c.allowWrite ? "escrita" : "somente leitura";
  const channels = [c.notify.ntfyUrl && "ntfy", c.notify.telegramChatId && "Telegram"].filter(Boolean).join(" + ") || "nenhum";
  return (
    `Deco: ${target} · alertas: ${channels} · poll ${c.pollIntervalMs / 1000}s (detalhe a cada ${c.detailEvery}) · ${mode} · ` +
    `dados em ${c.dataDir} · http://${c.http.bind}:${c.http.port}`
  );
}
