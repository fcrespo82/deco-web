import { useMemo, useState } from "preact/hooks";
import { api, type Band, type ClientView } from "../api";
import { BAND_LABEL, INVENTORY_TYPE_LABEL, NETWORK_LABEL, ago, dateTime, deviceType, rate } from "../format";
import { useNow, usePolled } from "../hooks";
import { DeviceEditor } from "../DeviceEditor";
import { StatusBar } from "../StatusBar";

/** Apelido do inventário, ou o nome que o Deco dá. */
const label = (c: ClientView) => c.device?.alias ?? c.name;

type SortKey = "name" | "ip" | "node" | "band" | "traffic" | "firstSeen" | "lastSeen";

/** Ordena IPs numericamente: .9 antes de .10. */
const ipKey = (ip: string | null) =>
  ip ? ip.split(".").reduce((acc, part) => acc * 256 + Number(part), 0) : Number.MAX_SAFE_INTEGER;

const SORTERS: Record<SortKey, (a: ClientView, b: ClientView) => number> = {
  name: (a, b) => label(a).localeCompare(label(b), "pt-BR"),
  ip: (a, b) => ipKey(a.ip) - ipKey(b.ip),
  node: (a, b) => (a.nodeName ?? "~").localeCompare(b.nodeName ?? "~", "pt-BR"),
  band: (a, b) => (a.band ?? "~").localeCompare(b.band ?? "~"),
  traffic: (a, b) => b.upKBps + b.downKBps - (a.upKBps + a.downKBps),
  firstSeen: (a, b) => (b.firstSeen ?? "").localeCompare(a.firstSeen ?? ""),
  lastSeen: (a, b) => (b.lastSeen ?? "").localeCompare(a.lastSeen ?? ""),
};

interface Filters {
  q: string;
  status: "all" | "online" | "offline";
  band: "" | Band;
  node: string;
  network: string;
  reservation: "" | "yes" | "no";
}

const EMPTY: Filters = { q: "", status: "all", band: "", node: "", network: "", reservation: "" };

