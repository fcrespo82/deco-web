/**
 * Backup: exportar em JSON e importar com pré-visualização. A importação é
 * mesclagem — acrescenta e atualiza, nunca apaga o que só existe aqui.
 */
import { useState } from "preact/hooks";
import { api, ApiError, type BackupDiff, type ImportResult } from "../api";
import { INVENTORY_TYPE_LABEL, dateTime } from "../format";
import { Modal } from "../Modal";

type Sections = { devices: boolean; ranges: boolean; reservations: boolean };

const FIELD_LABEL: Record<string, string> = {
  alias: "apelido",
  owner: "dono",
  type: "tipo",
  tags: "tags",
  notes: "notas",
  approved: "aprovado",
  macs: "MACs",
  merge: "junta",
  spec: "endereços",
  kind: "tipo de faixa",
  types: "tipos esperados",
};

function show(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (Array.isArray(v)) return v.length ? v.map((x) => INVENTORY_TYPE_LABEL[String(x)] ?? String(x)).join(", ") : "—";
  if (typeof v === "boolean") return v ? "sim" : "não";
  if (v === "static") return "fixa";
  if (v === "dynamic") return "dinâmica";
  return INVENTORY_TYPE_LABEL[String(v)] ?? String(v);
}

function Changes({ changes }: { changes: { field: string; from: unknown; to: unknown }[] }) {
  if (!changes.length) return null;
  return (
    <ul class="diff-fields">
      {changes.map((c) => (
        <li>
          <span class="muted">{FIELD_LABEL[c.field] ?? c.field}:</span> <del>{show(c.from)}</del> → <ins>{show(c.to)}</ins>
        </li>
      ))}
    </ul>
  );
}

const ACTION: Record<string, { label: string; tone: string }> = {
  add: { label: "novo", tone: "ok" },
  update: { label: "altera", tone: "warn" },
  move: { label: "muda IP", tone: "warn" },
  conflict: { label: "conflito", tone: "bad" },
};
const Action = ({ a }: { a: string }) => <span class={`badge ${ACTION[a]?.tone ?? ""}`}>{ACTION[a]?.label ?? a}</span>;

function Summary({ unchanged, localOnly, what }: { unchanged: number; localOnly: number; what: string }) {
  return (
    <p class="muted small" style="margin:6px 0 0">
      {unchanged} iguais · {localOnly} {what} só neste painel (mantidos)
    </p>
  );
}

