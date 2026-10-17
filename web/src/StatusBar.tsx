import { useState } from "preact/hooks";
import { api, ApiError, type StatusView } from "./api";
import { ago } from "./format";
import { useNow } from "./hooks";

interface Props {
  status: StatusView | null;
  /** Recarrega os dados da página; devolve o status novo. */
  reload: () => Promise<{ status: StatusView } | StatusView | null>;
}

const statusOf = (v: { status: StatusView } | StatusView | null) =>
  v && "status" in v ? v.status : (v as StatusView | null);

/**
 * Faixa de estado: idade dos dados, erros, breaker e botão de atualizar.
 * "Atualizar" pede um poll ao servidor (que pode levar até ~40 s no Deco) e
 * acompanha até o snapshot mudar.
 */
export function StatusBar({ status, reload }: Props) {
  const now = useNow(10_000);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (!status) return null;

  async function refresh() {
    setMessage(null);
    const before = status!.fetchedAt;
    const requestedAt = new Date().toISOString();
    try {
      await api.refresh();
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : "Falha ao pedir atualização.");
      return;
    }
    setRefreshing(true);
    // Espera até chegar um snapshot novo ou o poll pedido falhar.
    const deadline = Date.now() + 75_000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 3000));
      const s = statusOf(await reload());
      if (!s) continue;
      if (s.fetchedAt !== before) break;
      if (s.lastError && s.lastError.at >= requestedAt) break;
    }
    setRefreshing(false);
  }

  async function unlock() {
    if (!confirm("Destravar o acesso ao Deco? Faça isso só depois de corrigir DECO_PASSWORD — cada senha errada conta para o bloqueio do roteador.")) return;
    await api.resetBreaker();
    await reload();
  }

  return (
    <>
      {status.breaker === "locked" && (
        <div class="banner bad" role="alert">
          <strong>Acesso ao Deco travado</strong>
          <span>após falhas de login ({status.lastError?.message ?? "senha recusada"}). Nenhuma nova tentativa será feita.</span>
          <button class="btn" onClick={unlock}>Destravar</button>
        </div>
      )}
      {status.breaker === "open" && (
        <div class="banner warn" role="status">
          <span>
            Falha na última leitura{status.lastError ? `: ${status.lastError.message}` : ""}. Nova tentativa automática em breve.
          </span>
        </div>
      )}
      {status.stale && status.fetchedAt && status.breaker === "closed" && (
        <div class="banner warn" role="status">Dados desatualizados — última leitura {ago(status.fetchedAt, now)}.</div>
      )}
      <div class="statusbar">
        {status.mode.mock && <span class="badge accent">Mock</span>}
        <span class="badge">{status.mode.allowWrite ? "Escrita habilitada" : "Somente leitura"}</span>
        <span>
          {status.fetchedAt ? <>Atualizado {ago(status.fetchedAt, now)}</> : "Aguardando a primeira leitura do Deco…"}
        </span>
        {status.detailTakenAt && status.detailTakenAt !== status.fetchedAt && (
          <span title="Cliente→nó, Wi-Fi e CPU são lidos com menos frequência">
            · detalhes {ago(status.detailTakenAt, now)}
          </span>
        )}
        <span class="spacer" />
        {message && <span class="error">{message}</span>}
        <button class="btn" onClick={refresh} disabled={refreshing || status.breaker !== "closed"}>
          {refreshing ? "Lendo o Deco…" : "Atualizar"}
        </button>
      </div>
    </>
  );
}
