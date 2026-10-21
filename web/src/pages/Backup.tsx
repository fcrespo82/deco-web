/**
 * Backup: exportar em JSON e importar com pré-visualização. A importação é
 * mesclagem — acrescenta e atualiza, nunca apaga o que só existe aqui.
 */
import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { Download, FileUp } from "lucide-preact";
import { api, type BackupDiff, type ImportResult } from "../api";
import { INVENTORY_TYPE_LABEL, dateTime } from "../format";
import { errorText } from "../lib/mutate";
import { toast } from "../lib/toast";
import { Badge, Banner, Button, Card, Check, Dialog, Kv, SectionTitle, type Tone } from "../ui";

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
    <ul class="ml-1 mt-1 list-disc pl-4 text-[12.5px]">
      {changes.map((c) => (
        <li>
          <span class="text-muted">{FIELD_LABEL[c.field] ?? c.field}:</span> <del class="text-bad">{show(c.from)}</del> → <ins class="text-ok no-underline">{show(c.to)}</ins>
        </li>
      ))}
    </ul>
  );
}

const ACTION: Record<string, { label: string; tone: Tone }> = {
  add: { label: "novo", tone: "ok" },
  update: { label: "altera", tone: "warn" },
  move: { label: "muda IP", tone: "warn" },
  conflict: { label: "conflito", tone: "bad" },
};
const Action = ({ a }: { a: string }) => <Badge tone={ACTION[a]?.tone ?? ""}>{ACTION[a]?.label ?? a}</Badge>;

function Summary({ unchanged, localOnly, what }: { unchanged: number; localOnly: number; what: string }) {
  return (
    <p class="mt-2 text-[12.5px] text-muted">
      {unchanged} iguais · {localOnly} {what} só neste painel (mantidos)
    </p>
  );
}

function Section({ checked, onToggle, disabled, title, meta, children }: { checked: boolean; onToggle: () => void; disabled: boolean; title: string; meta: string; children: ComponentChildren }) {
  return (
    <Card class={checked ? "border-accent/50" : ""}>
      <Check checked={checked} onChange={onToggle} disabled={disabled}>
        <strong class="font-semibold">{title}</strong> <span class="text-muted">· {meta}</span>
      </Check>
      {children}
    </Card>
  );
}

function Preview({ diff, sections, setSections }: { diff: BackupDiff; sections: Sections; setSections: (s: Sections) => void }) {
  const toggle = (k: keyof Sections) => setSections({ ...sections, [k]: !sections[k] });
  const resApplicable = diff.reservations.changes.filter((c) => c.action !== "conflict").length;
  return (
    <div class="grid gap-3">
      <p class="text-[12.5px] text-muted">
        Backup de {dateTime(diff.exportedAt)}
        {diff.network.backup ? ` · rede ${diff.network.backup}` : ""}
        {!diff.network.matches && <strong class="text-bad"> — diferente desta rede ({diff.network.current})</strong>}
      </p>

      <Section checked={sections.devices} onToggle={() => toggle("devices")} disabled={!diff.devices.changes.length} title="Inventário" meta={`${diff.devices.changes.length} mudança(s) · só neste painel`}>
        {diff.devices.changes.length > 0 && (
          <ul class="mt-3 grid gap-2 text-[13.5px]">
            {diff.devices.changes.map((d) => (
              <li>
                <Action a={d.action} /> {d.alias} <span class="font-mono text-[12px] text-muted">{d.macs.join(", ")}</span>
                <Changes changes={d.changes} />
              </li>
            ))}
          </ul>
        )}
        <Summary unchanged={diff.devices.unchanged} localOnly={diff.devices.localOnly} what="dispositivos" />
      </Section>

      <Section
        checked={sections.ranges}
        onToggle={() => toggle("ranges")}
        disabled={!diff.ranges.changes.some((r) => r.action !== "conflict")}
        title="Plano de IPs"
        meta={`${diff.ranges.changes.length} mudança(s) · só neste painel`}
      >
        {diff.ranges.changes.length > 0 && (
          <ul class="mt-3 grid gap-2 text-[13.5px]">
            {diff.ranges.changes.map((r) => (
              <li>
                <Action a={r.action} /> {r.name} <span class="font-mono text-[12px]">{r.label}</span>
                {r.reason && <span class="text-[12.5px] text-bad"> — {r.reason}; será pulada</span>}
                <Changes changes={r.changes} />
              </li>
            ))}
          </ul>
        )}
        <Summary unchanged={diff.ranges.unchanged} localOnly={diff.ranges.localOnly} what="faixas" />
      </Section>

      <Section
        checked={sections.reservations}
        onToggle={() => toggle("reservations")}
        disabled={Boolean(diff.reservations.blocked) || resApplicable === 0}
        title="Reservas de DHCP"
        meta={`${diff.reservations.changes.length} mudança(s) · altera o Deco`}
      >
        {diff.reservations.blocked && resApplicable > 0 && (
          <div class="mt-3">
            <Banner tone="warn">{diff.reservations.blocked}</Banner>
          </div>
        )}
        {diff.reservations.changes.length > 0 && (
          <ul class="mt-3 grid gap-2 text-[13.5px]">
            {diff.reservations.changes.map((r) => (
              <li>
                <Action a={r.action} /> {r.name ?? <span class="font-mono">{r.mac}</span>}{" "}
                <span class="font-mono text-[12px]">
                  {r.from ?? "sem reserva"} → {r.to}
                </span>
                {r.reason && <span class="text-[12.5px] text-bad"> — {r.reason}; será pulada</span>}
              </li>
            ))}
          </ul>
        )}
        <p class="mt-2 text-[12.5px] text-muted">
          {diff.reservations.unchanged} iguais · {diff.reservations.localOnly} só no Deco (mantidas — a importação não remove reservas)
        </p>
      </Section>
    </div>
  );
}