function Preview({ diff, sections, setSections }: { diff: BackupDiff; sections: Sections; setSections: (s: Sections) => void }) {
  const toggle = (k: keyof Sections) => setSections({ ...sections, [k]: !sections[k] });
  const resApplicable = diff.reservations.changes.filter((c) => c.action !== "conflict").length;
  return (
    <>
      <p class="muted small">
        Backup de {dateTime(diff.exportedAt)}
        {diff.network.backup ? ` · rede ${diff.network.backup}` : ""}
        {!diff.network.matches && <strong class="error"> — diferente desta rede ({diff.network.current})</strong>}
      </p>

      <section class="card diff-section">
        <label class="check">
          <input type="checkbox" checked={sections.devices} onChange={() => toggle("devices")} disabled={!diff.devices.changes.length} />
          <strong>Inventário</strong> <span class="muted">· {diff.devices.changes.length} mudança(s) · só neste painel</span>
        </label>
        {diff.devices.changes.length > 0 && (
          <ul class="diff-list">
            {diff.devices.changes.map((d) => (
              <li>
                <Action a={d.action} /> {d.alias} <span class="muted small mono">{d.macs.join(", ")}</span>
                <Changes changes={d.changes} />
              </li>
            ))}
          </ul>
        )}
        <Summary unchanged={diff.devices.unchanged} localOnly={diff.devices.localOnly} what="dispositivos" />
      </section>

      <section class="card diff-section">
        <label class="check">
          <input
            type="checkbox"
            checked={sections.ranges}
            onChange={() => toggle("ranges")}
            disabled={!diff.ranges.changes.some((r) => r.action !== "conflict")}
          />
          <strong>Plano de IPs</strong> <span class="muted">· {diff.ranges.changes.length} mudança(s) · só neste painel</span>
        </label>
        {diff.ranges.changes.length > 0 && (
          <ul class="diff-list">
            {diff.ranges.changes.map((r) => (
              <li>
                <Action a={r.action} /> {r.name} <span class="mono small">{r.label}</span>
                {r.reason && <span class="error small"> — {r.reason}; será pulada</span>}
                <Changes changes={r.changes} />
              </li>
            ))}
          </ul>
        )}
        <Summary unchanged={diff.ranges.unchanged} localOnly={diff.ranges.localOnly} what="faixas" />
      </section>

      <section class="card diff-section">
        <label class="check">
          <input
            type="checkbox"
            checked={sections.reservations}
            onChange={() => toggle("reservations")}
            disabled={Boolean(diff.reservations.blocked) || resApplicable === 0}
          />
          <strong>Reservas de DHCP</strong> <span class="muted">· {diff.reservations.changes.length} mudança(s) · altera o Deco</span>
        </label>
        {diff.reservations.blocked && resApplicable > 0 && <div class="banner warn" style="margin:8px 0 0">{diff.reservations.blocked}</div>}
        {diff.reservations.changes.length > 0 && (
          <ul class="diff-list">
            {diff.reservations.changes.map((r) => (
              <li>
                <Action a={r.action} /> {r.name ?? <span class="mono">{r.mac}</span>}{" "}
                <span class="mono small">
                  {r.from ?? "sem reserva"} → {r.to}
                </span>
                {r.reason && <span class="error small"> — {r.reason}; será pulada</span>}
              </li>
            ))}
          </ul>
        )}
        <p class="muted small" style="margin:6px 0 0">
          {diff.reservations.unchanged} iguais · {diff.reservations.localOnly} só no Deco (mantidas — a importação não remove reservas)
        </p>
      </section>
    </>
  );
}

