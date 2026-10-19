/**
 * Resolve as imagens escolhidas pelo usuário (tela Aparência) para um modelo
 * de Deco ou um aparelho: foto do aparelho → imagem da categoria → nada
 * (o chamador cai no desenho/ícone).
 */
import type { ImagesView } from "../api";
import { useImages } from "../data";
import type { Category } from "./devices";

export interface Art {
  src: string;
  /** JPEG: fundo branco opaco, precisa de "pedestal" no tema escuro. */
  opaque: boolean;
}

/** Mesma normalização do servidor (src/server/images.ts modelKey). */
export const modelKey = (model: string) =>
  model.trim().toUpperCase().replace(/^DECO\s*/, "").replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "");

const art = (src: string | undefined): Art | null => (src ? { src, opaque: /[?&]t=jpg\b/.test(src) } : null);

export function decoArtFrom(images: ImagesView | undefined, model: string): Art | null {
  return art(images?.decos[modelKey(model)]);
}

export function deviceArtFrom(images: ImagesView | undefined, category: Category, deviceId?: number | null): Art | null {
  return art((deviceId != null ? images?.devices[String(deviceId)] : undefined) ?? images?.categories[category]);
}

export function useArtImages() {
  const { data } = useImages();
  return {
    images: data,
    deco: (model: string) => decoArtFrom(data, model),
    device: (category: Category, deviceId?: number | null) => deviceArtFrom(data, category, deviceId),
  };
}
