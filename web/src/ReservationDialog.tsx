/**
 * Criar, mudar ou remover a reserva de DHCP de um aparelho. Sempre em duas
 * etapas: escolher → confirmar (antes/depois). Só a confirmação escreve no
 * Deco, e a escrita leva ~15–30 s. Ela é otimista (lib/reservation-write): a
 * lista muda na hora com o selo "gravando…" e o diálogo fecha; o resultado
 * chega como aviso. Recusas imediatas (validação, conflito antes de ir ao
 * Deco) continuam aparecendo aqui.
 */
import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import { ArrowRight } from "lucide-preact";
import { api, type IpSuggestion, type ReservationResult } from "./api";
import { Loader, CircleHelp } from "lucide-preact";
import { usePendingReservations, writeReservation } from "./lib/reservation-write";
import { useClients, useReservations } from "./data";
import { toast } from "./lib/toast";
import { Badge, Banner, Button, Check, cx, Dialog, Field } from "./ui";
import { INVENTORY_TYPE_LABEL } from "./format";
import { invalidate } from "./lib/query";
import { OUTCOME_TONE, useElapsed, WorkingNote, type Step } from "./writes";

interface Props {
  mac: string;
  name: string;
  /** Reserva atual, se houver. */
  current: string | null;
  /** IP em uso agora (para "fixar o IP atual"). */
  currentIp: string | null;
  /** remove: abre direto na confirmação de remoção. */
  mode?: "edit" | "remove";
  /** IP já escolhido (ex.: a partir do plano de IPs). */
  presetIp?: string;
  onClose: (changed: boolean) => void;
}