function Results({ r }: { r: ImportResult }) {
  return (
    <div class="card">
      <h3 style="margin:0 0 8px">Importação concluída</h3>
      <dl class="kv" style="margin-top:0">
        <dt>Inventário</dt>
        <dd>
          {r.devices.added} novo(s), {r.devices.updated} atualizado(s)
        </dd>
        <dt>Plano de IPs</dt>
        <dd>
          {r.ranges.added} nova(s), {r.ranges.updated} atualizada(s)
          {r.ranges.skipped ? `, ${r.ranges.skipped} pulada(s)` : ""}
        </dd>
        <dt>Reservas</dt>
        <dd>{r.reservations.length === 0 ? "nenhuma alteração" : `${r.reservations.filter((x) => x.outcome === "applied").length} de ${r.reservations.length} aplicada(s)`}</dd>
      </dl>
      {r.reservations.some((x) => x.outcome !== "applied") && (
        <ul class="diff-list">
          {r.reservations
            .filter((x) => x.outcome !== "applied")
            .map((x) => (
              <li>
                <span class="badge bad">{x.outcome}</span> <span class="mono small">{x.mac}</span> {x.message}
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}

export function Backup() {
  const [exporting, setExporting] = useState(false);
  const [file, setFile] = useState<{ name: string; backup: unknown } | null>(null);
  const [diff, setDiff] = useState<BackupDiff | null>(null);
  const [sections, setSections] = useState<Sections>({ devices: true, ranges: true, reservations: false });
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  async function download() {
    setExporting(true);
    setError(null);
    try {
      const backup = await api.exportBackup();
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `deco-web-backup-${backup.exportedAt.slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao exportar.");
    } finally {
      setExporting(false);
    }
  }

  async function pick(e: Event) {
    const input = e.target as HTMLInputElement;
    const f = input.files?.[0];
    input.value = "";
    if (!f) return;
    setError(null);
    setDiff(null);
    setResult(null);
    try {
      if (f.size > 900_000) throw new Error("Arquivo grande demais para um backup do painel.");
      const backup = JSON.parse(await f.text()) as unknown;
      const d = await api.previewBackup(backup);
      setFile({ name: f.name, backup });
      setDiff(d);
      setSections({
        devices: d.devices.changes.length > 0,
        ranges: d.ranges.changes.some((r) => r.action !== "conflict"),
        reservations: false, // altera o Deco: só se marcar
      });
    } catch (err) {
      setFile(null);
      setError(err instanceof SyntaxError ? "O arquivo não é um JSON válido." : err instanceof Error ? err.message : "Falha ao ler.");
    }
  }

  async function apply() {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      setResult(await api.importBackup(file.backup, sections));
      setDiff(null);
      setFile(null);
      setConfirming(false);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Falha ao importar.");
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  const resCount = diff ? diff.reservations.changes.filter((c) => c.action !== "conflict").length : 0;
  const anySection = sections.devices || sections.ranges || sections.reservations;

  return (
    <>
      <div class="grid cols-2">
        <div class="card">
          <h3 style="margin:0 0 6px">Exportar</h3>
          <p class="muted small" style="margin:0 0 10px">
            Reservas do Deco, inventário e plano de IPs, em JSON. Não inclui senhas, PSK do Wi-Fi nem histórico.
          </p>
          <button class="btn primary" onClick={download} disabled={exporting}>
            {exporting ? "Gerando…" : "Baixar backup"}
          </button>
        </div>
        <div class="card">
          <h3 style="margin:0 0 6px">Importar</h3>
          <p class="muted small" style="margin:0 0 10px">
            Mostra o que muda antes de aplicar. Acrescenta e atualiza; nunca apaga o que só existe aqui.
          </p>
          <label class="btn file-btn">
            Escolher arquivo…
            <input type="file" accept="application/json,.json" onChange={pick} />
          </label>
          {file && <span class="muted small" style="margin-left:8px">{file.name}</span>}
        </div>
      </div>
      {error && <div class="banner bad" style="margin-top:12px">{error}</div>}
      {result && <Results r={result} />}

      {diff && (
        <>
          <h2>O que muda</h2>
          <Preview diff={diff} sections={sections} setSections={setSections} />
          <div class="form-actions" style="margin-top:12px">
            <span class="spacer" />
            <button class="btn" onClick={() => (setDiff(null), setFile(null))}>
              Cancelar
            </button>
            <button class="btn primary" disabled={!anySection} onClick={() => setConfirming(true)}>
              Aplicar selecionados…
            </button>
          </div>
        </>
      )}

      {confirming && diff && (
        <Modal title="Confirmar importação" onClose={() => !busy && setConfirming(false)}>
          <div class="form">
            <ul class="diff-list" style="margin:0">
              {sections.devices && <li>Inventário: {diff.devices.changes.length} mudança(s)</li>}
              {sections.ranges && (
                <li>Plano de IPs: {diff.ranges.changes.filter((r) => r.action !== "conflict").length} mudança(s)</li>
              )}
              {sections.reservations && (
                <li>
                  <strong>Reservas no Deco: {resCount} mudança(s)</strong>, numa sessão só. Pode levar {Math.round(15 + resCount)} s ou
                  mais; o app do Deco pode ser desconectado nesse tempo.
                </li>
              )}
            </ul>
            {sections.reservations && <div class="banner warn">Isto altera o Deco.</div>}
            <div class="form-actions">
              {busy && (
                <span class="muted small" role="status">
                  Aplicando…
                </span>
              )}
              <span class="spacer" />
              <button class="btn" onClick={() => setConfirming(false)} disabled={busy}>
                Voltar
              </button>
              <button class="btn primary" onClick={apply} disabled={busy}>
                {sections.reservations ? "Aplicar e gravar no Deco" : "Aplicar"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
