/**
 * Casa: a planta baixa com os Decos onde eles estão de verdade. Mostra a
 * cobertura estimada (2,4 ou 5 GHz), os aparelhos em volta de cada nó, os
 * links entre nós com o tráfego correndo e uma varredura de radar. No modo
 * "posicionar", os Decos se arrastam; a posição é salva no servidor.
 */
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { Crosshair, Map as MapIcon, Move, Ruler } from "lucide-preact";
import { api, type ClientView, type FloorplanView, type NodeView } from "../api";
import { DecoArt } from "../art/DecoArt";
import { categoryOf, DeviceArt } from "../art/devices";
import { clientLabel } from "../ClientSheet";
import { KEYS, useClients, useFloorplan, useImages, useOverview } from "../data";
import { UploadButton } from "../ImageDialogs";
import { errorText, mutate } from "../lib/mutate";
import { setQueryData } from "../lib/query";
import { openClient, selectNode, useUi } from "../lib/ui-state";
import { BAND_COLOR, Flow, signalTone } from "../Topology";
import { Badge, Button, Card, Check, cx, Empty, PageLoading, Segmented } from "../ui";
import { COVERAGE_STOPS, paintCoverage, type CoverageBand } from "../views/coverage";
import { BAND_LABEL, rate } from "../format";

type Layer = CoverageBand | "off";

/** Proporção (largura/altura) da imagem da planta; sem planta, 16:10. */
function useAspect(src: string | undefined): number {
  const [aspect, setAspect] = useState(1.6);
  useEffect(() => {
    if (!src) return setAspect(1.6);
    const img = new Image();
    img.onload = () => setAspect(img.naturalWidth / Math.max(1, img.naturalHeight));
    img.src = src;
  }, [src]);
  return aspect;
}

function save(plan: FloorplanView) {
  void mutate({
    optimistic: () => [setQueryData<FloorplanView>(KEYS.floorplan, () => plan)],
    run: () => api.saveFloorplan(plan),
    failure: "Não foi possível salvar a planta",
  });
}

/**
 * Aparelhos em anéis em volta do marcador do nó (px, relativos ao centro),
 * deixando livre a fatia de baixo, onde fica o nome.
 */
function ring(n: number, radius = 54): [number, number][] {
  const gap = (80 * Math.PI) / 180;
  const span = 2 * Math.PI - gap;
  const out: [number, number][] = [];
  for (let r = radius, left = n; left > 0; r += 25) {
    const cap = Math.max(1, Math.floor((span * r) / 27));
    const count = Math.min(cap, left);
    for (let i = 0; i < count; i++) {
      // Ângulo medido do fundo (0 = embaixo), pulando a fatia do nome.
      const a = gap / 2 + (span * (i + 0.5)) / count;
      out.push([-Math.sin(a) * r, Math.cos(a) * r]);
    }
    left -= count;
  }
  return out;
}

