/** Clientes como cartões com o retrato do aparelho, em seções por grupo. */
import { Lock } from "lucide-preact";
import type { ClientView } from "../api";
import { CATEGORY, categoryOf, DeviceArt } from "../art/devices";
import { clientLabel, RateBar } from "../ClientSheet";
import { BAND_LABEL, ago, rate } from "../format";
import { BAND_COLOR } from "../Topology";
import { cx } from "../ui";
import { groupClients, type GroupBy } from "./grouping";

function Tile({ c, onOpen, now }: { c: ClientView; onOpen: (c: ClientView) => void; now: number }) {
  const cat = categoryOf(c);
  const meta = CATEGORY[cat];
  const busy = c.online && c.downKBps + c.upKBps >= 50;
  return (
    <button
      type="button"
      onClick={() => onOpen(c)}
      class={cx(
        "group relative flex min-w-0 flex-col items-center overflow-hidden rounded-2xl border border-line bg-surface px-3 pb-3 pt-4 text-center shadow-card transition hover:-translate-y-0.5 hover:shadow-pop",
        !c.online && "opacity-70",
      )}
    >
      <span class="pointer-events-none absolute inset-x-0 top-0 h-16 opacity-[0.14] transition-opacity group-hover:opacity-25" style={{ background: `linear-gradient(135deg, ${meta.from}, ${meta.to})` }} />
      <span class="relative">
        <DeviceArt category={cat} size="lg" online={c.online} vendor={c.vendor} deviceId={c.device?.id} class={cx("transition-transform duration-300 group-hover:scale-110 group-hover:-rotate-3", busy && "shadow-[0_0_0_4px_color-mix(in_srgb,var(--flow-down)_30%,transparent)]")} />
        {c.reservation && (
          <span class="absolute -left-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full border-2 border-surface bg-accent text-accent-fg" title={`IP reservado ${c.reservation.ip}`}>
            <Lock class="size-2.5" />
          </span>
        )}
      </span>
      <span class="mt-2.5 w-full truncate text-[13.5px] font-semibold">{clientLabel(c)}</span>
      <span class="w-full truncate text-[11.5px] text-muted">{c.vendor ?? meta.label}</span>
      <span class="mt-2 inline-flex max-w-full items-center gap-1.5 truncate rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-muted">
        {c.online ? (
          <>
            <span class="size-1.5 shrink-0 rounded-full" style={{ background: BAND_COLOR[c.band ?? "wired"] }} />
            <span class="truncate">
              {c.band ? BAND_LABEL[c.band] : ""} · {c.nodeName ?? "?"}
            </span>
          </>
        ) : (
          <>visto {ago(c.lastSeen, now)}</>
        )}
      </span>
      <span class="mt-1 font-mono text-[11px] text-muted">{c.ip ?? c.reservation?.ip ?? "—"}</span>
      {c.online && (
        <span class="mt-2 w-full">
          <RateBar kBps={c.downKBps} tone="down" />
          <span class="mt-0.5 block text-[10.5px] tabular-nums text-muted">{c.downKBps + c.upKBps > 0 ? `↓ ${rate(c.downKBps)} ↑ ${rate(c.upKBps)}` : "parado"}</span>
        </span>
      )}
    </button>
  );
}

export function Gallery({ clients, groupBy, onOpen, now }: { clients: ClientView[]; groupBy: GroupBy | null; onOpen: (c: ClientView) => void; now: number }) {
  const groups = groupBy ? groupClients(clients, groupBy) : [["", clients] as [string, ClientView[]]];
  return (
    <div class="grid gap-6">
      {groups.map(([name, list]) => (
        <section key={name}>
          {name && (
            <h3 class="mb-2.5 flex items-center gap-2 text-[13px] font-semibold">
              {name} <span class="font-normal text-muted">· {list.length}</span>
              <span class="h-px flex-1 bg-line" />
            </h3>
          )}
          <div class="grid grid-cols-2 gap-2.5 sm:grid-cols-[repeat(auto-fill,minmax(158px,1fr))]">
            {list.map((c) => (
              <Tile key={c.mac} c={c} onOpen={onOpen} now={now} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
