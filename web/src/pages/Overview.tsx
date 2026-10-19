import type { ComponentChildren } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import { ArrowDown, ArrowUp, Cable, Globe, Power, Router, Search, Wifi, X } from "lucide-preact";
import type { Band, ClientView, NodeView, OverviewView, WifiKind, WifiNetwork } from "../api";
import { DecoArt } from "../art/DecoArt";
import { categoryOf, DeviceArt } from "../art/devices";
import { ClientSheet, clientLabel, RateBar } from "../ClientSheet";
import { RebootDialog, WifiDialog } from "../DangerDialogs";
import { useClients, useOverview, useStatus } from "../data";
import { BAND_LABEL, NETWORK_LABEL, WIFI_KIND_LABEL, rate, shortFirmware, since } from "../format";
import { useNow } from "../hooks";
import { recordTraffic, useTrafficHistory, type TrafficPoint } from "../lib/traffic";
import { BAND_COLOR, Topology, TopologyLegend } from "../Topology";
import { Badge, Button, Card, cx, Empty, Kv, PageLoading, SectionTitle } from "../ui";

const BAND_ORDER: Band[] = ["wired", "5GHz", "6GHz", "2.4GHz"];

function Sparkline({ points }: { points: TrafficPoint[] }) {
  if (points.length < 2) return <div class="flex h-9 items-end text-[11.5px] text-muted">coletando amostras…</div>;
  const W = 200;
  const H = 36;
  const max = Math.max(1, ...points.map((p) => p.down + p.up));
  const t0 = points[0]!.t;
  const span = Math.max(1, points.at(-1)!.t - t0);
  const xy = (p: TrafficPoint, v: number) => `${((p.t - t0) / span) * W},${H - (v / max) * (H - 3)}`;
  const line = points.map((p) => xy(p, p.down + p.up)).join(" L");
  const up = points.map((p) => xy(p, p.up)).join(" L");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" class="h-9 w-full" aria-hidden="true">
      <defs>
        <linearGradient id="spark-fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stop-color="var(--flow-down)" stop-opacity="0.35" />
          <stop offset="1" stop-color="var(--flow-down)" stop-opacity="0" />
        </linearGradient>
      </defs>
      <path d={`M0,${H} L${line} L${W},${H} Z`} fill="url(#spark-fill)" />
      <path d={`M${line}`} fill="none" stroke="var(--flow-down)" stroke-width="1.6" vector-effect="non-scaling-stroke" />
      <path d={`M${up}`} fill="none" stroke="var(--flow-up)" stroke-width="1.2" vector-effect="non-scaling-stroke" opacity="0.8" />
    </svg>
  );
}

function Ring({ value, label }: { value: number; label: string }) {
  const r = 15;
  const c = 2 * Math.PI * r;
  const tone = value > 0.85 ? "var(--bad)" : value > 0.65 ? "var(--warn)" : "var(--accent)";
  return (
    <div class="flex items-center gap-2">
      <svg viewBox="0 0 40 40" class="size-10 -rotate-90" aria-hidden="true">
        <circle cx="20" cy="20" r={r} fill="none" stroke="var(--surface-3)" stroke-width="4" />
        <circle cx="20" cy="20" r={r} fill="none" stroke={tone} stroke-width="4" stroke-linecap="round" stroke-dasharray={`${value * c} ${c}`} class="transition-[stroke-dasharray] duration-700" />
      </svg>
      <div class="leading-tight">
        <div class="text-[15px] font-semibold tabular-nums">{Math.round(value * 100)}%</div>
        <div class="text-[11.5px] text-muted">{label}</div>
      </div>
    </div>
  );
}

