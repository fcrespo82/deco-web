import { describe, expect, it } from "vitest";
import { DEFAULT_DECO_IMAGES, decoImageSource, modelKey } from "../web/src/art/deco-images.js";
import type { ImagesView } from "../src/server/api-types.js";

// As fotos oficiais ficam fora do git (direitos da TP-Link): os testes usam um mapa próprio.
const DEFAULTS = { X50: "/assets/deco-x50.png", M5: "/assets/deco-m5.png" };

describe("fotos padrão dos nós Deco", () => {
  it("resolve a foto padrão pelo modelo normalizado", () => {
    expect(decoImageSource(undefined, "Deco x50", undefined, DEFAULTS)).toBe(DEFAULTS.X50);
  });
  it("preserva a escolha personalizada e restaura o padrão ao removê-la", () => {
    const images: ImagesView = { decos: { X50: "/api/images/decos/X50?v=1&t=jpg" }, devices: {}, categories: {}, floorplan: {} };
    expect(decoImageSource(images.decos, "X50", undefined, DEFAULTS)).toBe(images.decos.X50);
    delete images.decos.X50;
    expect(decoImageSource(images.decos, "X50", undefined, DEFAULTS)).toBe(DEFAULTS.X50);
    expect(decoImageSource(images.decos, "X99", undefined, DEFAULTS)).toBeUndefined();
  });
  it("sem o arquivo da foto padrão, cai no desenho", () => {
    expect(decoImageSource(undefined, "X50", undefined, {})).toBeUndefined();
    expect(decoImageSource(undefined, "X50", "default", {})).toBeUndefined();
  });
  it("só lista fotos que existem no build, com chave normalizada", () => {
    for (const [key, url] of Object.entries(DEFAULT_DECO_IMAGES)) {
      expect(key).toBe(modelKey(key));
      expect(url).toMatch(/deco-/i);
    }
  });
});

it("o desenho pode ser escolhido mesmo com fotos disponíveis", () => {
  const photos = { X50: "/api/images/decos/X50?v=1&t=png" };
  expect(decoImageSource(photos, "X50", "drawing", DEFAULTS)).toBeUndefined();
  expect(decoImageSource(photos, "X50", "default", DEFAULTS)).toBe(DEFAULTS.X50);
  expect(decoImageSource(photos, "X50", "custom", DEFAULTS)).toBe(photos.X50);
});
