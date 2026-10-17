import { useMemo, useState } from "preact/hooks";
import { api, type DeviceMacView, type DeviceView } from "../api";
import { DeviceEditor } from "../DeviceEditor";
import { BAND_LABEL, INVENTORY_TYPE_LABEL, ago } from "../format";
import { usePolled } from "../hooks";

function MacLine({ m }: { m: DeviceMacView }) {
  return (
    <div class="mac-line">
      <span class={`dot ${m.online ? "ok" : ""}`} aria-label={m.online ? "online" : "offline"} />
      <span class="mono">{m.mac}</span>
      <span class="muted small">
        {[m.ip, m.band && BAND_LABEL[m.band], m.nodeName, !m.online && m.lastSeen ? `visto ${ago(m.lastSeen)}` : null]
          .filter(Boolean)
          .join(" · ")}
      </span>
    </div>
  );
}

type Editing = { deviceId: number } | { mac: string; name?: string };

export function Inventory() {
  const { data, error, reload } = usePolled(api.inventory, 30_000);
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [editing, setEditing] = useState<Editing | null>(null);

  const devices = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (data?.devices ?? []).filter((d: DeviceView) => {
      if (type && d.type !== type) return false;
      if (!needle) return true;
      return [d.alias, d.owner, d.notes, ...d.tags, ...d.macs.flatMap((m) => [m.mac, m.ip, m.decoName])]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(needle.replace(/:/g, "-"));
    });
  }, [data, q, type]);

  if (!data) return <div class="empty">{error ? `Erro: ${error.message}` : "Carregando…"}</div>;

  return (
    <>
      <div class="filters">
        <input type="search" placeholder="Buscar apelido, dono, tag, MAC…" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} aria-label="Buscar" />
        <select value={type} onChange={(e) => setType((e.target as HTMLSelectElement).value)} aria-label="Tipo">
          <option value="">Todos os tipos</option>
          {data.deviceTypes.map((t) => (
            <option value={t}>{INVENTORY_TYPE_LABEL[t] ?? t}</option>
          ))}
        </select>
      </div>

      <h2>Dispositivos cadastrados ({data.devices.length})</h2>
      {data.devices.length === 0 ? (
        <div class="card empty">
          Nada cadastrado ainda. Use "Cadastrar" na lista abaixo ou clique num nome na tela de Clientes.
        </div>
      ) : (
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Dispositivo</th>
                <th>Dono</th>
                <th>MACs</th>
                <th>Tags</th>
                <th>Notas</th>
              </tr>
            </thead>
            <tbody>
              {devices.map((d) => (
                <tr key={d.id} class={d.online ? "" : "offline"}>
                  <td class="primary-cell">
                    <span class={`dot ${d.online ? "ok" : ""}`} style="margin-right:6px" />
                    <button class="link client-name" onClick={() => setEditing({ deviceId: d.id })}>
                      {d.alias}
                    </button>
                    <div class="muted small">
                      {[d.type && INVENTORY_TYPE_LABEL[d.type], d.approved ? null : "não aprovado"].filter(Boolean).join(" · ")}
                    </div>
                  </td>
                  <td data-label="Dono">{d.owner ?? <span class="muted">—</span>}</td>
                  <td data-label="MACs">
                    <div>
                      {d.macs.map((m) => (
                        <MacLine m={m} />
                      ))}
                    </div>
                  </td>
                  <td data-label="Tags">
                    <div class="chips">
                      {d.tags.map((t) => (
                        <span class="badge">{t}</span>
                      ))}
                    </div>
                  </td>
                  <td data-label="Notas" class="small notes-cell">
                    {d.notes ?? ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {devices.length === 0 && <div class="empty">Nenhum dispositivo com esses filtros.</div>}
        </div>
      )}

      <h2>Sem cadastro ({data.unassigned.length})</h2>
      {data.unassigned.length === 0 ? (
        <p class="muted">Todos os MACs vistos estão cadastrados.</p>
      ) : (
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Nome no Deco</th>
                <th>MAC</th>
                <th>Último estado</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.unassigned.map((m) => (
                <tr key={m.mac} class={m.online ? "" : "offline"}>
                  <td class="primary-cell">
                    <span class={`dot ${m.online ? "ok" : ""}`} style="margin-right:6px" />
                    {m.decoName ?? <span class="muted">sem nome</span>}
                  </td>
                  <td data-label="MAC" class="mono">{m.mac}</td>
                  <td data-label="Estado" class="small">
                    {[m.ip, m.band && BAND_LABEL[m.band], m.nodeName, m.online ? "online" : m.lastSeen ? `visto ${ago(m.lastSeen)}` : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </td>
                  <td>
                    <button class="btn" onClick={() => setEditing({ mac: m.mac, name: m.decoName ?? undefined })}>
                      Cadastrar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <DeviceEditor
          {...("deviceId" in editing ? { deviceId: editing.deviceId } : { mac: editing.mac, suggestedName: editing.name })}
          onClose={(changed) => {
            setEditing(null);
            if (changed) void reload();
          }}
        />
      )}
    </>
  );
}
