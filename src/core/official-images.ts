/**
 * Fotos oficiais dos modelos Deco, lidas da página de produto da TP-Link.
 *
 * Nada disso vai para o repositório: as fotos têm direitos autorais e são
 * baixadas sob demanda para DATA_DIR/images, para uso pessoal. Só aceitamos
 * imagens de static.tp-link.com.
 */

export const OFFICIAL_IMAGE_HOST = "static.tp-link.com";
const PAGE_BASES = ["https://www.tp-link.com/us/home-networking/deco/", "https://www.tp-link.com/br/home-networking/deco/"];
const UA = "Mozilla/5.0 (deco-web; busca de fotos de produto)";
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

/** "M4R" → ["deco-m4r", "deco-m4"]; "X50-Outdoor" → ["deco-x50-outdoor", "deco-x50"]. */
export function slugsFor(model: string): string[] {
  const m = model.trim().toLowerCase().replace(/\s+/g, "-");
  const slugs = [m];
  const base = m.replace(/-.*$/, "");
  if (base !== m) slugs.push(base);
  const trimmed = base.replace(/(?<=\d)[a-z]+$/, "");
  if (trimmed !== base) slugs.push(trimmed);
  return [...new Set(slugs)].map((s) => `deco-${s}`);
}

/** Imagens grandes da galeria do produto, na ordem em que aparecem. */
export function extractCandidates(html: string): string[] {
  // Os nomes reais têm parênteses ("Deco_X50(3-pack)_…"), então ")" não encerra a URL.
  const re = /https?:\/\/static\.tp-link\.com\/[^"'\s<>]*?large[^"'\s<>]*?\.(?:png|jpe?g|webp)/gi;
  const seen = new Set<string>();
  for (const m of html.matchAll(re)) {
    const url = m[0].replace(/^http:/, "https:");
    if (!seen.has(url)) seen.add(url);
  }
  return [...seen].slice(0, 16);
}

/**
 * Escolha automática: prefere foto de uma unidade só ("1-pack", ou sem
 * "pack" no nome e que não seja a primeira, que costuma ser o kit).
 */
export function pickAuto(candidates: string[]): string | null {
  const name = (u: string) => decodeURIComponent(u.split("/").pop() ?? "").toLowerCase();
  return (
    candidates.find((u) => /1-pack/.test(name(u))) ??
    candidates.slice(1).find((u) => !/pack/.test(name(u))) ??
    candidates[0] ??
    null
  );
}

export async function findCandidates(model: string, fetchFn: FetchFn = fetch): Promise<{ page: string | null; candidates: string[] }> {
  for (const slug of slugsFor(model)) {
    for (const base of PAGE_BASES) {
      const page = `${base}${slug}/`;
      try {
        const res = await fetchFn(page, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(15_000) });
        if (!res.ok) continue;
        const candidates = extractCandidates(await res.text());
        if (candidates.length) return { page, candidates };
      } catch {
        // Tenta a próxima região/variação do nome.
      }
    }
  }
  return { page: null, candidates: [] };
}

export function isOfficialImageUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname === OFFICIAL_IMAGE_HOST;
  } catch {
    return false;
  }
}

export type ImageType = "png" | "jpeg" | "webp";

/** Tipo pela assinatura dos bytes; SVG e o resto ficam de fora. */
export function sniffImage(buf: Uint8Array): ImageType | null {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
  if (
    buf.length >= 12 &&
    String.fromCharCode(...buf.subarray(0, 4)) === "RIFF" &&
    String.fromCharCode(...buf.subarray(8, 12)) === "WEBP"
  ) {
    return "webp";
  }
  return null;
}

/** Baixa uma imagem oficial, com limite de tamanho e conferência do tipo. */
export async function downloadOfficial(url: string, fetchFn: FetchFn = fetch): Promise<{ bytes: Buffer; type: ImageType }> {
  if (!isOfficialImageUrl(url)) throw new Error(`Só imagens de ${OFFICIAL_IMAGE_HOST}.`);
  const res = await fetchFn(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > MAX_IMAGE_BYTES) throw new Error("Imagem grande demais.");
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length > MAX_IMAGE_BYTES) throw new Error("Imagem grande demais.");
  const type = sniffImage(bytes);
  if (!type) throw new Error("Não é PNG, JPEG nem WebP.");
  return { bytes, type };
}