function BandBar({ byBand, total }: { byBand: Partial<Record<Band, number>>; total: number }) {
  return (
    <div>
      <div class="flex h-2 overflow-hidden rounded-full bg-surface-2">
        {BAND_ORDER.filter((b) => byBand[b]).map((b) => (
          <span class="h-full transition-[width] duration-700" style={{ width: `${((byBand[b] ?? 0) / Math.max(1, total)) * 100}%`, background: BAND_COLOR[b] }} />
        ))}
      </div>
      <div class="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11.5px] text-muted">
        {BAND_ORDER.filter((b) => byBand[b]).map((b) => (
          <span class="inline-flex items-center gap-1">
            <span class="size-1.5 rounded-full" style={{ background: BAND_COLOR[b] }} />
            {BAND_LABEL[b]} <span class="tabular-nums text-fg">{byBand[b]}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function Tile({ label, icon, children, tone }: { label: string; icon: ComponentChildren; children: ComponentChildren; tone?: "ok" | "bad" }) {
  return (
    <Card class="relative overflow-hidden max-sm:p-3">
      <div class="mb-2 flex items-center gap-2 text-[12px] font-medium text-muted">
        <span class={cx("flex size-6 items-center justify-center rounded-md [&>svg]:size-3.5", tone === "bad" ? "bg-bad-soft text-bad" : tone === "ok" ? "bg-ok-soft text-ok" : "bg-surface-2")}>{icon}</span>
        {label}
      </div>
      {children}
    </Card>
  );
}

function Hero({ data, clients }: { data: OverviewView; clients: ClientView[] }) {
  const history = useTrafficHistory();
  const online = clients.filter((c) => c.online);
  const down = online.reduce((s, c) => s + c.downKBps, 0);
  const up = online.reduce((s, c) => s + c.upKBps, 0);
  const { internet, nodes, totals, performance } = data;
  const nodesOnline = nodes.filter((n) => n.online).length;
  return (
    <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Tile label="Internet" icon={<Globe />} tone={internet ? (internet.ipv4Online ? "ok" : "bad") : undefined}>
        <div class="text-[18px] font-semibold leading-tight sm:text-[22px]">{internet ? (internet.ipv4Online ? "Online" : "Fora do ar") : "—"}</div>
        <div class="mt-1 truncate text-[12px] text-muted">
          {internet && (
            <>
              <span class="font-mono">{internet.wanIp ?? "sem IP"}</span> · {internet.connectType.toUpperCase()} · IPv6 {internet.ipv6Online ? "ok" : "off"}
            </>
          )}
        </div>
      </Tile>
      <Tile label="Tráfego agora" icon={<ArrowDown />}>
        <div class="flex flex-wrap items-baseline gap-x-3 whitespace-nowrap tabular-nums">
          <span class="text-[18px] font-semibold leading-tight sm:text-[22px]" style={{ color: "var(--flow-down)" }}>
            ↓ {rate(down)}
          </span>
          <span class="text-[13px] font-medium" style={{ color: "var(--flow-up)" }}>
            ↑ {rate(up)}
          </span>
        </div>
        <Sparkline points={history} />
      </Tile>
      <Tile label="Clientes online" icon={<Wifi />}>
        <div class="mb-2 text-[18px] font-semibold leading-tight tabular-nums sm:text-[22px]">
          {totals.clients}
          {Object.keys(totals.byNetwork).length > 1 && (
            <span class="ml-2 text-[12px] font-normal text-muted max-sm:hidden">
              {Object.entries(totals.byNetwork)
                .map(([k, v]) => `${NETWORK_LABEL[k] ?? k} ${v}`)
                .join(" · ")}
            </span>
          )}
        </div>
        <BandBar byBand={totals.byBand} total={totals.clients} />
      </Tile>
      <Tile label="Mesh" icon={<Router />} tone={nodesOnline === nodes.length ? undefined : "bad"}>
        <div class="flex items-center justify-between gap-2">
          <div class="text-[18px] font-semibold leading-tight tabular-nums sm:text-[22px]">
            {nodesOnline}
            <span class="text-muted">/{nodes.length}</span>
            <div class="text-[11.5px] font-normal text-muted">{nodesOnline === nodes.length ? "nós online" : `${nodes.length - nodesOnline} offline`}</div>
          </div>
          {performance && (
            <div class="flex gap-3 max-sm:hidden lg:max-xl:hidden">
              <Ring value={performance.cpu} label="CPU" />
              <Ring value={performance.memory} label="RAM" />
            </div>
          )}
        </div>
      </Tile>
    </div>
  );
}

function Uplink({ node }: { node: NodeView }) {
  if (node.role === "master") return <>WAN (gateway)</>;
  if (node.backhaul.includes("wired")) {
    return (
      <span class="inline-flex items-center gap-1">
        <Cable class="size-3.5 text-muted" /> cabo → {node.parentName ?? "?"}
      </span>
    );
  }
  const bands = (["5GHz", "2.4GHz"] as const).filter((b) => node.backhaul.includes(b));
  return (
    <span class="inline-flex flex-wrap items-center gap-1">
      <Wifi class="size-3.5 text-muted" /> {bands.map((b) => `${BAND_LABEL[b]} ${"▮".repeat(node.signal[b] ?? 0)}${"▯".repeat(3 - (node.signal[b] ?? 0))}`).join(" · ")} → {node.parentName ?? "?"}
    </span>
  );
}

function ClientRow({ c, onOpen, right }: { c: ClientView; onOpen: (c: ClientView) => void; right?: ComponentChildren }) {
  return (
    <button type="button" onClick={() => onOpen(c)} class="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left transition hover:bg-surface-2">
      <DeviceArt category={categoryOf(c)} size="sm" online={c.online} />
      <span class="min-w-0 flex-1">
        <span class="block truncate text-[13px] font-medium">{clientLabel(c)}</span>
        <span class="block truncate text-[11.5px] text-muted">{[c.ip, c.band && BAND_LABEL[c.band]].filter(Boolean).join(" · ")}</span>
      </span>
      {right}
    </button>
  );
}

function NodePanel({ node, clients, now, onReboot, onOpen, onClose }: { node: NodeView; clients: ClientView[]; now: number; onReboot?: () => void; onOpen: (c: ClientView) => void; onClose: () => void }) {
  const own = clients.filter((c) => c.online && c.nodeMac === node.mac).sort((a, b) => b.downKBps + b.upKBps - (a.downKBps + a.upKBps));
  const down = own.reduce((s, c) => s + c.downKBps, 0);
  return (
    <div class="animate-fade-in">
      <div class="flex items-start gap-3">
        <div class="hero-glow -m-1 flex size-24 shrink-0 items-center justify-center rounded-2xl">
          <DecoArt model={node.model} online={node.online} active uid={`panel-${node.mac}`} class="h-20" />
        </div>
        <div class="min-w-0 flex-1 pt-1">
          <div class="flex items-center gap-2">
            <h3 class="truncate text-[17px] font-semibold tracking-tight">{node.name}</h3>
            <button type="button" class="ml-auto rounded-md p-1 text-muted hover:bg-surface-2 hover:text-fg" onClick={onClose} aria-label="Fechar painel do nó">
              <X class="size-4" />
            </button>
          </div>
          <div class="text-[12.5px] text-muted">
            Deco {node.model} · hw {node.hardware}
          </div>
          <div class="mt-1.5 flex flex-wrap gap-1">
            {node.role === "master" ? <Badge tone="accent">Gateway</Badge> : <Badge>Satélite</Badge>}
            <Badge tone={node.online ? "ok" : "bad"}>{node.online ? "online" : "offline"}</Badge>
          </div>
        </div>
      </div>
      <Kv
        class="mt-4"
        items={[
          ["IP", node.ip ?? "—", "font-mono text-[12.5px]"],
          ["Uplink", <Uplink node={node} />, "text-[12.5px]"],
          ["Online há", <span title="Medido por este painel">{node.online && node.onlineSince ? since(node.onlineSince, now) : "—"}</span>],
          ["Firmware", <span title={node.firmware}>{shortFirmware(node.firmware)}</span>, "text-[12.5px]"],
          ["Tráfego", `↓ ${rate(down)}`, "tabular-nums"],
        ]}
      />
      <div class="mb-1 mt-4 flex items-center justify-between text-[12px] font-semibold uppercase tracking-wide text-muted">
        <span>Clientes · {own.length}</span>
        {onReboot && (
          <Button size="sm" variant="danger" icon={<Power class="size-3.5" />} onClick={onReboot} disabled={!node.online}>
            Reiniciar…
          </Button>
        )}
      </div>
      <div class="-mx-2 max-h-[340px] overflow-y-auto">
        {own.map((c) => (
          <ClientRow c={c} onOpen={onOpen} right={c.downKBps + c.upKBps > 0 ? <span class="text-[11.5px] tabular-nums text-muted">{rate(c.downKBps)}</span> : null} />
        ))}
        {own.length === 0 && <p class="px-2 py-3 text-[12.5px] text-muted">Nenhum cliente neste nó agora.</p>}
      </div>
    </div>
  );
}

function TopTalkers({ clients, onOpen }: { clients: ClientView[]; onOpen: (c: ClientView) => void }) {
  const top = clients
    .filter((c) => c.online && c.downKBps + c.upKBps > 0)
    .sort((a, b) => b.downKBps + b.upKBps - (a.downKBps + a.upKBps))
    .slice(0, 7);
  return (
    <div>
      <h3 class="mb-1 text-[12px] font-semibold uppercase tracking-wide text-muted">Usando a rede agora</h3>
      {top.length === 0 ? (
        <p class="py-3 text-[12.5px] text-muted">Ninguém transferindo nada na última leitura.</p>
      ) : (
        <div class="-mx-2">
          {top.map((c) => (
            <ClientRow
              key={c.mac}
              c={c}
              onOpen={onOpen}
              right={
                <span class="w-24 shrink-0 text-right">
                  <span class="block text-[11.5px] tabular-nums">{rate(c.downKBps)}</span>
                  <RateBar kBps={c.downKBps} tone="down" />
                </span>
              }
            />
          ))}
        </div>
      )}
      <p class="mt-3 text-[11.5px] text-muted">Clique num Deco do mapa para ver os detalhes dele, ou num aparelho para abrir a ficha.</p>
    </div>
  );
}

function NodeShelf({ nodes, selected, onSelect, now }: { nodes: NodeView[]; selected: string | null; onSelect: (mac: string) => void; now: number }) {
  return (
    <div class="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 scrollbar-none lg:mx-0 lg:grid lg:grid-cols-[repeat(auto-fill,minmax(160px,1fr))] lg:overflow-visible lg:px-0">
      {nodes.map((n) => (
        <button
          type="button"
          onClick={() => onSelect(n.mac)}
          aria-pressed={selected === n.mac}
          class={cx(
            "group w-[168px] shrink-0 snap-start overflow-hidden rounded-2xl border bg-surface text-left shadow-card transition hover:-translate-y-0.5 hover:shadow-pop lg:w-auto",
            selected === n.mac ? "border-accent ring-2 ring-accent/25" : "border-line",
            !n.online && "border-bad/40",
          )}
        >
          <div class="hero-glow flex h-28 items-end justify-center pt-3">
            <DecoArt model={n.model} online={n.online} uid={`shelf-${n.mac}`} class="h-24 transition-transform duration-500 group-hover:scale-105" />
          </div>
          <div class="px-3.5 pb-3 pt-2">
            <div class="flex items-center gap-1.5">
              <span class="truncate font-semibold">{n.name}</span>
              {n.role === "master" && <Badge tone="accent">GW</Badge>}
            </div>
            <div class="text-[11.5px] text-muted">
              {n.model} · {n.online ? (n.onlineSince ? `há ${since(n.onlineSince, now)}` : "online") : "offline"}
            </div>
            <div class="mt-2 flex items-baseline gap-1">
              <span class="text-[22px] font-semibold leading-none tabular-nums">{n.clients.total}</span>
              <span class="text-[11.5px] text-muted">{n.clients.total === 1 ? "cliente" : "clientes"}</span>
            </div>
            <div class="mt-2 flex h-1.5 overflow-hidden rounded-full bg-surface-2">
              {BAND_ORDER.filter((b) => n.clients.byBand[b]).map((b) => (
                <span style={{ width: `${((n.clients.byBand[b] ?? 0) / Math.max(1, n.clients.total)) * 100}%`, background: BAND_COLOR[b] }} />
              ))}
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}

function WifiCards({ wifi, canEdit, onEdit }: { wifi: WifiNetwork[]; canEdit: boolean; onEdit: (k: WifiKind) => void }) {
  const KIND_ORDER = ["host", "guest", "iot"];
  const kinds = [...new Set(wifi.map((w) => w.kind))].sort((a, b) => KIND_ORDER.indexOf(a) - KIND_ORDER.indexOf(b));
  return (
    <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {kinds.map((k) => {
        const rows = wifi.filter((w) => w.kind === k).sort((a, b) => a.band.localeCompare(b.band));
        const enabled = rows.some((r) => r.enabled);
        const ssids = [...new Set(rows.map((r) => r.ssid))];
        return (
          <Card class={cx("relative overflow-hidden", !enabled && "opacity-70")}>
            <Wifi class={cx("absolute -right-3 -top-3 size-24 opacity-[0.06]", enabled && "text-accent opacity-10")} />
            <div class="text-[12px] font-medium text-muted">{WIFI_KIND_LABEL[k] ?? k}</div>
            <div class="mt-0.5 truncate text-[17px] font-semibold">{ssids.join(" / ")}</div>
            <div class="mt-3 flex flex-wrap gap-1.5">
              {rows.map((r) => (
                <Badge tone={r.enabled ? "ok" : ""}>
                  {BAND_LABEL[r.band]}
                  {r.channel ? ` · canal ${r.channel}` : ""}
                  {r.enabled ? "" : " · desligada"}
                </Badge>
              ))}
            </div>
            {canEdit && (k === "host" || k === "guest" || k === "iot") && (
              <Button size="sm" class="mt-3" onClick={() => onEdit(k as WifiKind)}>
                Alterar…
              </Button>
            )}
          </Card>
        );
      })}
    </div>
  );
}

export function Overview() {
  const now = useNow();
  const { data, error } = useOverview();
  const clientsQ = useClients();
  const status = useStatus();
  const [selected, setSelected] = useState<string | null>(null);
  const [opened, setOpened] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [rebooting, setRebooting] = useState<NodeView | null>(null);
  const [editingWifi, setEditingWifi] = useState<WifiKind | null>(null);

  const clients = clientsQ.data?.clients ?? [];
  const fetchedAt = clientsQ.data?.status.fetchedAt ?? null;
  useEffect(() => {
    const online = clients.filter((c) => c.online);
    recordTraffic(
      fetchedAt,
      online.reduce((s, c) => s + c.downKBps, 0),
      online.reduce((s, c) => s + c.upKBps, 0),
    );
  }, [fetchedAt, clients]);

  const highlight = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return undefined;
    return (c: ClientView) => [clientLabel(c), c.name, c.ip, c.mac, c.vendor, c.device?.owner].join(" ").toLowerCase().includes(needle);
  }, [q]);

  if (!data) return <PageLoading error={error} />;
  if (data.nodes.length === 0) return <Empty icon={<Router />}>Ainda sem dados do Deco. A primeira leitura leva uns 15–40 s.</Empty>;

  const mode = status?.mode ?? data.status.mode;
  const dangerous = mode.allowDangerous;
  const wifiWrite = dangerous && mode.wifiWrite;
  const node = data.nodes.find((n) => n.mac === selected) ?? null;
  const openClient = (c: ClientView) => setOpened(c.mac);
  const matches = highlight ? clients.filter((c) => c.online && highlight(c)).length : 0;

  return (
    <>
      {rebooting && <RebootDialog node={rebooting} onClose={() => setRebooting(null)} />}
      {editingWifi && <WifiDialog kind={editingWifi} rows={(data.wifi ?? []).filter((w) => w.kind === editingWifi)} onClose={() => setEditingWifi(null)} />}
      {opened && <ClientSheet mac={opened} onClose={() => setOpened(null)} />}

      <div class="flex flex-col gap-3">
      <div class="max-sm:order-2">
        <Hero data={data} clients={clients} />
      </div>

      <div class="grid gap-3 lg:grid-cols-[minmax(0,1fr)_330px]">
        <Card class="hero-glow relative overflow-hidden p-0 max-sm:-mx-1">
          <div class="flex flex-wrap items-center gap-3 px-4 pt-3.5">
            <h2 class="text-[15px] font-semibold tracking-tight">Mapa da rede</h2>
            <span class="inline-flex items-center gap-1.5 rounded-full bg-ok-soft px-2 py-0.5 text-[11px] font-semibold text-ok">
              <span class="size-1.5 animate-pulse rounded-full bg-ok" /> ao vivo
            </span>
            <span class="flex-1" />
            <div class="relative w-full sm:w-56">
              <Search class="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted" />
              <input type="search" class="field py-1.5 pl-8 text-[13px]" placeholder="Achar no mapa…" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} aria-label="Achar aparelho no mapa" />
            </div>
          </div>
          {highlight && <p class="px-4 pt-1 text-[12px] text-muted">{matches === 0 ? "Nenhum aparelho online com esse nome." : `${matches} aparelho(s) destacado(s).`}</p>}
          <div class="px-1 sm:px-2">
            <Topology nodes={data.nodes} clients={clients} internet={data.internet} selected={selected} onSelectNode={setSelected} onSelectClient={openClient} highlight={highlight} />
          </div>
          <div class="border-t border-line/70 px-4 py-2.5">
            <TopologyLegend />
          </div>
        </Card>
        <Card class="lg:sticky lg:top-[72px] lg:self-start">
          {node ? (
            <NodePanel node={node} clients={clients} now={now} onReboot={dangerous ? () => setRebooting(node) : undefined} onOpen={openClient} onClose={() => setSelected(null)} />
          ) : (
            <TopTalkers clients={clients} onOpen={openClient} />
          )}
        </Card>
      </div>
      </div>

      <SectionTitle>Seus Decos</SectionTitle>
      <NodeShelf
        nodes={data.nodes}
        selected={selected}
        now={now}
        onSelect={(mac) => {
          setSelected(mac);
          window.scrollTo({ top: 0, behavior: "smooth" });
        }}
      />

      {data.wifi && data.wifi.length > 0 && (
        <>
          <SectionTitle>Redes Wi-Fi</SectionTitle>
          <WifiCards wifi={data.wifi} canEdit={wifiWrite} onEdit={setEditingWifi} />
        </>
      )}

      {data.lan && (
        <p class="mt-6 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted">
          <span>
            LAN <span class="font-mono">{data.lan.ip}</span>/<span class="font-mono">{data.lan.mask}</span>
          </span>
          <span>
            Reservas {data.reservations.used}
            {data.reservations.max ? ` de ${data.reservations.max}` : ""}
          </span>
          {data.totals.unassigned > 0 && <span>{data.totals.unassigned} aparelho(s) sem cadastro</span>}
          <span class="inline-flex items-center gap-1">
            <ArrowDown class="size-3" />
            <ArrowUp class="size-3" /> taxas da última leitura do Deco
          </span>
        </p>
      )}
    </>
  );
}
