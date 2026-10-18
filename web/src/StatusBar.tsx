/**
 * Estado das leituras do Deco: selo "ao vivo", idade dos dados, botão de
 * atualizar e as faixas de aviso (acesso travado, falha, gateway reiniciando,
 * dados velhos). Tudo vem do status que o canal ao vivo empurra.
 */
import { useState } from "preact/hooks";
import { RefreshCw } from "lucide-preact";
import { api, ApiError, type StatusView } from "./api";
import { useStatus } from "./data";
import { ago } from "./format";
import { useNow } from "./hooks";
import { useLive } from "./lib/live";
import { toast } from "./lib/toast";
import { Badge, Banner, Button, cx, Dot, IconButton } from "./ui";

/** "Atualizado há 2 min" + leitura em andamento + selo ao vivo. */
export function StatusPill({ compact }: { compact?: boolean }) {
  const status = useStatus();
  const live = useLive();
  const now = useNow(10_000);
  if (!status) return null;
  const text = status.polling
    ? "Lendo o Deco…"
    : status.fetchedAt
      ? `Atualizado ${ago(status.fetchedAt, now)}`
      : "Aguardando a primeira leitura…";
  const liveLabel = live.state === "open" ? "Ao vivo" : live.state === "offline" ? "Reconectando" : "Conectando";
  return (
    <div class="flex min-w-0 items-center gap-2 text-[12.5px] text-muted" role="status">
      <span class="inline-flex items-center gap-1.5" title={live.state === "open" ? "Atualiza sozinho quando o Deco é lido" : "Sem canal ao vivo: relendo a cada 30 s"}>
        <Dot tone={live.state === "open" ? "ok" : "warn"} pulse={live.state === "open"} />
        {!compact && <span class="font-medium text-fg">{liveLabel}</span>}
      </span>
      <span class={cx("truncate", status.polling && "text-accent")}>{text}</span>
      {!compact && status.detailTakenAt && status.detailTakenAt !== status.fetchedAt && (
        <span class="hidden truncate xl:inline" title="Cliente→nó, Wi-Fi e CPU são lidos com menos frequência">
          · detalhes {ago(status.detailTakenAt, now)}
        </span>
      )}
    </div>
  );
}

function useRefresh(status: StatusView | null) {
  const [asking, setAsking] = useState(false);
  async function refresh() {
    setAsking(true);
    try {
      await api.refresh();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Falha ao pedir atualização.", { tone: "bad" });
    } finally {
      setAsking(false);
    }
  }
  const busy = asking || Boolean(status?.polling);
  return { refresh, busy, disabled: busy || status?.breaker !== "closed" };
}

/** Pede um poll; o canal ao vivo avisa quando ele termina. */
export function RefreshButton({ icon }: { icon?: boolean }) {
  const status = useStatus();
  const { refresh, busy, disabled } = useRefresh(status);
  const spin = <RefreshCw class={cx("size-4", busy && "animate-spin")} />;
  if (icon) {
    return (
      <IconButton label={busy ? "Lendo o Deco…" : "Atualizar agora"} onClick={refresh} disabled={disabled}>
        {spin}
      </IconButton>
    );
  }
  return (
    <Button onClick={refresh} disabled={disabled} icon={spin}>
      {busy ? "Lendo…" : "Atualizar"}
    </Button>
  );
}

export function ModeBadge() {
  const status = useStatus();
  if (!status) return null;
  const m = status.mode;
  return (
    <div class="flex flex-wrap gap-1.5">
      {m.mock && <Badge tone="accent">Mock</Badge>}
      <Badge tone={m.allowDangerous ? "warn" : m.allowWrite ? "accent" : ""}>
        {m.allowDangerous ? (m.wifiWrite ? "Escrita + reinício/Wi-Fi" : "Escrita + reinício") : m.allowWrite ? "Escrita habilitada" : "Somente leitura"}
      </Badge>
    </div>
  );
}

export function StatusBanners() {
  const status = useStatus();
  const now = useNow(10_000);
  if (!status) return null;

  async function unlock() {
    if (!confirm("Destravar o acesso ao Deco? Faça isso só depois de corrigir DECO_PASSWORD — cada senha errada conta para o bloqueio do roteador.")) return;
    try {
      await api.resetBreaker();
      toast("Acesso ao Deco destravado");
    } catch (err) {
      toast("Falha ao destravar", { tone: "bad", detail: err instanceof Error ? err.message : undefined });
    }
  }

  const items = [
    status.breaker === "locked" && (
      <Banner tone="bad" role="alert" action={<Button size="sm" onClick={unlock}>Destravar</Button>}>
        <strong>Acesso ao Deco travado</strong> após falhas de login ({status.lastError?.message ?? "senha recusada"}). Nenhuma nova tentativa será feita.
      </Banner>
    ),
    status.breaker === "open" && (
      <Banner tone="warn" role="status">
        Falha na última leitura{status.lastError ? `: ${status.lastError.message}` : ""}. Nova tentativa automática em breve.
      </Banner>
    ),
    status.pausedUntil && Date.parse(status.pausedUntil) > now && (
      <Banner tone="warn" role="status">
        Gateway reiniciando: leituras suspensas até{" "}
        {new Date(status.pausedUntil).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}.
      </Banner>
    ),
    status.stale && status.fetchedAt && status.breaker === "closed" && (
      <Banner tone="warn" role="status">
        Dados desatualizados — última leitura {ago(status.fetchedAt, now)}.
      </Banner>
    ),
  ].filter(Boolean);
  if (!items.length) return null;
  return <div class="mb-4 grid gap-2">{items}</div>;
}