function matches(c: ClientView, f: Filters): boolean {
  if (f.status === "online" && !c.online) return false;
  if (f.status === "offline" && c.online) return false;
  if (f.band && c.band !== f.band) return false;
  if (f.node && c.nodeMac !== f.node) return false;
  if (f.network && c.network !== f.network) return false;
  if (f.reservation === "yes" && !c.reservation) return false;
  if (f.reservation === "no" && c.reservation) return false;
  if (f.q) {
    const q = f.q.toLowerCase().replace(/[:]/g, "-");
    const hay = [
      c.name,
      c.device?.alias,
      c.device?.owner,
      ...(c.device?.tags ?? []),
      c.mac,
      c.ip,
      c.reservation?.ip,
      c.deviceType,
      deviceType(c.deviceType),
      c.nodeName,
    ]
      .join(" ")
      .toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

function Reservation({ c }: { c: ClientView }) {
  if (!c.reservation) return <span class="muted">—</span>;
  if (c.reservation.matchesCurrentIp === false) {
    return (
      <span class="badge warn" title={`Reservado ${c.reservation.ip}, mas está usando ${c.ip}`}>
        reservado {c.reservation.ip}
      </span>
    );
  }
  return <span class="badge ok">reservado</span>;
}

export function Clients() {
  const now = useNow();
  const { data, error, reload } = usePolled(api.clients);
  const [f, setF] = useState<Filters>(EMPTY);
  const [sort, setSort] = useState<SortKey | null>(null);
  const [editing, setEditing] = useState<ClientView | null>(null);

  const clients = data?.clients ?? [];
  const nodes = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of clients) if (c.nodeMac && c.nodeName) m.set(c.nodeMac, c.nodeName);
    return [...m].sort((a, b) => a[1].localeCompare(b[1], "pt-BR"));
  }, [clients]);
  const networks = useMemo(() => [...new Set(clients.map((c) => c.network).filter(Boolean))] as string[], [clients]);

  const rows = useMemo(() => {
    const filtered = clients.filter((c) => matches(c, f));
    // Sem ordenação escolhida, mantém a do servidor (online primeiro, por nome).
    return sort ? [...filtered].sort(SORTERS[sort]) : filtered;
  }, [clients, f, sort]);

  if (!data) return <div class="empty">{error ? `Erro: ${error.message}` : "Carregando…"}</div>;

  const set = <K extends keyof Filters>(k: K) => (e: Event) =>
    setF({ ...f, [k]: (e.target as HTMLInputElement).value });
  const online = clients.filter((c) => c.online).length;

  const Th = ({ k, children }: { k: SortKey; children: string }) => (
    <th aria-sort={sort === k ? "descending" : undefined}>
      <button onClick={() => setSort(sort === k ? null : k)}>
        {children}
        {sort === k ? " ▾" : ""}
      </button>
    </th>
  );

  return (
    <>
      <StatusBar status={data.status} reload={reload} />
      <div class="filters">
        <input type="search" placeholder="Buscar nome, apelido, dono, tag, MAC, IP…" value={f.q} onInput={set("q")} aria-label="Buscar" />
        <select value={f.status} onChange={set("status")} aria-label="Status">
          <option value="all">Todos ({clients.length})</option>
          <option value="online">Online ({online})</option>
          <option value="offline">Offline ({clients.length - online})</option>
        </select>
        <select value={f.band} onChange={set("band")} aria-label="Banda">
          <option value="">Qualquer banda</option>
          {(["wired", "5GHz", "2.4GHz", "6GHz"] as Band[]).map((b) => (
            <option value={b}>{BAND_LABEL[b]}</option>
          ))}
        </select>
        <select value={f.node} onChange={set("node")} aria-label="Nó">
          <option value="">Qualquer nó</option>
          {nodes.map(([mac, name]) => (
            <option value={mac}>{name}</option>
          ))}
        </select>
        {networks.length > 1 && (
          <select value={f.network} onChange={set("network")} aria-label="Rede">
            <option value="">Qualquer rede</option>
            {networks.map((n) => (
              <option value={n}>{NETWORK_LABEL[n] ?? n}</option>
            ))}
          </select>
        )}
        <select value={f.reservation} onChange={set("reservation")} aria-label="Reserva">
          <option value="">Com ou sem reserva</option>
          <option value="yes">Com reserva</option>
          <option value="no">Sem reserva</option>
        </select>
        {JSON.stringify(f) !== JSON.stringify(EMPTY) && (
          <button class="btn" onClick={() => setF(EMPTY)}>
            Limpar
          </button>
        )}
      </div>

      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <Th k="name">Nome</Th>
              <th>MAC</th>
              <Th k="ip">IP</Th>
              <th>Reserva</th>
              <Th k="node">Nó</Th>
              <Th k="band">Banda</Th>
              <Th k="traffic">Envio / receb.</Th>
              <Th k="firstSeen">Primeira vez</Th>
              <Th k="lastSeen">Última vez</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.mac} class={c.online ? "" : "offline"}>
                <td class="primary-cell">
                  <span class={`dot ${c.online ? "ok" : ""}`} style="margin-right:6px" />
                  <button class="link client-name" onClick={() => setEditing(c)} title="Editar no inventário">
                    {label(c)}
                  </button>
                  <div class="muted small">
                    {[
                      c.device && c.device.alias !== c.name && c.name !== c.mac ? c.name : null,
                      c.device?.type ? INVENTORY_TYPE_LABEL[c.device.type] : deviceType(c.deviceType),
                      c.device?.owner,
                      c.network && c.network !== "main" ? (NETWORK_LABEL[c.network] ?? c.network) : null,
                    ]
                      .filter((v, i, all) => v && all.indexOf(v) === i)
                      .join(" · ")}
                  </div>
                  {c.device && c.device.tags.length > 0 && (
                    <div class="chips" style="margin-top:3px">
                      {c.device.tags.map((t) => (
                        <span class="badge">{t}</span>
                      ))}
                    </div>
                  )}
                </td>
                <td data-label="MAC" class="mono">{c.mac}</td>
                <td data-label="IP" class="mono">{c.ip ?? c.reservation?.ip ?? "—"}</td>
                <td data-label="Reserva"><Reservation c={c} /></td>
                <td data-label="Nó">{c.nodeName ?? <span class="muted">—</span>}</td>
                <td data-label="Banda">{c.band ? BAND_LABEL[c.band] : "—"}</td>
                <td data-label="Envio / receb." class="num">
                  {c.online && c.upKBps + c.downKBps > 0 ? (
                    `${rate(c.upKBps)} / ${rate(c.downKBps)}`
                  ) : (
                    <span class="muted">—</span>
                  )}
                </td>
                <td data-label="Primeira vez" class="small hide-mobile" title={dateTime(c.firstSeen)}>
                  {ago(c.firstSeen, now)}
                </td>
                <td data-label="Última vez" class="small" title={dateTime(c.lastSeen)}>
                  {c.online ? "agora" : ago(c.lastSeen, now)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <div class="empty">Nenhum cliente com esses filtros.</div>}
      </div>
      {editing && (
        <DeviceEditor
          mac={editing.mac}
          suggestedName={editing.name !== editing.mac ? editing.name : undefined}
          onClose={(changed) => {
            setEditing(null);
            if (changed) void reload();
          }}
        />
      )}
      <p class="muted small">
        O firmware do Deco não informa o sinal por cliente nem tráfego acumulado; o tráfego mostrado é a taxa no momento da
        última leitura. "Primeira vez" conta a partir de quando este painel começou a registrar.
      </p>
    </>
  );
}
