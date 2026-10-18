/**
 * Operações perigosas (DECO_ALLOW_DANGEROUS): reiniciar nós e alterar Wi-Fi.
 * Comum ao live e ao mock, como reservations.ts.
 *
 * Reiniciar: admin/device?form=system, operation "reboot", com
 * `{mac_list: [{mac}]}` (formato do deco-mcp). Não há o que reler — o nó está
 * reiniciando —, então o resultado é "sent". Se a resposta se perde (o gateway
 * costuma cair antes de responder), é "ambiguous"; nunca há reenvio.
 *
 * Wi-Fi: admin/wireless?form=wlan, operation "write", com só os campos que
 * mudam: `{band2_4: {guest: {enable: true}}}`. No X50 o firmware guarda SSID e
 * senha em base64 (lido no próprio aparelho); a codificação de cada campo
 * segue a do valor atual, com base64 como padrão. Roteiro igual ao das
 * reservas: lê → escreve uma vez → relê e confere. As senhas cruas só existem
 * em memória, dentro desta função; nada daqui sai com senha.
 *
 * Erros de login (DecoLoginError) sobem intactos, para o circuit breaker.
 */
import { DecoApiError, DecoLoginError } from "./vendor/errors.js";
import { decodeName, normalize } from "./vendor/format.js";
import { parseWifi } from "./parse.js";
import type { Band, MeshNode, WifiNetwork } from "./types.js";

// --- reiniciar ----------------------------------------------------------

export interface RebootPrimitives {
  nodes(): Promise<MeshNode[]>;
  reboot(macs: string[]): Promise<void>;
}

export type RebootOutcome =
  /** O Deco aceitou o pedido. */
  | "sent"
  /** Algum MAC não é nó deste mesh; nada foi enviado. */
  | "conflict"
  /** O Deco recusou (error_code). */
  | "rejected"
  /** Sem resposta: o nó pode ter reiniciado antes de responder. */
  | "ambiguous";

export interface RebootResult {
  outcome: RebootOutcome;
  ok: boolean;
  message: string;
  nodes: { mac: string; name: string; role: MeshNode["role"] }[];
}

export async function applyReboot(p: RebootPrimitives, macs: string[]): Promise<RebootResult> {
  const known = await p.nodes();
  const targets = macs.map((mac) => known.find((n) => n.mac === mac));
  const nodes = targets.filter((n): n is MeshNode => Boolean(n)).map((n) => ({ mac: n.mac, name: n.name, role: n.role }));
  const missing = macs.filter((_, i) => !targets[i]);
  if (missing.length) {
    return { outcome: "conflict", ok: false, message: `Não são nós deste mesh: ${missing.join(", ")}.`, nodes };
  }
  try {
    await p.reboot(macs);
  } catch (err) {
    if (err instanceof DecoLoginError) throw err;
    if (err instanceof DecoApiError) {
      return { outcome: "rejected", ok: false, message: `O Deco recusou: ${err.message}`, nodes };
    }
    return {
      outcome: "ambiguous",
      ok: false,
      message: `Sem resposta do Deco (${(err as Error).message}). Ele pode ter reiniciado antes de responder; o pedido não foi reenviado.`,
      nodes,
    };
  }
  const gateway = nodes.some((n) => n.role === "master");
  return {
    outcome: "sent",
    ok: true,
    message: gateway
      ? "Reinício enviado. A rede inteira fica fora por uns 2–4 minutos."
      : "Reinício enviado. O nó volta em uns 2–3 minutos.",
    nodes,
  };
}

// --- Wi-Fi --------------------------------------------------------------

/** host = rede principal; guest = convidados; iot = rede IoT. */
export type WifiKind = "host" | "guest" | "iot";
export const WIFI_KINDS: readonly WifiKind[] = ["host", "guest", "iot"];

export interface WifiChange {
  network: WifiKind;
  enabled?: boolean;
  ssid?: string;
  /** Nova senha (WPA). Nunca volta em resultado, log ou auditoria. */
  password?: string;
}

/** Estado de uma rede, sem senha. */
export interface WifiNetworkState {
  network: WifiKind;
  ssid: string;
  enabled: boolean;
  bands: Band[];
}

export interface WifiPrimitives {
  /** wlan cru, com SSIDs e senhas como o firmware manda (sem redigir). */
  read(): Promise<Record<string, unknown>>;
  write(params: Record<string, unknown>): Promise<void>;
  /** Pausa antes de reler, se a primeira releitura não mostrar a mudança. */
  sleep?(ms: number): Promise<void>;
}

export type WifiOutcome = "applied" | "noop" | "conflict" | "rejected" | "unverified" | "ambiguous";