export function ReservationDialog({ mac, name, current, currentIp, mode = "edit", presetIp, onClose }: Props) {
  const [suggestions, setSuggestions] = useState<IpSuggestion[] | null>(null);
  const [ip, setIp] = useState(presetIp ?? "");
  const [step, setStep] = useState<Step>(mode === "remove" || presetIp ? "confirm" : "choose");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ReservationResult | null>(null);
  const elapsed = useElapsed(step);
  const removing = mode === "remove";

  useEffect(() => {
    if (removing) return;
    api.suggestIp(mac).then(
      (r) => {
        setSuggestions(r.suggestions);
        if (!presetIp) setIp((v) => v || r.suggestions[0]?.ip || "");
      },
      () => setSuggestions([]),
    );
  }, [mac]);

  const busy = usePendingReservations().has(mac);

  async function confirm() {
    setStep("working");
    setError(null);
    const target = removing ? null : ip.trim();
    const h = writeReservation({ mac, name, op: removing ? "remove" : current ? "move" : "add", ip: target });
    // Recusa imediata (antes de ir ao Deco) volta para cá; se demorar, segue em segundo plano.
    const first = await Promise.race([h.done, new Promise<null>((r) => setTimeout(() => r(null), 800))]);
    if (first === null) {
      h.detach();
      toast(removing ? `Removendo a reserva de ${name}…` : `Gravando ${name} em ${target}…`, {
        tone: "info",
        detail: "A lista já mostra a mudança; a confirmação do Deco chega em uns 20 s.",
        ms: 5000,
      });
      onClose(true);
      return;
    }
    if (first.kind === "error") {
      setError(first.message);
      setStep(removing || presetIp ? "confirm" : "choose");
      return;
    }
    if (first.result) setResult(first.result);
    setStep("done");
    if (first.kind === "ok") toast(removing ? `Reserva de ${name} removida` : `${name} reservado em ${target}`);
  }

  const close = () => {
    if (step === "working") return; // não abandona uma escrita em andamento
    onClose(result !== null);
  };
  const title = removing ? "Remover reserva" : current ? "Mudar IP reservado" : "Fixar IP";
  const radio = (value: string, label: ComponentChildren, hint: string) => (
    <label class={cx("flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 transition", ip === value ? "border-accent bg-accent-soft/50" : "border-line hover:bg-surface-2")}>
      <input type="radio" name="ip" checked={ip === value} onChange={() => setIp(value)} class="size-4 accent-[var(--accent)]" />
      <span class="font-mono text-[13.5px] font-medium">{label}</span>
      <span class="text-[12.5px] text-muted">{hint}</span>
    </label>
  );

  const footer =
    step === "choose" ? (
      <>
        <span class="flex-1" />
        <Button onClick={close}>Cancelar</Button>
        <Button variant="primary" type="submit" form="res-form" disabled={!ip.trim()}>
          Continuar
        </Button>
      </>
    ) : step === "done" ? (
      <>
        <span class="flex-1" />
        <Button variant="primary" onClick={() => onClose(true)}>
          Concluir
        </Button>
      </>
    ) : (
      <>
        {step === "working" && <WorkingNote>Gravando no Deco… {elapsed} s (costuma levar 15–30 s)</WorkingNote>}
        <span class="flex-1" />
        <Button onClick={() => (removing || presetIp ? close() : setStep("choose"))} disabled={step === "working"}>
          {removing || presetIp ? "Cancelar" : "Voltar"}
        </Button>
        <Button variant={removing ? "danger-solid" : "primary"} onClick={confirm} loading={step === "working"} disabled={busy && step !== "working"}>
          {removing ? "Remover do Deco" : "Gravar no Deco"}
        </Button>
      </>
    );

  return (
    <Dialog title={`${title}: ${name}`} subtitle={<span class="font-mono">{mac}</span>} onClose={close} footer={footer}>
      {step === "choose" && (
        <form
          id="res-form"
          class="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            setStep("confirm");
          }}
        >
          {suggestions && suggestions.length > 0 && (
            <fieldset class="grid gap-2">
              <legend class="mb-2 text-[13px] font-medium text-muted">Sugestões do plano de IPs</legend>
              {suggestions.map((s) =>
                radio(s.ip, s.ip, `${s.rangeName ? `próximo livre em "${s.rangeName}"` : "primeiro livre"}${s.matchesType ? " · faixa do tipo deste aparelho" : ""}`),
              )}
              {currentIp && currentIp !== current && !suggestions.some((s) => s.ip === currentIp) &&
                radio(currentIp, currentIp, "IP que está usando agora (não muda nada no aparelho)")}
            </fieldset>
          )}
          {suggestions === null && <div class="h-24 animate-pulse rounded-lg bg-surface-2" />}
          {suggestions && suggestions.length === 0 && (
            <p class="text-[12.5px] text-muted">Sem sugestão: crie faixas fixas no Plano de IPs para o painel sugerir endereços.</p>
          )}
          <Field label="IP">
            <input class="field font-mono" value={ip} onInput={(e) => setIp((e.target as HTMLInputElement).value)} required placeholder="192.168.68.50" />
          </Field>
          {error && <p class="text-[13px] text-bad">{error}</p>}
        </form>
      )}

      {(step === "confirm" || step === "working") && (
        <div class="grid gap-4">
          {busy && step !== "working" ? (
            <Banner tone="accent">Já há uma gravação em andamento para este aparelho. Espere ela terminar.</Banner>
          ) : (
            <Banner tone="warn">Isto altera o Deco. Confira antes de confirmar.</Banner>
          )}
          <div class="grid items-center gap-2 sm:grid-cols-[1fr_auto_1fr]">
            <div class="rounded-xl border border-line bg-surface-2/50 px-3.5 py-3">
              <div class="text-[11.5px] font-semibold uppercase tracking-wide text-muted">Antes</div>
              <div class="mt-1 font-mono text-[13.5px]">{current ? `reservado ${current}` : `sem reserva${currentIp ? ` (usando ${currentIp})` : ""}`}</div>
            </div>
            <ArrowRight class="mx-auto size-4 rotate-90 text-muted sm:rotate-0" />
            <div class="rounded-xl border border-accent/40 bg-accent-soft/40 px-3.5 py-3">
              <div class="text-[11.5px] font-semibold uppercase tracking-wide text-accent">Depois</div>
              <div class="mt-1 font-mono text-[13.5px]">{removing ? "sem reserva (IP dinâmico)" : `reservado ${ip.trim()}`}</div>
            </div>
          </div>
          <p class="text-[12.5px] text-muted">
            {removing
              ? "O aparelho volta a receber IP do pool na próxima renovação do DHCP."
              : currentIp && currentIp !== ip.trim()
                ? "O aparelho só passa a usar o IP novo quando renovar o lease — reconectar o Wi-Fi ou o cabo acelera."
                : "O aparelho mantém o IP; ele só deixa de mudar."}
          </p>
          {error && <p class="text-[13px] text-bad">{error}</p>}
        </div>
      )}

      {step === "done" && result && (
        <div class="grid gap-3">
          <Banner tone={OUTCOME_TONE[result.outcome] ?? "warn"} role="status">
            {result.message}
          </Banner>
          {result.outcome === "ambiguous" && (
            <p class="text-[12.5px] text-muted">O painel vai reler o Deco agora. Confira a lista de reservas antes de tentar de novo.</p>
          )}
        </div>
      )}
    </Dialog>
  );
}

