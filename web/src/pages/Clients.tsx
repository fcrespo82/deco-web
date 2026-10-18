import { useMemo, useState } from "preact/hooks";
import { ArrowDownUp, Lock, MonitorSmartphone, Search, X } from "lucide-preact";
import type { Band, ClientView } from "../api";
import { useClients, useStatus } from "../data";
import { DeviceEditor } from "../DeviceEditor";
import { BAND_LABEL, INVENTORY_TYPE_LABEL, NETWORK_LABEL, ago, dateTime, deviceType, rate } from "../format";
import { useNow } from "../hooks";
import { ReservationDialog } from "../ReservationDialog";
import { Badge, Button, cx, Dot, Empty, FilterChips, PageLoading, TableCard } from "../ui";

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

const SORT_LABEL: Record<SortKey, string> = {
  name: "Nome",
  ip: "IP",
  node: "Nó",
  band: "Banda",
  traffic: "Tráfego",
  firstSeen: "Primeira vez",
  lastSeen: "Última vez",
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
      c.vendorFull,
      c.randomMac ? "mac privado aleatório" : null,
      c.nodeName,
    ]
      .join(" ")
      .toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

function Reservation({ c }: { c: ClientView }) {
  if (!c.reservation) return <span class="text-muted">—</span>;
  if (c.reservation.matchesCurrentIp === false) {
    return (
      <Badge tone="warn" title={`Reservado ${c.reservation.ip}, mas está usando ${c.ip}`}>
        reservado {c.reservation.ip}
      </Badge>
    );
  }
  return (
    <Badge tone="ok">
      <Lock class="size-3" /> reservado
    </Badge>
  );
}

