/**
 * Modo TV / quiosque (#/tv): tela cheia ambiente para um tablet na parede ou
 * uma TV. Mapa grande, relógio, internet, tráfego ao vivo, chegadas e saídas
 * e a faixa dos Decos. Sempre escura; pede para a tela não apagar (Wake Lock)
 * e esconde o cursor quando parado.
 */
import { useEffect, useState } from "preact/hooks";
import { ArrowLeft, Expand, Globe, LogIn, LogOut, Shrink, Sparkles } from "lucide-preact";
import { api, type EventView } from "../api";
import { DecoArt } from "../art/DecoArt";
import { categoryOf, DeviceArt } from "../art/devices";
import { KEYS, useClients, useOverview } from "../data";
import { ago, rate } from "../format";
import { useQuery } from "../lib/query";
import { useTrafficHistory, useTrafficRecorder } from "../lib/traffic";
import { openClient, selectNode, useUi } from "../lib/ui-state";
import { Topology } from "../Topology";
import { cx } from "../ui";
import { Sparkline } from "../views/Sparkline";

const ARRIVALS = "client_new,client_connected,client_disconnected";
const fmtClock = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" });
const fmtDate = new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "numeric", month: "long" });

function useClock() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

/** Tema escuro enquanto a TV está aberta; volta ao que era ao sair. */
function useForcedDark() {
  useEffect(() => {
    const el = document.documentElement;
    const before = el.dataset.theme;
    el.dataset.theme = "dark";
    return () => {
      if (before) el.dataset.theme = before;
      else delete el.dataset.theme;
    };
  }, []);
}

/** Mantém a tela acesa; o navegador solta o bloqueio quando a aba some, então pede de novo ao voltar. */
function useWakeLock() {
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    const request = async () => {
      try {
        lock = (await (navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } }).wakeLock?.request("screen")) ?? null;
      } catch {
        // Sem suporte ou sem permissão: a tela pode apagar, nada mais.
      }
    };
    const onVisible = () => document.visibilityState === "visible" && void request();
    void request();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      void lock?.release().catch(() => undefined);
    };
  }, []);
}

/** Cursor e controles somem depois de 3 s sem mexer. */
function useIdle(ms = 3000) {
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    let t = setTimeout(() => setIdle(true), ms);
    const wake = () => {
      setIdle(false);
      clearTimeout(t);
      t = setTimeout(() => setIdle(true), ms);
    };
    addEventListener("pointermove", wake);
    addEventListener("keydown", wake);
    addEventListener("touchstart", wake);
    return () => {
      clearTimeout(t);
      removeEventListener("pointermove", wake);
      removeEventListener("keydown", wake);
      removeEventListener("touchstart", wake);
    };
  }, [ms]);
  return idle;
}

function Arrival({ e, now }: { e: EventView; now: number }) {
  const clients = useClients().data?.clients;
  const c = e.mac ? clients?.find((x) => x.mac === e.mac) : undefined;
  const left = e.type === "client_disconnected";
  const Icon = e.type === "client_new" ? Sparkles : left ? LogOut : LogIn;
  return (
    <button type="button" onClick={() => c && openClient(c.mac)} class={cx("flex w-full items-center gap-3 rounded-xl px-2 py-1.5 text-left transition hover:bg-white/5", left && "opacity-60")}>
      {c ? <DeviceArt category={categoryOf(c)} size="md" online={!left} deviceId={c.device?.id} /> : <span class="size-11 rounded-[13px] bg-white/10" />}
      <span class="min-w-0 flex-1">
        <span class="block truncate text-[15px] font-medium">{e.name ?? e.mac}</span>
        <span class={cx("flex items-center gap-1 text-[12.5px]", left ? "text-muted" : e.type === "client_new" ? "text-warn" : "text-ok")}>
          <Icon class="size-3.5" />
          {e.type === "client_new" ? "apareceu pela primeira vez" : left ? "saiu" : "chegou"}
          {c?.nodeName && !left ? ` · ${c.nodeName}` : ""}
        </span>
      </span>
      <span class="shrink-0 text-[12px] tabular-nums text-muted">{ago(e.at, now)}</span>
    </button>
  );
}

