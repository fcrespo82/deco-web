import {mapMatches} from "./lib/map-search";
import {useMapViewport} from "./lib/map-viewport";
import {descendantPositions} from "./lib/map-geometry";
import { MapContextMenu, mapMenuContext, type MapMenuContext } from "./MapContextMenu";
import { modelPortCount } from "./lib/port-points";
import { useStored } from "./lib/preferences";
import { useQuery } from "./lib/query";
import { api } from "./api";
import { useNodePositions } from "./lib/node-positions";
import { useReducedMotion } from "./lib/preferences";
/**
 * Mapa vivo da rede: internet → gateway → satélites, com os clientes em
 * órbita do nó em que estão. Links por cabo são contínuos; por Wi-Fi,
 * tracejados na cor do sinal. Partículas correm pelos links na proporção do
 * tráfego (descendo = download, subindo = upload). Clientes que trocam de nó
 * deslizam até a nova órbita.
 */
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { Globe, Maximize, Minus, Plus } from "lucide-preact";
import type { Band, ClientView, NodeView } from "./api";
import type { InternetStatus } from "../../src/deco-client/types";
import { CATEGORY, CategoryGradients, categoryOf } from "./art/devices";
import { useArtImages } from "./art/images";
import { PhotoDefs, SvgAvatar, SvgDeco } from "./art/svg";
import { BAND_LABEL, rate } from "./format";
import { cx, IconButton } from "./ui";

const AV = 12; // raio do avatar de cliente
const RING0 = 70;
const RING_STEP = 31;
const SPACING = 30;
const LINK_GAP = 34; // largura (px) livre na órbita onde passa um link
const LABEL_GAP = (120 * Math.PI) / 180; // espaço no 1º anel para o nome do nó
const NODE_MIN_FOOT = 70;
const INTERNET_W = 150;

export const BAND_COLOR: Record<Band, string> = {
  wired: "var(--band-wired)",
  "5GHz": "var(--band-5)",
  "2.4GHz": "var(--band-24)",
  "6GHz": "var(--band-6)",
};
const BAND_ORDER: Band[] = ["wired", "5GHz", "6GHz", "2.4GHz"];
const TAU = Math.PI * 2;

interface Placed {
  node: NodeView;
  x: number;
  y: number;
  foot: number;
  clients: { c: ClientView; x: number; y: number }[];
  /** Tráfego que passa pelo link deste nó até o pai (KB/s). */
  down: number;
  up: number;
  parent: Placed | null;
}

interface Tree {
  node: NodeView;
  clients: ClientView[];
  children: Tree[];
  foot: number;
  weight: number;
}

/** Ângulo de a para b, medido do topo no sentido horário. */
const angleTo = (ax: number, ay: number, bx: number, by: number) => (Math.atan2(bx - ax, -(by - ay)) + TAU) % TAU;
const polar = (r: number, a: number): [number, number] => [Math.sin(a) * r, -Math.cos(a) * r];

/** Arcos livres de um anel de raio r, tirando as fatias dos links e do nome. */
function freeArcs(r: number, links: number[], label: boolean): [number, number][] {
  const gaps: [number, number][] = [];
  const add = (center: number, half: number) => {
    const a = (((center - half) % TAU) + TAU) % TAU;
    const b = a + half * 2;
    if (b > TAU) gaps.push([a, TAU], [0, b - TAU]);
    else gaps.push([a, b]);
  };
  for (const l of links) add(l, Math.min(Math.PI / 3, LINK_GAP / 2 / r));
  if (label) add(Math.PI, LABEL_GAP / 2);
  gaps.sort((x, y) => x[0] - y[0]);
  const free: [number, number][] = [];
  let at = 0;
  for (const [a, b] of gaps) {
    if (a > at) free.push([at, a]);
    at = Math.max(at, b);
  }
  if (at < TAU) free.push([at, TAU]);
  return free;
}

