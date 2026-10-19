/**
 * Número que "rola" até o valor novo (easing de ~0,7 s) e pisca um brilho
 * quando muda. Com movimento reduzido, troca direto.
 */
import { useEffect, useRef, useState } from "preact/hooks";
import { cx } from "./ui";

const reduced = () => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export function Counter({ value, format = (n) => String(Math.round(n)), ms = 700, class: klass }: { value: number; format?: (n: number) => string; ms?: number; class?: string }) {
  const [shown, setShown] = useState(value);
  const [bump, setBump] = useState(false);
  const from = useRef(value);

  useEffect(() => {
    const start = from.current;
    if (start === value) return;
    if (reduced()) {
      from.current = value;
      setShown(value);
      return;
    }
    setBump(true);
    const t0 = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / ms);
      const eased = 1 - (1 - k) ** 3;
      const v = start + (value - start) * eased;
      from.current = v;
      setShown(v);
      if (k < 1) raf = requestAnimationFrame(tick);
      else setBump(false);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, ms]);

  return <span class={cx("counter tabular-nums", bump && "is-bump", klass)}>{format(shown)}</span>;
}
