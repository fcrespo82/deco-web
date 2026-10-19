/**
 * Preparo de imagens no navegador antes do envio: tira o fundo branco das
 * fotos de produto (preenchimento a partir das bordas, então o corpo branco
 * do Deco fica, desde que tenha contorno), recorta no conteúdo e reduz para
 * no máximo 512 px, em WebP.
 */

export interface PrepareOptions {
  removeBackground?: boolean;
  /** Quão perto do branco um pixel precisa estar para virar fundo (0–255). */
  tolerance?: number;
  /** Recorta em quadrado ao redor do conteúdo (avatares). */
  square?: boolean;
  max?: number;
}

export function loadImage(src: string | Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = typeof src === "string" ? src : URL.createObjectURL(src);
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Não consegui abrir a imagem."));
    img.src = url;
  });
}

/** Fundo claro ligado às bordas vira transparente, com borda suavizada. */
function clearBackground(data: ImageData, tolerance = 8) {
  const { width: w, height: h, data: px } = data;
  const isBg = (i: number) => px[i]! > 255 - tolerance && px[i + 1]! > 255 - tolerance && px[i + 2]! > 255 - tolerance;
  const seen = new Uint8Array(w * h);
  const stack: number[] = [];
  for (let x = 0; x < w; x++) stack.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y++) stack.push(y * w, y * w + w - 1);
  while (stack.length) {
    const p = stack.pop()!;
    if (seen[p]) continue;
    seen[p] = 1;
    if (!isBg(p * 4)) continue;
    px[p * 4 + 3] = 0;
    const x = p % w;
    if (x > 0) stack.push(p - 1);
    if (x < w - 1) stack.push(p + 1);
    if (p >= w) stack.push(p - w);
    if (p < w * (h - 1)) stack.push(p + w);
  }
  // Suaviza a transição: pixels claros vizinhos do fundo ficam semitransparentes.
  for (let p = 0; p < w * h; p++) {
    const i = p * 4;
    if (px[i + 3] === 0) continue;
    const x = p % w;
    const nearBg = (x > 0 && px[i - 1]! === 0) || (x < w - 1 && px[i + 7]! === 0) || (p >= w && px[i - w * 4 + 3]! === 0) || (p < w * (h - 1) && px[i + w * 4 + 3]! === 0);
    if (nearBg) {
      const light = Math.min(px[i]!, px[i + 1]!, px[i + 2]!);
      px[i + 3] = Math.round(255 * Math.min(1, (255 - light) / 40 + 0.35));
    }
  }
}

function contentBox(data: ImageData): { x: number; y: number; w: number; h: number } {
  const { width: w, height: h, data: px } = data;
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (px[(y * w + x) * 4 + 3]! > 16) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return { x: 0, y: 0, w, h };
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/** Devolve um Blob pronto para enviar e uma URL de pré-visualização. */
export async function prepareImage(src: string | Blob, opts: PrepareOptions = {}): Promise<{ blob: Blob; preview: string }> {
  const img = await loadImage(src);
  const max = opts.max ?? 512;
  // Trabalha numa versão reduzida (rápido) e com folga para o recorte.
  const work = Math.min(1, 1200 / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement("canvas");
  c.width = Math.round(img.naturalWidth * work);
  c.height = Math.round(img.naturalHeight * work);
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, c.width, c.height);
  const data = ctx.getImageData(0, 0, c.width, c.height);
  if (opts.removeBackground) {
    clearBackground(data, opts.tolerance);
    ctx.putImageData(data, 0, 0);
  }
  let box = opts.removeBackground ? contentBox(data) : { x: 0, y: 0, w: c.width, h: c.height };
  if (opts.square) {
    const side = Math.max(box.w, box.h);
    box = { x: box.x - (side - box.w) / 2, y: box.y - (side - box.h) / 2, w: side, h: side };
  }
  const pad = opts.removeBackground ? Math.round(Math.max(box.w, box.h) * 0.04) : 0;
  const scale = Math.min(1, max / (Math.max(box.w, box.h) + pad * 2));
  const out = document.createElement("canvas");
  out.width = Math.round((box.w + pad * 2) * scale);
  out.height = Math.round((box.h + pad * 2) * scale);
  const octx = out.getContext("2d")!;
  octx.imageSmoothingQuality = "high";
  octx.drawImage(c, box.x - pad, box.y - pad, box.w + pad * 2, box.h + pad * 2, 0, 0, out.width, out.height);
  const blob = await new Promise<Blob>((resolve, reject) =>
    out.toBlob((b) => (b ? resolve(b) : reject(new Error("Falha ao gerar a imagem."))), "image/webp", 0.9),
  );
  // Navegadores sem WebP devolvem PNG: o servidor aceita os dois.
  return { blob, preview: URL.createObjectURL(blob) };
}

/**
 * Nota de uma foto de produto para virar recorte: quanto do fundo saiu
 * limpo e quantos objetos grandes sobram. Foto de ambiente quase não limpa;
 * kit com três unidades sobra com vários objetos.
 */
export async function scoreCutout(src: string): Promise<{ clear: number; objects: number }> {
  const img = await loadImage(src);
  const S = 160;
  const scale = S / Math.max(img.naturalWidth, img.naturalHeight);
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(img.naturalWidth * scale));
  c.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, c.width, c.height);
  const data = ctx.getImageData(0, 0, c.width, c.height);
  clearBackground(data);
  const { width: w, height: h, data: px } = data;
  const solid = new Uint8Array(w * h);
  let cleared = 0;
  for (let p = 0; p < w * h; p++) {
    if (px[p * 4 + 3]! > 128) solid[p] = 1;
    else cleared++;
  }
  // Componentes conexos dos pixels opacos; conta os que passam de 3% da imagem.
  const seen = new Uint8Array(w * h);
  let objects = 0;
  for (let start = 0; start < w * h; start++) {
    if (!solid[start] || seen[start]) continue;
    let area = 0;
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const p = stack.pop()!;
      area++;
      const x = p % w;
      for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p - w, p + w]) {
        if (q >= 0 && q < w * h && solid[q] && !seen[q]) {
          seen[q] = 1;
          stack.push(q);
        }
      }
    }
    if (area > w * h * 0.03) objects++;
  }
  return { clear: cleared / (w * h), objects };
}

/**
 * Primeira candidata (na ordem dada) que vira um recorte limpo: descarta
 * fotos de ambiente e infográficos, que quase não perdem fundo. Kits com
 * várias unidades sobrepostas passam como um objeto só, então a ordem (que
 * prefere "1-pack" e nomes sem "pack") é que evita o kit.
 */
export async function pickBestCutout(candidates: string[], toSrc: (u: string) => string, limit = 8): Promise<string | null> {
  for (const url of candidates.slice(0, limit)) {
    try {
      const s = await scoreCutout(toSrc(url));
      if (s.clear > 0.35 && s.objects >= 1 && s.objects <= 2) return url;
    } catch {
      // ignora a candidata que não abriu
    }
  }
  return candidates[0] ?? null;
}

/** Mesma preferência do servidor (pickAuto): "1-pack", depois nomes sem "pack" fora a primeira. */
export function orderCandidates(candidates: string[]): string[] {
  const name = (u: string) => decodeURIComponent(u.split("/").pop() ?? "").toLowerCase();
  const rank = (u: string, i: number) => (/1-pack/.test(name(u)) ? 0 : i > 0 && !/pack/.test(name(u)) ? 1 : 2);
  return candidates.map((u, i) => ({ u, r: rank(u, i), i })).sort((a, b) => a.r - b.r || a.i - b.i).map((x) => x.u);
}