export function Clients() {
  const now = useNow();
  const { data, error } = useClients();
  const status = useStatus();
  const [f, setF] = useState<Filters>(EMPTY);
  const [sort, setSort] = useState<SortKey | null>(null);
  const [editing, setEditing] = useState<ClientView | null>(null);
  const [reserving, setReserving] = useState<ClientView | null>(null);

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

  if (!data) return <PageLoading error={error} />;

  const set = <K extends keyof Filters>(k: K) => (e: Event) => setF({ ...f, [k]: (e.target as HTMLInputElement).value });
  const online = clients.filter((c) => c.online).length;
  const allowWrite = (status ?? data.status).mode.allowWrite;
  const filtered = JSON.stringify(f) !== JSON.stringify(EMPTY);

  const Th = ({ k, children, class: klass }: { k: SortKey; children: string; class?: string }) => (
    <th aria-sort={sort === k ? "descending" : undefined} class={klass}>
      <button type="button" class={cx("inline-flex items-center gap-1 uppercase hover:text-fg", sort === k && "text-fg")} onClick={() => setSort(sort === k ? null : k)}>
        {children}
        {sort === k && <span aria-hidden="true">▾</span>}
      </button>
    </th>
  );

  return (
    <>
      <div class="mb-4 grid gap-3">
        <FilterChips
          label="Status"
          value={f.status}
          onChange={(status) => setF({ ...f, status })}
          options={[
            { value: "all", label: "Todos", count: clients.length },
            { value: "online", label: "Online", count: online },
            { value: "offline", label: "Offline", count: clients.length - online },
          ]}
        />
        <div class="flex flex-wrap gap-2">
          <div class="relative min-w-0 basis-full sm:basis-auto sm:flex-[1_1_260px]">
            <Search class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <input type="search" class="field pl-9" placeholder="Buscar nome, apelido, dono, tag, MAC, IP…" value={f.q} onInput={set("q")} aria-label="Buscar" />
          </div>
          <select class="field w-auto min-w-[calc(50%-4px)] flex-1 sm:min-w-0 sm:flex-none" value={f.band} onChange={set("band")} aria-label="Banda">
            <option value="">Qualquer banda</option>
            {(["wired", "5GHz", "2.4GHz", "6GHz"] as Band[]).map((b) => (
              <option value={b}>{BAND_LABEL[b]}</option>
            ))}
          </select>
          <select class="field w-auto min-w-[calc(50%-4px)] flex-1 sm:min-w-0 sm:flex-none" value={f.node} onChange={set("node")} aria-label="Nó">
            <option value="">Qualquer nó</option>
            {nodes.map(([mac, name]) => (
              <option value={mac}>{name}</option>
            ))}
          </select>
          {networks.length > 1 && (
            <select class="field w-auto min-w-[calc(50%-4px)] flex-1 sm:min-w-0 sm:flex-none" value={f.network} onChange={set("network")} aria-label="Rede">
              <option value="">Qualquer rede</option>
              {networks.map((n) => (
                <option value={n}>{NETWORK_LABEL[n] ?? n}</option>
              ))}
            </select>
          )}
          <select class="field w-auto min-w-[calc(50%-4px)] flex-1 sm:min-w-0 sm:flex-none" value={f.reservation} onChange={set("reservation")} aria-label="Reserva">
            <option value="">Com ou sem reserva</option>
            <option value="yes">Com reserva</option>
            <option value="no">Sem reserva</option>
          </select>
          {/* No celular não há cabeçalho de tabela: a ordenação vem aqui. */}
          <label class="relative min-w-[calc(50%-4px)] flex-1 md:hidden">
            <ArrowDownUp class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <select class="field pl-9" value={sort ?? ""} onChange={(e) => setSort(((e.target as HTMLSelectElement).value || null) as SortKey | null)} aria-label="Ordenar por">
              <option value="">Ordem padrão</option>
              {(Object.keys(SORT_LABEL) as SortKey[]).map((k) => (
                <option value={k}>{SORT_LABEL[k]}</option>
              ))}
            </select>
          </label>
          {filtered && (
            <Button variant="ghost" icon={<X class="size-4" />} onClick={() => setF(EMPTY)}>
              Limpar
            </Button>
          )}
        </div>
        {filtered && (
          <p class="text-[12.5px] text-muted">
            {rows.length} de {clients.length} clientes
          </p>
        )}
      </div>

      {rows.length === 0 ? (
        <Empty icon={<MonitorSmartphone />}>Nenhum cliente com esses filtros.</Empty>
      ) : (
        <TableCard>
          <table class="rtable">
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
                <tr key={c.mac} class={c.online ? "" : "is-off"}>
                  <td class="cell-primary">
                    <div class="flex items-center gap-2">
                      <Dot tone={c.online ? "ok" : "off"} label={c.online ? "online" : "offline"} />
                      <button type="button" class="truncate text-left font-medium text-fg hover:text-accent hover:underline" onClick={() => setEditing(c)} title="Editar no inventário">
                        {label(c)}
                      </button>
                    </div>
                    <div class="mt-0.5 pl-4 text-[12px] text-muted">
                      {[
                        c.device && c.device.alias !== c.name && c.name !== c.mac ? c.name : null,
                        c.device?.type ? INVENTORY_TYPE_LABEL[c.device.type] : deviceType(c.deviceType),
                        c.vendor ?? (c.randomMac ? "MAC privado" : null),
                        c.device?.owner,
                        c.network && c.network !== "main" ? (NETWORK_LABEL[c.network] ?? c.network) : null,
                      ]
                        .filter((v, i, all) => v && all.indexOf(v) === i)
                        .join(" · ")}
                    </div>
                    {c.device && c.device.tags.length > 0 && (
                      <div class="mt-1 flex flex-wrap gap-1 pl-4">
                        {c.device.tags.map((t) => (
                          <Badge>{t}</Badge>
                        ))}
                      </div>
                    )}
                  </td>
                  <td data-label="MAC" class="whitespace-nowrap font-mono text-[12.5px]">
                    {c.mac}
                  </td>
                  <td data-label="IP" class="whitespace-nowrap font-mono text-[12.5px]">
                    {c.ip ?? c.reservation?.ip ?? "—"}
                  </td>
                  <td data-label="Reserva">
                    <div class="flex flex-wrap items-center gap-1.5">
                      <Reservation c={c} />
                      {allowWrite && (c.online || c.reservation) && (
                        <Button size="sm" variant="ghost" onClick={() => setReserving(c)} aria-label={c.reservation ? `Mudar reserva de ${label(c)}` : `Fixar IP de ${label(c)}`}>
                          {c.reservation ? "Mudar" : "Fixar IP"}
                        </Button>
                      )}
                    </div>
                  </td>
                  <td data-label="Nó">{c.nodeName ?? <span class="text-muted">—</span>}</td>
                  <td data-label="Banda">{c.band ? BAND_LABEL[c.band] : "—"}</td>
                  <td data-label="Envio / receb." class="whitespace-nowrap tabular-nums">
                    {c.online && c.upKBps + c.downKBps > 0 ? `${rate(c.upKBps)} / ${rate(c.downKBps)}` : <span class="text-muted">—</span>}
                  </td>
                  <td data-label="Primeira vez" class="hide-sm text-[12.5px]" title={dateTime(c.firstSeen)}>
                    {ago(c.firstSeen, now)}
                  </td>
                  <td data-label="Última vez" class="text-[12.5px]" title={dateTime(c.lastSeen)}>
                    {c.online ? "agora" : ago(c.lastSeen, now)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableCard>
      )}
      {editing && (
        <DeviceEditor
          mac={editing.mac}
          suggestedName={editing.name !== editing.mac ? editing.name : undefined}
          suggestedType={editing.suggestedType ?? undefined}
          vendor={editing.vendorFull ?? (editing.randomMac ? null : undefined)}
          onClose={() => setEditing(null)}
        />
      )}
      {reserving && (
        <ReservationDialog
          mac={reserving.mac}
          name={label(reserving)}
          current={reserving.reservation?.ip ?? null}
          currentIp={reserving.online ? reserving.ip : null}
          onClose={() => setReserving(null)}
        />
      )}
      <p class="mt-4 text-[12.5px] text-muted">
        O firmware do Deco não informa o sinal por cliente nem tráfego acumulado; o tráfego mostrado é a taxa no momento da última leitura. "Primeira vez" conta
        a partir de quando este painel começou a registrar.
      </p>
    </>
  );
}
