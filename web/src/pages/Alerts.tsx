import { useState } from "preact/hooks";
import { Bell, Check as CheckIcon, Send } from "lucide-preact";
import { api, type AlertEntry, type AlertsView, type ClientView } from "../api";
import { KEYS, useAlerts } from "../data";
import { BAND_LABEL, ago, dateTime, deviceType } from "../format";
import { errorText, mutate } from "../lib/mutate";
import { setQueryData } from "../lib/query";
import { Badge, Button, Card, Dot, Empty, Kv, PageLoading, SectionTitle, TableCard } from "../ui";

const KIND_LABEL: Record<AlertEntry["kind"], string> = {
  new_device: "Dispositivo novo",
  node_offline: "Nó offline",
  node_online: "Nó voltou",
  internet_down: "Internet caiu",
  internet_up: "Internet voltou",
  test: "Teste",
};
const KIND_TONE: Record<AlertEntry["kind"], "ok" | "warn" | "bad" | ""> = {
  new_device: "warn",
  node_offline: "bad",
  node_online: "ok",
  internet_down: "bad",
  internet_up: "ok",
  test: "",
};
const CHANNEL_LABEL: Record<string, string> = { ntfy: "ntfy", telegram: "Telegram" };

function Delivery({ a }: { a: AlertEntry }) {
  if (a.delivery.length === 0) return <span class="text-[12.5px] text-muted">sem canal</span>;
  return (
    <div class="flex flex-wrap gap-1">
      {a.delivery.map((d) => (
        <Badge tone={d.ok ? "ok" : "bad"} title={d.error}>
          {d.ok ? "✓" : "✗"} {CHANNEL_LABEL[d.channel] ?? d.channel}
        </Badge>
      ))}
    </div>
  );
}

type Clients = { status: unknown; clients: ClientView[] };

/** Aprovar some da lista na hora; se o servidor recusar, volta. */
function approve(macs: string[], what: string) {
  void mutate({
    optimistic: () => [
      setQueryData<AlertsView>(KEYS.alerts, (d) => ({ ...d, pending: d.pending.filter((c) => !macs.includes(c.mac)) })),
      setQueryData<Clients>(KEYS.clients, (d) => ({
        ...d,
        clients: d.clients.map((c) => (macs.includes(c.mac) && c.device ? { ...c, device: { ...c.device, approved: true } } : c)),
      })),
    ],
    run: () => api.approve(macs),
    success: macs.length === 1 ? `${what} aprovado` : `${macs.length} aparelhos aprovados`,
    invalidates: ["inventory"],
    failure: "Não foi possível aprovar",
  });
}

