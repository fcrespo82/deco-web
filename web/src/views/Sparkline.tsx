/** Tráfego total desde que a página abriu: download (área) e upload (linha). */
import { useId } from "preact/hooks";
import type { TrafficPoint } from "../lib/traffic";
import { cx } from "../ui";

export function Sparkline({ points, class: klass = "h-9" }: { points: TrafficPoint[]; class?: string }) {
  const gid = `spark-${useId()}`;
  if (points.length < 2) return <div class={cx("flex items-end text-[11.5px] text-muted", klass)}>coletando amostras…</div>;
  const W = 200;
  const H = 36;
  const max = Math.max(1, ...points.map((p) => p.down + p.up));
  const t0 = points[0]!.t;
  const span = Math.max(1, points.at(-1)!.t - t0);
  const xy = (p: TrafficPoint, v: number) => `${((p.t - t0) / span) * W},${H - (v / max) * (H - 3)}`;
  const line = points.map((p) => xy(p, p.down + p.up)).join(" L");
  const up = points.map((p) => xy(p, p.up)).join(" L");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" class={cx("w-full", klass)} aria-hidden="true">
      <defs>
        <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stop-color="var(--flow-down)" stop-opacity="0.35" />
          <stop offset="1" stop-color="var(--flow-down)" stop-opacity="0" />
        </linearGradient>
      </defs>
      <path d={`M0,${H} L${line} L${W},${H} Z`} fill={`url(#${gid})`} />
      <path d={`M${line}`} fill="none" stroke="var(--flow-down)" stroke-width="1.6" vector-effect="non-scaling-stroke" />
      <path d={`M${up}`} fill="none" stroke="var(--flow-up)" stroke-width="1.2" vector-effect="non-scaling-stroke" opacity="0.8" />
    </svg>
  );
}
