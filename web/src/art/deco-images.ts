/// <reference types="vite/client" />
/** Mesma normalização do servidor (src/server/images.ts modelKey). */
export const modelKey = (model: string) =>
  model.trim().toUpperCase().replace(/^DECO\s*/, "").replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "");

/**
 * Fotos padrão opcionais, descobertas no build em `./decos/deco-<modelo>.png`
 * (também .jpg/.webp). Ficam fora do git: as fotos oficiais têm direitos
 * autorais da TP-Link. Sem o arquivo, o modelo usa o desenho SVG com status.
 */
const files = import.meta.glob<string>("./decos/deco-*.{png,jpg,webp}", { eager: true, query: "?url", import: "default" });
export const DEFAULT_DECO_IMAGES: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(files).map(([path, url]) => [modelKey(/deco-([^/]+)\.\w+$/.exec(path)![1]!), url]),
);

/** Retorna a foto personalizada, a foto padrão ou nenhuma (desenho SVG). */
export function decoImageSource(
  custom: Record<string, string> | undefined,
  model: string,
  style?: "drawing" | "default" | "custom",
  defaults: Readonly<Record<string, string>> = DEFAULT_DECO_IMAGES,
): string | undefined {
  const key = modelKey(model);
  if (style === "drawing") return undefined;
  if (style === "default") return defaults[key];
  return custom?.[key] ?? defaults[key];
}