export function Tv() {
  useForcedDark();
  useWakeLock();
  const idle = useIdle();
  const now = useClock();
  const ui = useUi();
  const overview = useOverview();
  const clientsQ = useClients();
  useTrafficRecorder(clientsQ.data);
  const history = useTrafficHistory();
  const arrivals = useQuery(KEYS.events(ARRIVALS), () => api.events({ type: ARRIVALS, limit: 100 }), ["snapshot"]);
  const [full, setFull] = useState(!!document.fullscreenElement);

  useEffect(() => {
    const onFs = () => setFull(!!document.fullscreenElement);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.fullscreenElement && !document.querySelector("dialog[open]")) location.hash = "#/";
    };
    document.addEventListener("fullscreenchange", onFs);
    addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("fullscreenchange", onFs);
      removeEventListener("keydown", onKey);
    };
  }, []);

  const data = overview.data;
  const clients = clientsQ.data?.clients ?? [];
  const online = clients.filter((c) => c.online);
  const down = online.reduce((s, c) => s + c.downKBps, 0);
  const up = online.reduce((s, c) => s + c.upKBps, 0);
  const internetOk = data?.internet?.ipv4Online ?? true;
  const toggleFull = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => undefined);
  // Só quem conectou/saiu, sem repetir o mesmo aparelho em sequência.
  const recent = (arrivals.data?.events ?? []).filter((e, i, all) => all.findIndex((x) => x.mac === e.mac) === i).slice(0, 7);

  return (
    <div class={cx("tv-bg fixed inset-0 overflow-hidden text-fg", idle && "cursor-none")}>
      <div class="grid h-full grid-rows-[auto_1fr_auto] gap-4 p-4 lg:grid-cols-[1fr_minmax(320px,26%)] lg:grid-rows-[1fr_auto] lg:p-6">
        {/* Mapa */}
        <div class="relative min-h-0 lg:row-span-1">
          {data && (
            <Topology
              ambient
              nodes={data.nodes}
              clients={clients}
              internet={data.internet}
              selected={ui.node}
              onSelectNode={selectNode}
              onSelectClient={(c) => openClient(c.mac)}
            />
          )}
        </div>

        {/* Coluna da direita */}
        <aside class="flex min-h-0 flex-col gap-4 max-lg:row-start-1">
          <div>
            <div class="font-display text-[64px] font-semibold leading-none tracking-tight tabular-nums lg:text-[88px]">{fmtClock.format(now)}</div>
            <div class="mt-1 text-[15px] text-muted">{(() => {
              const d = fmtDate.format(now);
              return d.charAt(0).toUpperCase() + d.slice(1);
            })()}</div>
          </div>

          <div class="tv-card flex items-center gap-3">
            <span class={cx("flex size-10 items-center justify-center rounded-full", internetOk ? "bg-ok-soft text-ok" : "bg-bad-soft text-bad animate-pulse")}>
              <Globe class="size-5" />
            </span>
            <div>
              <div class="text-[17px] font-semibold">{internetOk ? "Internet funcionando" : "Internet fora do ar"}</div>
              <div class="text-[12.5px] text-muted">
                {online.length} aparelhos conectados · {data?.nodes.filter((n) => n.online).length ?? "–"}/{data?.nodes.length ?? "–"} Decos
              </div>
            </div>
          </div>

          <div class="tv-card">
            <div class="flex items-baseline gap-4 tabular-nums">
              <span class="font-display text-[34px] font-semibold leading-none" style={{ color: "var(--flow-down)" }}>
                ↓ {rate(down)}
              </span>
              <span class="text-[17px] font-medium" style={{ color: "var(--flow-up)" }}>
                ↑ {rate(up)}
              </span>
            </div>
            <Sparkline points={history} class="mt-2 h-16" />
          </div>

          <div class="tv-card flex min-h-0 flex-1 flex-col max-lg:hidden">
            <div class="mb-1 text-[12px] font-semibold uppercase tracking-wide text-muted">Chegadas e saídas</div>
            <div class="-mx-2 min-h-0 overflow-hidden">
              {recent.map((e) => (
                <Arrival key={e.id} e={e} now={now} />
              ))}
              {arrivals.data && recent.length === 0 && <p class="px-2 py-3 text-[13px] text-muted">Ninguém chegou ou saiu ainda.</p>}
            </div>
          </div>
        </aside>

        {/* Faixa dos Decos */}
        <div class="flex gap-3 overflow-x-auto scrollbar-none lg:col-span-2">
          {data?.nodes.map((n) => (
            <button
              type="button"
              onClick={() => selectNode(ui.node === n.mac ? null : n.mac)}
              class={cx("tv-card flex shrink-0 items-center gap-3 !py-2 pr-5", ui.node === n.mac && "ring-2 ring-accent", !n.online && "opacity-60")}
            >
              <DecoArt model={n.model} online={n.online} uid={`tv-${n.mac}`} class="h-12 w-10" />
              <span class="text-left">
                <span class="block text-[15px] font-semibold">{n.name}</span>
                <span class="block text-[12px] text-muted">{n.online ? `${n.clients.total} ${n.clients.total === 1 ? "aparelho" : "aparelhos"}` : "offline"}</span>
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Controles: somem com o cursor parado */}
      <div class={cx("absolute bottom-24 right-4 flex gap-2 transition-opacity duration-500 lg:bottom-auto lg:left-6 lg:right-auto lg:top-6", idle ? "pointer-events-none opacity-0" : "opacity-100")}>
        <a href="#/" class="tv-card flex items-center gap-1.5 !px-3 !py-2 text-[13px] hover:bg-white/10">
          <ArrowLeft class="size-4" /> Sair
        </a>
        <button type="button" onClick={toggleFull} class="tv-card flex items-center gap-1.5 !px-3 !py-2 text-[13px] hover:bg-white/10">
          {full ? <Shrink class="size-4" /> : <Expand class="size-4" />}
          {full ? "Sair da tela cheia" : "Tela cheia"}
        </button>
      </div>
    </div>
  );
}
