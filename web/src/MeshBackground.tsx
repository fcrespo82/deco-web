/**
 * Fundo da tela de login: uma malha de nós que derivam devagar e se ligam
 * quando ficam perto, com pulsos correndo pelos links. Canvas, ~40 nós;
 * com movimento reduzido, fica parada.
 */
import { useEffect, useRef } from "preact/hooks";

interface Node {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
}

export function MeshBackground({ class: klass }: { class?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext("2d")!;
    const css = getComputedStyle(document.documentElement);
    const from = css.getPropertyValue("--brand-from").trim() || "#14b8a6";
    const to = css.getPropertyValue("--brand-to").trim() || "#7c5cff";
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let w = 0;
    let h = 0;
    let nodes: Node[] = [];
    let raf = 0;
    const pulses: { a: number; b: number; t: number }[] = [];

    const resize = () => {
      const dpr = Math.min(2, devicePixelRatio || 1);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const n = Math.round(Math.min(48, Math.max(18, (w * h) / 26000)));
      nodes = Array.from({ length: n }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.25,
        vy: (Math.random() - 0.5) * 0.25,
        r: 1.5 + Math.random() * 2.5,
      }));
    };

    const LINK = 170;
    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      const grad = ctx.createLinearGradient(0, 0, w, h);
      grad.addColorStop(0, from);
      grad.addColorStop(1, to);
      for (const n of nodes) {
        if (!reduced) {
          n.x += n.vx;
          n.y += n.vy;
          if (n.x < -20 || n.x > w + 20) n.vx *= -1;
          if (n.y < -20 || n.y > h + 20) n.vy *= -1;
        }
      }
      ctx.lineWidth = 1;
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i]!;
          const b = nodes[j]!;
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          if (d > LINK) continue;
          ctx.globalAlpha = (1 - d / LINK) * 0.35;
          ctx.strokeStyle = grad;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
          if (!reduced && pulses.length < 10 && Math.random() < 0.0008) pulses.push({ a: i, b: j, t: 0 });
        }
      }
      // Pulsos: um ponto que atravessa o link, como tráfego.
      for (let k = pulses.length - 1; k >= 0; k--) {
        const p = pulses[k]!;
        const a = nodes[p.a]!;
        const b = nodes[p.b]!;
        p.t += 0.012;
        if (p.t >= 1 || Math.hypot(a.x - b.x, a.y - b.y) > LINK) {
          pulses.splice(k, 1);
          continue;
        }
        ctx.globalAlpha = Math.sin(p.t * Math.PI);
        ctx.fillStyle = to;
        ctx.beginPath();
        ctx.arc(a.x + (b.x - a.x) * p.t, a.y + (b.y - a.y) * p.t, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
      for (const n of nodes) {
        ctx.globalAlpha = 0.55;
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      if (!reduced) raf = requestAnimationFrame(draw);
    };

    resize();
    draw();
    const ro = new ResizeObserver(() => {
      resize();
      if (reduced) draw();
    });
    ro.observe(canvas);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return <canvas ref={ref} class={klass} aria-hidden="true" />;
}
