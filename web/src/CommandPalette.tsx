/**
 * Paleta de comandos (Ctrl/⌘+K ou "/"): acha aparelho, Deco, tela ou ação
 * pelo nome, IP ou MAC. Também cuida dos atalhos de teclado globais ("g" + letra
 * para ir às telas, "t" para o tema, "?" para a ajuda).
 */
import type { ComponentChildren, ComponentType } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { CornerDownLeft, Lock, Monitor, Power, RefreshCw, Router, Search, SunMoon } from "lucide-preact";
import { api } from "./api";
import { categoryOf, DeviceArt } from "./art/devices";
import { DecoArt } from "./art/DecoArt";
import { clientLabel } from "./ClientSheet";
import { useClients, useOverview, useStatus } from "./data";
import { BAND_LABEL } from "./format";
import { errorText } from "./lib/mutate";
import { openClient, selectNode, setUi, useUi } from "./lib/ui-state";
import { toast } from "./lib/toast";
import { cx, Dialog } from "./ui";

export interface PaletteRoute {
  path: string;
  label: string;
  icon: ComponentType<{ class?: string }>;
  /** Letra do atalho "g" + letra. */
  key?: string;
}

interface Item {
  id: string;
  group: "Aparelhos" | "Decos" | "Telas" | "Ações";
  label: string;
  hint?: string;
  icon: ComponentChildren;
  keywords: string;
  run: () => void;
}

/** Sem acentos e minúsculo, para "esc" achar "Escritório". */
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

function score(item: Item, q: string): number {
  if (!q) return item.group === "Telas" || item.group === "Ações" ? 1 : 0;
  const label = norm(item.label);
  if (label.startsWith(q)) return 4;
  if (label.split(/[\s·\-_]+/).some((w) => w.startsWith(q))) return 3;
  if (label.includes(q)) return 2;
  if (norm(item.keywords).includes(q)) return 1;
  return 0;
}

const isTyping = (e: KeyboardEvent) => {
  const t = e.target as HTMLElement | null;
  return !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
};

const go = (path: string) => {
  location.hash = `#/${path}`;
};

