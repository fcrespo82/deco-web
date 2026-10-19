/**
 * Cobertura Wi-Fi estimada sobre a planta: modelo de perda por distância
 * (log-distance), sem paredes. Cada ponto recebe o melhor sinal entre os nós.
 * É uma estimativa grosseira para "onde fica fraco", não uma medição.
 */

export type CoverageBand = "5GHz" | "2.4GHz";

/** dBm a 1 m e expoente de perda (ambiente interno típico). */
const MODEL: Record<CoverageBand, { p1: number; n: number }> = {
  "5GHz": { p1: -40, n: 3.5 },
  "2.4GHz": { p1: -34, n: 3.0 },
};

export function rssiAt(band: CoverageBand, meters: number): number {
  const { p1, n } = MODEL[band];
  return p1 - 10 * n * Math.log10(Math.max(1, meters));
}

/** Faixas da legenda, do melhor para o pior. */
export const COVERAGE_STOPS = [
  { dbm: -50, label: "Excelente", rgb: [59, 130, 246], a: 0.42 },
  { dbm: -60, label: "Bom", rgb: [34, 170, 110], a: 0.36 },
  { dbm: -70, label: "Razoável", rgb: [235, 160, 30], a: 0.36 },
  { dbm: -78, label: "Fraco", rgb: [220, 60, 60], a: 0.32 },
] as const;

/** Cor RGBA (0–255) para um sinal, interpolando entre as faixas. */
export function colorFor(dbm: number): [number, number, number, number] {
  const s = COVERAGE_STOPS;
  if (dbm >= s[0].dbm) return [...s[0].rgb, s[0].a * 255] as [number, number, number, number];
  for (let i = 0; i < s.length - 1; i++) {
    const a = s[i]!;
    const b = s[i + 1]!;
    if (dbm >= b.dbm) {
      const t = (a.dbm - dbm) / (a.dbm - b.dbm);
      return [
        a.rgb[0] + (b.rgb[0] - a.rgb[0]) * t,
        a.rgb[1] + (b.rgb[1] - a.rgb[1]) * t,
        a.rgb[2] + (b.rgb[2] - a.rgb[2]) * t,
        (a.a + (b.a - a.a) * t) * 255,
      ];
    }
  }
  // Abaixo do "fraco": some aos poucos até -88 dBm.
  const last = s[s.length - 1]!;
  const fade = Math.max(0, 1 - (last.dbm - dbm) / 8);
  return [...last.rgb, last.a * 255 * fade] as [number, number, number, number];
}

/**
 * Pinta a cobertura num canvas pequeno (o CSS estica com suavização).
 * Posições dos nós em 0–1; widthMeters dá a escala; aspect = largura/altura.
 */
export function paintCoverage(canvas: HTMLCanvasElement, nodes: { x: number; y: number }[], band: CoverageBand, widthMeters: number, aspect: number) {
  const W = 220;
  const H = Math.max(40, Math.round(W / aspect));
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(W, H);
  const heightMeters = widthMeters / aspect;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let best = -200;
      for (const n of nodes) {
        const dx = (x / W - n.x) * widthMeters;
        const dy = (y / H - n.y) * heightMeters;
        const r = rssiAt(band, Math.hypot(dx, dy));
        if (r > best) best = r;
      }
      const [r, g, b, a] = nodes.length ? colorFor(best) : [0, 0, 0, 0];
      const i = (y * W + x) * 4;
      img.data[i] = r;
      img.data[i + 1] = g;
      img.data[i + 2] = b;
      img.data[i + 3] = a;
    }
  }
  ctx.putImageData(img, 0, 0);
}