function Pending({ pending }: { pending: ClientView[] }) {
  const online = pending.filter((c) => c.online);
  const bulk = (macs: string[], label: string) => {
    if (confirm(`Aprovar ${label}? Eles deixam de gerar alerta de dispositivo novo.`)) approve(macs, label);
  };
  return (
    <>
      <SectionTitle
        actions={
          pending.length > 1 && (
            <>
              {online.length > 0 && online.length < pending.length && (
                <Button onClick={() => bulk(online.map((c) => c.mac), `os ${online.length} online`)}>Aprovar online ({online.length})</Button>
              )}
              <Button icon={<CheckIcon class="size-4" />} onClick={() => bulk(pending.map((c) => c.mac), `todos os ${pending.length}`)}>
                Aprovar todos
              </Button>
            </>
          )
        }
      >
        Aguardando aprovação <span class="font-normal text-muted">· {pending.length}</span>
      </SectionTitle>
      {pending.length === 0 ? (
        <p class="text-muted">Todos os aparelhos vistos estão aprovados.</p>
      ) : (
        <TableCard>
          <table class="rtable">
            <thead>
              <tr>
                <th>Aparelho</th>
                <th>MAC</th>
                <th>Último estado</th>
                <th>Primeira vez</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {pending.map((c) => (
                <tr key={c.mac} class={c.online ? "" : "is-off"}>
                  <td class="cell-primary">
                    <span class="flex items-center gap-2 font-medium text-fg">
                      <Dot tone={c.online ? "ok" : "off"} />
                      {c.device?.alias ?? c.name}
                    </span>
                    <div class="pl-4 text-[12px] text-muted">{deviceType(c.deviceType)}</div>
                  </td>
                  <td data-label="MAC" class="whitespace-nowrap font-mono text-[12.5px]">
                    {c.mac}
                  </td>
                  <td data-label="Estado" class="text-[12.5px]">
                    {[c.ip, c.band && BAND_LABEL[c.band], c.nodeName, c.online ? null : c.lastSeen ? `visto ${ago(c.lastSeen)}` : null].filter(Boolean).join(" · ")}
                  </td>
                  <td data-label="Primeira vez" class="text-[12.5px]" title={dateTime(c.firstSeen)}>
                    {ago(c.firstSeen)}
                  </td>
                  <td class="cell-actions text-right">
                    <Button size="sm" icon={<CheckIcon class="size-3.5" />} onClick={() => approve([c.mac], c.device?.alias ?? c.name)} aria-label={`Aprovar ${c.device?.alias ?? c.name}`}>
                      Aprovar
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableCard>
      )}
    </>
  );
}

export function Alerts() {
  const { data, error } = useAlerts();
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);

  if (!data) return <PageLoading error={error} />;
  const s = data.settings;

  async function test() {
    setTesting(true);
    setTestResult(null);
    try {
      const a = await api.testAlert();
      const failed = a.delivery.filter((d) => !d.ok);
      setTestResult(
        failed.length
          ? { ok: false, text: `Falhou: ${failed.map((d) => `${CHANNEL_LABEL[d.channel] ?? d.channel} (${d.error})`).join("; ")}` }
          : { ok: true, text: "Enviado. Confira no celular." },
      );
    } catch (e) {
      setTestResult({ ok: false, text: errorText(e, "Falha.") });
    } finally {
      setTesting(false);
    }
  }

  return (
    <>
      <div class="grid gap-3 md:grid-cols-2">
        <Card>
          <h3 class="mb-3 font-semibold">Canais</h3>
          {data.channels.length === 0 ? (
            <p class="text-[12.5px] text-muted">
              Nenhum canal configurado: os alertas ficam só nesta tela. Configure <code>NOTIFY_NTFY_URL</code> ou <code>NOTIFY_TELEGRAM_TOKEN</code> +{" "}
              <code>NOTIFY_TELEGRAM_CHAT_ID</code>.
            </p>
          ) : (
            <Kv items={data.channels.map((c) => [CHANNEL_LABEL[c.name] ?? c.name, c.target])} />
          )}
          <div class="mt-4 flex flex-wrap items-center gap-3">
            <Button icon={<Send class="size-4" />} onClick={test} loading={testing} disabled={data.channels.length === 0}>
              {testing ? "Enviando…" : "Enviar teste"}
            </Button>
            {testResult && (
              <span class={`text-[12.5px] ${testResult.ok ? "text-ok" : "text-bad"}`} role="status">
                {testResult.text}
              </span>
            )}
          </div>
        </Card>
        <Card>
          <h3 class="mb-3 font-semibold">Regras</h3>
          <Kv
            items={[
              ["Dispositivo novo", s.newDevice ? "MAC nunca visto e não aprovado" : "desligado"],
              ["Nó offline", s.nodeOfflineMinutes === null ? "desligado" : `após ${s.nodeOfflineMinutes} min, e quando voltar`],
              ["Internet", s.internetDownMinutes === null ? "desligado" : `fora por ${s.internetDownMinutes} min, e quando voltar`],
            ]}
          />
          {!s.publicUrl && (
            <p class="mt-3 text-[12.5px] text-muted">
              Defina <code>PUBLIC_URL</code> para as notificações abrirem o painel.
            </p>
          )}
        </Card>
      </div>

      <Pending pending={data.pending} />

      <SectionTitle>Alertas recentes</SectionTitle>
      {data.alerts.length === 0 ? (
        <Empty icon={<Bell />}>Nenhum alerta ainda.</Empty>
      ) : (
        <TableCard>
          <table class="rtable">
            <thead>
              <tr>
                <th>Quando</th>
                <th>Alerta</th>
                <th>Detalhe</th>
                <th>Entrega</th>
              </tr>
            </thead>
            <tbody>
              {data.alerts.map((a) => (
                <tr key={a.id} class="animate-fade-in">
                  <td class="cell-primary whitespace-nowrap text-[12.5px]">
                    <span class="text-fg">{dateTime(a.at)}</span> <span class="text-muted">· {ago(a.at)}</span>
                  </td>
                  <td data-label="Alerta">
                    <Badge tone={KIND_TONE[a.kind]}>{KIND_LABEL[a.kind] ?? a.kind}</Badge>
                    <div class="mt-0.5">{a.title}</div>
                  </td>
                  <td data-label="Detalhe" class="whitespace-pre-line text-[12.5px]">
                    {a.body}
                  </td>
                  <td data-label="Entrega">
                    <Delivery a={a} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableCard>
      )}
      <p class="mt-4 text-[12.5px] text-muted">
        Cada alerta é enviado uma vez; se um canal falhar, a falha fica registrada aqui (passe o mouse sobre ✗) e não há reenvio. Sem internet, ntfy público e
        Telegram não entregam — o aviso de "internet voltou" diz quanto tempo ela ficou fora.
      </p>
    </>
  );
}
