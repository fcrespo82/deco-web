/**
 * Operações perigosas (DECO_ALLOW_DANGEROUS=1): reiniciar um nó e alterar
 * uma rede Wi-Fi. Mesmo roteiro do diálogo de reservas — escolher → confirmar
 * → gravando → resultado —, com uma confirmação digitada quando o efeito
 * atinge a rede inteira (reiniciar o gateway, mexer na rede principal).
 */
import { useEffect, useState } from "preact/hooks";
import { api, ApiError, type NodeView, type RebootResult, type WifiKind, type WifiNetwork, type WifiResult } from "./api";
import { BAND_LABEL, WIFI_KIND_LABEL } from "./format";
import { Modal } from "./Modal";

type Step = "edit" | "confirm" | "working" | "done";
const TONE: Record<string, "ok" | "warn" | "bad"> = {
  sent: "ok",
  applied: "ok",
  noop: "ok",
  conflict: "warn",
  rejected: "warn",
  unverified: "bad",
  ambiguous: "bad",
};

/** Segundos desde que a etapa "working" começou. */
function useElapsed(step: Step): number {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (step !== "working") return;
    setElapsed(0);
    const started = Date.now();
    const id = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(id);
  }, [step]);
  return elapsed;
}

/** Pega o resultado de uma escrita que o servidor devolveu com status de erro. */
function resultOf<T extends { outcome: string }>(e: unknown): T | null {
  const body = e instanceof ApiError ? (e.body as Partial<T> | undefined) : undefined;
  return body?.outcome ? (body as T) : null;
}

function Typed({ word, value, onInput }: { word: string; value: string; onInput: (v: string) => void }) {
  return (
    <label>
      <span>
        Para confirmar, digite <strong class="mono">{word}</strong>
      </span>
      <input class="mono" value={value} autoComplete="off" onInput={(e) => onInput((e.target as HTMLInputElement).value)} />
    </label>
  );
}

// --- reiniciar ----------------------------------------------------------

