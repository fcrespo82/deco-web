/**
 * Série do tráfego total desde que a página abriu: o Deco só informa a taxa
 * no momento da leitura, então guardamos uma amostra por leitura (até 1 h de
 * pontos). Fica no módulo para sobreviver à troca de tela.
 */
import { useEffect, useState } from "preact/hooks";

export interface TrafficPoint {
  t: number;
  down: number;
  up: number;
}

const MAX = 240;
const points: TrafficPoint[] = [];
let lastKey: string | null = null;
const listeners = new Set<() => void>();

export function recordTraffic(key: string | null, down: number, up: number) {
  if (!key || key === lastKey) return;
  lastKey = key;
  points.push({ t: Date.now(), down, up });
  if (points.length > MAX) points.shift();
  for (const l of listeners) l();
}

export function useTrafficHistory(): TrafficPoint[] {
  const [, tick] = useState(0);
  useEffect(() => {
    const l = () => tick((n) => n + 1);
    listeners.add(l);
    return () => listeners.delete(l);
  }, []);
  return points;
}