export function CommandPalette({ routes, cycleTheme }: { routes: PaletteRoute[]; cycleTheme: () => void }) {
  const ui = useUi();

  // Atalhos globais.
  useEffect(() => {
    let pendingG = 0;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setUi({ palette: !ui.palette });
        return;
      }
      if (isTyping(e) || e.ctrlKey || e.metaKey || e.altKey || document.querySelector("dialog[open]")) return;
      if (e.key === "/") {
        e.preventDefault();
        setUi({ palette: true });
      } else if (e.key === "?") {
        setUi({ shortcuts: true });
      } else if (e.key === "t") {
        cycleTheme();
      } else if (e.key === "g") {
        pendingG = Date.now();
      } else if (Date.now() - pendingG < 1200) {
        const r = routes.find((x) => x.key === e.key);
        pendingG = 0;
        if (r) go(r.path);
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [routes, cycleTheme, ui.palette]);

  return (
    <>
      {ui.palette && <Palette routes={routes} cycleTheme={cycleTheme} onClose={() => setUi({ palette: false })} />}
      {ui.shortcuts && <ShortcutsHelp routes={routes} onClose={() => setUi({ shortcuts: false })} />}
    </>
  );
}

function Palette({ routes, cycleTheme, onClose }: { routes: PaletteRoute[]; cycleTheme: () => void; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const clients = useClients().data?.clients ?? [];
  const nodes = useOverview().data?.nodes ?? [];
  const mode = useStatus()?.mode;

  useEffect(() => {
    const d = ref.current!;
    if (!d.open) d.showModal();
    input.current?.focus();
    const onCancel = (e: Event) => {
      e.preventDefault();
      onClose();
    };
    d.addEventListener("cancel", onCancel);
    return () => d.removeEventListener("cancel", onCancel);
  }, [onClose]);

  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    for (const r of routes) {
      const Icon = r.icon;
      out.push({ id: `p-${r.path}`, group: "Telas", label: r.label, hint: r.key ? `g ${r.key}` : undefined, icon: <Icon class="size-4" />, keywords: r.path, run: () => go(r.path) });
    }
    out.push(
      {
        id: "a-refresh",
        group: "Ações",
        label: "Atualizar agora",
        icon: <RefreshCw class="size-4" />,
        keywords: "ler deco refresh",
        run: () => api.refresh().then(() => toast("Lendo o Deco…"), (e) => toast("Não deu para atualizar", { tone: "bad", detail: errorText(e) })),
      },
      { id: "a-theme", group: "Ações", label: "Alternar tema", hint: "t", icon: <SunMoon class="size-4" />, keywords: "claro escuro dark light", run: cycleTheme },
      { id: "a-tv", group: "Ações", label: "Abrir modo TV", icon: <Monitor class="size-4" />, keywords: "quiosque tela cheia parede", run: () => go("tv") },
    );
    if (mode?.allowWrite) {
      out.push({ id: "a-reserve", group: "Ações", label: "Nova reserva de IP", icon: <Lock class="size-4" />, keywords: "fixar ip dhcp", run: () => go("reservas?nova=1") });
    }
    for (const n of nodes) {
      out.push({
        id: `n-${n.mac}`,
        group: "Decos",
        label: n.name,
        hint: `${n.model} · ${n.clients.total} clientes`,
        icon: <DecoArt model={n.model} online={n.online} uid={`pal-${n.mac}`} class="h-6 w-5" />,
        keywords: `${n.model} ${n.ip ?? ""} ${n.mac} deco no`,
        run: () => {
          selectNode(n.mac);
          go("");
        },
      });
      if (mode?.allowDangerous && n.online) {
        out.push({ id: `r-${n.mac}`, group: "Ações", label: `Reiniciar ${n.name}…`, icon: <Power class="size-4 text-bad" />, keywords: `reboot ${n.model}`, run: () => setUi({ reboot: n.mac }) });
      }
    }
    for (const c of clients) {
      out.push({
        id: `c-${c.mac}`,
        group: "Aparelhos",
        label: clientLabel(c),
        hint: c.online ? [c.ip, c.band && BAND_LABEL[c.band], c.nodeName].filter(Boolean).join(" · ") : "offline",
        icon: <DeviceArt category={categoryOf(c)} size="sm" online={c.online} deviceId={c.device?.id} class="!size-7" />,
        keywords: [c.name, c.ip, c.mac, c.mac.replace(/-/g, ":"), c.vendor, c.device?.owner, ...(c.device?.tags ?? []), c.reservation?.ip].filter(Boolean).join(" "),
        run: () => openClient(c.mac),
      });
    }
    return out;
  }, [routes, clients, nodes, mode, cycleTheme]);

  const results = useMemo(() => {
    const nq = norm(q.trim());
    const order = nq ? ["Aparelhos", "Decos", "Telas", "Ações"] : ["Telas", "Ações", "Decos", "Aparelhos"];
    return items
      .map((it) => ({ it, s: score(it, nq) }))
      .filter((x) => x.s > 0 || (!nq && x.it.group === "Decos"))
      .sort((a, b) => order.indexOf(a.it.group) - order.indexOf(b.it.group) || b.s - a.s || a.it.label.localeCompare(b.it.label, "pt-BR", { numeric: true }))
      .slice(0, 40)
      .map((x) => x.it);
  }, [items, q]);

  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    list.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const run = (it: Item | undefined) => {
    if (!it) return;
    onClose();
    it.run();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(results.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      run(results[active]);
    }
  };

  let lastGroup = "";
  return (
    <dialog ref={ref} class="palette" aria-label="Paleta de comandos" onClick={(e) => e.target === ref.current && onClose()}>
      <div class="flex max-h-[min(560px,80dvh)] flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-pop">
        <label class="flex items-center gap-3 border-b border-line px-4">
          <Search class="size-4 shrink-0 text-muted" />
          <input
            ref={input}
            type="search"
            value={q}
            onInput={(e) => setQ((e.target as HTMLInputElement).value)}
            onKeyDown={onKeyDown}
            placeholder="Aparelho, IP, MAC, Deco, tela ou ação…"
            class="h-13 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted/70"
            // Os tipos do Preact exigem "list" junto de role=combobox; aqui não há datalist.
            {...({ role: "combobox", "aria-expanded": "true", "aria-controls": "palette-list" } as object)}
            aria-activedescendant={results[active] ? `pal-${results[active]!.id}` : undefined}
          />
          <kbd class="kbd">esc</kbd>
        </label>
        <div ref={list} id="palette-list" role="listbox" class="min-h-0 flex-1 overflow-y-auto p-2">
          {results.length === 0 && <p class="px-3 py-6 text-center text-[13px] text-muted">Nada encontrado para "{q}".</p>}
          {results.map((it, i) => {
            const header = it.group !== lastGroup ? it.group : null;
            lastGroup = it.group;
            return (
              <>
                {header && <div class="px-3 pb-1 pt-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted">{header}</div>}
                <div
                  id={`pal-${it.id}`}
                  data-i={i}
                  role="option"
                  aria-selected={i === active}
                  onMouseMove={() => setActive(i)}
                  onClick={() => run(it)}
                  class={cx("flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2", i === active ? "bg-accent-soft text-fg" : "text-fg")}
                >
                  <span class={cx("flex size-7 shrink-0 items-center justify-center rounded-md", (it.group === "Telas" || it.group === "Ações") && "bg-surface-2 text-muted")}>
                    {it.icon}
                  </span>
                  <span class="min-w-0 flex-1 truncate text-[13.5px] font-medium">{it.label}</span>
                  {it.hint && <span class="max-w-[45%] shrink-0 truncate text-[12px] text-muted">{it.hint}</span>}
                  {i === active && <CornerDownLeft class="size-3.5 shrink-0 text-muted" />}
                </div>
              </>
            );
          })}
        </div>
        <div class="flex flex-wrap gap-x-4 gap-y-1 border-t border-line bg-surface-2/50 px-4 py-2 text-[11.5px] text-muted max-sm:hidden">
          <span>
            <kbd class="kbd">↑</kbd> <kbd class="kbd">↓</kbd> navegar
          </span>
          <span>
            <kbd class="kbd">↵</kbd> abrir
          </span>
          <span>
            <kbd class="kbd">?</kbd> todos os atalhos
          </span>
        </div>
      </div>
    </dialog>
  );
}