export function RebootDialog({ node, onClose }: { node: NodeView; onClose: () => void }) {
  const [step, setStep] = useState<Step>("confirm");
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RebootResult | null>(null);
  const elapsed = useElapsed(step);
  const gateway = node.role === "master";
  const word = "REINICIAR";

  async function confirm() {
    setStep("working");
    setError(null);
    try {
      setResult(await api.rebootNodes([node.mac]));
      setStep("done");
    } catch (e) {
      const r = resultOf<RebootResult>(e);
      if (r) {
        setResult(r);
        setStep("done");
      } else {
        setError(e instanceof Error ? e.message : "Falha ao reiniciar.");
        setStep("confirm");
      }
    }
  }

  const close = () => step !== "working" && onClose();
  return (
    <Modal title={`Reiniciar ${node.name}`} onClose={close}>
      <div class="form">
        <p class="muted small mono" style="margin:0">
          {node.model} · {node.mac}
        </p>
        {step !== "done" && (
          <>
            <div class="banner bad">
              {gateway
                ? "Este é o gateway: a internet e o Wi-Fi da casa inteira caem por uns 2–4 minutos, inclusive este painel."
                : `Os ${node.clients.total} aparelho(s) conectados a este nó perdem a conexão por uns 2–3 minutos.`}
            </div>
            <ul class="small" style="margin:0;padding-left:18px">
              <li>Reiniciar não apaga configurações nem mexe no firmware.</li>
              <li>Não reinicie durante uma atualização de firmware.</li>
              <li>O painel não reenvia o pedido; um mesmo nó só pode ser reiniciado de novo depois de 5 minutos.</li>
              {gateway && <li>As leituras do painel ficam suspensas por 3 minutos.</li>}
            </ul>
            {gateway && <Typed word={word} value={typed} onInput={setTyped} />}
            {error && <div class="error">{error}</div>}
            <div class="form-actions">
              {step === "working" && (
                <span class="muted small" role="status">
                  Enviando ao Deco… {elapsed} s
                </span>
              )}
              <span class="spacer" />
              <button type="button" class="btn" onClick={close} disabled={step === "working"}>
                Cancelar
              </button>
              <button class="btn primary danger" onClick={confirm} disabled={step === "working" || (gateway && typed.trim().toUpperCase() !== word)}>
                Reiniciar agora
              </button>
            </div>
          </>
        )}
        {step === "done" && result && (
          <>
            <div class={`banner ${TONE[result.outcome]}`} role="status">
              {result.ok ? "✓ " : "⚠ "}
              {result.message}
            </div>
            <div class="form-actions">
              <span class="spacer" />
              <button class="btn primary" onClick={onClose}>
                Concluir
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

// --- Wi-Fi --------------------------------------------------------------

interface WifiDialogProps {
  kind: WifiKind;
  /** As linhas desta rede (uma por banda). */
  rows: WifiNetwork[];
  onClose: (changed: boolean) => void;
}

export function WifiDialog({ kind, rows, onClose }: WifiDialogProps) {
  const currentSsid = rows[0]?.ssid ?? "";
  const currentEnabled = rows.some((r) => r.enabled);
  const [ssid, setSsid] = useState(currentSsid);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [enabled, setEnabled] = useState(currentEnabled);
  const [typed, setTyped] = useState("");
  const [step, setStep] = useState<Step>("edit");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<WifiResult | null>(null);
  const elapsed = useElapsed(step);
  const host = kind === "host";
  const label = WIFI_KIND_LABEL[kind] ?? kind;
  const networkName = { host: "rede principal", guest: "rede de convidados", iot: "rede IoT" }[kind];
  const word = "ALTERAR";

  const change = {
    network: kind,
    ...(ssid !== currentSsid && { ssid }),
    ...(password !== "" && { password }),
    ...(!host && enabled !== currentEnabled && { enabled }),
  };
  const nothing = Object.keys(change).length === 1;
  const ssidBytes = new TextEncoder().encode(ssid).length;
  const invalid =
    ssid.length === 0 || ssidBytes > 32 || ssid.trim() !== ssid
      ? "SSID: de 1 a 32 bytes, sem espaço no começo ou no fim."
      : password !== "" && !/^[\x20-\x7E]{8,63}$/.test(password)
        ? "Senha: de 8 a 63 caracteres, sem acentos."
        : null;
  // Com a rede ativa, desligar, trocar o nome ou a senha derruba quem está nela.
  const drops = currentEnabled && ("ssid" in change || "password" in change || change.enabled === false);
  const credentials = "ssid" in change || "password" in change;

  async function confirm() {
    setStep("working");
    setError(null);
    try {
      setResult(await api.changeWifi(change));
      setStep("done");
    } catch (e) {
      const r = resultOf<WifiResult>(e);
      if (r) {
        setResult(r);
        setStep("done");
      } else {
        setError(e instanceof Error ? e.message : "Falha ao gravar.");
        setStep("confirm");
      }
    } finally {
      setPassword("");
    }
  }

  const close = () => step !== "working" && onClose(result !== null);
  return (
    <Modal title={`Wi-Fi: ${label}`} onClose={close}>
      <div class="form">
        <p class="muted small" style="margin:0">
          {rows.map((r) => BAND_LABEL[r.band]).join(" + ")} · hoje {currentEnabled ? "ativa" : "desligada"}
        </p>

        {step === "edit" && (
          <form
            class="form"
            onSubmit={(e) => {
              e.preventDefault();
              setStep("confirm");
            }}
          >
            {!host && (
              <label class="check">
                <input type="checkbox" checked={enabled} onChange={(e) => setEnabled((e.target as HTMLInputElement).checked)} />
                Rede ativa
              </label>
            )}
            <label>
              Nome (SSID)
              <input value={ssid} maxLength={32} onInput={(e) => setSsid((e.target as HTMLInputElement).value)} />
            </label>
            <label>
              Nova senha <span class="muted small">(deixe em branco para manter)</span>
              <span class="row">
                <input
                  type={(showPassword ? "text" : "password") as "text"}
                  value={password}
                  autoComplete="new-password"
                  maxLength={63}
                  onInput={(e) => setPassword((e.target as HTMLInputElement).value)}
                />
                <button type="button" class="btn" onClick={() => setShowPassword((v) => !v)}>
                  {showPassword ? "Ocultar" : "Mostrar"}
                </button>
              </span>
            </label>
            {host && (
              <p class="muted small" style="margin:0">
                A rede principal não pode ser desligada pelo painel — só renomeada ou com a senha trocada.
              </p>
            )}
            {invalid && <div class="error">{invalid}</div>}
            <div class="form-actions">
              <span class="spacer" />
              <button type="button" class="btn" onClick={close}>
                Cancelar
              </button>
              <button class="btn primary" disabled={nothing || Boolean(invalid)}>
                Continuar
              </button>
            </div>
          </form>
        )}

        {(step === "confirm" || step === "working") && (
          <>
            <div class={`banner ${drops ? "bad" : "warn"}`}>
              {drops
                ? `Todos os aparelhos na ${networkName} vão desconectar${credentials ? " e só voltam com o nome/senha novos — os de IoT podem precisar ser reconfigurados um a um" : ""}. Se você está no painel por esse Wi-Fi, vai perder a conexão.`
                : `A ${networkName} está desligada: ninguém é desconectado. Os rádios do Deco podem reiniciar por alguns segundos, o que derruba o Wi-Fi da casa brevemente.`}
            </div>
            <dl class="kv">
              {"enabled" in change && (
                <>
                  <dt>Rede</dt>
                  <dd>
                    {currentEnabled ? "ativa" : "desligada"} → <strong>{enabled ? "ativa" : "desligada"}</strong>
                  </dd>
                </>
              )}
              {"ssid" in change && (
                <>
                  <dt>SSID</dt>
                  <dd>
                    {currentSsid} → <strong>{ssid}</strong>
                  </dd>
                </>
              )}
              {"password" in change && (
                <>
                  <dt>Senha</dt>
                  <dd>será trocada</dd>
                </>
              )}
            </dl>
            {host && <Typed word={word} value={typed} onInput={setTyped} />}
            {error && <div class="error">{error}</div>}
            <div class="form-actions">
              {step === "working" && (
                <span class="muted small" role="status">
                  Gravando no Deco… {elapsed} s (costuma levar 20–40 s)
                </span>
              )}
              <span class="spacer" />
              <button type="button" class="btn" onClick={() => setStep("edit")} disabled={step === "working"}>
                Voltar
              </button>
              <button
                class={`btn primary${drops ? " danger" : ""}`}
                onClick={confirm}
                disabled={step === "working" || (host && typed.trim().toUpperCase() !== word)}
              >
                Gravar no Deco
              </button>
            </div>
          </>
        )}

        {step === "done" && result && (
          <>
            <div class={`banner ${TONE[result.outcome]}`} role="status">
              {result.ok ? "✓ " : "⚠ "}
              {result.message}
            </div>
            {result.after && (
              <dl class="kv">
                <dt>Agora</dt>
                <dd>
                  {result.after.ssid} · {result.after.enabled ? "ativa" : "desligada"}
                  {result.passwordChanged && " · senha trocada"}
                </dd>
              </dl>
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
