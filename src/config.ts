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
  };
  pollIntervalMs: number;
  /** Leitura detalhada (cliente→nó, Wi-Fi, CPU) a cada N polls. */
  detailEvery: number;
  allowWrite: boolean;
  allowDangerous: boolean;
  dataDir: string;
  logLevel: "debug" | "info" | "warn" | "error";
}

export class ConfigError extends Error {}

const MIN_POLL_SECONDS = 30;

function flag(env: NodeJS.ProcessEnv, name: string): boolean {
  const raw = env[name]?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
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

  return {
    mock,
    deco: {
      host,
      username: env.DECO_USERNAME?.trim() || "admin",
      timeoutMs: positiveNumber(env, "DECO_TIMEOUT_MS", 15_000),
    },
    pollIntervalMs: pollSeconds * 1000,
    detailEvery: Math.round(positiveNumber(env, "POLL_DETAIL_EVERY", 5)),
    allowWrite,
    allowDangerous,
    dataDir: env.DATA_DIR?.trim() || "/data",
    logLevel,
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

/** Resumo legível para o log de inicialização. Sem segredos. */
export function describeConfig(c: Config): string {
  const target = c.mock ? "mock (fixtures)" : `${c.deco.host} (usuário ${c.deco.username})`;
  const mode = c.allowDangerous ? "escrita + perigosas" : c.allowWrite ? "escrita" : "somente leitura";
  return `Deco: ${target} · poll ${c.pollIntervalMs / 1000}s · ${mode} · dados em ${c.dataDir}`;
}
