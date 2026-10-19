/**
 * "Ritmo da casa": média de clientes online por dia da semana × hora, nos
 * últimos 30 dias (baldes de 1 h, em hora local). A célula de agora tem
 * contorno.
 */
import { useMemo } from "preact/hooks";
import type { SamplePoint } from "../api";
import { cx } from "../ui";

const DAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

export function Heatmap({ points }: { points: SamplePoint[] }) {
  const { grid, max, min, days } = useMemo(() => {
    const sum = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
    const n = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
    const seenDays = new Set<string>();
    for (const p of points) {
      const d = new Date(p.t);
      sum[d.getDay()]![d.getHours()]! += p.avg;
      n[d.getDay()]![d.getHours()]! += 1;
      seenDays.add(d.toDateString());
    }
    const grid = sum.map((row, i) => row.map((s, h) => (n[i]![h]! ? s / n[i]![h]! : null)));
    const vals = grid.flat().filter((v): v is number => v !== null);
    return { grid, max: Math.max(1, ...vals), min: vals.length ? Math.min(...vals) : 0, days: seenDays.size };
  }, [points]);

  const now = new Date();
  // Escala começando no mínimo observado: o contraste fica no que muda ao longo do dia.
  const level = (v: number) => (max === min ? 0.6 : 0.12 + 0.88 * ((v - min) / (max - min)));

  return (
    <div>
      <div class="overflow-x-auto pb-1">
        <div class="grid min-w-[560px] grid-cols-[34px_repeat(24,1fr)] gap-[3px]">
          <span />
          {Array.from({ length: 24 }, (_, h) => (
            <span class="text-center text-[10px] tabular-nums text-muted">{h % 3 === 0 ? `${h}h` : ""}</span>
          ))}
          {grid.map((row, d) => (
            <>
              <span class="flex items-center text-[11px] text-muted">{DAYS[d]}</span>
              {row.map((v, h) => (
                <span
                  class={cx("heat-cell aspect-square rounded-[4px]", v === null && "is-empty", d === now.getDay() && h === now.getHours() && "is-now")}
                  style={v === null ? undefined : { opacity: level(v) }}
                  title={v === null ? `${DAYS[d]} ${h}h: sem dados` : `${DAYS[d]} ${h}h: em média ${v.toFixed(1).replace(".", ",")} clientes`}
                />
              ))}
            </>
          ))}
        </div>
      </div>
      <div class="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-muted">
        <span class="inline-flex items-center gap-1.5">
          menos
          <span class="flex gap-[3px]">
            {[0.15, 0.35, 0.55, 0.75, 1].map((o) => (
              <span class="heat-cell size-3 rounded-[3px]" style={{ opacity: o }} />
            ))}
          </span>
          mais
        </span>
        <span>
          {Math.round(min)}–{Math.round(max)} clientes · {days} {days === 1 ? "dia" : "dias"} de dados
        </span>
        {days < 7 && <span>O desenho fica completo depois de uma semana de leituras.</span>}
      </div>
    </div>
  );
}
