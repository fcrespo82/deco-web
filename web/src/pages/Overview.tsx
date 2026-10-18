import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { Cable, Cpu, Globe, Lock, MonitorSmartphone, Power, Router, Wifi } from "lucide-preact";
import type { Band, NodeView, OverviewView, WifiKind } from "../api";
import { RebootDialog, WifiDialog } from "../DangerDialogs";
import { useOverview, useStatus } from "../data";
import { BAND_LABEL, NETWORK_LABEL, WIFI_KIND_LABEL, pct, shortFirmware, since } from "../format";
import { useNow } from "../hooks";
import { Badge, Button, Card, cx, Dot, Empty, Kv, PageLoading, SectionTitle, TableCard } from "../ui";

const BAND_ORDER: Band[] = ["wired", "5GHz", "2.4GHz", "6GHz"];

function Bars({ level }: { level: number | null }) {
  if (level === null) return null;
  return (
    <span class="bars ml-1" role="img" aria-label={`sinal ${level} de 3`}>
      {[1, 2, 3].map((i) => (
        <i class={i <= level ? "on" : ""} />
      ))}
    </span>
  );
}

function BandChips({ byBand }: { byBand: Partial<Record<Band, number>> }) {
  return (
    <>
      {BAND_ORDER.filter((b) => byBand[b]).map((b) => (
        <Badge>
          {BAND_LABEL[b]} <span class="tabular-nums text-fg">{byBand[b]}</span>
        </Badge>
      ))}
    </>
  );
}

function Uplink({ node }: { node: NodeView }) {
  if (node.role === "master") return <>WAN (gateway)</>;
  if (node.backhaul.includes("wired")) {
    return (
      <span class="inline-flex items-center gap-1">
        <Cable class="size-3.5 text-muted" /> Cabo → {node.parentName ?? "?"}
      </span>
    );
  }
  const bands = (["5GHz", "2.4GHz"] as const).filter((b) => node.backhaul.includes(b));
  return (
    <>
      <span class="inline-flex items-center gap-1">
        <Wifi class="size-3.5 text-muted" /> Wi-Fi → {node.parentName ?? "?"}
      </span>
      <div class="text-[12px] text-muted">
        {bands.map((b, i) => (
          <span class="whitespace-nowrap">
            {i > 0 && " · "}
            {BAND_LABEL[b]}
            <Bars level={node.signal[b]} />
          </span>
        ))}
      </div>
    </>
  );
}

function NodeCard({ node, now, onReboot }: { node: NodeView; now: number; onReboot?: () => void }) {
  const master = node.role === "master";
  return (
    <Card class={cx("flex flex-col transition hover:shadow-pop", !node.online && "border-bad/40")}>
      <div class="flex items-center gap-3">
        <div class={cx("flex size-10 shrink-0 items-center justify-center rounded-xl", master ? "bg-accent-soft text-accent" : "bg-surface-2 text-muted")}>
          <Router class="size-5" />
        </div>
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <Dot tone={node.online ? "ok" : "bad"} label={node.online ? "online" : "offline"} />
            <span class="truncate font-semibold">{node.name}</span>
          </div>
          <div class="text-[12px] text-muted">
            {node.model} · hw {node.hardware}
          </div>
        </div>
        {master ? <Badge tone="accent">Gateway</Badge> : <Badge>Satélite</Badge>}
      </div>

      <div class="mt-4 flex items-end gap-2">
        <span class="text-[28px] font-semibold leading-none tabular-nums">{node.clients.total}</span>
        <span class="pb-0.5 text-[12.5px] text-muted">clientes</span>
        <span class="flex-1" />
        <div class="flex flex-wrap justify-end gap-1">
          <BandChips byBand={node.clients.byBand} />
        </div>
      </div>

      <Kv
        class="mt-4 border-t border-line pt-3"
        items={[
          ["IP", node.ip ?? "—", "font-mono text-[12.5px]"],
          ["Uplink", <Uplink node={node} />],
          [
            node.online ? "Online há" : "Status",
            node.online ? (
              <span title="Medido por este painel: o Deco não informa uptime">{node.onlineSince ? since(node.onlineSince, now) : "—"}</span>
            ) : (
              <Badge tone="bad">offline</Badge>
            ),
          ],
          ["Firmware", <span title={node.firmware}>{shortFirmware(node.firmware)}</span>, "text-[12.5px]"],
        ]}
      />
      {onReboot && (
        <div class="mt-auto flex justify-end pt-3">
          <Button size="sm" variant="danger" icon={<Power class="size-3.5" />} onClick={onReboot} disabled={!node.online}>
            Reiniciar…
          </Button>
        </div>
      )}
    </Card>
  );
}

function Kpi({ icon, label, value, detail, tone }: { icon: ComponentChildren; label: string; value: ComponentChildren; detail?: ComponentChildren; tone?: "ok" | "bad" }) {
  return (
    <Card class="relative overflow-hidden">
      <div class="flex items-center gap-2 text-[12.5px] font-medium text-muted">
        <span class={cx("flex size-7 items-center justify-center rounded-lg [&>svg]:size-4", tone === "bad" ? "bg-bad-soft text-bad" : tone === "ok" ? "bg-ok-soft text-ok" : "bg-surface-2 text-muted")}>
          {icon}
        </span>
        {label}
      </div>
      <div class="mt-3 text-[26px] font-semibold leading-tight tracking-tight tabular-nums">{value}</div>
      {detail && <div class="mt-1 flex flex-wrap gap-1 text-[12.5px] text-muted">{detail}</div>}
    </Card>
  );
}

