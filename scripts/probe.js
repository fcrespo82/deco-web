/**
 * Probe SOMENTE LEITURA do Deco: modelo, firmware, quais forms de leitura do
 * catálogo respondem, nós, clientes e reservas. Grava probe-output.json com
 * segredos redigidos.
 *
 * Uso: npm run probe   (lê DECO_HOST / DECO_PASSWORD do ambiente ou de .env)
 *
 * Proteções:
 * - Uma única sessão: tudo roda em sequência no mesmo login e termina com logout.
 * - Aborta no primeiro erro de autenticação. Cada form chamado depois de um
 *   login falho tentaria logar de novo, e ~10 falhas bloqueiam o Deco.
 * - Só operações com risco "read" do catálogo são chamadas.
 */
import { writeFileSync } from "node:fs";
import { DecoClient } from "../src/deco-client/vendor/client.js";
import { CATALOG } from "../src/deco-client/vendor/catalog.js";
import { DecoApiError, DecoLoginError } from "../src/deco-client/vendor/errors.js";
import { normalize } from "../src/deco-client/vendor/format.js";

const OUTPUT = "probe-output.json";

const host = process.env.DECO_HOST?.trim();
const password = process.env.DECO_PASSWORD;
if (!host || !password) {
  console.error("Defina DECO_HOST e DECO_PASSWORD (no ambiente ou em .env).");
  process.exit(2);
}

const client = new DecoClient({
  host,
  username: process.env.DECO_USERNAME ?? "admin",
  password,
  timeoutMs: 15_000,
});

const redact = (value) => normalize(value, false);

/** Erro de login aborta tudo; o resto é registrado e o probe continua. */
async function read(request) {
  try {
    return { ok: true, result: redact(await client.call(request)) };
  } catch (err) {
    if (err instanceof DecoLoginError) throw err;
    return {
      ok: false,
      error: err.name,
      ...(err instanceof DecoApiError ? { errorCode: err.errorCode } : {}),
      message: String(err.message).slice(0, 200),
    };
  }
}

const output = {
  probedAt: new Date().toISOString(),
  host,
  device: null,
  forms: {},
  clientsByNode: {},
};

let exitCode = 0;
try {
  console.log(`Conectando em ${host}...`);

  const nodes = await read({ endpoint: "admin/device", form: "device_list", operation: "read" });
  output.forms["admin/device?form=device_list"] = nodes;
  if (!nodes.ok) throw new Error(`device_list falhou: ${nodes.message}`);

  const list = nodes.result.device_list ?? [];
  const master = list.find((n) => String(n.role).toLowerCase() === "master") ?? list[0];
  output.device = master
    ? {
        model: master.device_model ?? null,
        firmware: master.software_ver ?? null,
        hardware: master.hardware_ver ?? null,
        nodes: list.length,
      }
    : null;

  for (const entry of CATALOG) {
    const key = `${entry.endpoint}?form=${entry.form}`;
    if (key in output.forms) continue;
    const readOp = Object.entries(entry.operations).find(([, risk]) => risk === "read");
    if (!readOp) continue;
    process.stdout.write(`  ${key} (${readOp[0]}) ... `);
    const res = await read({
      endpoint: entry.endpoint,
      form: entry.form,
      operation: readOp[0],
      ...(entry.form === "client_list" ? { params: { device_mac: "default" } } : {}),
    });
    output.forms[key] = { operation: readOp[0], ...res };
    console.log(res.ok ? "ok" : `falhou (${res.errorCode ?? res.error})`);
  }

  // Clientes por nó, para saber se a separação por nó funciona.
  for (const node of list) {
    output.clientsByNode[node.mac] = await read({
      endpoint: "admin/client",
      form: "client_list",
      operation: "read",
      params: { device_mac: node.mac },
    });
  }
} catch (err) {
  exitCode = 1;
  output.fatal = { error: err.name, message: String(err.message).slice(0, 300) };
  if (err instanceof DecoLoginError) {
    output.fatal.attemptsAllowed = err.attemptsAllowed ?? null;
    console.error(
      `\nLogin recusado: ${err.message}` +
        (err.attemptsAllowed !== undefined ? ` Tentativas restantes: ${err.attemptsAllowed}.` : "") +
        "\nAbortado sem novas tentativas.",
    );
  } else {
    console.error(`\nErro: ${err.message}`);
  }
} finally {
  await client.logout();
}

const served = Object.entries(output.forms).filter(([, v]) => v.ok).map(([k]) => k);
const unserved = Object.entries(output.forms).filter(([, v]) => !v.ok).map(([k]) => k);
output.summary = { served, unserved };

writeFileSync(OUTPUT, JSON.stringify(output, null, 2) + "\n");

const forms = output.forms;
const count = (key, field) => forms[key]?.ok ? (forms[key].result[field]?.length ?? 0) : "n/d";
console.log(`
Modelo:    ${output.device?.model ?? "?"}  (hw ${output.device?.hardware ?? "?"})
Firmware:  ${output.device?.firmware ?? "?"}
Nós:       ${output.device?.nodes ?? "?"}
Clientes:  ${count("admin/client?form=client_list", "client_list")}
Reservas:  ${count("admin/client?form=addr_reservation", "reservation_list")}
Forms OK:  ${served.length}   Não servidos: ${unserved.length}
Resultado completo em ${OUTPUT}`);

process.exit(exitCode);