function Results({ r }: { r: ImportResult }) {
  return (
    <Card class="mt-4">
      <h3 class="mb-3 font-semibold">Importação concluída</h3>
      <Kv
        items={[
          ["Inventário", `${r.devices.added} novo(s), ${r.devices.updated} atualizado(s)`],
          ["Plano de IPs", `${r.ranges.added} nova(s), ${r.ranges.updated} atualizada(s)${r.ranges.skipped ? `, ${r.ranges.skipped} pulada(s)` : ""}`],
          [
            "Reservas",
            r.reservations.length === 0 ? "nenhuma alteração" : `${r.reservations.filter((x) => x.outcome === "applied").length} de ${r.reservations.length} aplicada(s)`,
          ],
        ]}
      />
      {r.reservations.some((x) => x.outcome !== "applied") && (
        <ul class="mt-3 grid gap-1.5 text-[13px]">
          {r.reservations
            .filter((x) => x.outcome !== "applied")
            .map((x) => (
              <li>
                <Badge tone="bad">{x.outcome}</Badge> <span class="font-mono text-[12px]">{x.mac}</span> {x.message}
              </li>
            ))}
        </ul>
      )}
    </Card>
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
      toast("Backup baixado");
    } catch (e) {
      setError(errorText(e, "Falha ao exportar."));
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
      setError(err instanceof SyntaxError ? "O arquivo não é um JSON válido." : errorText(err, "Falha ao ler."));
    }
  }

  async function apply() {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      setResult(await api.importBackup(file.backup, sections));
      toast("Backup importado");
      setDiff(null);
      setFile(null);
      setConfirming(false);
    } catch (e) {
      setError(errorText(e, "Falha ao importar."));
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  const resCount = diff ? diff.reservations.changes.filter((c) => c.action !== "conflict").length : 0;
  const anySection = sections.devices || sections.ranges || sections.reservations;

  return (
    <>
      <div class="grid gap-3 md:grid-cols-2">
        <Card>
          <div class="mb-1 flex items-center gap-2 font-semibold">
            <Download class="size-4 text-muted" /> Exportar
          </div>
          <p class="mb-4 text-[12.5px] text-muted">Reservas do Deco, inventário e plano de IPs, em JSON. Não inclui senhas, PSK do Wi-Fi nem histórico.</p>
          <Button variant="primary" onClick={download} loading={exporting}>
            {exporting ? "Gerando…" : "Baixar backup"}
          </Button>
        </Card>
        <Card>
          <div class="mb-1 flex items-center gap-2 font-semibold">
            <FileUp class="size-4 text-muted" /> Importar
          </div>
          <p class="mb-4 text-[12.5px] text-muted">Mostra o que muda antes de aplicar. Acrescenta e atualiza; nunca apaga o que só existe aqui.</p>
          <div class="flex flex-wrap items-center gap-3">
            <label class="relative inline-flex h-9 cursor-pointer items-center rounded-lg border border-line bg-surface px-3.5 text-[13.5px] font-medium shadow-card transition hover:bg-surface-2 focus-within:ring-2 focus-within:ring-accent">
              Escolher arquivo…
              <input type="file" accept="application/json,.json" onChange={pick} class="absolute inset-0 cursor-pointer opacity-0" />
            </label>
            {file && <span class="truncate text-[12.5px] text-muted">{file.name}</span>}
          </div>
        </Card>
      </div>
      {error && (
        <div class="mt-4">
          <Banner tone="bad">{error}</Banner>
        </div>
      )}
      {result && <Results r={result} />}

      {diff && (
        <>
          <SectionTitle>O que muda</SectionTitle>
          <Preview diff={diff} sections={sections} setSections={setSections} />
          <div class="mt-4 flex flex-wrap justify-end gap-3">
            <Button onClick={() => (setDiff(null), setFile(null))}>Cancelar</Button>
            <Button variant="primary" disabled={!anySection} onClick={() => setConfirming(true)}>
              Aplicar selecionados…
            </Button>
          </div>
        </>
      )}

      {confirming && diff && (
        <Dialog
          title="Confirmar importação"
          onClose={() => !busy && setConfirming(false)}
          footer={
            <>
              {busy && <span class="text-[12.5px] text-muted" role="status">Aplicando…</span>}
              <span class="flex-1" />
              <Button onClick={() => setConfirming(false)} disabled={busy}>
                Voltar
              </Button>
              <Button variant="primary" onClick={apply} loading={busy}>
                {sections.reservations ? "Aplicar e gravar no Deco" : "Aplicar"}
              </Button>
            </>
          }
        >
          <div class="grid gap-4">
            <ul class="list-disc space-y-1 pl-5 text-[13.5px]">
              {sections.devices && <li>Inventário: {diff.devices.changes.length} mudança(s)</li>}
              {sections.ranges && <li>Plano de IPs: {diff.ranges.changes.filter((r) => r.action !== "conflict").length} mudança(s)</li>}
              {sections.reservations && (
                <li>
                  <strong>Reservas no Deco: {resCount} mudança(s)</strong>, numa sessão só. Pode levar {Math.round(15 + resCount)} s ou mais; o app do Deco pode ser
                  desconectado nesse tempo.
                </li>
              )}
            </ul>
            {sections.reservations && <Banner tone="warn">Isto altera o Deco.</Banner>}
          </div>
        </Dialog>
      )}
    </>
  );
}