function Kpis({ data }: { data: OverviewView }) {
  const { internet, totals, nodes, reservations, performance } = data;
  const nodesOnline = nodes.filter((n) => n.online).length;
  return (
    <div class="grid grid-cols-2 gap-3 lg:grid-cols-5">
      <div class="col-span-2 lg:col-span-1">
        <Kpi
          icon={<Globe />}
          label="Internet"
          tone={internet ? (internet.ipv4Online ? "ok" : "bad") : undefined}
          value={internet ? (internet.ipv4Online ? "Online" : "Offline") : "—"}
          detail={
            internet && (
              <span>
                <span class="font-mono">{internet.wanIp ?? "sem IP"}</span> · {internet.connectType.toUpperCase()}
                {!internet.cablePlugged && " · cabo WAN desconectado"} · IPv6 {internet.ipv6Online ? "online" : "offline"}
              </span>
            )
          }
        />
      </div>
      <Kpi icon={<MonitorSmartphone />} label="Clientes online" value={totals.clients} detail={<BandChips byBand={totals.byBand} />} />
      <Kpi
        icon={<Router />}
        label="Nós do mesh"
        tone={nodesOnline === nodes.length ? undefined : "bad"}
        value={
          <>
            {nodesOnline}
            <span class="text-muted">/{nodes.length}</span>
          </>
        }
        detail={nodesOnline === nodes.length ? "todos online" : `${nodes.length - nodesOnline} offline`}
      />
      <Kpi
        icon={<Lock />}
        label="Reservas de DHCP"
        value={reservations.used}
        detail={
          reservations.max ? (
            <div class="w-full">
              <div class="mb-1">de {reservations.max} possíveis</div>
              <div class="h-1.5 overflow-hidden rounded-full bg-surface-2">
                <div class="h-full rounded-full bg-accent transition-all" style={{ width: `${Math.min(100, (reservations.used / reservations.max) * 100)}%` }} />
              </div>
            </div>
          ) : undefined
        }
      />
      <Kpi
        icon={<Cpu />}
        label="Redes"
        value={
          <span class="text-[17px]">
            {Object.entries(totals.byNetwork)
              .map(([k, v]) => `${NETWORK_LABEL[k] ?? k} ${v}`)
              .join(" · ") || "—"}
          </span>
        }
        detail={performance ? `CPU ${pct(performance.cpu)} · memória ${pct(performance.memory)}` : undefined}
      />
    </div>
  );
}

export function Overview() {
  const now = useNow();
  const { data, error } = useOverview();
  const status = useStatus();
  const [rebooting, setRebooting] = useState<NodeView | null>(null);
  const [editingWifi, setEditingWifi] = useState<WifiKind | null>(null);

  if (!data) return <PageLoading error={error} />;

  const mode = status?.mode ?? data.status.mode;
  const dangerous = mode.allowDangerous;
  // Escrita de Wi-Fi é experimental: o X50 recusa o formato (ver README).
  const wifiWrite = dangerous && mode.wifiWrite;
  const KIND_ORDER = ["host", "guest", "iot"];
  const wifi = [...(data.wifi ?? [])].sort(
    (a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.band.localeCompare(b.band),
  );
  /** A primeira linha de cada rede leva o botão (a rede é uma só nas várias bandas). */
  const firstOfKind = (i: number) => wifi.findIndex((w) => w.kind === wifi[i]!.kind) === i;

  return (
    <>
      {rebooting && <RebootDialog node={rebooting} onClose={() => setRebooting(null)} />}
      {editingWifi && <WifiDialog kind={editingWifi} rows={wifi.filter((w) => w.kind === editingWifi)} onClose={() => setEditingWifi(null)} />}
      {data.nodes.length === 0 ? (
        <Empty icon={<Router />}>Ainda sem dados do Deco. A primeira leitura leva uns 15–40 s.</Empty>
      ) : (
        <>
          <Kpis data={data} />
          <SectionTitle>Nós</SectionTitle>
          <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {data.nodes.map((n) => (
              <NodeCard key={n.mac} node={n} now={now} onReboot={dangerous ? () => setRebooting(n) : undefined} />
            ))}
          </div>
          {wifi.length > 0 && (
            <>
              <SectionTitle>Redes Wi-Fi</SectionTitle>
              <TableCard>
                <table class="rtable">
                  <thead>
                    <tr>
                      <th>SSID</th>
                      <th>Rede</th>
                      <th>Banda</th>
                      <th>Canal</th>
                      <th>Status</th>
                      {wifiWrite && <th />}
                    </tr>
                  </thead>
                  <tbody>
                    {wifi.map((w, i) => (
                      <tr class={w.enabled ? "" : "is-off"}>
                        <td class="cell-primary font-medium">{w.ssid}</td>
                        <td data-label="Rede">{WIFI_KIND_LABEL[w.kind] ?? w.kind}</td>
                        <td data-label="Banda">{BAND_LABEL[w.band]}</td>
                        <td data-label="Canal" class="tabular-nums">
                          {w.channel ?? "—"} {w.channelWidth && <span class="text-[12px] text-muted">{w.channelWidth}</span>}
                        </td>
                        <td data-label="Status">
                          <Badge tone={w.enabled ? "ok" : ""}>{w.enabled ? "ativa" : "desligada"}</Badge>
                        </td>
                        {wifiWrite && (
                          <td class="cell-actions text-right">
                            {firstOfKind(i) && (w.kind === "host" || w.kind === "guest" || w.kind === "iot") && (
                              <Button size="sm" onClick={() => setEditingWifi(w.kind as WifiKind)}>
                                Alterar…
                              </Button>
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableCard>
            </>
          )}
        </>
      )}
    </>
  );
}
