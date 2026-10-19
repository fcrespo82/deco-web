/**
 * Baixa as fotos oficiais dos modelos Deco da sua rede (lidos do último
 * snapshot salvo) para DATA_DIR/images/decos. Uso pessoal: as fotos têm
 * direitos autorais da TP-Link e não vão para o repositório. Modelos extras
 * podem vir como argumentos.
 *
 *   npm run fetch-images [X50 M5 …]                          # desenvolvimento
 *   docker compose run --rm deco-web node dist/fetch-images.js   # container
 */
import { join } from "node:path";
import { Store } from "./db/store.js";
import { fetchOfficialImages, ImageStore } from "./server/images.js";

const dataDir = process.env.DATA_DIR?.trim() || "/data";
const store = new Store(join(dataDir, "deco-web.sqlite"));
const fromSnapshot = (store.latestSnapshot()?.nodes ?? []).map((n) => n.model).filter((m) => m && m !== "?");
store.close();

const models = [...new Set([...fromSnapshot, ...process.argv.slice(2)])];
if (!models.length) {
  console.error("Nenhum modelo conhecido: rode o painel uma vez ou passe os modelos (ex.: npm run fetch-images X50 M5).");
  process.exit(1);
}

const results = await fetchOfficialImages(new ImageStore(join(dataDir, "images")), models);
for (const r of results) {
  console.log(`${r.model.padEnd(12)} ${r.status === "ok" ? "ok" : r.status === "not-found" ? "não encontrado" : `falhou: ${r.error}`}${r.url ? `  (${r.url})` : ""}`);
}
console.log("Para escolher outra foto (de uma unidade só, sem fundo), use a tela Aparência do painel.");
process.exit(results.some((r) => r.status === "ok") ? 0 : 1);
