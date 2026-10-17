/** Logger mínimo em texto. Nunca registre a senha do Deco ou PSKs. */
export type Level = "debug" | "info" | "warn" | "error";

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface Logger {
  debug(msg: string): void;
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

export function createLogger(level: Level = "info", sink = console): Logger {
  const at = (l: Level) => (msg: string) => {
    if (ORDER[l] < ORDER[level]) return;
    const line = `${new Date().toISOString()} ${l.toUpperCase().padEnd(5)} ${msg}`;
    (l === "error" || l === "warn" ? sink.error : sink.log)(line);
  };
  return { debug: at("debug"), info: at("info"), warn: at("warn"), error: at("error") };
}

export const silentLogger: Logger = { debug() {}, info() {}, warn() {}, error() {} };
