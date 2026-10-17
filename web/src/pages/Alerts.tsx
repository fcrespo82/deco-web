import { useState } from "preact/hooks";
import { api, ApiError, type AlertEntry, type ClientView } from "../api";
import { BAND_LABEL, ago, dateTime, deviceType } from "../format";
import { usePolled } from "../hooks";

const KIND_LABEL: Record<AlertEntry["kind"], string> = {
  new_device: "Dispositivo novo",
  node_offline: "Nó offline",
  node_online: "Nó voltou",
  internet_down: "Internet caiu",
  internet_up: "Internet voltou",
  test: "Teste",
};
const KIND_TONE: Record<AlertEntry["kind"], string> = {
  new_device: "warn",
  node_offline: "bad",
  node_online: "ok",
  internet_down: "bad",
  internet_up: "ok",
  test: "",
};
const CHANNEL_LABEL: Record<string, string> = { ntfy: "ntfy", telegram: "Telegram" };

function Delivery({ a }: { a: AlertEntry }) {
  if (a.delivery.length === 0) return <span class="muted small">sem canal</span>;
  return (
    <div class="chips">
      {a.delivery.map((d) => (
        <span class={`badge ${d.ok ? "ok" : "bad"}`} title={d.error}>
          {d.ok ? "✓" : "✗"} {CHANNEL_LABEL[d.channel] ?? d.channel}
        </span>
      ))}
    </div>
  );
}

function Pending({ pending, onChange }: { pending: ClientView[]; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function approve(macs: string[], label: string) {
    if (macs.length > 1 && !confirm(`Aprovar ${label}? Eles deixam de gerar alerta de dispositivo novo.`)) return;
    setBusy(true);
    setError(null);
    try {
      await api.approve(macs);
      onChange();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Falha ao aprovar.");
    } finally {
      setBusy(false);
    }
  }
  const online = pending.filter((c) => c.online);
  return (
    <>
      <div class="section-head">
        <h2>Aguardando aprovação ({pending.length})</h2>
        {pending.length > 1 && (
          <div class="row-actions">
            {online.length > 0 && online.length < pending.length && (
              <button class="btn" disabled={busy} onClick={() => approve(online.map((c) => c.mac), `os ${online.length} online`)}>
                Aprovar online ({online.length})
              </button>
            )}
            <button class="btn" disabled={busy} onClick={() => approve(pending.map((c) => c.mac), `todos os ${pending.length}`)}>
              Aprovar todos
            </button>
          </div>
        )}
      </div>
      {error && <div class="error">{error}</div>}
      {pending.length === 0 ? (
        <p class="muted">Todos os aparelhos vistos estão aprovados.</p>
      ) : (
        <div class="table-wrap">
          <table>
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
                <tr key={c.mac} class={c.online ? "" : "offline"}>
                  <td class="primary-cell">
                    <span class={`dot ${c.online ? "ok" : ""}`} style="margin-right:6px" />
                    {c.device?.alias ?? c.name}
                    <div class="muted small">{deviceType(c.deviceType)}</div>
                  </td>
                  <td data-label="MAC" class="mono">{c.mac}</td>
                  <td data-label="Estado" class="small">
                    {[c.ip, c.band && BAND_LABEL[c.band], c.nodeName, c.online ? null : c.lastSeen ? `visto ${ago(c.lastSeen)}` : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </td>
                  <td data-label="Primeira vez" class="small" title={dateTime(c.firstSeen)}>
                    {ago(c.firstSeen)}
                  </td>
                  <td>
                    <button class="btn" disabled={busy} onClick={() => approve([c.mac], c.name)} aria-label={`Aprovar ${c.device?.alias ?? c.name}`}>
                      Aprovar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

export function Alerts() {
  const { data, error, reload } = usePolled(api.alerts, 30_000);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);

  if (!data) return <div class="empty">{error ? `Erro: ${error.message}` : "Carregando…"}</div>;
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
      void reload();
    } catch (e) {
      setTestResult({ ok: false, text: e instanceof Error ? e.message : "Falha." });
    } finally {
      setTesting(false);
    }
  }

  return (
    <>
      <div class="grid cols-2">
        <div class="card">
          <h3 style="margin:0 0 8px">Canais</h3>
          {data.channels.length === 0 ? (
            <p class="muted small" style="margin:0">
              Nenhum canal configurado: os alertas ficam só nesta tela. Configure <code>NOTIFY_NTFY_URL</code> ou{" "}
              <code>NOTIFY_TELEGRAM_TOKEN</code> + <code>NOTIFY_TELEGRAM_CHAT_ID</code>.
            </p>
          ) : (
            <dl class="kv" style="margin-top:0">
              {data.channels.map((c) => (
                <>
                  <dt>{CHANNEL_LABEL[c.name] ?? c.name}</dt>
                  <dd>{c.target}</dd>
                </>
              ))}
            </dl>
          )}
          <div class="form-actions" style="margin-top:10px">
            <button class="btn" onClick={test} disabled={testing || data.channels.length === 0}>
              {testing ? "Enviando…" : "Enviar teste"}
            </button>
            {testResult && (
              <span class={`small ${testResult.ok ? "" : "error"}`} role="status">
                {testResult.text}
              </span>
            )}
          </div>
        </div>
        <div class="card">
          <h3 style="margin:0 0 8px">Regras</h3>
          <dl class="kv" style="margin-top:0">
            <dt>Dispositivo novo</dt>
            <dd>{s.newDevice ? "MAC nunca visto e não aprovado" : "desligado"}</dd>
            <dt>Nó offline</dt>
            <dd>{s.nodeOfflineMinutes === null ? "desligado" : `após ${s.nodeOfflineMinutes} min, e quando voltar`}</dd>
            <dt>Internet</dt>
            <dd>{s.internetDownMinutes === null ? "desligado" : `fora por ${s.internetDownMinutes} min, e quando voltar`}</dd>
          </dl>
          {!s.publicUrl && (
            <p class="muted small" style="margin:8px 0 0">
              Defina <code>PUBLIC_URL</code> para as notificações abrirem o painel.
            </p>
          )}
        </div>
      </div>

      <Pending pending={data.pending} onChange={() => void reload()} />

      <h2>Alertas recentes</h2>
      {data.alerts.length === 0 ? (
        <p class="muted">Nenhum alerta ainda.</p>
      ) : (
        <div class="table-wrap">
          <table>
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
                <tr key={a.id}>
                  <td class="primary-cell small nowrap">
                    {dateTime(a.at)} <span class="muted">· {ago(a.at)}</span>
                  </td>
                  <td data-label="Alerta">
                    <span class={`badge ${KIND_TONE[a.kind]}`}>{KIND_LABEL[a.kind] ?? a.kind}</span>
                    <div>{a.title}</div>
                  </td>
                  <td data-label="Detalhe" class="small pre-line">{a.body}</td>
                  <td data-label="Entrega">
                    <Delivery a={a} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p class="muted small">
        Cada alerta é enviado uma vez; se um canal falhar, a falha fica registrada aqui (passe o mouse sobre ✗) e não há
        reenvio. Sem internet, ntfy público e Telegram não entregam — o aviso de "internet voltou" diz quanto tempo ela
        ficou fora.
      </p>
    </>
  );
}
