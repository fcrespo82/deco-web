/**
 * Raias de presença: uma linha por aparelho, com as faixas de tempo em que
 * esteve online na janela (24 h ou 7 dias). Barras na cor da categoria;
 * quem está online agora tem a ponta direita pulsando.
 */
import { useMemo, useState } from "preact/hooks";
import { Search } from "lucide-preact";
import type { ClientView, PresenceView } from "../api";
import { CATEGORY, categoryOf, DeviceArt } from "../art/devices";
import { clientLabel } from "../ClientSheet";
import { openClient } from "../lib/ui-state";
import { Button, cx, Segmented } from "../ui";

const fmtTime = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" });
const fmtDay = new Intl.DateTimeFormat("pt-BR", { weekday: "short", day: "2-digit" });
const fmtFull = new Intl.DateTimeFormat("pt-BR", { weekday: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });

function span(ms: number): string {
  const m = Math.round(ms / 60_000);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h} h ${m % 60 ? `${m % 60} min` : ""}`.trim() : `${Math.floor(h / 24)} d ${h % 24} h`;
}

interface Row {
  c: ClientView;
  bars: { a: number; b: number; open: boolean }[];
  share: number;
}

export function Presence({ data, clients, hours }: { data: PresenceView; clients: ClientView[]; hours: number }) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"time" | "name">("time");
  const [all, setAll] = useState(false);
  const from = Date.parse(data.from);
  const to = Date.parse(data.to);
  const total = to - from;

  const rows = useMemo<Row[]>(() => {
    const byMac = new Map(clients.map((c) => [c.mac, c]));
    const needle = q.trim().toLowerCase();
    const out: Row[] = [];
    for (const d of data.devices) {
      const c = byMac.get(d.mac);
      if (!c) continue;
      if (needle && ![clientLabel(c), c.name, c.ip, c.mac, c.vendor].join(" ").toLowerCase().includes(needle)) continue;
      const bars = d.intervals.map(([a, b]) => ({ a: Date.parse(a), b: b ? Date.parse(b) : to, open: b === null }));
      const share = bars.reduce((s, x) => s + (x.b - x.a), 0) / total;
      out.push({ c, bars, share });
    }
    return out.sort((x, y) => (sort === "time" ? y.share - x.share : 0) || clientLabel(x.c).localeCompare(clientLabel(y.c), "pt-BR", { numeric: true }));
  }, [data, clients, q, sort, to, total]);

  // Marcas do eixo: a cada 3 h (24 h) ou a cada dia (7 dias), em hora local.
  const ticks = useMemo(() => {
    const step = hours <= 24 ? 3 * 3600_000 : 24 * 3600_000;
    const first = new Date(from);
    if (hours <= 24) {
      first.setMinutes(0, 0, 0);
      first.setHours(Math.ceil(first.getHours() / 3) * 3);
    } else {
      first.setHours(24, 0, 0, 0);
    }
    const out: { x: number; label: string }[] = [];
    // Sem marca colada no "agora" da direita.
    for (let t = first.getTime(); t < to - total * 0.07; t += step) out.push({ x: (t - from) / total, label: hours <= 24 ? fmtTime.format(t) : fmtDay.format(t) });
    return out;
  }, [from, to, total, hours]);

  const shown = all ? rows : rows.slice(0, 24);
  const pct = (t: number) => `${((t - from) / total) * 100}%`;

  return (
    <div>
      <div class="mb-3 flex flex-wrap items-center gap-2">
        <div class="relative min-w-0 flex-[1_1_220px]">
          <Search class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <input type="search" class="field py-1.5 pl-9" placeholder="Filtrar aparelho…" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} aria-label="Filtrar aparelho" />
        </div>
        <Segmented label="Ordenar" value={sort} onChange={setSort} options={[{ value: "time", label: "mais presentes" }, { value: "name", label: "nome" }]} />
      </div>

      <div class="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
        {/* Eixo do tempo */}
        <div class="grid grid-cols-[minmax(120px,30%)_1fr_44px] items-end border-b border-line bg-surface-2/50 text-[11px] text-muted sm:grid-cols-[220px_1fr_52px]">
          <span class="px-3 py-1.5">{rows.length} aparelhos</span>
          <div class="relative h-7">
            {ticks.map((t, i) => (
              <span class={cx("absolute bottom-1.5 -translate-x-1/2 whitespace-nowrap tabular-nums", i % 2 === 1 && "max-sm:hidden")} style={{ left: `${t.x * 100}%` }}>
                {t.label}
              </span>
            ))}
            <span class="absolute bottom-1.5 right-0 font-semibold text-accent">agora</span>
          </div>
          <span />
        </div>

        <div class="max-h-[560px] overflow-y-auto">
          {shown.map(({ c, bars, share }) => {
            const cat = categoryOf(c);
            const meta = CATEGORY[cat];
            return (
              <button
                type="button"
                onClick={() => openClient(c.mac)}
                class="group grid w-full grid-cols-[minmax(120px,30%)_1fr_44px] items-center border-b border-line/60 text-left last:border-0 hover:bg-surface-2/60 sm:grid-cols-[220px_1fr_52px]"
              >
                <span class="flex min-w-0 items-center gap-2 px-3 py-1.5">
                  <DeviceArt category={cat} size="sm" online={c.online} deviceId={c.device?.id} class="!size-6 !rounded-md [&>svg]:!size-3.5" />
                  <span class="truncate text-[12.5px] font-medium">{clientLabel(c)}</span>
                </span>
                <span class="presence-lane relative h-7">
                  {ticks.map((t) => (
                    <span class="absolute inset-y-0 w-px bg-line/70" style={{ left: `${t.x * 100}%` }} />
                  ))}
                  {bars.map((b) => (
                    <span
                      class={cx("presence-bar absolute top-1/2 h-3 -translate-y-1/2 rounded-full", b.open && "is-open")}
                      style={{ left: pct(b.a), width: `max(3px, ${((b.b - b.a) / total) * 100}%)`, backgroundImage: `linear-gradient(90deg, ${meta.from}, ${meta.to})` }}
                      title={`${fmtFull.format(b.a)} → ${b.open ? "agora" : fmtFull.format(b.b)} (${span(b.b - b.a)})`}
                    />
                  ))}
                </span>
                <span class="pr-3 text-right text-[11.5px] tabular-nums text-muted">{Math.round(share * 100)}%</span>
              </button>
            );
          })}
          {rows.length === 0 && <p class="px-3 py-6 text-center text-[13px] text-muted">Nenhum aparelho com esse filtro.</p>}
        </div>
      </div>
      {rows.length > shown.length && (
        <div class="mt-2 flex justify-center">
          <Button size="sm" variant="ghost" onClick={() => setAll(true)}>
            Mostrar todos ({rows.length})
          </Button>
        </div>
      )}
    </div>
  );
}
