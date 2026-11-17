import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { SwitchConfig } from "./types.js";

export type Collect = (config: SwitchConfig, password: string, action: "collect" | "transceiver", signal?: AbortSignal) => Promise<Record<string, unknown>>;
/** Sem shell ou credenciais em argv/env/log; processo com duração e saída limitadas. */
export const collectSwitch: Collect = (config, password, action, signal) => new Promise((resolve, reject) => {
  const child = spawn(process.env.SWITCH_PYTHON || "python3", [fileURLToPath(new URL("../../collectors/switches/worker.py", import.meta.url))], {
    stdio: ["pipe", "pipe", "ignore"], signal,
    env: { PATH: process.env.PATH, LANG: "C.UTF-8", PYTHONDONTWRITEBYTECODE: "1" },
  });
  let output = "";
  const fail = () => new Error("Falha na coleta. Confira conexão, modelo, credenciais e dependências Python.");
  const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("Tempo máximo de coleta excedido (120 s).")); }, 120_000);
  child.once("error", () => { clearTimeout(timer); reject(fail()); });
  child.stdin.on("error", () => undefined);
  child.stdout.on("data", (chunk: Buffer) => {
    output += chunk.toString();
    if (output.length > 4_000_000) { child.kill("SIGKILL"); reject(fail()); }
  });
  child.once("close", (code) => {
    clearTimeout(timer);
    try {
      const result = JSON.parse(output) as { ok: boolean; data: Record<string, unknown> };
      if (code !== 0 || !result.ok || !result.data) return reject(fail());
      resolve(result.data);
    } catch { reject(fail()); }
  });
  child.stdin.end(JSON.stringify({ action, config: {
    name: config.name, ip: config.host, model: config.model, username: config.username, password, port_count: config.portCount,
  } }));
});
