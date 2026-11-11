/**
 * Imagens escolhidas pelo usuário: fotos dos modelos Deco, das categorias de
 * aparelho e de aparelhos do inventário. Ficam em DATA_DIR/images, fora do
 * repositório. PNG, JPEG e WebP (conferidos pelos bytes) para tudo; SVG só
 * para modelos Deco, e só depois de reconstruído por lista de permissões
 * (src/core/svg-sanitize.ts), porque é desenhado inline para o LED de status
 * acompanhar o nó.
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
import { MAX_SVG_BYTES, sanitizeSvg } from "../core/svg-sanitize.js";
import { NotFoundError, ValidationError } from "../db/errors.js";
import type { DecoImageStyle, ImageKind, ImagesView, OfficialResult } from "./api-types.js";

export const IMAGE_KINDS: readonly ImageKind[] = ["decos", "categories", "devices", "floorplan"];
const EXT: Record<ImageType, string> = { png: "png", jpeg: "jpg", webp: "webp" };
const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", webp: "image/webp", svg: "image/svg+xml" };
/** Extensões guardadas; trocar SVG↔PNG remove a anterior. */
const FILE_EXTS = [...Object.values(EXT), "svg"];
/** Abrir a URL do SVG direto também não executa nada. */
const SVG_CSP = "default-src 'none'; style-src 'unsafe-inline'";
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
    for (const ext of FILE_EXTS) {
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
    const out: ImagesView = { decos: {}, categories: {}, devices: {}, floorplan: {} };
    for (const kind of IMAGE_KINDS) {
      let files: string[] = [];
      try {
        files = readdirSync(this.dir(kind));
      } catch {
        continue;
      }
      for (const f of files) {
        const m = /^([A-Za-z0-9_-]{1,40})\.(png|jpg|webp|svg)$/.exec(f);
        if (!m) continue;
        const mtime = Math.round(statSync(join(this.dir(kind), f)).mtimeMs);
        // t= diz o formato: jpg é opaco (fundo branco); svg é desenhado inline.
        out[kind][m[1]!] = `/api/images/${kind}/${m[1]}?v=${mtime}&t=${m[2]}`;
      }
    }
    return out;
  }

  write(kind: ImageKind, name: string, bytes: Buffer): ImageType {
    const type = sniffImage(bytes);
    if (!type) throw new ValidationError("Envie PNG, JPEG ou WebP.");
    this.replace(kind, name, EXT[type], bytes);
    return type;
  }

  /** SVG só para Deco, e só a versão reconstruída pelo sanitizador. */
  writeSvg(kind: ImageKind, name: string, text: string): string[] {
    if (kind !== "decos") throw new ValidationError("SVG só é aceito para modelos Deco; envie PNG, JPEG ou WebP.");
    let clean;
    try {
      clean = sanitizeSvg(text);
    } catch (e) {
      throw new ValidationError(`SVG recusado: ${(e as Error).message}`);
    }
    this.replace(kind, name, "svg", Buffer.from(clean.svg, "utf8"));
    return clean.warnings;
  }

  private replace(kind: ImageKind, name: string, ext: string, bytes: Buffer) {
    mkdirSync(this.dir(kind), { recursive: true });
    this.remove(kind, name);
    const path = join(this.dir(kind), `${name}.${ext}`);
    const tmp = `${path}.tmp-${process.pid}`;
    writeFileSync(tmp, bytes);
    renameSync(tmp, path);
  }

  remove(kind: ImageKind, name: string): boolean {
    let removed = false;
    for (const ext of FILE_EXTS) {
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
  const styles = () => app.store.getJson<Record<string, DecoImageStyle>>("deco_image_styles") ?? {};
  const setStyle = (name: string, style: DecoImageStyle) => {
    app.store.setJson("deco_image_styles", { ...styles(), [modelKey(name)]: style });
  };

  server.addContentTypeParser(["image/png", "image/jpeg", "image/webp"], { parseAs: "buffer", bodyLimit: MAX_IMAGE_BYTES }, (_req, body, done) =>
    done(null, body),
  );
  server.addContentTypeParser("image/svg+xml", { parseAs: "string", bodyLimit: MAX_SVG_BYTES }, (_req, body, done) => done(null, body));

  server.get("/api/images", async () => ({ ...store.manifest(), decoStyles: styles(), models: [...new Set([...knownModels(app).map(modelKey), ...Object.keys(styles())])] }));

  server.put<{ Params: { name: string }; Body: { style?: unknown } }>("/api/images/decos/:name/style", async (req) => {
    ImageStore.check("decos", req.params.name);
    const name = modelKey(req.params.name);
    ImageStore.check("decos", name);
    const style = req.body?.style;
    if (style !== "drawing" && style !== "default" && style !== "custom") throw new ValidationError("Escolha desenho, foto padrão ou foto personalizada.");
    if (style === "custom" && !store.find("decos", name)) throw new ValidationError("Envie uma foto personalizada primeiro.");
    const before = styles()[name] ?? null;
    setStyle(name, style);
    app.audit.record({ actor: actorOf(req), action: "image.set", target: `decos/${name}`, before: { style: before }, after: { style } });
    return { ok: true };
  });

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
    for (const result of results) if (result.status === "ok") setStyle(result.model, "custom");
    app.audit.record({ actor: actorOf(req), action: "images.official", target: models.join(","), after: results.map((r) => `${r.model}: ${r.status}`) });
    return { results };
  });

  // --- por arquivo -----------------------------------------------------

  server.get<{ Params: { kind: string; name: string } }>("/api/images/:kind/:name", async (req, reply) => {
    ImageStore.check(req.params.kind, req.params.name);
    const img = store.read(req.params.kind, req.params.name);
    if (!img) throw new NotFoundError("Imagem não encontrada.");
    // A URL do manifesto muda a cada troca (?v=), então pode ficar em cache.
    reply.header("cache-control", "private, max-age=31536000, immutable").header("x-content-type-options", "nosniff");
    if (img.mime === MIME.svg) reply.header("content-security-policy", SVG_CSP);
    return reply.type(img.mime).send(img.bytes);
  });

  server.put<{ Params: { kind: string; name: string }; Body: Buffer | string }>("/api/images/:kind/:name", async (req) => {
    ImageStore.check(req.params.kind, req.params.name);
    const { kind, name } = req.params;
    if (typeof req.body === "string" && /^image\/svg\+xml\b/i.test(req.headers["content-type"] ?? "")) {
      const warnings = store.writeSvg(kind, name, req.body);
      setStyle(name, "custom");
      app.audit.record({ actor: actorOf(req), action: "image.set", target: `${kind}/${name}`, after: { type: "svg", bytes: Buffer.byteLength(req.body), warnings } });
      return { ok: true, warnings };
    }
    if (!Buffer.isBuffer(req.body)) throw new ValidationError("Envie a imagem no corpo (image/png, image/jpeg, image/webp ou, para Deco, image/svg+xml).");
    const type = store.write(kind, name, req.body);
    if (kind === "decos") setStyle(name, "custom");
    app.audit.record({ actor: actorOf(req), action: "image.set", target: `${kind}/${name}`, after: { type, bytes: req.body.length } });
    return { ok: true };
  });

  server.delete<{ Params: { kind: string; name: string } }>("/api/images/:kind/:name", async (req) => {
    ImageStore.check(req.params.kind, req.params.name);
    if (!store.remove(req.params.kind, req.params.name)) throw new NotFoundError("Imagem não encontrada.");
    if (req.params.kind === "decos") setStyle(req.params.name, "default");
    app.audit.record({ actor: actorOf(req), action: "image.remove", target: `${req.params.kind}/${req.params.name}` });
    return { ok: true };
  });
}
