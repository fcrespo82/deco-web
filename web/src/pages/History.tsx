import { useEffect, useState } from "preact/hooks";
import { api, type AuditView, type EventView } from "../api";
import { EVENT_LABEL, EVENT_TONE, ago, dateTime, eventDetail } from "../format";
import { usePolled } from "../hooks";
import { LineChart } from "../LineChart";

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

function Events() {
  const [types, setTypes] = useState("");
  const [events, setEvents] = useState<EventView[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load(before?: number) {
    try {
      const res = await api.events({ type: types, before, limit: 100 });
      setEvents((prev) => (before ? [...prev, ...res.events] : res.events));
      setNext(res.nextBefore);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    void load();
    const id = setInterval(() => document.visibilityState === "visible" && void load(), 30_000);
    return () => clearInterval(id);
  }, [types]);

  return (
    <>
      <div class="filters" role="group" aria-label="Filtrar eventos">
        {TYPE_GROUPS.map((g) => (
          <button class={`btn ${types === g.types ? "primary" : ""}`} aria-pressed={types === g.types} onClick={() => setTypes(g.types)}>
            {g.label}
          </button>
        ))}
      </div>
      {error && <div class="error">{error}</div>}
      {events.length === 0 ? (
        <div class="card empty">Nenhum evento registrado ainda.</div>
      ) : (
        <div class="table-wrap">
          <table>
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
                <tr key={e.id}>
                  <td class="primary-cell small nowrap" title={dateTime(e.at)}>
                    {dateTime(e.at)} <span class="muted">· {ago(e.at)}</span>
                  </td>
                  <td data-label="Evento">
                    <span class={`badge ${EVENT_TONE[e.type] ?? ""}`}>{EVENT_LABEL[e.type] ?? e.type}</span>
                  </td>
                  <td data-label="Dispositivo">
                    {e.name ?? (e.mac ? <span class="mono">{e.mac}</span> : <span class="muted">rede</span>)}
                    {e.name && e.mac && <div class="muted small mono">{e.mac}</div>}
                  </td>
                  <td data-label="Detalhe" class="mono small">{eventDetail(e.type, e.data)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {next && (
        <p>
          <button class="btn" onClick={() => load(next)}>
            Carregar mais
          </button>
        </p>
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
  const [entries, setEntries] = useState<AuditView[] | null>(null);
  useEffect(() => {
    api.audit({ limit: 50 }).then((r) => setEntries(r.entries), () => setEntries([]));
  }, []);
  if (!entries) return null;
  if (entries.length === 0) return <p class="muted">Nenhuma alteração registrada.</p>;
  return (
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Quando</th>
            <th>Ação</th>
            <th>Alvo</th>
            <th>Quem</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((a) => (
            <tr>
              <td class="primary-cell small nowrap">{dateTime(a.at)}</td>
              <td data-label="Ação">
                {ACTION_LABEL[a.action] ?? a.action}
                {a.result !== "ok" && (
                  <div>
                    <span class="badge bad" title={a.result}>
                      {a.result.split(":")[0]}
                    </span>
                  </div>
                )}
              </td>
              <td data-label="Alvo" class={a.action.startsWith("reservation.") ? "mono small" : ""}>
                {target(a)}
              </td>
              <td data-label="Quem" class="mono small">{a.actor}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function History() {
  const [hours, setHours] = useState(24);
  const { data: samples, reload } = usePolled(() => api.samples(hours), 60_000);
  useEffect(() => {
    void reload();
  }, [hours]);

  return (
    <>
      <div class="section-head">
        <h2>Clientes online</h2>
        <div class="segmented" role="group" aria-label="Período">
          {RANGES.map((r) => (
            <button class={hours === r.hours ? "on" : ""} aria-pressed={hours === r.hours} onClick={() => setHours(r.hours)}>
              {r.label}
            </button>
          ))}
        </div>
      </div>
      <div class="card">
        {samples ? (
          <LineChart
            points={samples.points}
            from={samples.from}
            to={samples.to}
            bucketMs={samples.bucketMs}
            label={`Clientes online nas últimas ${RANGES.find((r) => r.hours === hours)?.label}`}
          />
        ) : (
          <div class="empty">Carregando…</div>
        )}
      </div>

      <h2>Eventos</h2>
      <Events />

      <h2>Alterações feitas no painel</h2>
      <Audit />
    </>
  );
}
