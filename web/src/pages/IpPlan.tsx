import { useState } from "preact/hooks";
import { api, ApiError, type CellStatus, type IpCell, type RangeSummary } from "../api";
import { INVENTORY_TYPE_LABEL } from "../format";
import { usePolled } from "../hooks";
import { Modal } from "../Modal";

/** Cores das faixas: ordem categórica fixa (validada); da 9ª em diante, cinza. */
const RANGE_SLOTS = 8;
const rangeColor = (index: number) => (index < RANGE_SLOTS ? `var(--series-${index + 1})` : "var(--series-other)");

const STATUS_LABEL: Record<CellStatus, string> = {
  network: "Endereço de rede",
  broadcast: "Broadcast",
  gateway: "Gateway (Deco principal)",
  node: "Nó do mesh",
  "reserved-online": "Reservado, em uso",
  reserved: "Reservado, offline",
  online: "Em uso (dinâmico)",
  recent: "Visto há pouco (lease pode valer)",
  free: "Livre",
};

const ANOMALY_LABEL: Record<string, string> = {
  "outside-plan": "Fora do plano",
  "dynamic-in-static": "Dinâmico em faixa fixa",
  "type-mismatch": "Tipo inesperado",
  "reservation-conflict": "Conflito de reserva",
  "reservation-not-applied": "Reserva não aplicada",
};

const LEGEND: CellStatus[] = ["reserved-online", "reserved", "online", "recent", "free", "node", "gateway"];

