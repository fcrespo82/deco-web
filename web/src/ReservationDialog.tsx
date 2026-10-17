/**
 * Criar, mudar ou remover a reserva de DHCP de um aparelho. Sempre em duas
 * etapas: escolher → confirmar (antes/depois). Só a confirmação escreve no
 * Deco, e a escrita leva ~15–30 s (uma sessão inteira: login, leitura,
 * escrita, releitura, logout), então o diálogo mostra o tempo decorrido e não
 * deixa reenviar.
 */
import { useEffect, useState } from "preact/hooks";
import { api, ApiError, type IpSuggestion, type ReservationResult } from "./api";
import { Modal } from "./Modal";

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

const OUTCOME_TONE: Record<ReservationResult["outcome"], "ok" | "warn" | "bad"> = {
  applied: "ok",
  noop: "ok",
  conflict: "warn",
  rejected: "warn",
  "rolled-back": "warn",
  unverified: "bad",
  ambiguous: "bad",
  lost: "bad",
};

export function ReservationDialog({ mac, name, current, currentIp, mode = "edit", presetIp, onClose }: Props) {
  const [suggestions, setSuggestions] = useState<IpSuggestion[] | null>(null);
  const [ip, setIp] = useState(presetIp ?? "");
  const [step, setStep] = useState<"choose" | "confirm" | "working" | "done">(mode === "remove" || presetIp ? "confirm" : "choose");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ReservationResult | null>(null);
  const [elapsed, setElapsed] = useState(0);
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

  useEffect(() => {
    if (step !== "working") return;
    const started = Date.now();
    const id = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(id);
  }, [step]);

  async function confirm() {
    setStep("working");
    setError(null);
    setElapsed(0);
    try {
      const r = removing
        ? await api.removeReservation(mac)
        : current
          ? await api.moveReservation(mac, ip.trim())
          : await api.addReservation(mac, ip.trim());
      setResult(r);
      setStep("done");
    } catch (e) {
      const body = e instanceof ApiError ? (e.body as Partial<ReservationResult> | undefined) : undefined;
      if (body?.outcome) {
        setResult(body as ReservationResult);
        setStep("done");
      } else {
        // Recusado antes de chegar ao Deco (validação, conflito no cache, breaker).
        setError(e instanceof Error ? e.message : "Falha ao gravar.");
        setStep(removing ? "confirm" : "choose");
      }
    }
  }

  const close = () => {
    if (step === "working") return; // não abandona uma escrita em andamento
    onClose(result !== null);
  };
  const title = removing ? "Remover reserva" : current ? "Mudar IP reservado" : "Fixar IP";

  return (
    <Modal title={`${title}: ${name}`} onClose={close}>
      <div class="form">
        <p class="muted small mono" style="margin:0">{mac}</p>

        {step === "choose" && (
          <form
            class="form"
            onSubmit={(e) => {
              e.preventDefault();
              setError(null);
              setStep("confirm");
            }}
          >
            {suggestions && suggestions.length > 0 && (
              <fieldset>
                <legend>Sugestões do plano de IPs</legend>
                {suggestions.map((s) => (
                  <label class="check">
                    <input type="radio" name="ip" checked={ip === s.ip} onChange={() => setIp(s.ip)} />
                    <span class="mono">{s.ip}</span>
                    <span class="muted small">
                      {s.rangeName ? `próximo livre em "${s.rangeName}"` : "primeiro livre"}
                      {s.matchesType ? " · faixa do tipo deste aparelho" : ""}
                    </span>
                  </label>
                ))}
                {currentIp && currentIp !== current && !suggestions.some((s) => s.ip === currentIp) && (
                  <label class="check">
                    <input type="radio" name="ip" checked={ip === currentIp} onChange={() => setIp(currentIp)} />
                    <span class="mono">{currentIp}</span>
                    <span class="muted small">IP que está usando agora (não muda nada no aparelho)</span>
                  </label>
                )}
              </fieldset>
            )}
            {suggestions && suggestions.length === 0 && (
              <p class="muted small" style="margin:0">
                Sem sugestão: crie faixas fixas no Plano de IPs para o painel sugerir endereços.
              </p>
            )}
            <label>
              IP
              <input class="mono" value={ip} onInput={(e) => setIp((e.target as HTMLInputElement).value)} required placeholder="192.168.68.50" />
            </label>
            {error && <div class="error">{error}</div>}
            <div class="form-actions">
              <span class="spacer" />
              <button type="button" class="btn" onClick={close}>
                Cancelar
              </button>
              <button class="btn primary" disabled={!ip.trim()}>
                Continuar
              </button>
            </div>
          </form>
        )}

        {(step === "confirm" || step === "working") && (
          <>
            <div class="banner warn">Isto altera o Deco. Confira antes de confirmar.</div>
            <dl class="kv">
              <dt>Antes</dt>
              <dd class="mono">{current ? `reservado ${current}` : `sem reserva${currentIp ? ` (usando ${currentIp})` : ""}`}</dd>
              <dt>Depois</dt>
              <dd class="mono">{removing ? "sem reserva (IP dinâmico)" : `reservado ${ip.trim()}`}</dd>
            </dl>
            <p class="muted small" style="margin:0">
              {removing
                ? "O aparelho volta a receber IP do pool na próxima renovação do DHCP."
                : currentIp && currentIp !== ip.trim()
                  ? "O aparelho só passa a usar o IP novo quando renovar o lease — reconectar o Wi-Fi ou o cabo acelera."
                  : "O aparelho mantém o IP; ele só deixa de mudar."}
            </p>
            {error && <div class="error">{error}</div>}
            <div class="form-actions">
              {step === "working" && (
                <span class="muted small" role="status">
                  Gravando no Deco… {elapsed} s (costuma levar 15–30 s)
                </span>
              )}
              <span class="spacer" />
              <button type="button" class="btn" onClick={() => (removing || presetIp ? close() : setStep("choose"))} disabled={step === "working"}>
                {removing || presetIp ? "Cancelar" : "Voltar"}
              </button>
              <button class={`btn primary${removing ? " danger" : ""}`} onClick={confirm} disabled={step === "working"}>
                {removing ? "Remover do Deco" : "Gravar no Deco"}
              </button>
            </div>
          </>
        )}

        {step === "done" && result && (
          <>
            <div class={`banner ${OUTCOME_TONE[result.outcome]}`} role="status">
              {result.ok ? "✓ " : "⚠ "}
              {result.message}
            </div>
            {result.outcome === "ambiguous" && (
              <p class="muted small" style="margin:0">
                O painel vai reler o Deco agora. Confira a lista de reservas antes de tentar de novo.
              </p>
            )}
            <div class="form-actions">
              <span class="spacer" />
              <button class="btn primary" onClick={() => onClose(true)}>
                Concluir
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