export interface WifiWriteResult {
  outcome: WifiOutcome;
  ok: boolean;
  message: string;
  before: WifiNetworkState | null;
  after: WifiNetworkState | null;
  passwordChanged: boolean;
  /** Redes lidas por último (sem senha), para atualizar o cache; null sem releitura. */
  wifi: WifiNetwork[] | null;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

const BAND_KEYS: Record<string, Band> = { band2_4: "2.4GHz", band5_1: "5GHz", band5_2: "5GHz", band6: "6GHz" };

/** As entradas do wlan cru que formam uma rede: [chave da banda, objeto]. */
function entries(raw: Obj, kind: WifiKind): [string, Obj][] {
  if (kind === "iot") {
    const iot = isObj(raw.iot) && isObj(raw.iot.host) ? raw.iot.host : null;
    return iot ? [["iot", iot]] : [];
  }
  return Object.entries(raw)
    .filter(([key, v]) => key in BAND_KEYS && isObj(v) && isObj(v[kind]))
    .map(([key, v]) => [key, (v as Obj)[kind] as Obj]);
}

const text = (v: unknown) => (typeof v === "string" ? v : "");
const isBase64 = (raw: unknown) => typeof raw === "string" && raw !== "" && decodeName(raw) !== raw;

/** Codifica como o valor atual está codificado; base64 quando não dá para saber. */
function encodeLike(current: unknown, value: string): string {
  const plain = typeof current === "string" && current !== "" && !isBase64(current);
  return plain ? value : Buffer.from(value, "utf8").toString("base64");
}

function stateOf(raw: Obj, kind: WifiKind): WifiNetworkState | null {
  const list = entries(raw, kind);
  if (list.length === 0) return null;
  const [, first] = list[0]!;
  const bands: Band[] =
    kind === "iot"
      ? ([first.enable_2g === true && "2.4GHz", first.enable_5g === true && "5GHz"].filter(Boolean) as Band[])
      : list.map(([key]) => BAND_KEYS[key]!);
  return {
    network: kind,
    ssid: String(decodeName(text(first.ssid))),
    enabled: list.some(([, e]) => e.enable === true),
    bands,
  };
}

/** Confere o wlan relido contra o pedido. Senha: compara o valor codificado enviado. */
function matches(raw: Obj, change: WifiChange, sent: Map<string, Obj>): boolean {
  for (const [key, entry] of entries(raw, change.network)) {
    const want = sent.get(key);
    if (!want) continue;
    if ("enable" in want && entry.enable !== want.enable) return false;
    if ("ssid" in want && decodeName(text(entry.ssid)) !== change.ssid) return false;
    if ("password" in want && text(entry.password) !== want.password) return false;
  }
  return true;
}

const unchanged = (raw: Obj, before: Obj) => JSON.stringify(raw) === JSON.stringify(before);

export async function applyWifiChange(p: WifiPrimitives, change: WifiChange): Promise<WifiWriteResult> {
  const kind = change.network;
  const parsed = (raw: Obj) => parseWifi(normalize(raw, false));
  const base = { passwordChanged: false };

  const current = await p.read();
  const before = stateOf(current, kind);
  const list = entries(current, kind);
  if (!before || list.length === 0) {
    return { ...base, outcome: "conflict", ok: false, message: "Esta rede não existe neste Deco.", before, after: before, wifi: parsed(current) };
  }

  // Só os campos que mudam, por banda.
  const sent = new Map<string, Obj>();
  for (const [key, entry] of list) {
    const fields: Obj = {};
    if (change.enabled !== undefined && entry.enable !== change.enabled) fields.enable = change.enabled;
    if (change.ssid !== undefined && decodeName(text(entry.ssid)) !== change.ssid) fields.ssid = encodeLike(entry.ssid, change.ssid);
    if (change.password !== undefined) {
      const encoded = encodeLike(entry.password, change.password);
      if (text(entry.password) !== encoded) fields.password = encoded;
    }
    if (Object.keys(fields).length) sent.set(key, fields);
  }
  if (sent.size === 0) {
    return { ...base, outcome: "noop", ok: true, message: "Nada a mudar: o Deco já está assim.", before, after: before, wifi: parsed(current) };
  }
  const passwordChanged = [...sent.values()].some((f) => "password" in f);

  const params: Obj = {};
  for (const [key, fields] of sent) {
    params[key] = kind === "iot" ? { host: fields } : { [kind]: fields };
  }

  let writeError: unknown = null;
  try {
    await p.write(params);
  } catch (err) {
    if (err instanceof DecoLoginError) throw err;
    writeError = err ?? new Error("falha desconhecida");
  }

  // Releitura (só leitura; repetir é seguro). O rádio pode demorar a refletir.
  let after: Obj | null = null;
  for (const wait of [0, 5_000]) {
    if (wait) await (p.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))))(wait);
    try {
      after = await p.read();
    } catch (err) {
      if (err instanceof DecoLoginError) throw err;
      after = null;
    }
    if (after && matches(after, change, sent)) break;
  }

  const reason = writeError ? (writeError as Error).message : null;
  if (!after) {
    return {
      ...base,
      passwordChanged,
      outcome: "ambiguous",
      ok: false,
      message: `${reason ? `Sem resposta do Deco (${reason}). ` : ""}Não deu para reler o Wi-Fi: não se sabe se a mudança foi aplicada. Nada foi reenviado.`,
      before,
      after: null,
      wifi: null,
    };
  }
  const result = { before, after: stateOf(after, kind), wifi: parsed(after) };
  if (matches(after, change, sent)) {
    return {
      ...result,
      passwordChanged,
      outcome: "applied",
      ok: true,
      message: reason ? `Aplicada (a resposta se perdeu, mas a releitura confirma).` : "Aplicada e confirmada pela releitura.",
    };
  }
  if (writeError && unchanged(after, current)) {
    return { ...result, passwordChanged: false, outcome: "rejected", ok: false, message: `O Deco recusou: ${reason}. Nada mudou.` };
  }
  return {
    ...result,
    passwordChanged,
    outcome: "unverified",
    ok: false,
    message: `${reason ? `${reason}. ` : ""}A releitura não mostra a mudança como pedida. Confira no app do Deco.`,
  };
}
