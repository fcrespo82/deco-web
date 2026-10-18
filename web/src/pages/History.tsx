import { useEffect, useMemo, useState } from "preact/hooks";
import { Clock } from "lucide-preact";
import { api, type AuditView, type EventView } from "../api";
import { KEYS, useAudit, useSamples } from "../data";
import { EVENT_LABEL, EVENT_TONE, ago, dateTime, eventDetail } from "../format";
import { useNow } from "../hooks";
import { useQuery } from "../lib/query";
import { LineChart } from "../LineChart";
import { Badge, Button, Card, Empty, FilterChips, Segmented, SectionTitle, Skeleton, TableCard } from "../ui";

const RANGES = [
  { hours: 24, label: "24 h" },
  { hours: 24 * 7, label: "7 dias" },
  { hours: 24 * 30, label: "30 dias" },
  { hours: 24 * 90, label: "90 dias" },
];

const TYPE_GROUPS: { label: string; types: string }[] = [
  { label: "Todos", types: "" },
  { label: "Dispositivos novos", types: "client_new" },
  { label: "Conexões", types: "client_connected,client_disconnected" },
  { label: "IP mudou", types: "client_ip_changed" },
  { label: "Nós", types: "node_offline,node_online" },
  { label: "Internet", types: "internet_down,internet_up" },
  { label: "Reservas", types: "reservation_added,reservation_removed,reservation_changed" },
];

/**
 * Eventos: a primeira página vem do cache e se atualiza sozinha a cada
 * leitura; "Carregar mais" acrescenta páginas antigas por baixo.
 */
function Events() {
  const now = useNow();
  const [types, setTypes] = useState("");
  const first = useQuery(KEYS.events(types), () => api.events({ type: types, limit: 100 }), ["snapshot", "reservations"]);
  const [older, setOlder] = useState<{ events: EventView[]; next: number | null } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => setOlder(null), [types]);

  const events = useMemo(() => {
    const all = [...(first.data?.events ?? []), ...(older?.events ?? [])];
    const seen = new Set<number>();
    return all.filter((e) => !seen.has(e.id) && seen.add(e.id));
  }, [first.data, older]);
  const next = older ? older.next : (first.data?.nextBefore ?? null);

  async function loadMore() {
    if (!next) return;
    setLoading(true);
    try {
      const res = await api.events({ type: types, before: next, limit: 100 });
      setOlder((prev) => ({ events: [...(prev?.events ?? []), ...res.events], next: res.nextBefore }));
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div class="mb-3">
        <FilterChips label="Filtrar eventos" value={types} onChange={setTypes} options={TYPE_GROUPS.map((g) => ({ value: g.types, label: g.label }))} />
      </div>
      {first.error && <p class="text-[13px] text-bad">{first.error.message}</p>}
      {!first.data ? (
        <Skeleton class="h-64" />
      ) : events.length === 0 ? (
        <Empty icon={<Clock />}>Nenhum evento registrado ainda.</Empty>
      ) : (
        <TableCard>
          <table class="rtable">
            <thead>
              <tr>
                <th>Quando</th>
                <th>Evento</th>
                <th>Dispositivo</th>
                <th>Detalhe</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id} class="animate-fade-in">
                  <td class="cell-primary whitespace-nowrap text-[12.5px]" title={dateTime(e.at)}>
                    <span class="text-fg">{dateTime(e.at)}</span> <span class="text-muted">· {ago(e.at, now)}</span>
                  </td>
                  <td data-label="Evento">
                    <Badge tone={EVENT_TONE[e.type] || ""}>{EVENT_LABEL[e.type] ?? e.type}</Badge>
                  </td>
                  <td data-label="Dispositivo">
                    {e.name ?? (e.mac ? <span class="font-mono text-[12.5px]">{e.mac}</span> : <span class="text-muted">rede</span>)}
                    {e.name && e.mac && <div class="font-mono text-[11.5px] text-muted">{e.mac}</div>}
                  </td>
                  <td data-label="Detalhe" class="font-mono text-[12.5px]">
                    {eventDetail(e.type, e.data)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableCard>
      )}
      {next && (
        <div class="mt-3 flex justify-center">
          <Button onClick={loadMore} loading={loading}>
            Carregar mais
          </Button>
        </div>
      )}
    </>
  );
}