function Marker({
  node,
  pos,
  clients,
  editing,
  selected,
  showClients,
  onDrag,
  onDrop,
}: {
  node: NodeView;
  pos: { x: number; y: number };
  clients: ClientView[];
  editing: boolean;
  selected: boolean;
  showClients: boolean;
  onDrag: (x: number, y: number) => void;
  onDrop: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const points = useMemo(() => ring(clients.length), [clients.length]);
  const down = clients.reduce((s, c) => s + c.downKBps, 0);

  const onPointerDown = (e: PointerEvent) => {
    if (!editing) return;
    e.preventDefault();
    dragging.current = true;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent) => {
    if (!dragging.current) return;
    const stage = ref.current!.closest(".casa-stage") as HTMLElement;
    const r = stage.getBoundingClientRect();
    onDrag(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)));
  };
  const onPointerUp = () => {
    if (!dragging.current) return;
    dragging.current = false;
    onDrop();
  };

  return (
    <div ref={ref} class={cx("casa-marker", editing && "is-editing", selected && "is-selected", !node.online && "is-off")} style={{ left: `${pos.x * 100}%`, top: `${pos.y * 100}%` }}>
      {node.online && <span class="casa-radar" aria-hidden="true" />}
      {showClients &&
        !editing &&
        clients.map((c, i) => {
          const [dx, dy] = points[i]!;
          const busy = c.downKBps + c.upKBps >= 50;
          return (
            <button
              type="button"
              class={cx("casa-client", busy && "is-busy")}
              style={{ transform: `translate(${dx}px, ${dy}px)`, "--band": BAND_COLOR[c.band ?? "wired"] }}
              onClick={() => openClient(c.mac)}
              title={`${clientLabel(c)} · ${c.band ? BAND_LABEL[c.band] : ""}${busy ? ` · ↓ ${rate(c.downKBps)}` : ""}`}
            >
              <DeviceArt category={categoryOf(c)} size="sm" deviceId={c.device?.id} class="!size-[22px] !rounded-full [&>svg]:!size-3" />
            </button>
          );
        })}
      <button
        type="button"
        class="casa-node"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onClick={() => !editing && selectNode(selected ? null : node.mac)}
        aria-label={`${node.name}${editing ? " (arraste para posicionar)" : ""}`}
      >
        <DecoArt model={node.model} online={node.online} uid={`casa-${node.mac}`} class="h-14 w-12" />
      </button>
      <span class="casa-label">
        <span class="font-semibold">{node.name}</span>
        <span class="text-muted">
          {" "}
          · {clients.length}
          {down > 0 ? ` · ↓ ${rate(down)}` : ""}
        </span>
      </span>
    </div>
  );
}

