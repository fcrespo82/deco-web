/**
 * Imagens escolhidas pelo usuário: fotos dos modelos Deco, das categorias de
 * aparelho e de aparelhos do inventário. Ficam em DATA_DIR/images, fora do
 * repositório. Só PNG, JPEG e WebP (conferidos pelos bytes); SVG não, porque
 * pode carregar script.
 */
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { App } from "../app.js";
import {
  downloadOfficial,
  findCandidates,
  isOfficialImageUrl,
  MAX_IMAGE_BYTES,
  pickAuto,
  sniffImage,
  type FetchFn,
  type ImageType,
} from "../core/official-images.js";
import { NotFoundError, ValidationError } from "../db/errors.js";
import type { ImageKind, ImagesView, OfficialResult } from "./api-types.js";

export const IMAGE_KINDS: readonly ImageKind[] = ["decos", "categories", "devices"];
const EXT: Record<ImageType, string> = { png: "png", jpeg: "jpg", webp: "webp" };
const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", webp: "image/webp" };
const NAME_RE = /^[A-Za-z0-9_-]{1,40}$/;

/** Nome do arquivo de um modelo: "Deco X50" → "X50". */
export const modelKey = (model: string) => model.trim().toUpperCase().replace(/^DECO\s*/, "").replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "");

export class ImageStore {
  constructor(private readonly root: string) {}

  private dir(kind: ImageKind) {
    return join(this.root, kind);
  }

  static check(kind: string, name: string): asserts kind is ImageKind {
    if (!(IMAGE_KINDS as readonly string[]).includes(kind)) throw new ValidationError("Tipo de imagem inválido.");
    if (!NAME_RE.test(name)) throw new ValidationError("Nome de imagem inválido.");
  }

  /** Arquivo atual de (kind, name), em qualquer extensão aceita. */
  find(kind: ImageKind, name: string): { path: string; ext: string; mtimeMs: number } | null {
    for (const ext of Object.values(EXT)) {
      const path = join(this.dir(kind), `${name}.${ext}`);
      try {
        return { path, ext, mtimeMs: statSync(path).mtimeMs };
      } catch {
        // tenta a próxima extensão
      }
    }
    return null;
  }

  manifest(): ImagesView {
    const out: ImagesView = { decos: {}, categories: {}, devices: {} };
    for (const kind of IMAGE_KINDS) {
      let files: string[] = [];
      try {
        files = readdirSync(this.dir(kind));
      } catch {
        continue;
      }
      for (const f of files) {
        const m = /^([A-Za-z0-9_-]{1,40})\.(png|jpg|webp)$/.exec(f);
        if (!m) continue;
        const mtime = Math.round(statSync(join(this.dir(kind), f)).mtimeMs);
        // t= diz se a imagem é opaca (jpg) — a UI trata fundo branco diferente.
        out[kind][m[1]!] = `/api/images/${kind}/${m[1]}?v=${mtime}&t=${m[2]}`;
      }
    }
    return out;
  }

  write(kind: ImageKind, name: string, bytes: Buffer): ImageType {
    const type = sniffImage(bytes);
    if (!type) throw new ValidationError("Envie PNG, JPEG ou WebP.");
    mkdirSync(this.dir(kind), { recursive: true });
    this.remove(kind, name);
    const path = join(this.dir(kind), `${name}.${EXT[type]}`);
    const tmp = `${path}.tmp-${process.pid}`;
    writeFileSync(tmp, bytes);
    renameSync(tmp, path);
    return type;
  }

  remove(kind: ImageKind, name: string): boolean {
    let removed = false;
    for (const ext of Object.values(EXT)) {
      const path = join(this.dir(kind), `${name}.${ext}`);
      try {
        rmSync(path);
        removed = true;
      } catch {
        // não existia nessa extensão
      }
    }
    return removed;
  }

  read(kind: ImageKind, name: string): { bytes: Buffer; mime: string } | null {
    const f = this.find(kind, name);
    return f ? { bytes: readFileSync(f.path), mime: MIME[f.ext]! } : null;
  }
}

/** Modelos presentes no último snapshot. */
export function knownModels(app: App): string[] {
  const nodes = app.poller.cache.snapshot?.nodes ?? app.store.latestSnapshot()?.nodes ?? [];
  return [...new Set(nodes.map((n) => n.model).filter((m) => m && m !== "?"))];
}

