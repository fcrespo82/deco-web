/**
 * Operações perigosas (DECO_ALLOW_DANGEROUS=1): reiniciar um nó e alterar
 * uma rede Wi-Fi. Mesmo roteiro do diálogo de reservas — escolher → confirmar
 * → gravando → resultado —, com uma confirmação digitada quando o efeito
 * atinge a rede inteira (reiniciar o gateway, mexer na rede principal).
 */
import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { api, type NodeView, type RebootResult, type WifiKind, type WifiNetwork, type WifiResult } from "./api";
import { BAND_LABEL, WIFI_KIND_LABEL } from "./format";
import { Banner, Button, Check, Dialog, Field, Kv } from "./ui";
import { OUTCOME_TONE, resultOf, useElapsed, WorkingNote, type Step } from "./writes";

function Typed({ word, value, onInput }: { word: string; value: string; onInput: (v: string) => void }) {
  return (
    <Field
      label={
        <>
          Para confirmar, digite <strong class="font-mono text-fg">{word}</strong>
        </>
      }
    >
      <input class="field font-mono" value={value} autoComplete="off" onInput={(e) => onInput((e.target as HTMLInputElement).value)} />
    </Field>
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
  const done = step === "done" && result;
  return (
    <Dialog
      title={`Reiniciar ${node.name}`}
      subtitle={<span class="font-mono">{node.model} · {node.mac}</span>}
      onClose={close}
      footer={
        done ? (
          <>
            <span class="flex-1" />
            <Button variant="primary" onClick={onClose}>
              Concluir
            </Button>
          </>
        ) : (
          <>
            {step === "working" && <WorkingNote>Enviando ao Deco… {elapsed} s</WorkingNote>}
            <span class="flex-1" />
            <Button onClick={close} disabled={step === "working"}>
              Cancelar
            </Button>
            <Button variant="danger-solid" onClick={confirm} loading={step === "working"} disabled={gateway && typed.trim().toUpperCase() !== word}>
              Reiniciar agora
            </Button>
          </>
        )
      }
    >
      {done ? (
        <Banner tone={OUTCOME_TONE[result.outcome] ?? "warn"} role="status">
          {result.message}
        </Banner>
      ) : (
        <div class="grid gap-4">
          <Banner tone="bad">
            {gateway
              ? "Este é o gateway: a internet e o Wi-Fi da casa inteira caem por uns 2–4 minutos, inclusive este painel."
              : `Os ${node.clients.total} aparelho(s) conectados a este nó perdem a conexão por uns 2–3 minutos.`}
          </Banner>
          <ul class="list-disc space-y-1 pl-5 text-[13px] text-muted">
            <li>Reiniciar não apaga configurações nem mexe no firmware.</li>
            <li>Não reinicie durante uma atualização de firmware.</li>
            <li>O painel não reenvia o pedido; um mesmo nó só pode ser reiniciado de novo depois de 5 minutos.</li>
            {gateway && <li>As leituras do painel ficam suspensas por 3 minutos.</li>}
          </ul>
          {gateway && <Typed word={word} value={typed} onInput={setTyped} />}
          {error && <p class="text-[13px] text-bad">{error}</p>}
        </div>
      )}
    </Dialog>
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

  const changes: [ComponentChildren, ComponentChildren][] = [];
  if ("enabled" in change) {
    changes.push(["Rede", <>{currentEnabled ? "ativa" : "desligada"} → <strong>{enabled ? "ativa" : "desligada"}</strong></>]);
  }
  if ("ssid" in change) changes.push(["SSID", <>{currentSsid} → <strong>{ssid}</strong></>]);
  if ("password" in change) changes.push(["Senha", "será trocada"]);

  const close = () => step !== "working" && onClose(result !== null);
  const footer =
    step === "edit" ? (
      <>
        <span class="flex-1" />
        <Button onClick={close}>Cancelar</Button>
        <Button variant="primary" type="submit" form="wifi-form" disabled={nothing || Boolean(invalid)}>
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
        {step === "working" && <WorkingNote>Gravando no Deco… {elapsed} s (costuma levar 20–40 s)</WorkingNote>}
        <span class="flex-1" />
        <Button onClick={() => setStep("edit")} disabled={step === "working"}>
          Voltar
        </Button>
        <Button variant={drops ? "danger-solid" : "primary"} onClick={confirm} loading={step === "working"} disabled={host && typed.trim().toUpperCase() !== word}>
          Gravar no Deco
        </Button>
      </>
    );

  return (
    <Dialog title={`Wi-Fi: ${label}`} subtitle={`${rows.map((r) => BAND_LABEL[r.band]).join(" + ")} · hoje ${currentEnabled ? "ativa" : "desligada"}`} onClose={close} footer={footer}>
      {step === "edit" && (
        <form
          id="wifi-form"
          class="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            setStep("confirm");
          }}
        >
          {!host && (
            <Check checked={enabled} onChange={() => setEnabled((v) => !v)}>
              Rede ativa
            </Check>
          )}
          <Field label="Nome (SSID)">
            <input class="field" value={ssid} maxLength={32} onInput={(e) => setSsid((e.target as HTMLInputElement).value)} />
          </Field>
          <Field label="Nova senha" hint="(deixe em branco para manter)">
            <div class="flex gap-3">
              <input
                class="field"
                type={(showPassword ? "text" : "password") as "text"}
                value={password}
                autoComplete="new-password"
                maxLength={63}
                onInput={(e) => setPassword((e.target as HTMLInputElement).value)}
              />
              <Button onClick={() => setShowPassword((v) => !v)}>{showPassword ? "Ocultar" : "Mostrar"}</Button>
            </div>
          </Field>
          {host && <p class="text-[12.5px] text-muted">A rede principal não pode ser desligada pelo painel — só renomeada ou com a senha trocada.</p>}
          {invalid && <p class="text-[13px] text-bad">{invalid}</p>}
        </form>
      )}

      {(step === "confirm" || step === "working") && (
        <div class="grid gap-4">
          <Banner tone={drops ? "bad" : "warn"}>
            {drops
              ? `Todos os aparelhos na ${networkName} vão desconectar${credentials ? " e só voltam com o nome/senha novos — os de IoT podem precisar ser reconfigurados um a um" : ""}. Se você está no painel por esse Wi-Fi, vai perder a conexão.`
              : `A ${networkName} está desligada: ninguém é desconectado. Os rádios do Deco podem reiniciar por alguns segundos, o que derruba o Wi-Fi da casa brevemente.`}
          </Banner>
          <Kv items={changes} />
          {host && <Typed word={word} value={typed} onInput={setTyped} />}
          {error && <p class="text-[13px] text-bad">{error}</p>}
        </div>
      )}

      {step === "done" && result && (
        <div class="grid gap-4">
          <Banner tone={OUTCOME_TONE[result.outcome] ?? "warn"} role="status">
            {result.message}
          </Banner>
          {result.after && (
            <Kv
              items={[["Agora", `${result.after.ssid} · ${result.after.enabled ? "ativa" : "desligada"}${result.passwordChanged ? " · senha trocada" : ""}`]]}
            />
          )}
        </div>
      )}
    </Dialog>
  );
}