/** Selo de gravação pendente ("gravando…" / "a confirmar") para um aparelho. */
export function PendingReservationBadge({ mac }: { mac: string }) {
  const p = usePendingReservations().get(mac);
  if (!p) return null;
  return p.phase === "saving" ? (
    <Badge tone="accent" title="Gravando no Deco; a lista já mostra o resultado esperado">
      <Loader class="size-3 animate-spin" /> gravando…
    </Badge>
  ) : (
    <Badge tone="warn" title="O Deco não confirmou; a próxima leitura completa mostra o estado real">
      <CircleHelp class="size-3" /> a confirmar
    </Badge>
  );
}

const MAC_RE = /^([0-9A-F]{2}[-:]){5}[0-9A-F]{2}$/i;

/**
 * Reserva para um aparelho que não está na lista: digita o MAC (e um nome para
 * reconhecer). O Deco às vezes não lista aparelhos que estão na rede, e
 * desligados não aparecem.
 */
export function ManualMacDialog({ onNext, onCancel }: { onNext: (mac: string, name: string) => void; onCancel: () => void }) {
  const [mac, setMac] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState("");
  const [register, setRegister] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clients = useClients().data?.clients;
  const reservations = useReservations().data?.clients;
  const norm = mac.trim().toUpperCase().replace(/:/g, "-");
  const valid = MAC_RE.test(mac.trim());
  const known = valid ? clients?.find((c) => c.mac === norm) : undefined;
  const reserved = valid ? reservations?.find((c) => c.mac === norm)?.reservation : undefined;
  // Cadastrar guarda o nome (o Deco não conhece o aparelho) e o tipo, que
  // decide a faixa sugerida. Aparelho já cadastrado: nada a fazer aqui.
  const canRegister = valid && !known?.device;

  async function next() {
    if (!valid) return;
    const label = name.trim() || known?.device?.alias || known?.name || norm;
    if (canRegister && register && name.trim()) {
      setSaving(true);
      setError(null);
      try {
        // Antes de seguir: a sugestão de IP do próximo passo lê o tipo do inventário.
        await api.saveClientDevice(norm, { alias: name.trim(), type: type || null, approved: true });
        invalidate(["inventory"]);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Falha ao cadastrar.");
        setSaving(false);
        return;
      }
    }
    onNext(norm, label);
  }

  return (
    <Dialog
      title="Reservar por MAC"
      subtitle="Para aparelhos que não aparecem na lista do Deco"
      onClose={onCancel}
      footer={
        <>
          <span class="flex-1" />
          <Button onClick={onCancel}>Cancelar</Button>
          <Button variant="primary" type="submit" form="mac-form" disabled={!valid} loading={saving}>
            Continuar
          </Button>
        </>
      }
    >
      <form
        id="mac-form"
        class="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void next();
        }}
      >
        <Field label="MAC" hint="Ex.: BC:24:11:5E:F8:B8. No Proxmox: CT → Network; no aparelho: configurações de rede.">
          <input class="field font-mono" value={mac} onInput={(e) => setMac((e.target as HTMLInputElement).value)} placeholder="AA:BB:CC:DD:EE:FF" autofocus required />
        </Field>
        <div class="grid gap-3 sm:grid-cols-[1fr_160px]">
          <Field label="Nome">
            <input class="field" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} placeholder="deco-web" />
          </Field>
          <Field label="Tipo">
            <select class="field" value={type} onChange={(e) => setType((e.target as HTMLSelectElement).value)} disabled={!canRegister || !register}>
              <option value="">—</option>
              {Object.entries(INVENTORY_TYPE_LABEL).map(([k, v]) => (
                <option value={k}>{v}</option>
              ))}
            </select>
          </Field>
        </div>
        {canRegister && (
          <Check checked={register} onChange={() => setRegister(!register)}>
            Cadastrar no inventário com este nome e tipo (o tipo escolhe a faixa sugerida)
          </Check>
        )}
        {error && <p class="text-[13px] text-bad">{error}</p>}
        {mac.trim() && !valid && <p class="text-[13px] text-bad">MAC inválido: use 6 pares hexadecimais separados por ":" ou "-".</p>}
        {known && (
          <Banner tone="accent">
            {known.device ? `Já cadastrado no inventário como "${known.device.alias}".` : `Este MAC é de "${known.name}", que está na lista de aparelhos.`}
          </Banner>
        )}
        {reserved && <Banner tone="warn">Já reservado em {reserved.ip}: a reserva será mudada, não duplicada.</Banner>}
      </form>
    </Dialog>
  );
}