/** Baixa automaticamente uma foto por modelo; usado pelo botão e pelo CLI. */
export async function fetchOfficialImages(store: ImageStore, models: string[], fetchFn?: FetchFn): Promise<OfficialResult[]> {
  const results: OfficialResult[] = [];
  for (const model of models) {
    const { page, candidates } = await findCandidates(model, fetchFn);
    const url = pickAuto(candidates);
    if (!url) {
      results.push({ model, status: "not-found", page, url: null, error: "Página do produto não encontrada." });
      continue;
    }
    try {
      const { bytes } = await downloadOfficial(url, fetchFn);
      store.write("decos", modelKey(model), bytes);
      results.push({ model, status: "ok", page, url, error: null });
    } catch (e) {
      results.push({ model, status: "failed", page, url, error: (e as Error).message });
    }
  }
  return results;
}

export function registerImageRoutes(
  server: FastifyInstance,
  app: App,
  actorOf: (req: FastifyRequest) => string,
  opts: { fetch?: FetchFn } = {},
): void {
  const store = new ImageStore(join(app.config.dataDir, "images"));

  server.addContentTypeParser(["image/png", "image/jpeg", "image/webp"], { parseAs: "buffer", bodyLimit: MAX_IMAGE_BYTES }, (_req, body, done) =>
    done(null, body),
  );

  server.get("/api/images", async () => ({ ...store.manifest(), models: knownModels(app) }));

  // --- fotos oficiais (rotas fixas antes das paramétricas) -------------

  server.get<{ Querystring: { model?: string } }>("/api/images/official/candidates", async (req) => {
    const model = String(req.query.model ?? "").trim();
    if (!model || model.length > 40) throw new ValidationError("Informe o modelo.");
    return { model, ...(await findCandidates(model, opts.fetch)) };
  });

  /** Repassa uma imagem oficial pela mesma origem, para o navegador poder editá-la num canvas. */
  server.get<{ Querystring: { url?: string } }>("/api/images/official/proxy", async (req, reply) => {
    const url = String(req.query.url ?? "");
    if (!isOfficialImageUrl(url)) throw new ValidationError("URL não permitida.");
    try {
      const { bytes, type } = await downloadOfficial(url, opts.fetch);
      return reply.header("cache-control", "private, max-age=3600").header("x-content-type-options", "nosniff").type(MIME[EXT[type]]!).send(bytes);
    } catch (e) {
      return reply.code(502).send({ error: `Não consegui baixar: ${(e as Error).message}` });
    }
  });

  server.post("/api/images/official/auto", async (req) => {
    const models = knownModels(app);
    if (!models.length) throw new ValidationError("Ainda não há leitura do Deco com os modelos.");
    const results = await fetchOfficialImages(store, models, opts.fetch);
    app.audit.record({ actor: actorOf(req), action: "images.official", target: models.join(","), after: results.map((r) => `${r.model}: ${r.status}`) });
    return { results };
  });

  // --- por arquivo -----------------------------------------------------

  server.get<{ Params: { kind: string; name: string } }>("/api/images/:kind/:name", async (req, reply) => {
    ImageStore.check(req.params.kind, req.params.name);
    const img = store.read(req.params.kind, req.params.name);
    if (!img) throw new NotFoundError("Imagem não encontrada.");
    // A URL do manifesto muda a cada troca (?v=), então pode ficar em cache.
    return reply.header("cache-control", "private, max-age=31536000, immutable").header("x-content-type-options", "nosniff").type(img.mime).send(img.bytes);
  });

  server.put<{ Params: { kind: string; name: string }; Body: Buffer }>("/api/images/:kind/:name", async (req) => {
    ImageStore.check(req.params.kind, req.params.name);
    if (!Buffer.isBuffer(req.body)) throw new ValidationError("Envie a imagem no corpo (image/png, image/jpeg ou image/webp).");
    const type = store.write(req.params.kind, req.params.name, req.body);
    app.audit.record({ actor: actorOf(req), action: "image.set", target: `${req.params.kind}/${req.params.name}`, after: { type, bytes: req.body.length } });
    return { ok: true };
  });

  server.delete<{ Params: { kind: string; name: string } }>("/api/images/:kind/:name", async (req) => {
    ImageStore.check(req.params.kind, req.params.name);
    if (!store.remove(req.params.kind, req.params.name)) throw new NotFoundError("Imagem não encontrada.");
    app.audit.record({ actor: actorOf(req), action: "image.remove", target: `${req.params.kind}/${req.params.name}` });
    return { ok: true };
  });
}
