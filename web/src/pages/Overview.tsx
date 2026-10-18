import { useState } from "preact/hooks";
import { api, type Band, type NodeView, type OverviewView, type WifiKind } from "../api";
import { RebootDialog, WifiDialog } from "../DangerDialogs";
import { BAND_LABEL, NETWORK_LABEL, WIFI_KIND_LABEL, pct, shortFirmware, since } from "../format";
import { useNow, usePolled } from "../hooks";
import { StatusBar } from "../StatusBar";

const BAND_ORDER: Band[] = ["wired", "5GHz", "2.4GHz", "6GHz"];

function Bars({ level }: { level: number | null }) {
  if (level === null) return null;
  return (
    <span class="bars" role="img" aria-label={`sinal ${level} de 3`}>
      {[1, 2, 3].map((i) => <i class={i <= level ? "on" : ""} />)}
    </span>
  );
}

function bandChips(byBand: Partial<Record<Band, number>>) {
  return BAND_ORDER.filter((b) => byBand[b]).map((b) => (
    <span class="badge">
      {BAND_LABEL[b]} {byBand[b]}
    </span>
  ));
}

function Uplink({ node }: { node: NodeView }) {
  if (node.role === "master") return <>WAN (gateway)</>;
  if (node.backhaul.includes("wired")) return <>Cabo → {node.parentName ?? "?"}</>;
  const bands = (["5GHz", "2.4GHz"] as const).filter((b) => node.backhaul.includes(b));
  return (
    <>
      Wi-Fi → {node.parentName ?? "?"}
      <div class="small muted">
        {bands.map((b, i) => (
          <span class="nowrap">
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
  return (
    <article class="card">
      <div class="node-head">
        <span class={`dot ${node.online ? "ok" : "bad"}`} aria-label={node.online ? "online" : "offline"} />
        <span class="name">{node.name}</span>
        {node.role === "master" ? <span class="badge accent">Gateway</span> : <span class="badge">Satélite</span>}
      </div>
      <dl class="kv">
        <dt>Modelo</dt>
        <dd>
          {node.model} <span class="muted small">hw {node.hardware}</span>
        </dd>
        <dt>IP</dt>
        <dd class="mono">{node.ip ?? "—"}</dd>
        <dt>Uplink</dt>
        <dd>
          <Uplink node={node} />
        </dd>
        <dt>{node.online ? "Online há" : "Status"}</dt>
        <dd title="Medido por este painel: o Deco não informa uptime">
          {node.online ? (node.onlineSince ? since(node.onlineSince, now) : "—") : <span class="badge bad">offline</span>}
        </dd>
        <dt>Clientes</dt>
        <dd>
          <div class="chips">
            <strong>{node.clients.total}</strong>
            {bandChips(node.clients.byBand)}
          </div>
        </dd>
        <dt>Firmware</dt>
        <dd class="small" title={node.firmware}>
          {shortFirmware(node.firmware)}
        </dd>
      </dl>
      {onReboot && (
        <div class="card-actions">
          <button class="btn danger" onClick={onReboot} disabled={!node.online}>
            Reiniciar…
          </button>
        </div>
      )}
    </article>
  );
}

function Kpis({ data }: { data: OverviewView }) {
  const { internet, totals, nodes, reservations, performance } = data;
  const nodesOnline = nodes.filter((n) => n.online).length;
  return (
    <div class="grid kpis">
      <div class="card kpi">
        <div class="label">Internet</div>
        <div class="value">
          {internet ? (
            <span class={`badge ${internet.ipv4Online ? "ok" : "bad"}`} style="font-size:15px">
              {internet.ipv4Online ? "Online" : "Offline"}
            </span>
          ) : (
            "—"
          )}
        </div>
        <div class="detail">
          {internet && (
            <>
              <span class="mono">{internet.wanIp ?? "sem IP"}</span> · {internet.connectType.toUpperCase()}
              {!internet.cablePlugged && " · cabo WAN desconectado"}
              <br />
              IPv6 {internet.ipv6Online ? "online" : "offline"}
            </>
          )}
        </div>
      </div>
      <div class="card kpi">
        <div class="label">Clientes online</div>
        <div class="value">{totals.clients}</div>
        <div class="detail chips">{bandChips(totals.byBand)}</div>
      </div>
      <div class="card kpi">
        <div class="label">Nós do mesh</div>
        <div class="value">
          {nodesOnline}/{nodes.length}
        </div>
        <div class="detail">{nodesOnline === nodes.length ? "todos online" : `${nodes.length - nodesOnline} offline`}</div>
      </div>
      <div class="card kpi">
        <div class="label">Reservas de DHCP</div>
        <div class="value">{reservations.used}</div>
        <div class="detail">{reservations.max ? `de ${reservations.max} possíveis` : ""}</div>
      </div>
      <div class="card kpi">
        <div class="label">Redes</div>
        <div class="value" style="font-size:18px">
          {Object.entries(totals.byNetwork)
            .map(([k, v]) => `${NETWORK_LABEL[k] ?? k} ${v}`)
            .join(" · ") || "—"}
        </div>
        <div class="detail">
          {performance ? `CPU ${pct(performance.cpu)} · memória ${pct(performance.memory)}` : ""}
        </div>
      </div>
    </div>
  );
}

export function Overview() {
  const now = useNow();
  const { data, error, reload } = usePolled(api.overview);
  const [rebooting, setRebooting] = useState<NodeView | null>(null);
  const [editingWifi, setEditingWifi] = useState<WifiKind | null>(null);

  if (!data) return <div class="empty">{error ? `Erro: ${error.message}` : "Carregando…"}</div>;

  const dangerous = data.status.mode.allowDangerous;
  const KIND_ORDER = ["host", "guest", "iot"];
  const wifi = [...(data.wifi ?? [])].sort(
    (a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.band.localeCompare(b.band),
  );
  /** A primeira linha de cada rede leva o botão (a rede é uma só nas várias bandas). */
  const firstOfKind = (i: number) => wifi.findIndex((w) => w.kind === wifi[i]!.kind) === i;

  return (
    <>
      <StatusBar status={data.status} reload={reload} />
      {rebooting && <RebootDialog node={rebooting} onClose={() => (setRebooting(null), reload())} />}
      {editingWifi && (
        <WifiDialog
          kind={editingWifi}
          rows={wifi.filter((w) => w.kind === editingWifi)}
          onClose={(changed) => {
            setEditingWifi(null);
            if (changed) reload();
          }}
        />
      )}
      {data.nodes.length === 0 ? (
        <div class="card empty">Ainda sem dados do Deco.</div>
      ) : (
        <>
          <Kpis data={data} />
          <h2>Nós</h2>
          <div class="grid nodes">
            {data.nodes.map((n) => (
              <NodeCard key={n.mac} node={n} now={now} onReboot={dangerous ? () => setRebooting(n) : undefined} />
            ))}
          </div>
          {wifi.length > 0 && (
            <>
              <h2>Redes Wi-Fi</h2>
              <div class="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>SSID</th>
                      <th>Rede</th>
                      <th>Banda</th>
                      <th>Canal</th>
                      <th>Status</th>
                      {dangerous && <th />}
                    </tr>
                  </thead>
                  <tbody>
                    {wifi.map((w, i) => (
                      <tr class={w.enabled ? "" : "offline"}>
                        <td class="primary-cell client-name">{w.ssid}</td>
                        <td data-label="Rede">{WIFI_KIND_LABEL[w.kind] ?? w.kind}</td>
                        <td data-label="Banda">{BAND_LABEL[w.band]}</td>
                        <td data-label="Canal" class="num">
                          {w.channel ?? "—"} {w.channelWidth && <span class="muted small">{w.channelWidth}</span>}
                        </td>
                        <td data-label="Status">
                          <span class={`badge ${w.enabled ? "ok" : ""}`}>{w.enabled ? "ativa" : "desligada"}</span>
                        </td>
                        {dangerous && (
                          <td>
                            {firstOfKind(i) && (w.kind === "host" || w.kind === "guest" || w.kind === "iot") && (
                              <button class="btn" onClick={() => setEditingWifi(w.kind as WifiKind)}>
                                Alterar…
                              </button>
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}
