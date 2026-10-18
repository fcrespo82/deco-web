// Atualiza oui/ieee-oui.tsv.gz a partir dos registros públicos do IEEE
// (MA-L/24 bits, MA-M/28 bits, MA-S/36 bits). Rode de vez em quando:
//   node scripts/update-oui.mjs            # baixa do IEEE
//   node scripts/update-oui.mjs pasta/     # usa oui.csv, mam.csv e oui36.csv já baixados
// O painel consulta o arquivo localmente: nenhum MAC sai da rede.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const SOURCES = {
  "oui.csv": "https://standards-oui.ieee.org/oui/oui.csv",
  "mam.csv": "https://standards-oui.ieee.org/oui28/mam.csv",
  "oui36.csv": "https://standards-oui.ieee.org/oui36/oui36.csv",
};

/** CSV com campos entre aspas (vírgulas e "" dentro). */
function* rows(text) {
  let field = "", row = [], quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') (field += '"'), i++;
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") row.push(field), (field = "");
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field), (field = "");
      if (row.length > 1) yield row;
      row = [];
    } else field += ch;
  }
  if (field || row.length) yield [...row, field];
}

const dir = process.argv[2];
const entries = new Map();
for (const [file, url] of Object.entries(SOURCES)) {
  let text;
  if (dir) text = readFileSync(join(dir, file), "utf8");
  else {
    const res = await fetch(url, { headers: { "user-agent": "deco-web oui update" } });
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    text = await res.text();
  }
  let n = 0;
  for (const [registry, assignment, name] of rows(text)) {
    if (registry === "Registry" || !/^[0-9A-F]{6,9}$/i.test(assignment ?? "")) continue;
    const vendor = (name ?? "").replace(/\s+/g, " ").trim();
    if (!vendor || /^private$/i.test(vendor)) continue;
    entries.set(assignment.toUpperCase(), vendor);
    n++;
  }
  console.log(`${file}: ${n} prefixos`);
}
const lines = [...entries].sort(([a], [b]) => a.localeCompare(b)).map(([p, v]) => `${p}\t${v}`);
const out = new URL("../oui/ieee-oui.tsv.gz", import.meta.url);
writeFileSync(out, gzipSync(lines.join("\n") + "\n", { level: 9 }));
console.log(`${lines.length} prefixos → ${out.pathname}`);