/** Posições (relativas ao nó) de n clientes em anéis concêntricos. */
function orbit(n: number, links: number[]): { points: [number, number][]; outer: number } {
  const points: [number, number][] = [];
  let r = RING0;
  let outer = 0;
  for (let ring = 0; points.length < n; ring++, r += RING_STEP) {
    const arcs = freeArcs(r, links, ring === 0);
    const len = arcs.reduce((s, [a, b]) => s + (b - a), 0);
    const count = Math.min(n - points.length, Math.max(1, Math.floor((len * r) / SPACING)));
    // Espaçamento uniforme ao longo dos arcos livres concatenados.
    const step = len / count;
    for (let i = 0; i < count; i++) {
      let d = step * (i + 0.5);
      for (const [a, b] of arcs) {
        if (d <= b - a) {
          points.push(polar(r, a + d));
          break;
        }
        d -= b - a;
      }
    }
    outer = r;
  }
  return { points, outer };
}

function bandRank(c: ClientView) {
  return c.band ? BAND_ORDER.indexOf(c.band) : BAND_ORDER.length;
}

function build(nodes: NodeView[], clients: ClientView[]) {
  const byMac = new Map(nodes.map((n) => [n.mac, n]));
  const root = nodes.find((n) => n.role === "master") ?? nodes[0];
  if (!root) return null;
  const online = clients.filter((c) => c.online);
  const trees = new Map<string, Tree>();
  for (const n of nodes) {
    const own = online
      .filter((c) => (c.nodeMac && byMac.has(c.nodeMac) ? c.nodeMac === n.mac : n === root))
      .sort((a, b) => bandRank(a) - bandRank(b) || (a.device?.alias ?? a.name).localeCompare(b.device?.alias ?? b.name, "pt-BR"));
    // Estimativa do tamanho com um link só; a órbita final usa os links reais.
    const { outer } = orbit(own.length, [0]);
    const foot = Math.max(NODE_MIN_FOOT, outer + AV + 8);
    trees.set(n.mac, { node: n, clients: own, children: [], foot, weight: 0 });
  }
  for (const n of nodes) {
    if (n === root) continue;
    const parent = (n.parentMac && n.parentMac !== n.mac && trees.get(n.parentMac)) || trees.get(root.mac)!;
    parent.children.push(trees.get(n.mac)!);
  }
  let maxFoot = 0;
  const measure = (t: Tree, depth: number) => {
    if (depth > 6) t.children = [];
    t.children.sort((a, b) => a.node.name.localeCompare(b.node.name, "pt-BR"));
    for (const ch of t.children) measure(ch, depth + 1);
    if (depth > 0) maxFoot = Math.max(maxFoot, t.foot);
    t.weight = Math.max(t.foot * 2 + 26, t.children.reduce((s, ch) => s + ch.weight, 0));
  };
  const rootTree = trees.get(root.mac)!;
  measure(rootTree, 0);

  // Raio do 1º círculo: cabe a soma dos diâmetros e não encosta no gateway.
  const total = INTERNET_W + rootTree.children.reduce((s, ch) => s + ch.weight, 0);
  const R1 = Math.max(rootTree.foot + maxFoot + 34, total / TAU);
  const depthStep = maxFoot * 2 + 40;
  const unit = TAU / total;

  const placed: Placed[] = [];
  const rootPlaced: Placed = { node: root, x: 0, y: 0, foot: rootTree.foot, clients: [], down: 0, up: 0, parent: null };
  placed.push(rootPlaced);
  const linksOf = new Map<Placed, number[]>([[rootPlaced, [0]]]); // 0 = internet, para cima
  const place = (t: Tree, center: number, span: number, depth: number, parent: Placed) => {
    const [x, y] = polar(R1 + (depth - 1) * depthStep, center);
    const p: Placed = { node: t.node, x, y, foot: t.foot, clients: [], down: 0, up: 0, parent };
    placed.push(p);
    linksOf.set(p, [angleTo(x, y, parent.x, parent.y)]);
    linksOf.get(parent)!.push(angleTo(parent.x, parent.y, x, y));
    let cursor = center - span / 2;
    const sum = t.children.reduce((s, ch) => s + ch.weight, 0) || 1;
    for (const ch of t.children) {
      const sub = (span * ch.weight) / sum;
      place(ch, cursor + sub / 2, sub, depth + 1, p);
      cursor += sub;
    }
  };
  let cursor = (INTERNET_W / 2) * unit;
  for (const ch of rootTree.children) {
    const span = ch.weight * unit;
    place(ch, cursor + span / 2, span, 1, rootPlaced);
    cursor += span;
  }
  for (const p of placed) {
    const own = trees.get(p.node.mac)!.clients;
    const { points } = orbit(own.length, linksOf.get(p)!);
    p.clients = own.map((c, i) => ({ c, x: p.x + points[i]![0], y: p.y + points[i]![1] }));
  }

  // Tráfego acumulado subindo a árvore: cada link carrega o da subárvore.
  for (const p of [...placed].reverse()) {
    p.down += p.clients.reduce((s, { c }) => s + c.downKBps, 0);
    p.up += p.clients.reduce((s, { c }) => s + c.upKBps, 0);
    if (p.parent) {
      p.parent.down += p.down;
      p.parent.up += p.up;
    }
  }

  const internet = { x: 0, y: -Math.max(rootTree.foot + 70, R1 * 0.82) };
  let minX = -110;
  let maxX = 110;
  let minY = internet.y - 62;
  let maxY = 0;
  for (const p of placed) {
    minX = Math.min(minX, p.x - p.foot);
    maxX = Math.max(maxX, p.x + p.foot);
    minY = Math.min(minY, p.y - p.foot);
    maxY = Math.max(maxY, p.y + Math.max(p.foot, 100));
  }
  return { placed, internet, box: { x: minX, y: minY, w: maxX - minX, h: maxY - minY } };
}

