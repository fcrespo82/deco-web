/**
 * Gráfico de linha de uma série (clientes online ao longo do tempo).
 * Linha de 2px com área a 10%, grade em linha fina, crosshair que acha o ponto
 * mais próximo do ponteiro, tooltip, navegação por teclado (← →) e tabela.
 * Uma série só: o título nomeia o dado, sem caixa de legenda.
 */
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { SamplePoint } from "./api";

interface Props {
  points: SamplePoint[];
  from: string;
  to: string;
  bucketMs: number;
  label: string;
}

const H = 220;
const PAD = { top: 12, right: 12, bottom: 26, left: 36 };

function niceMax(v: number): number {
  if (v <= 5) return 5;
  const step = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * step >= v) return m * step;
  return 10 * step;
}

const hourFmt = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" });
const dayFmt = new Intl.DateTimeFormat("pt-BR", { weekday: "short", day: "2-digit" });
const dateFmt = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" });
const fullFmt = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });

export function LineChart({ points, from, to, bucketMs, label }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    const el = wrap.current!;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(280, entry!.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const t0 = Date.parse(from);
  const t1 = Date.parse(to);
  const innerW = width - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const yMax = niceMax(Math.max(0, ...points.map((p) => p.max)));
  const x = (t: number) => PAD.left + ((t - t0) / (t1 - t0)) * innerW;
  const y = (v: number) => PAD.top + innerH - (v / yMax) * innerH;

  const { line, area, isolated } = useMemo(() => {
    // Quebra a linha onde faltam dados (painel parado ou Deco inacessível).
    const segments: SamplePoint[][] = [];
    let current: SamplePoint[] = [];
    let prev: number | null = null;
    for (const p of points) {
      const t = Date.parse(p.t);
      if (prev !== null && t - prev > 2 * bucketMs) {
        segments.push(current);
        current = [];
      }
      current.push(p);
      prev = t;
    }
    if (current.length) segments.push(current);
    const path = (seg: SamplePoint[]) => seg.map((p, i) => `${i ? "L" : "M"}${x(Date.parse(p.t)).toFixed(1)},${y(p.avg).toFixed(1)}`).join("");
    return {
      line: segments.map(path).join(""),
      area: segments
        .filter((s) => s.length > 1)
        .map((s) => `${path(s)}L${x(Date.parse(s.at(-1)!.t)).toFixed(1)},${y(0)}L${x(Date.parse(s[0]!.t)).toFixed(1)},${y(0)}Z`)
        .join(""),
      // Ponto cercado de lacunas não forma linha: vira um ponto.
      isolated: segments.filter((s) => s.length === 1).map((s) => s[0]!),
    };
  }, [points, width, yMax, bucketMs]);

  const span = t1 - t0;
  const xTicks = useMemo(() => {
    const day = 86_400_000;
    const step = span <= 2 * day ? 3 * 3600_000 : span <= 8 * day ? day : 7 * day;
    const fmt = span <= 2 * day ? hourFmt : span <= 8 * day ? dayFmt : dateFmt;
    const first = new Date(t0);
    first.setMinutes(0, 0, 0);
    if (step >= day) first.setHours(0);
    const out: { t: number; text: string }[] = [];
    for (let t = first.getTime(); t <= t1; t += step) {
      if (t >= t0) out.push({ t, text: fmt.format(t) });
    }
    return out;
  }, [t0, t1]);
  const yTicks = [0, yMax / 2, yMax];

  function onPointer(e: PointerEvent) {
    if (!points.length) return;
    const rect = (e.currentTarget as SVGElement).getBoundingClientRect();
    const px = e.clientX - rect.left;
    let best = 0;
    let bestD = Infinity;
    points.forEach((p, i) => {
      const d = Math.abs(x(Date.parse(p.t)) - px);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    setActive(best);
  }

  function onKey(e: KeyboardEvent) {
    if (!points.length) return;
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const step = e.key === "ArrowRight" ? 1 : -1;
      setActive((a) => Math.min(points.length - 1, Math.max(0, (a ?? (step > 0 ? -1 : points.length)) + step)));
    } else if (e.key === "Escape") setActive(null);
  }

  const p = active !== null ? points[active] : null;
  const px = p ? x(Date.parse(p.t)) : 0;

  return (
    <div class="chart relative" ref={wrap}>
      {points.length === 0 ? (
        <div class="py-16 text-center text-muted">Sem amostras neste período.</div>
      ) : (
        <>
          <svg
            width={width}
            height={H}
            role="img"
            aria-label={`${label}. Use as setas para navegar.`}
            tabIndex={0}
            onPointerMove={onPointer}
            onPointerLeave={() => setActive(null)}
            onKeyDown={onKey}
            onBlur={() => setActive(null)}
          >
            <defs>
              <linearGradient id="area-fill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stop-color="var(--series-1)" stop-opacity="0.22" />
                <stop offset="100%" stop-color="var(--series-1)" stop-opacity="0" />
              </linearGradient>
            </defs>
            {yTicks.map((v) => (
              <g>
                <line class="grid-line" x1={PAD.left} x2={width - PAD.right} y1={y(v)} y2={y(v)} />
                <text class="tick" x={PAD.left - 6} y={y(v) + 4} text-anchor="end">
                  {Math.round(v)}
                </text>
              </g>
            ))}
            {xTicks.map((t) => (
              <text class="tick" x={x(t.t)} y={H - 8} text-anchor="middle">
                {t.text}
              </text>
            ))}
            <path class="area" d={area} />
            <path class="line" d={line} />
            {isolated.map((pt) => (
              <circle class="lone" cx={x(Date.parse(pt.t))} cy={y(pt.avg)} r={2.5} />
            ))}
            {p && (
              <g>
                <line class="crosshair" x1={px} x2={px} y1={PAD.top} y2={PAD.top + innerH} />
                <circle class="dot" cx={px} cy={y(p.avg)} r={4} />
              </g>
            )}
          </svg>
          {p && (
            <div
              class="pointer-events-none absolute top-1 -translate-x-1/2 whitespace-nowrap rounded-lg border border-line bg-surface px-3 py-1.5 text-[13px] shadow-pop"
              style={{ left: `${Math.min(Math.max(px, 80), width - 80)}px` }}
              role="status"
            >
              <strong>{p.avg.toLocaleString("pt-BR")}</strong> clientes (média)
              <div class="text-[12px] text-muted">máx. {p.max} · {fullFmt.format(Date.parse(p.t))}</div>
            </div>
          )}
        </>
      )}
      <details class="mt-2 text-[13px]">
        <summary class="cursor-pointer text-muted hover:text-fg">Ver dados em tabela</summary>
        <table class="mt-2 w-full text-left text-[12.5px] [&_td]:border-t [&_td]:border-line [&_td]:py-1 [&_th]:py-1 [&_th]:font-medium [&_th]:text-muted">
          <thead>
            <tr>
              <th>Início</th>
              <th>Média</th>
              <th>Máximo</th>
            </tr>
          </thead>
          <tbody>
            {points.map((pt) => (
              <tr>
                <td>{fullFmt.format(Date.parse(pt.t))}</td>
                <td class="tabular-nums">{pt.avg.toLocaleString("pt-BR")}</td>
                <td class="tabular-nums">{pt.max}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