function RangeForm({ range, onClose }: { range: RangeSummary | null; onClose: (changed: boolean) => void }) {
  const [form, setForm] = useState({
    name: range?.name ?? "",
    spec: range?.label.replace("–", "-") ?? "",
    kind: range?.kind ?? "static",
    types: range?.types ?? [],
    notes: range?.notes ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: Event) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const input = { ...form, notes: form.notes || null };
      if (range) await api.updateRange(range.id, input);
      else await api.createRange(input);
      onClose(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao salvar.");
    } finally {
      setBusy(false);
    }
  }

  const toggleType = (t: string) =>
    setForm({ ...form, types: form.types.includes(t) ? form.types.filter((x) => x !== t) : [...form.types, t] });

  return (
    <Modal title={range ? `Faixa: ${range.name}` : "Nova faixa"} onClose={() => onClose(false)}>
      <form class="form" onSubmit={submit}>
        <div class="form-row">
          <label>
            Nome
            <input value={form.name} onInput={(e) => setForm({ ...form, name: (e.target as HTMLInputElement).value })} required maxLength={60} placeholder="ex.: Servidores" />
          </label>
          <label>
            Endereços
            <input value={form.spec} onInput={(e) => setForm({ ...form, spec: (e.target as HTMLInputElement).value })} required class="mono" placeholder=".20-.39" />
          </label>
        </div>
        <p class="muted small" style="margin:0">
          Formatos: <code>.8/29</code> (bloco), <code>.20-.39</code> (intervalo), <code>.100+</code> (até o fim), <code>.50</code> (um só).
        </p>
        <fieldset>
          <legend>Tipo</legend>
          <label class="check">
            <input type="radio" name="kind" checked={form.kind === "static"} onChange={() => setForm({ ...form, kind: "static" })} />
            Fixa — só por reserva (cliente dinâmico aqui é anomalia)
          </label>
          <label class="check">
            <input type="radio" name="kind" checked={form.kind === "dynamic"} onChange={() => setForm({ ...form, kind: "dynamic" })} />
            Dinâmica — onde o DHCP do Deco distribui endereços
          </label>
        </fieldset>
        <fieldset>
          <legend>Tipos de dispositivo esperados (opcional)</legend>
          <div class="chips">
            {Object.entries(INVENTORY_TYPE_LABEL).map(([t, label]) => (
              <label class="check chip-check">
                <input type="checkbox" checked={form.types.includes(t)} onChange={() => toggleType(t)} />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
        <label>
          Notas
          <input value={form.notes} onInput={(e) => setForm({ ...form, notes: (e.target as HTMLInputElement).value })} maxLength={500} />
        </label>
        {error && <div class="error">{error}</div>}
        <div class="form-actions">
          <span class="spacer" />
          <button type="button" class="btn" onClick={() => onClose(false)}>
            Cancelar
          </button>
          <button class="btn primary" disabled={busy}>
            Salvar
          </button>
        </div>
      </form>
    </Modal>
  );
}

function CellDetail({ cell, range }: { cell: IpCell; range: RangeSummary | undefined }) {
  return (
    <div class="card cell-detail" aria-live="polite">
      <div class="node-head">
        <span class="mono" style="font-weight:600">{cell.ip}</span>
        <span class="badge">{STATUS_LABEL[cell.status]}</span>
      </div>
      <dl class="kv">
        <dt>Faixa</dt>
        <dd>{range ? `${range.name} (${range.label})` : "fora do plano"}</dd>
        {cell.name && (
          <>
            <dt>Dispositivo</dt>
            <dd>{cell.name}</dd>
          </>
        )}
        {cell.mac && (
          <>
            <dt>MAC</dt>
            <dd class="mono">{cell.mac}</dd>
          </>
        )}
        {cell.anomalies.length > 0 && (
          <>
            <dt>Atenção</dt>
            <dd>{cell.anomalies.map((a) => ANOMALY_LABEL[a] ?? a).join(", ")}</dd>
          </>
        )}
      </dl>
    </div>
  );
}

export function IpPlan() {
  const { data, error, reload } = usePolled(api.ipPlan, 30_000);
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<RangeSummary | "new" | null>(null);

  if (!data) return <div class="empty">{error ? `Erro: ${error.message}` : "Carregando…"}</div>;

  const colorOf = new Map(data.ranges.map((r, i) => [r.id, rangeColor(i)]));
  const rangeOf = new Map(data.ranges.map((r) => [r.id, r]));
  const cell = data.cells.find((c) => c.ip === selected);

  async function remove(r: RangeSummary) {
    if (!confirm(`Excluir a faixa "${r.name}" (${r.label})? Não afeta o Deco, só o plano.`)) return;
    await api.deleteRange(r.id);
    await reload();
  }

  return (
    <>
      <div class="section-head">
        <h2>Faixas {data.network && <span class="muted">· rede {data.network.address}/{data.network.prefix}</span>}</h2>
        <button class="btn primary" onClick={() => setEditing("new")} disabled={!data.network}>
          Nova faixa
        </button>
      </div>
      {data.message && <div class="banner warn">{data.message}</div>}
      {data.ranges.length === 0 ? (
        <div class="card empty">
          Nenhuma faixa definida. Exemplo: <code>.8/29</code> Confiáveis, <code>.20-.39</code> Servidores, <code>.100+</code> IoT.
        </div>
      ) : (
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Faixa</th>
                <th>Endereços</th>
                <th>Tipo</th>
                <th>Uso</th>
                <th>Próximo livre</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.ranges.map((r) => (
                <tr key={r.id}>
                  <td class="primary-cell">
                    <span class="swatch" style={{ background: colorOf.get(r.id) }} />
                    <span class="client-name">{r.name}</span>
                    {r.types.length > 0 && (
                      <div class="muted small">espera: {r.types.map((t) => INVENTORY_TYPE_LABEL[t] ?? t).join(", ")}</div>
                    )}
                    {r.notes && <div class="muted small">{r.notes}</div>}
                  </td>
                  <td data-label="Endereços" class="mono">{r.label}</td>
                  <td data-label="Tipo">{r.kind === "static" ? "Fixa" : "Dinâmica"}</td>
                  <td data-label="Uso" class="num">
                    {r.reserved} reserv. · {r.inUse} em uso · {r.free} livres <span class="muted">/ {r.size}</span>
                  </td>
                  <td data-label="Próximo livre" class="mono">{r.suggestion ?? <span class="muted">cheia</span>}</td>
                  <td>
                    <div class="row-actions">
                      <button class="btn" onClick={() => setEditing(r)}>
                        Editar
                      </button>
                      <button class="btn" onClick={() => remove(r)} aria-label={`Excluir ${r.name}`}>
                        Excluir
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data.cells.length > 0 && (
        <>
          <h2>Mapa do /24</h2>
          <div class="ip-layout">
            <div>
              <div class="ip-grid" role="grid" aria-label="Endereços da rede">
                {data.cells.map((c) => {
                  const range = c.rangeId ? rangeOf.get(c.rangeId) : undefined;
                  const title = [c.ip, STATUS_LABEL[c.status], range && `${range.name} (${range.label})`, c.name, ...c.anomalies.map((a) => `⚠ ${ANOMALY_LABEL[a]}`)]
                    .filter(Boolean)
                    .join("\n");
                  return (
                    <button
                      key={c.ip}
                      class={`ip-cell s-${c.status}${c.anomalies.length ? " anomaly" : ""}${selected === c.ip ? " selected" : ""}`}
                      style={c.rangeId ? { "--range": colorOf.get(c.rangeId) } : undefined}
                      title={title}
                      aria-label={title.replace(/\n/g, ", ")}
                      onClick={() => setSelected(selected === c.ip ? null : c.ip)}
                    >
                      {c.octet}
                    </button>
                  );
                })}
              </div>
            </div>
            <aside class="ip-side">
              {cell ? (
                <CellDetail cell={cell} range={cell.rangeId ? rangeOf.get(cell.rangeId) : undefined} />
              ) : (
                <p class="muted small">Clique num endereço para ver detalhes.</p>
              )}
              <h4>Legenda</h4>
              <ul class="legend">
                {LEGEND.map((s) => (
                  <li>
                    <span class={`ip-cell s-${s} legend-cell`} aria-hidden="true" />
                    {STATUS_LABEL[s]}
                  </li>
                ))}
                <li>
                  <span class="ip-cell s-free anomaly legend-cell" aria-hidden="true" />
                  Anomalia
                </li>
                {data.ranges.map((r) => (
                  <li>
                    <span class="swatch" style={{ background: colorOf.get(r.id) }} />
                    {r.name} <span class="muted mono small">{r.label}</span>
                  </li>
                ))}
              </ul>
            </aside>
          </div>
        </>
      )}

      <h2>Anomalias ({data.anomalies.length})</h2>
      {data.anomalies.length === 0 ? (
        <p class="muted">Nada fora do esperado.</p>
      ) : (
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>IP</th>
                <th>Tipo</th>
                <th>Dispositivo</th>
                <th>Detalhe</th>
              </tr>
            </thead>
            <tbody>
              {data.anomalies.map((a) => (
                <tr>
                  <td class="primary-cell mono">
                    <button class="link mono" onClick={() => setSelected(a.ip)}>
                      {a.ip}
                    </button>
                  </td>
                  <td data-label="Tipo">
                    <span class="badge warn">⚠ {ANOMALY_LABEL[a.code] ?? a.code}</span>
                  </td>
                  <td data-label="Dispositivo">{a.name ?? <span class="muted">—</span>}</td>
                  <td data-label="Detalhe" class="small">{a.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p class="muted small">
        A faixa e o DNS do DHCP do Deco só podem ser alterados pelo app; este plano é documentação + verificação. "Em
        uso" vem da lista de clientes; o Deco não expõe a tabela de leases pela API local.
      </p>

      {editing && (
        <RangeForm
          range={editing === "new" ? null : editing}
          onClose={(changed) => {
            setEditing(null);
            if (changed) void reload();
          }}
        />
      )}
    </>
  );
}