export function Casa() {
  const plan = useFloorplan();
  const overview = useOverview();
  const clientsQ = useClients();
  const images = useImages();
  const ui = useUi();
  const [layer, setLayer] = useState<Layer>("5GHz");
  const [showClients, setShowClients] = useState(true);
  const [showLinks, setShowLinks] = useState(true);
  const [blueprint, setBlueprint] = useState(true);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<FloorplanView | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  // Marcadores encolhem junto com a planta (celular).
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setScale(Math.max(0.5, Math.min(1, e!.contentRect.width / 860))));
    ro.observe(el);
    return () => ro.disconnect();
  });
  // Leitura nova do servidor (inclusive a do próprio salvamento) descarta o rascunho do arraste.
  useEffect(() => setDraft(null), [plan.data]);

  const src = images.data?.floorplan.casa;
  const aspect = useAspect(src);
  const current = draft ?? plan.data;
  const nodes = overview.data?.nodes ?? [];
  const clients = clientsQ.data?.clients ?? [];
  const placed = nodes.filter((n) => current?.nodes[n.mac]);
  const unplaced = nodes.filter((n) => !current?.nodes[n.mac]);

  useEffect(() => {
    if (!canvas.current || !current) return;
    if (layer === "off") {
      canvas.current.getContext("2d")?.clearRect(0, 0, canvas.current.width, canvas.current.height);
      return;
    }
    paintCoverage(
      canvas.current,
      placed.filter((n) => n.online).map((n) => current.nodes[n.mac]!),
      layer,
      current.widthMeters,
      aspect,
    );
  }, [current, layer, aspect, placed.length, nodes]);

  if (!plan.data || !overview.data) return <PageLoading error={plan.error ?? overview.error} />;
  const p = current!;

  const move = (mac: string, x: number, y: number) => setDraft({ ...p, nodes: { ...p.nodes, [mac]: { x, y } } });
  const commit = () => draft && save(draft);
  const place = (mac: string) => {
    // Novo nó entra perto do centro, desviando dos que já estão lá.
    const k = Object.keys(p.nodes).length;
    const next = { ...p, nodes: { ...p.nodes, [mac]: { x: 0.5 + 0.12 * Math.cos(k * 2.4), y: 0.5 + 0.12 * Math.sin(k * 2.4) } } };
    setDraft(next);
    save(next);
  };
  const remove = (mac: string) => {
    const { [mac]: _, ...rest } = p.nodes;
    const next = { ...p, nodes: rest };
    setDraft(next);
    save(next);
  };
  const H = 1000 / aspect;
  const byNode = (mac: string) => clients.filter((c) => c.online && c.nodeMac === mac);
  const sel = nodes.find((n) => n.mac === ui.node && p.nodes[n.mac]);

  return (
    <div class="grid gap-3 lg:grid-cols-[minmax(0,1fr)_300px]">
      <Card class="p-2 sm:p-3">
        <div class="mb-2 flex flex-wrap items-center gap-2 px-1">
          <Segmented
            label="Cobertura"
            value={layer}
            onChange={setLayer}
            options={[
              { value: "5GHz", label: "5 GHz" },
              { value: "2.4GHz", label: "2,4 GHz" },
              { value: "off", label: "sem cobertura" },
            ]}
          />
          <span class="flex-1" />
          <Button size="sm" variant={editing ? "primary" : "default"} icon={<Move class="size-3.5" />} onClick={() => setEditing(!editing)}>
            {editing ? "Pronto" : "Posicionar Decos"}
          </Button>
        </div>

        <div ref={stage} class={cx("casa-stage", !src && "is-empty", blueprint && "is-blueprint")} style={{ aspectRatio: String(aspect), "--s": scale }}>
          {src && <img src={src} alt="Planta da casa" class="casa-plan" draggable={false} />}
          <canvas ref={canvas} class="casa-coverage" aria-hidden="true" />
          <svg class="casa-links" viewBox={`0 0 1000 ${H}`} preserveAspectRatio="none" aria-hidden="true">
            {showLinks &&
              placed.map((n) => {
                const parent = n.parentMac && p.nodes[n.parentMac] ? n.parentMac : null;
                if (!parent) return null;
                const a = p.nodes[parent]!;
                const b = p.nodes[n.mac]!;
                const d = `M${a.x * 1000} ${a.y * H} L${b.x * 1000} ${b.y * H}`;
                const wired = n.backhaul.includes("wired");
                const down = byNode(n.mac).reduce((s, c) => s + c.downKBps, 0);
                return (
                  <g key={n.mac}>
                    <path d={d} class={cx("topo-link", !n.online ? "is-down" : wired ? "is-wired" : "is-wifi")} style={!wired && n.online ? { stroke: signalTone(n) } : undefined} vector-effect="non-scaling-stroke" />
                    {n.online && <Flow d={d} kBps={down} class="flow-down" r={4} />}
                  </g>
                );
              })}
          </svg>
          {placed.map((n) => (
            <Marker
              key={n.mac}
              node={n}
              pos={p.nodes[n.mac]!}
              clients={byNode(n.mac)}
              editing={editing}
              selected={ui.node === n.mac}
              showClients={showClients}
              onDrag={(x, y) => move(n.mac, x, y)}
              onDrop={commit}
            />
          ))}
          {!src && placed.length === 0 && (
            <div class="absolute inset-0 flex items-center justify-center p-6">
              <Empty icon={<MapIcon />}>
                Envie a planta da sua casa (foto ou imagem) e posicione os Decos onde eles estão. Sem planta, dá para posicionar sobre a grade.
              </Empty>
            </div>
          )}
        </div>
        <p class="mt-2 px-1 text-[11.5px] text-muted">
          Cobertura estimada pela distância, sem considerar paredes nem interferência: serve para ver onde o sinal tende a ficar fraco, não é medição.
        </p>
      </Card>

      <div class="grid content-start gap-3">
        <Card>
          <h3 class="mono-label mb-3">camadas</h3>
          <div class="grid gap-2">
            <Check checked={showClients} onChange={() => setShowClients(!showClients)}>
              Aparelhos em volta dos Decos
            </Check>
            <Check checked={showLinks} onChange={() => setShowLinks(!showLinks)}>
              Links e tráfego entre Decos
            </Check>
            <Check checked={blueprint} onChange={() => setBlueprint(!blueprint)}>
              Planta em estilo blueprint
            </Check>
          </div>
          {layer !== "off" && (
            <div class="mt-4">
              <div class="mono-label mb-1.5">sinal estimado · {layer === "5GHz" ? "5 GHz" : "2,4 GHz"}</div>
              <div class="grid gap-1">
                {COVERAGE_STOPS.map((s) => (
                  <span class="flex items-center gap-2 text-[12.5px]">
                    <span class="h-2.5 w-6 rounded-sm" style={{ background: `rgb(${s.rgb.join(" ")} / ${s.a + 0.3})` }} />
                    {s.label}
                    <span class="ml-auto font-mono text-[11px] text-muted">≥ {s.dbm} dBm</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </Card>

        {editing && (
          <Card class="animate-fade-in">
            <h3 class="mono-label mb-3">posicionar</h3>
            <label class="mb-3 flex items-center gap-2 text-[13px]">
              <Ruler class="size-4 text-muted" />
              Largura real da planta
              <input
                type="number"
                min={2}
                max={200}
                step={0.5}
                class="field w-20 py-1"
                value={p.widthMeters}
                onChange={(e) => {
                  const v = Number((e.target as HTMLInputElement).value);
                  if (v >= 2 && v <= 200) {
                    const next = { ...p, widthMeters: v };
                    setDraft(next);
                    save(next);
                  }
                }}
              />
              m
            </label>
            <div class="mb-3 flex flex-wrap gap-2">
              <UploadButton kind="floorplan" name="casa" label="planta" max={1600}>
                {src ? "Trocar planta" : "Enviar planta"}
              </UploadButton>
            </div>
            {unplaced.length > 0 && <div class="mono-label mb-1.5">fora da planta</div>}
            <div class="grid gap-1.5">
              {unplaced.map((n) => (
                <div class="flex items-center gap-2">
                  <DecoArt model={n.model} online={n.online} uid={`tray-${n.mac}`} class="h-8 w-7" />
                  <span class="flex-1 truncate text-[13px] font-medium">{n.name}</span>
                  <Button size="sm" icon={<Crosshair class="size-3.5" />} onClick={() => place(n.mac)}>
                    Colocar
                  </Button>
                </div>
              ))}
              {placed.map((n) => (
                <div class="flex items-center gap-2">
                  <DecoArt model={n.model} online={n.online} uid={`trayp-${n.mac}`} class="h-8 w-7" />
                  <span class="flex-1 truncate text-[13px]">{n.name}</span>
                  <Button size="sm" variant="ghost" onClick={() => remove(n.mac)}>
                    Tirar
                  </Button>
                </div>
              ))}
            </div>
            <p class="mt-3 text-[12px] text-muted">Arraste cada Deco na planta. A posição é salva ao soltar.</p>
          </Card>
        )}

        {!editing && sel && (
          <Card class="animate-fade-in">
            <div class="flex items-center gap-3">
              <DecoArt model={sel.model} online={sel.online} uid={`casa-sel-${sel.mac}`} class="h-14 w-12" />
              <div class="min-w-0">
                <div class="truncate font-semibold">{sel.name}</div>
                <div class="text-[12px] text-muted">
                  Deco {sel.model} · {byNode(sel.mac).length} aparelhos
                </div>
                {sel.role === "master" ? <Badge tone="accent">gateway</Badge> : null}
              </div>
            </div>
            <div class="mt-3 grid gap-0.5">
              {byNode(sel.mac)
                .sort((a, b) => b.downKBps - a.downKBps)
                .slice(0, 10)
                .map((c) => (
                  <button type="button" onClick={() => openClient(c.mac)} class="flex items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-surface-2">
                    <DeviceArt category={categoryOf(c)} size="sm" deviceId={c.device?.id} class="!size-6" />
                    <span class="flex-1 truncate text-[12.5px]">{clientLabel(c)}</span>
                    <span class="text-[11px] tabular-nums text-muted">{c.downKBps > 0 ? rate(c.downKBps) : ""}</span>
                  </button>
                ))}
            </div>
          </Card>
        )}
        {plan.error && <p class="text-[12px] text-bad">{errorText(plan.error)}</p>}
      </div>
    </div>
  );
}