/** Partículas ao longo de um caminho; a quantidade e a velocidade seguem o tráfego. */
export function Flow({ d, kBps, reverse, class: klass, r = 2.6 }: { d: string; kBps: number; reverse?: boolean; class: string; r?: number }) {
  const reduced = useReducedMotion();
  if (reduced || kBps < 2) return null;
  const n = kBps < 60 ? 1 : kBps < 600 ? 2 : kBps < 3000 ? 3 : 4;
  const dur = Math.max(0.9, 4.2 - Math.min(3.5, Math.log10(kBps)) * 0.95);
  return (
    <g class={cx("flow", klass)} key={`${n}-${dur.toFixed(1)}`}>
      {Array.from({ length: n }, (_, i) => (
        <circle r={r}>
          <animateMotion
            dur={`${dur}s`}
            begin={`${(-i * dur) / n}s`}
            repeatCount="indefinite"
            // "path" falta nos tipos do Preact, mas é atributo válido do animateMotion.
            {...({ path: d } as object)}
            {...(reverse ? { keyPoints: "1;0", keyTimes: "0;1", calcMode: "linear" } : {})}
          />
        </circle>
      ))}
    </g>
  );
}

export function signalTone(node: NodeView): string {
  const levels = (["5GHz", "2.4GHz"] as const).filter((b) => node.backhaul.includes(b)).map((b) => node.signal[b] ?? 0);
  const best = Math.max(0, ...levels);
  return best >= 3 ? "var(--ok)" : best === 2 ? "var(--warn)" : "var(--bad)";
}

function backhaulLabel(node: NodeView): string {
  if (node.backhaul.includes("wired")) return "cabo";
  const bands = (["5GHz", "2.4GHz"] as const).filter((b) => node.backhaul.includes(b));
  // Só a melhor banda, para o rótulo caber no link.
  const best = [...bands].sort((a, b) => (node.signal[b] ?? 0) - (node.signal[a] ?? 0))[0];
  if (!best) return "Wi-Fi";
  const level = node.signal[best] ?? 0;
  return `${BAND_LABEL[best]} ${"▮".repeat(level)}${"▯".repeat(3 - level)}`;
}

