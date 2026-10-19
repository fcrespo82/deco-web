/**
 * Clientes como bolhas: o tamanho segue o tráfego, a cor o tipo do aparelho,
 * e cada grupo vira um aglomerado. Uma simulação simples (atração ao centro
 * do grupo + colisão) faz as bolhas migrarem quando o agrupamento muda ou
 * quando um aparelho troca de nó.
 */
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { ClientView } from "../api";
import { CATEGORY, CategoryGradients, categoryOf } from "../art/devices";
import { useArtImages } from "../art/images";
import { PhotoDefs, SvgAvatar } from "../art/svg";
import { clientLabel } from "../ClientSheet";
import { BAND_LABEL, rate } from "../format";
import { cx } from "../ui";
import { groupClients, type GroupBy } from "./grouping";

interface Body {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

const radius = (c: ClientView, byTraffic: boolean) => {
  if (!byTraffic) return 19;
  const k = c.online ? c.downKBps + c.upKBps : 0;
  return 11 + 25 * Math.sqrt(Math.min(1, Math.log10(1 + k) / 4));
};

export function Bubbles({ clients, groupBy, byTraffic, onOpen }: { clients: ClientView[]; groupBy: GroupBy; byTraffic: boolean; onOpen: (c: ClientView) => void }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const bodies = useRef(new Map<string, Body>());
  const [, setFrame] = useState(0);
  const [hover, setHover] = useState<string | null>(null);
  const art = useArtImages();

  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setWidth(e!.contentRect.width));
    ro.observe(wrap.current!);
    return () => ro.disconnect();
  }, []);

  // Grupos dispostos em fileiras; cada um ocupa um círculo da área das bolhas.
  const layout = useMemo(() => {
    const W = Math.max(320, width);
    const groups = groupClients(clients, groupBy).map(([name, list]) => {
      const area = list.reduce((s, c) => s + (radius(c, byTraffic) + 2) ** 2, 0);
      return { name, list, R: Math.sqrt(area) * 1.12 + 14, x: 0, y: 0 };
    });
    const GAP = 20;
    const LABEL = 30;
    let x = 0;
    let y = 0;
    let rowH = 0;
    let row: typeof groups = [];
    const rows: (typeof groups)[] = [];
    for (const g of groups) {
      const d = Math.min(W, g.R * 2);
      if (x > 0 && x + d > W) {
        rows.push(row);
        row = [];
        x = 0;
      }
      row.push(g);
      x += d + GAP;
    }
    if (row.length) rows.push(row);
    for (const r of rows) {
      const used = r.reduce((s, g) => s + g.R * 2, 0) + GAP * (r.length - 1);
      let cx = Math.max(0, (W - used) / 2);
      rowH = Math.max(...r.map((g) => g.R * 2));
      for (const g of r) {
        g.x = cx + g.R;
        g.y = y + LABEL + rowH / 2;
        cx += g.R * 2 + GAP;
      }
      y += LABEL + rowH + GAP;
    }
    return { groups, W, H: Math.max(200, y) };
  }, [clients, groupBy, byTraffic, width]);

  // Simulação: roda alguns segundos a cada mudança e para sozinha.
  useEffect(() => {
    if (!width) return;
    const targets = new Map<string, { x: number; y: number; r: number }>();
    for (const g of layout.groups) for (const c of g.list) targets.set(c.mac, { x: g.x, y: g.y, r: radius(c, byTraffic) });
    const map = bodies.current;
    for (const mac of [...map.keys()]) if (!targets.has(mac)) map.delete(mac);
    for (const [mac, t] of targets) {
      if (!map.has(mac)) map.set(mac, { x: t.x + (Math.random() - 0.5) * 30, y: t.y + (Math.random() - 0.5) * 30, vx: 0, vy: 0 });
    }
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const list = [...targets].map(([mac, t]) => ({ b: map.get(mac)!, t }));
    let ticks = 0;
    let raf = 0;
    const step = () => {
      for (const { b, t } of list) {
        b.vx += (t.x - b.x) * 0.012;
        b.vy += (t.y - b.y) * 0.012;
      }
      for (let i = 0; i < list.length; i++) {
        const a = list[i]!;
        for (let j = i + 1; j < list.length; j++) {
          const o = list[j]!;
          const dx = o.b.x - a.b.x;
          const dy = o.b.y - a.b.y;
          const min = a.t.r + o.t.r + 2.5;
          const d2 = dx * dx + dy * dy;
          if (d2 < min * min) {
            const d = Math.sqrt(d2) || 0.01;
            const push = ((min - d) / d) * 0.5;
            a.b.x -= dx * push;
            a.b.y -= dy * push;
            o.b.x += dx * push;
            o.b.y += dy * push;
          }
        }
      }
      for (const { b } of list) {
        b.vx *= 0.82;
        b.vy *= 0.82;
        b.x += b.vx;
        b.y += b.vy;
      }
    };
    const loop = () => {
      const n = reduced ? 300 : 1;
      for (let i = 0; i < n; i++) step();
      ticks += n;
      setFrame((f) => f + 1);
      if (ticks < 320) raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [layout]);

  const hovered = hover ? clients.find((c) => c.mac === hover) : null;
  const hb = hover ? bodies.current.get(hover) : null;

  return (
    <div ref={wrap} class="relative">
      {width > 0 && (
        <svg viewBox={`0 0 ${layout.W} ${layout.H}`} class="block w-full select-none" role="img" aria-label={`${clients.length} aparelhos agrupados`}>
          <CategoryGradients />
          <PhotoDefs />
          {layout.groups.map((g) => (
            <g key={`g-${g.name}`}>
              <circle cx={g.x} cy={g.y} r={g.R} class="bubble-group" />
              <text x={g.x} y={g.y - g.R - 10} text-anchor="middle" class="bubble-group-label">
                {g.name} <tspan class="bubble-group-count">· {g.list.length}</tspan>
              </text>
            </g>
          ))}
          {layout.groups.flatMap((g) =>
            g.list.map((c) => {
              const b = bodies.current.get(c.mac);
              if (!b) return null;
              const r = radius(c, byTraffic);
              const cat = categoryOf(c);
              return (
                <g
                  key={c.mac}
                  transform={`translate(${b.x} ${b.y})`}
                  class={cx("bubble", !c.online && "is-off")}
                  tabIndex={0}
                  role="button"
                  aria-label={`${clientLabel(c)}, ${CATEGORY[cat].label}`}
                  onClick={() => onOpen(c)}
                  onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onOpen(c))}
                  onPointerEnter={() => setHover(c.mac)}
                  onPointerLeave={() => setHover((h) => (h === c.mac ? null : h))}
                >
                  <g class="bubble-body">
                    <SvgAvatar category={cat} r={r} art={art.device(cat, c.device?.id)} own={c.device != null && art.images?.devices[String(c.device.id)] != null} ring={false} />
                  </g>
                </g>
              );
            }),
          )}
          {hovered && hb && (
            <g transform={`translate(${hb.x} ${hb.y - radius(hovered, byTraffic) - 8})`} class="topo-tip" pointer-events="none">
              {(() => {
                const t1 = clientLabel(hovered);
                const t2 = hovered.online
                  ? [hovered.band && BAND_LABEL[hovered.band], hovered.nodeName, hovered.downKBps + hovered.upKBps > 0 ? `↓ ${rate(hovered.downKBps)}` : null].filter(Boolean).join(" · ")
                  : "offline";
                const w = Math.max(t1.length * 7, t2.length * 5.8) + 20;
                return (
                  <>
                    <rect x={-w / 2} y="-36" width={w} height="36" rx="8" />
                    <text y="-20" text-anchor="middle" class="tip-1">
                      {t1}
                    </text>
                    <text y="-7" text-anchor="middle" class="tip-2">
                      {t2}
                    </text>
                  </>
                );
              })()}
            </g>
          )}
        </svg>
      )}
    </div>
  );
}