const ACTION_LABEL: Record<string, string> = {
  "device.create": "Cadastrou dispositivo",
  "device.update": "Editou dispositivo",
  "device.delete": "Excluiu dispositivo",
  "device.attach_mac": "Agrupou MAC",
  "device.detach_mac": "Separou MAC",
  "range.create": "Criou faixa",
  "range.update": "Editou faixa",
  "range.delete": "Excluiu faixa",
  "breaker.reset": "Destravou acesso ao Deco",
  "reservation.add": "Criou reserva no Deco",
  "reservation.move": "Mudou IP reservado no Deco",
  "reservation.remove": "Removeu reserva do Deco",
  "reservation.batch": "Lote de reservas no Deco",
  "device.approve": "Aprovou dispositivos",
  "alerts.test": "Enviou alerta de teste",
  "backup.import": "Importou backup",
};

function describe(v: unknown): string {
  if (!v || typeof v !== "object") return "";
  const o = v as Record<string, unknown>;
  if (typeof o.mac === "string" && typeof o.ip === "string") return `${o.ip} · ${o.mac}`;
  return String(o.alias ?? o.name ?? o.mac ?? "");
}

/** Reservas: mostra a transição (antes → depois). */
function target(a: AuditView): string {
  if (a.action.startsWith("reservation.")) {
    const ip = (v: unknown) => (v && typeof v === "object" ? String((v as { ip?: string }).ip ?? "—") : "—");
    return `${a.target ?? ""}: ${ip(a.before)} → ${a.action === "reservation.remove" && a.result === "ok" ? "—" : ip(a.after)}`;
  }
  return describe(a.after) || describe(a.before) || a.target || "";
}

function Audit() {
  const { data } = useAudit();
  if (!data) return <Skeleton class="h-40" />;
  if (data.entries.length === 0) return <p class="text-muted">Nenhuma alteração registrada.</p>;
  return (
    <TableCard>
      <table class="rtable">
        <thead>
          <tr>
            <th>Quando</th>
            <th>Ação</th>
            <th>Alvo</th>
            <th>Quem</th>
          </tr>
        </thead>
        <tbody>
          {data.entries.map((a) => (
            <tr key={a.id}>
              <td class="cell-primary whitespace-nowrap text-[12.5px]">{dateTime(a.at)}</td>
              <td data-label="Ação">
                {ACTION_LABEL[a.action] ?? a.action}
                {a.result !== "ok" && (
                  <div class="mt-0.5">
                    <Badge tone="bad" title={a.result}>
                      {a.result.split(":")[0]}
                    </Badge>
                  </div>
                )}
              </td>
              <td data-label="Alvo" class={a.action.startsWith("reservation.") ? "font-mono text-[12.5px]" : ""}>
                {target(a)}
              </td>
              <td data-label="Quem" class="font-mono text-[12px] text-muted">
                {a.actor}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableCard>
  );
}

export function History() {
  const [hours, setHours] = useState(24);
  const { data: samples } = useSamples(hours);

  return (
    <>
      <SectionTitle actions={<Segmented label="Período" value={hours} onChange={setHours} options={RANGES.map((r) => ({ value: r.hours, label: r.label }))} />}>
        Clientes online
      </SectionTitle>
      <Card>
        {samples ? (
          <LineChart
            points={samples.points}
            from={samples.from}
            to={samples.to}
            bucketMs={samples.bucketMs}
            label={`Clientes online nas últimas ${RANGES.find((r) => r.hours === hours)?.label}`}
          />
        ) : (
          <Skeleton class="h-[220px]" />
        )}
      </Card>

      <SectionTitle>Eventos</SectionTitle>
      <Events />

      <SectionTitle>Alterações feitas no painel</SectionTitle>
      <Audit />
    </>
  );
}