function useWidth(ref: { current: HTMLElement | null }) {
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(e!.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return w;
}

export interface TopologyProps {
  search?:string;
  nodes: NodeView[];
  clients: ClientView[];
  internet: InternetStatus | null;
  selected: string | null;
  onSelectNode: (mac: string | null) => void;
  onSelectClient: (c: ClientView) => void;
  /** Destaque de clientes (busca); os outros ficam apagados. */
  highlight?: (c: ClientView) => boolean;
  /** Modo TV: ocupa a altura disponível, textos maiores, sem controles. */
  ambient?: boolean;
  onOpenPhysical?:()=>void;
  onEditWiring?:(id:string)=>void;
}

export function Topology({ nodes, clients, internet, selected, onSelectNode, onSelectClient, highlight, search="", ambient, onOpenPhysical, onEditWiring }: TopologyProps) {
  const wrap = useRef<HTMLDivElement>(null);
  const width = useWidth(wrap);
  const [grid,setGrid]=useStored("maps.mesh.grid",true,(v):v is boolean=>typeof v==="boolean");
  const [moveChildren,setMoveChildren]=useStored("maps.mesh.moveChildren",false,(v):v is boolean=>typeof v==="boolean");
  const positioning = useNodePositions("maps.mesh.positions",grid?20:0);
  const [context,setContext]=useState<MapMenuContext|null>(null);
  const cabling=useQuery("physical-topology",api.networkTopology,["switches"]);
  const layout = useMemo(() => {
    const base=build(nodes,clients);if(!base)return null;
    const placed=base.placed.map(p=>{
      const pinned=positioning.positions[`mesh:${p.node.mac}`];
      const x=pinned?.x??p.x,y=pinned?.y??p.y,dx=x-p.x,dy=y-p.y;
      return {...p,x,y,clients:p.clients.map(c=>({...c,x:positioning.positions[`client:${c.c.mac}`]?.x??c.x+dx,y:positioning.positions[`client:${c.c.mac}`]?.y??c.y+dy}))};
    });
    const byMac=new Map(placed.map(p=>[p.node.mac,p]));
    for(const p of placed)if(p.parent)p.parent=byMac.get(p.parent.node.mac)!;
    // Amplia o enquadramento para posições salvas, sem alterar a escala durante o gesto.
    let minX=base.box.x,minY=base.box.y,maxX=minX+base.box.w,maxY=minY+base.box.h;
    for(const p of base.placed){
      const pin=positioning.savedPositions[`mesh:${p.node.mac}`];
      if(pin){minX=Math.min(minX,pin.x-p.foot);maxX=Math.max(maxX,pin.x+p.foot);minY=Math.min(minY,pin.y-p.foot);maxY=Math.max(maxY,pin.y+p.foot);}
    }
    for(const [id,pin] of Object.entries(positioning.savedPositions))if(id.startsWith("client:")||id==="internet"){
      const margin=id==="internet"?80:20;minX=Math.min(minX,pin.x-margin);maxX=Math.max(maxX,pin.x+margin);minY=Math.min(minY,pin.y-margin);maxY=Math.max(maxY,pin.y+margin);
    }
    return {...base,placed,box:{x:minX,y:minY,w:maxX-minX,h:maxY-minY},internet:positioning.positions.internet??base.internet};
  }, [nodes, clients, positioning.positions]);
  const art = useArtImages();
  const viewport=useMapViewport(!!ambient);
  const [hover, setHover] = useState<string | null>(null);

  // Telas estreitas: o desenho encolhe, então os textos crescem um pouco.
  const fit = layout && width ? width / (layout.box.w + 32) : 1;
  const textScale = Math.min(1.7, Math.max(1, 0.72 / fit)) * (ambient ? 1.2 : 1);

  if (!layout) return null;
  const { placed, box, internet: net } = layout;
  const pad = 16;
  const W = box.w + pad * 2;
  const frame=viewport.frame({x:box.x-pad,y:box.y-pad,width:W,height:box.h+pad*2},positioning.ready);
  const vb = `${frame.x} ${frame.y} ${frame.width} ${frame.height}`;
  const cxBox = box.x + box.w / 2;
  const cyBox = box.y + box.h / 2;
  const root = placed[0]!;
  const netOnline = internet?.ipv4Online ?? true;
  const totalDown = root.down;
  const totalUp = root.up;
  const moved=viewport.view.k!==1||viewport.view.x!==0||viewport.view.y!==0;
  const clicked=()=>viewport.allowClick()&&positioning.allowClick();
  const treePositions=new Map(placed.map(p=>[`mesh:${p.node.mac}`,{x:p.x,y:p.y}]));
  const treeLinks=[{source:"internet",target:`mesh:${root.node.mac}`},...placed.filter(p=>p.parent).map(p=>({source:`mesh:${p.parent!.node.mac}`,target:`mesh:${p.node.mac}`}))];
  const followers=(id:string)=>{
    if(!moveChildren)return {};
    const group=descendantPositions(id,treeLinks,treePositions),owners=new Set([id,...Object.keys(group)]);
    for(const p of placed)if(owners.has(`mesh:${p.node.mac}`))for(const c of p.clients){const key=`client:${c.c.mac}`;if(positioning.savedPositions[key])group[key]={x:c.x,y:c.y};}
    return group;
  };

  const dim = (c: ClientView) => highlight && !highlight(c);
  const hoverClient = hover ? placed.flatMap((p) => p.clients).find((x) => x.c.mac === hover) : null;

  return (
    <div ref={wrap} class={cx("topology relative", ambient && "h-full")}>
      <svg ref={viewport.svg} {...viewport.events}
        viewBox={vb}
        class={cx("block w-full select-none", ambient ? "h-full" : viewport.panning ? "cursor-grabbing" : "cursor-grab")}
        style={{ maxHeight: ambient || width < 640 ? undefined : "80vh", "--ts": textScale, touchAction:ambient?undefined:"none" }}
        role="img"
        aria-label={`Topologia: ${nodes.length} nós, ${clients.filter((c) => c.online).length} clientes online`}
        onContextMenu={ambient?undefined:e=>setContext(mapMenuContext(e))}
        onClick={(e) => e.target === e.currentTarget && clicked() && onSelectNode(null)}
        onDblClick={e=>{if(!(e.target as Element).closest("[data-map-node]"))viewport.reset();}}
      >
        <CategoryGradients />
        <PhotoDefs />
        <defs>
          <radialGradient class={netOnline ? "is-online" : "is-offline"} id="topo-net" cx="0.35" cy="0.3" r="0.9">
            <stop class="network-highlight" offset="0" stop-color={`color-mix(in srgb, ${netOnline ? "var(--flow-down)" : "var(--bad)"} 60%, #ffffff)`} />
            <stop offset="1" stop-color={netOnline ? "var(--flow-down)" : "var(--bad)"} />
          </radialGradient>
          <pattern id="topo-dots" width="20" height="20" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="1" fill="var(--grid)" />
          </pattern>
        </defs>
        <rect x={box.x - pad} y={box.y - pad} width={W} height={box.h + pad * 2} fill={grid?"url(#topo-dots)":"none"} pointer-events="none" />

        <g
          data-map-stage transform={viewport.transform}
          class="topo-stage"
        >
          {/* Internet → gateway */}
          {(() => {
            const d = `M${net.x} ${net.y + 26} L${root.x} ${root.y - 20}`;
            return (
              <g>
                <path d={d} class={cx("topo-link", netOnline ? "is-wired" : "is-down")} />
                {netOnline && <Flow d={d} kBps={totalDown} class="flow-down" r={3.2} />}
                {netOnline && <Flow d={d} kBps={totalUp} reverse class="flow-up" r={2.4} />}
              </g>
            );
          })()}

          {/* Links entre nós */}
          {placed.slice(1).map((p) => {
            const parent = p.parent!;
            const d = `M${parent.x} ${parent.y} L${p.x} ${p.y}`;
            const wired = p.node.backhaul.includes("wired");
            // Rótulo no meio do trecho livre entre as duas órbitas.
            const dist = Math.hypot(p.x - parent.x, p.y - parent.y) || 1;
            const t = (parent.foot + (dist - parent.foot - p.foot) / 2) / dist;
            const mx = parent.x + (p.x - parent.x) * t;
            const my = parent.y + (p.y - parent.y) * t;
            const label = backhaulLabel(p.node);
            return (
              <g key={`l-${p.node.mac}`}>
                <path
                  d={d}
                  class={cx("topo-link", !p.node.online ? "is-down" : wired ? "is-wired" : "is-wifi")}
                  style={!wired && p.node.online ? { stroke: signalTone(p.node) } : undefined}
                />
                {p.node.online && <Flow d={d} kBps={p.down} class="flow-down" />}
                {p.node.online && <Flow d={d} kBps={p.up} reverse class="flow-up" r={2} />}
                <g transform={`translate(${mx} ${my}) scale(${textScale})`} class="topo-edge-label">
                  <rect x={-(label.length * 3.1 + 8)} y="-9" width={label.length * 6.2 + 16} height="18" />
                  <text text-anchor="middle" dy="3.5">
                    {label}
                  </text>
                </g>
              </g>
            );
          })}

          {/* Links nó → cliente */}
          {placed.map((p) =>
            p.clients.map(({ c, x, y }) => {
              const d = `M${p.x} ${p.y - 4} L${x} ${y}`;
              // Sem banda (visto só pelo painel): traço pontilhado neutro, nem cabo nem Wi-Fi.
              return (
                <g key={`cl-${c.mac}`} class={cx("topo-client-link", dim(c) && "is-dim", hover === c.mac && "is-hover")}>
                  <path d={d} stroke={c.band ? BAND_COLOR[c.band] : "var(--muted)"} class={!c.band ? "is-unknown" : c.band === "wired" ? "" : "is-wifi"} />
                  <Flow d={d} kBps={c.downKBps} class="flow-down" r={1.8} />
                </g>
              );
            }),
          )}

          {/* Internet */}
          <g data-map-node="internet" data-map-name="Internet" {...(!ambient?positioning.bind("internet",net,{minX:box.x+80,maxX:box.x+box.w-80,minY:box.y+65,maxY:box.y+box.h-65},followers("internet")): {})} style={{touchAction:"none",cursor:ambient?undefined:"grab"}} transform={`translate(${net.x} ${net.y})`} class={cx("topo-internet", !netOnline && "is-down")}>
            <circle r="34" class="topo-halo" />
            <circle r="26" fill="url(#topo-net)" />
            <Globe x={-13} y={-13} size={26} color="white" stroke-width={1.6} />
            <text y={-34 - 16 * textScale} class="topo-name" text-anchor="middle">
              Internet {netOnline ? "" : "fora do ar"}
            </text>
            <text y={-34 - 2 * textScale} class="topo-sub" text-anchor="middle">
              {internet?.wanIp ?? ""}
              {totalDown + totalUp > 0 ? ` · ↓ ${rate(totalDown)} ↑ ${rate(totalUp)}` : ""}
            </text>
          </g>

          {/* Nós */}
          {placed.map((p) => {
            const isSel = selected === p.node.mac;
            const portCount=cabling.data?.portCounts?.[`mesh:${p.node.mac}`]??modelPortCount(p.node.model);
            const uid = `deco-${p.node.mac.replace(/[^A-Za-z0-9]/g, "")}`;
            const select = (e: Event) => {
              e.stopPropagation();
              if (clicked()) onSelectNode(isSel ? null : p.node.mac);
            };
            return (
              <g
                {...(!ambient?positioning.bind(`mesh:${p.node.mac}`,p,{minX:box.x+p.foot,maxX:box.x+box.w-p.foot,minY:box.y+p.foot,maxY:box.y+box.h-p.foot},followers(`mesh:${p.node.mac}`)): {})}
                data-map-node={`mesh:${p.node.mac}`} data-map-name={p.node.name} data-port-names={JSON.stringify(cabling.data?.portNames?.[`mesh:${p.node.mac}`]??Array.from({length:portCount??0},(_,i)=>String(i+1)))} data-port-count={portCount??undefined}
                key={`n-${p.node.mac}`}
                class={cx("topo-node", (isSel||!!search.trim()&&mapMatches(search,p.node.name,p.node.mac,p.node.model)) && "is-selected", !p.node.online && "is-off")}
                style={{ transform: `translate(${p.x}px, ${p.y}px)`,touchAction:"none",cursor:ambient?undefined:"grab",transition:positioning.dragging?"none":undefined }}
                tabIndex={0}
                role="button"
                aria-label={`${p.node.name}, ${p.node.online ? "online" : "offline"}, ${p.clients.length} clientes`}
                aria-pressed={isSel}
                onClick={select}
                onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onSelectNode(isSel ? null : p.node.mac))}
              >
                <circle r="46" class="topo-node-hit" />
                {p.node.online && <circle r="40" class="topo-halo" />}
                {(isSel||!!search.trim()&&mapMatches(search,p.node.name,p.node.mac,p.node.model)) && <circle r="50" class="topo-select" />}
                <SvgDeco model={p.node.model} online={p.node.online} active={isSel} uid={uid} art={art.deco(p.node.model)} />
                <text y={31 + 13 * textScale} class="topo-name" text-anchor="middle">
                  {p.node.name}
                </text>
                <text y={34 + 25 * textScale} class="topo-sub" text-anchor="middle">
                  {p.node.role === "master" ? "gateway · " : ""}
                  {p.node.online ? (p.clients.length === 1 ? "1 cliente" : `${p.clients.length} clientes`) : "offline"}
                </text>
                {Array.from({length:portCount??0},(_,i)=><circle key={i} data-port={String(i+1)} cx={(i%12-(Math.min(12,(portCount??0)-Math.floor(i/12)*12)-1)/2)*10} cy={82+Math.floor(i/12)*10} r="4" fill="var(--surface)" stroke="var(--muted)"><title>Porta {i+1} · estado não informado</title></circle>)}
              </g>
            );
          })}

          {/* Clientes */}
          {placed.map((p) =>
            p.clients.map(({ c, x, y }) => {
              const cat = categoryOf(c);
              const kBps = c.downKBps + c.upKBps;
              const busy = kBps >= 50;
              return (
                <g
                  {...(!ambient?positioning.bind(`client:${c.mac}`,{x,y},{minX:box.x+20,maxX:box.x+box.w-20,minY:box.y+20,maxY:box.y+box.h-20}):{})}
                  data-map-node={`client:${c.mac}`} data-map-name={c.device?.alias??c.name} data-port-count={cabling.data?.portCounts?.[`client:${c.mac}`]}
                  key={`c-${c.mac}`}
                  class={cx("topo-client", busy && "is-busy", dim(c) && "is-dim")}
                  style={{ transform: `translate(${x}px, ${y}px)`,touchAction:"none",cursor:ambient?undefined:"grab",transition:positioning.dragging?"none":undefined }}
                  tabIndex={0}
                  role="button"
                  aria-label={`${c.device?.alias ?? c.name}, ${CATEGORY[cat].label}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (clicked()) onSelectClient(c);
                  }}
                  onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onSelectClient(c))}
                  onPointerEnter={() => setHover(c.mac)}
                  onPointerLeave={() => setHover((h) => (h === c.mac ? null : h))}
                  onFocus={() => setHover(c.mac)}
                  onBlur={() => setHover((h) => (h === c.mac ? null : h))}
                >
                  <g class="topo-client-body">
                    {busy && <circle r={AV + 3 + Math.min(6, Math.log10(kBps) * 1.6)} class="topo-busy" />}
                    <SvgAvatar category={cat} r={AV} art={art.device(cat, c.device?.id)} own={c.device != null && art.images?.devices[String(c.device.id)] != null} />
                  </g>
                </g>
              );
            }),
          )}

          {/* Rótulo do cliente sob o cursor, por cima de tudo */}
          {hoverClient && (
            <g transform={`translate(${hoverClient.x} ${hoverClient.y - AV - 10})`} class="topo-tip" pointer-events="none">
              {(() => {
                const c = hoverClient.c;
                const t1 = c.device?.alias ?? c.name;
                const t2 = [c.ip, c.band && BAND_LABEL[c.band], c.downKBps + c.upKBps > 0 ? `↓ ${rate(c.downKBps)}` : null].filter(Boolean).join(" · ");
                const w = Math.max(t1.length * 7, t2.length * 5.8) + 20;
                return (
                  <>
                    <rect class="theme-svg-tooltip" x={-w / 2} y="-36" width={w} height="36" />
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
        </g>
      </svg>

      {!ambient&&positioning.saveError&&<p role="alert" class="px-3 text-xs text-bad">{positioning.saveError}</p>}
      {!ambient&&positioning.saving&&<p role="status" class="px-3 text-xs text-muted">Salvando posições no servidor…</p>}
      {!ambient&&<details class="border-t border-line px-4 py-2 text-xs text-muted"><summary class="cursor-pointer py-1 font-medium">Opções do mapa mesh</summary><div class="flex flex-wrap items-center gap-4 py-3"><label class="flex items-center gap-2"><input type="checkbox" checked={grid} onChange={e=>setGrid(e.currentTarget.checked)}/>Encaixar na grade</label><label class="flex items-center gap-2"><input type="checkbox" checked={moveChildren} onChange={e=>setMoveChildren(e.currentTarget.checked)}/>Mover filhos juntos</label><button type="button" class="text-accent underline" onClick={()=>{positioning.reset();viewport.reset();}}>Restaurar posições</button></div><p class="pb-2">Arraste os nós para organizar. Clique direito para editar equipamentos.</p></details>}
      {context&&!ambient&&<MapContextMenu context={context} mode="mesh" onEditWiring={onEditWiring} onResetPosition={positioning.resetNode} onClose={()=>setContext(null)} onPlaced={()=>onOpenPhysical?.()}/>}
      <div class={cx("flex items-center gap-1 px-3 pb-3", ambient && "hidden")}>
        <span class="mr-2 text-xs tabular-nums text-muted">{Math.round(viewport.view.k*100)}%</span>
        <IconButton label="Aproximar" onClick={() => viewport.zoom(1.2)}>
          <Plus class="size-4" />
        </IconButton>
        <IconButton label="Afastar" onClick={() => viewport.zoom(1 / 1.2)}>
          <Minus class="size-4" />
        </IconButton>
        <IconButton label="Ajustar à tela" onClick={viewport.reset} disabled={!moved}>
          <Maximize class="size-4" />
        </IconButton>
      </div>
    </div>
  );
}

export function TopologyLegend() {
  const Item = ({ color, dashed, children }: { color: string; dashed?: boolean; children: string }) => (
    <span class="inline-flex items-center gap-1.5">
      <svg width="22" height="6" aria-hidden="true">
        <line x1="1" y1="3" x2="21" y2="3" stroke={color} stroke-width="2.5" stroke-linecap="round" stroke-dasharray={dashed ? "4 4" : undefined} />
      </svg>
      {children}
    </span>
  );
  return (
    <div class="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px] text-muted">
      <Item color="var(--band-wired)">Cabo</Item>
      <Item color="var(--band-5)" dashed>
        5 GHz
      </Item>
      <Item color="var(--band-24)" dashed>
        2,4 GHz
      </Item>
      <Item color="var(--band-6)" dashed>
        6 GHz
      </Item>
      <span class="inline-flex items-center gap-1.5">
        <span class="size-2 rounded-full bg-[var(--flow-down)]" /> download
      </span>
      <span class="inline-flex items-center gap-1.5">
        <span class="size-2 rounded-full bg-[var(--flow-up)]" /> upload
      </span>
      <span class="max-sm:hidden">Arraste para mover · Ctrl + rolagem para zoom · clique duplo para ajustar</span>
    </div>
  );
}
