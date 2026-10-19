/**
 * Sequência de inicialização, uma vez por sessão do navegador: o logo com
 * anéis girando e linhas "de terminal" com os números reais da rede, enquanto
 * a primeira leitura chega. Some sozinha em ~2 s; clique ou tecla pula.
 * Com movimento reduzido, não aparece.
 */
import { useEffect, useState } from "preact/hooks";
import { useClients, useOverview } from "./data";
import { cx } from "./ui";

const KEY = "deco-web.booted";

function alreadyBooted(): boolean {
  try {
    return sessionStorage.getItem(KEY) === "1" || matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return true;
  }
}

export function Boot() {
  const [done, setDone] = useState(alreadyBooted);
  const [leaving, setLeaving] = useState(false);
  const [step, setStep] = useState(0);
  const overview = useOverview().data;
  const clients = useClients().data?.clients;

  const finish = () => {
    if (leaving) return;
    setLeaving(true);
    try {
      sessionStorage.setItem(KEY, "1");
    } catch {
      // sem storage: aparece de novo na próxima visita, sem problema
    }
    setTimeout(() => setDone(true), 450);
  };

  useEffect(() => {
    if (done) return;
    const timers = [1, 2, 3, 4].map((n) => setTimeout(() => setStep(n), n * 330));
    const end = setTimeout(finish, 2100);
    const skip = () => finish();
    addEventListener("keydown", skip);
    addEventListener("pointerdown", skip);
    return () => {
      timers.forEach(clearTimeout);
      clearTimeout(end);
      removeEventListener("keydown", skip);
      removeEventListener("pointerdown", skip);
    };
  }, [done]);

  if (done) return null;
  const nodes = overview?.nodes ?? [];
  const lines = [
    `> estabelecendo canal seguro ............ ok`,
    `> malha mesh: ${nodes.length ? `${nodes.filter((n) => n.online).length}/${nodes.length} nós` : "lendo…"}`,
    `> aparelhos: ${clients ? `${clients.filter((c) => c.online).length} online` : "lendo…"}`,
    `> internet: ${overview?.internet ? (overview.internet.ipv4Online ? `online · ${overview.internet.wanIp ?? ""}` : "FORA DO AR") : "lendo…"}`,
  ];

  return (
    <div class={cx("boot fixed inset-0 z-[200] flex items-center justify-center", leaving && "is-leaving")} role="status" aria-label="Iniciando o painel">
      <div class="flex flex-col items-center gap-7">
        <div class="boot-logo relative flex size-36 items-center justify-center">
          <span class="boot-ring" />
          <span class="boot-ring is-2" />
          <span class="boot-ring is-3" />
          <img src="/favicon.svg" alt="" class="size-14 rounded-xl" />
        </div>
        <div class="font-display text-[22px] font-semibold uppercase tracking-[0.3em] text-fg glow-text">Deco · HUD</div>
        <div class="w-[min(420px,86vw)] font-mono text-[12.5px] leading-6 text-muted">
          {lines.slice(0, step).map((l) => (
            <div class="boot-line">{l}</div>
          ))}
          <div class="mt-3 h-[2px] overflow-hidden rounded bg-surface-3">
            <div class="boot-bar h-full" />
          </div>
        </div>
      </div>
    </div>
  );
}
