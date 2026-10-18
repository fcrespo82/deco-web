/**
 * Fabricante pelo MAC, consultado localmente na base pública do IEEE
 * (oui/ieee-oui.tsv.gz, gerada por scripts/update-oui.mjs). Nenhum MAC sai
 * da rede.
 *
 * MACs com o bit "administrado localmente" ligado (segundo dígito 2, 6, A ou
 * E) não são de fabricante nenhum: são os endereços privados/aleatórios de
 * celulares e tablets, ou MACs gerados por VMs e containers.
 */
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

export const OUI_FILE = new URL("../../oui/ieee-oui.tsv.gz", import.meta.url);

export interface MacInfo {
  /** Nome registrado no IEEE, completo. */
  vendor: string | null;
  /** Nome sem sufixos jurídicos ("Apple, Inc." → "Apple"). */
  vendorShort: string | null;
  /** MAC administrado localmente: privado/aleatório ou gerado por software. */
  randomized: boolean;
}

/** Remove "Inc.", "Co.,Ltd", "GmbH" etc. do fim, repetidamente. */
export function shortVendor(name: string): string {
  const suffix =
    /[\s,.]+(inc|incorporated|co|company|corp|corporation|ltd|limited|llc|gmbh|ag|sa|s\.a|s\.p\.a|spa|bv|b\.v|nv|oy|ab|as|pte|pty|plc|kg|srl|sas|technologies|technology|tech|electronics|electronic|international|holdings?|group)\.?$/i;
  let out = name.trim();
  for (let prev = ""; prev !== out; ) {
    prev = out;
    out = out.replace(suffix, "").replace(/[\s,.]+$/, "").trim();
  }
  return out || name.trim();
}

let db: Map<string, string> | null = null;

function load(): Map<string, string> {
  if (db) return db;
  db = new Map();
  try {
    const text = gunzipSync(readFileSync(OUI_FILE)).toString("utf8");
    for (const line of text.split("\n")) {
      const tab = line.indexOf("\t");
      if (tab > 0) db.set(line.slice(0, tab), line.slice(tab + 1));
    }
  } catch {
    // Sem a base, o painel segue funcionando, só sem fabricante.
  }
  return db;
}

const cache = new Map<string, MacInfo>();

export function macInfo(mac: string): MacInfo {
  const hex = mac.toUpperCase().replace(/[^0-9A-F]/g, "");
  const hit = cache.get(hex);
  if (hit) return hit;
  let info: MacInfo;
  if (hex.length !== 12) info = { vendor: null, vendorShort: null, randomized: false };
  else if ((parseInt(hex.slice(0, 2), 16) & 0b10) !== 0) info = { vendor: null, vendorShort: null, randomized: true };
  else {
    const table = load();
    // Blocos menores (36 e 28 bits) vêm antes do bloco de 24 bits que os contém.
    const vendor = table.get(hex.slice(0, 9)) ?? table.get(hex.slice(0, 7)) ?? table.get(hex.slice(0, 6)) ?? null;
    info = { vendor, vendorShort: vendor ? shortVendor(vendor) : null, randomized: false };
  }
  cache.set(hex, info);
  return info;
}
