/** Agregação das amostras para o gráfico de clientes online. Puro. */
import type { Sample } from "../db/store.js";
import type { SamplePoint } from "./api-types.js";

/**
 * Agrupa amostras em no máximo `maxPoints` baldes de tempo, com média e
 * máximo de clientes online. Baldes sem amostra ficam de fora; o gráfico
 * quebra a linha onde o intervalo entre pontos passa de 2 baldes (painel
 * fora do ar ou Deco inacessível).
 */
export function bucketSamples(
  samples: Sample[],
  fromMs: number,
  toMs: number,
  maxPoints = 240,
): { bucketMs: number; points: SamplePoint[] } {
  const minBucket = 60_000;
  const bucketMs = Math.max(minBucket, Math.ceil((toMs - fromMs) / maxPoints / minBucket) * minBucket);
  const buckets = new Map<number, { sum: number; max: number; n: number }>();
  for (const s of samples) {
    const t = Date.parse(s.takenAt);
    if (t < fromMs || t > toMs) continue;
    const key = fromMs + Math.floor((t - fromMs) / bucketMs) * bucketMs;
    const b = buckets.get(key) ?? { sum: 0, max: 0, n: 0 };
    b.sum += s.onlineClients;
    b.max = Math.max(b.max, s.onlineClients);
    b.n += 1;
    buckets.set(key, b);
  }
  const points = [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([t, b]) => ({ t: new Date(t).toISOString(), avg: Math.round((b.sum / b.n) * 10) / 10, max: b.max }));
  return { bucketMs, points };
}