function ShortcutsHelp({ routes, onClose }: { routes: PaletteRoute[]; onClose: () => void }) {
  const Row = ({ keys, children }: { keys: string[]; children: ComponentChildren }) => (
    <div class="flex items-center justify-between gap-4 py-1.5">
      <span class="text-[13.5px]">{children}</span>
      <span class="flex gap-1">
        {keys.map((k) => (
          <kbd class="kbd">{k}</kbd>
        ))}
      </span>
    </div>
  );
  return (
    <Dialog title="Atalhos de teclado" onClose={onClose}>
      <div class="grid gap-x-8 sm:grid-cols-2">
        <div>
          <Row keys={["Ctrl", "K"]}>Paleta de comandos</Row>
          <Row keys={["/"]}>Buscar</Row>
          <Row keys={["t"]}>Alternar tema</Row>
          <Row keys={["?"]}>Esta ajuda</Row>
          <Row keys={["esc"]}>Fechar</Row>
        </div>
        <div>
          {routes
            .filter((r) => r.key)
            .map((r) => (
              <Row keys={["g", r.key!]}>{r.label}</Row>
            ))}
        </div>
      </div>
      <p class="mt-3 flex items-center gap-1.5 text-[12px] text-muted">
        <Router class="size-3.5" /> No mapa: clique num Deco para o painel dele; arraste para mover, Ctrl + rolagem para zoom.
      </p>
    </Dialog>
  );
}
