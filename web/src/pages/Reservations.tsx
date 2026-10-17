import { useMemo, useState } from "preact/hooks";
import { api, type ClientView } from "../api";
import { INVENTORY_TYPE_LABEL, ago, deviceType } from "../format";
import { usePolled } from "../hooks";
import { ReservationDialog } from "../ReservationDialog";

const label = (c: ClientView) => c.device?.alias ?? c.name;
const ipKey = (ip: string) => ip.split(".").reduce((acc, part) => acc * 256 + Number(part), 0);

type Editing = { client: ClientView; mode: "edit" | "remove" };

function State({ c }: { c: ClientView }) {
  if (!c.online) {
    return <span class="muted">{c.lastSeen ? `offline · visto ${ago(c.lastSeen)}` : "nunca visto por este painel"}</span>;
  }
  if (c.reservation?.matchesCurrentIp === false) {
    return (
      <span class="badge warn" title="A reserva vale na próxima renovação do DHCP">
        usando {c.ip} — aguardando renovação
      </span>
    );
  }
  return <span class="badge ok">em uso</span>;
}

/** Escolhe um cliente sem reserva para fixar o IP. */
function PickClient({ onPick, onCancel }: { onPick: (c: ClientView) => void; onCancel: () => void }) {
  const { data } = usePolled(api.clients, 60_000);
  const [q, setQ] = useState("");
  const options = useMemo(
    () =>
      (data?.clients ?? [])
        .filter((c) => !c.reservation && c.online)
        .filter((c) => !q || [label(c), c.mac, c.ip].join(" ").toLowerCase().includes(q.toLowerCase())),
    [data, q],
  );
  return (
    <div class="card">
      <div class="section-head">
        <h3 style="margin:0">Fixar IP de qual aparelho?</h3>
        <button class="btn" onClick={onCancel}>
          Cancelar
        </button>
      </div>
      <input type="search" placeholder="Buscar nome, MAC, IP…" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} aria-label="Buscar aparelho" autofocus />
      <ul class="pick-list">
        {options.map((c) => (
          <li>
            <button class="link" onClick={() => onPick(c)}>
              {label(c)}
            </button>{" "}
            <span class="muted small mono">
              {c.ip} · {c.mac}
            </span>
          </li>
        ))}
        {data && options.length === 0 && <li class="muted">Nenhum aparelho online sem reserva.</li>}
      </ul>
    </div>
  );
}

export function Reservations() {
  const { data, error, reload } = usePolled(api.reservations, 30_000);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [picking, setPicking] = useState(false);

  const rows = useMemo(
    () => [...(data?.clients ?? [])].sort((a, b) => ipKey(a.reservation!.ip) - ipKey(b.reservation!.ip)),
    [data],
  );

  if (!data) return <div class="empty">{error ? `Erro: ${error.message}` : "Carregando…"}</div>;

  return (
    <>
      <div class="section-head">
        <h2>
          Reservas de DHCP{" "}
          <span class="muted">
            · {data.used}
            {data.max ? ` de ${data.max}` : ""}
          </span>
        </h2>
        {data.allowWrite && !picking && (
          <button class="btn primary" onClick={() => setPicking(true)}>
            Nova reserva
          </button>
        )}
      </div>
      {!data.allowWrite && (
        <div class="banner">
          Somente leitura. Para criar, mudar ou remover reservas, inicie o painel com <code>DECO_ALLOW_WRITE=1</code>.
        </div>
      )}
      {picking && (
        <PickClient
          onCancel={() => setPicking(false)}
          onPick={(c) => {
            setPicking(false);
            setEditing({ client: c, mode: "edit" });
          }}
        />
      )}

      {rows.length === 0 ? (
        <div class="card empty">Nenhuma reserva no Deco.</div>
      ) : (
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>IP reservado</th>
                <th>Aparelho</th>
                <th>MAC</th>
                <th>Estado</th>
                {data.allowWrite && <th />}
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.mac} class={c.online ? "" : "offline"}>
                  <td class="primary-cell mono">{c.reservation!.ip}</td>
                  <td data-label="Aparelho">
                    {label(c)}
                    <div class="muted small">{c.device?.type ? INVENTORY_TYPE_LABEL[c.device.type] : deviceType(c.deviceType)}</div>
                  </td>
                  <td data-label="MAC" class="mono">{c.mac}</td>
                  <td data-label="Estado">
                    <State c={c} />
                  </td>
                  {data.allowWrite && (
                    <td>
                      <div class="row-actions">
                        <button class="btn" onClick={() => setEditing({ client: c, mode: "edit" })}>
                          Mudar IP
                        </button>
                        <button class="btn danger" onClick={() => setEditing({ client: c, mode: "remove" })} aria-label={`Remover reserva de ${label(c)}`}>
                          Remover
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p class="muted small">
        Cada alteração abre uma sessão própria no Deco (login, conferência, escrita, releitura, logout) e fica registrada
        na auditoria, em Histórico. Enquanto ela roda, o app do Deco no celular pode ser desconectado.
      </p>

      {editing && (
        <ReservationDialog
          mac={editing.client.mac}
          name={label(editing.client)}
          current={editing.client.reservation?.ip ?? null}
          currentIp={editing.client.online ? editing.client.ip : null}
          mode={editing.mode}
          onClose={(changed) => {
            setEditing(null);
            if (changed) void reload();
          }}
        />
      )}
    </>
  );
}
