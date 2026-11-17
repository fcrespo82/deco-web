import { MAC_FORMATS } from "../lib/mac-format";
import { useEffect, useState } from "preact/hooks";
import { api } from "../api";
import { useStatus } from "../data";
import { ThemeEditor, downloadTheme } from "./ThemeEditor";
import { THEME_LOAD_ERRORS, getTheme } from "../lib/themes";
import { currentTheme } from "../lib/preferences";
import { Appearance } from "./Appearance";
import { THEMES, usePreferences, resetLocalPreferences } from "../lib/preferences";
import { useQuery } from "../lib/query";
import { useNow } from "../hooks";
import { dateTime, ago } from "../format";
import { Button, Card, Field, Kv, LinkButton, PageLoading, SectionTitle } from "../ui";
const SECTIONS = ["aparencia", "temas", "atualizacao", "alertas", "sistema", "dados"] as const;
type Section = typeof SECTIONS[number];
const LABEL = { aparencia: "Aparência", temas: "Editor de temas", atualizacao: "Atualização", alertas: "Alertas", sistema: "Sistema", dados: "Dados" };
const sectionFromUrl = (): Section => {
  const value = new URLSearchParams(location.hash.split("?")[1]).get("secao");
  return SECTIONS.includes(value as Section) ? value as Section : "aparencia";
};
const enabled = (v: boolean) => v ? "Ativado" : "Desativado";
const threshold = (v: number | null) => v === null ? "Desativado" : `${v / 60} min`;
export function Settings() {
  const [section, setSection] = useState<Section>(sectionFromUrl);
  const [prefs, set] = usePreferences();
  const config = useQuery("settings", api.settings, []);
  const status = useStatus();
  const now = useNow(1000);
  useEffect(() => { const sync = () => setSection(sectionFromUrl()); addEventListener("hashchange", sync); return () => removeEventListener("hashchange", sync); }, []);
  const c = config.data;
  if (!c) return <PageLoading error={config.error} />;
  return <>
    <nav aria-label="Seções de configurações" class="mb-5 flex flex-wrap gap-2">
      {SECTIONS.map(id => <a class={`rounded-lg border px-3 py-2 text-sm ${id === section ? "border-accent bg-accent-soft text-accent" : "border-line text-muted"}`} href={`#/configuracoes?secao=${id}`} aria-current={id === section ? "page" : undefined}>{LABEL[id]}</a>)}
    </nav>
    {section === "temas" && <ThemeEditor />}
    {section === "aparencia" && <>
      <SectionTitle actions={<div class="flex flex-wrap gap-2"><Button onClick={()=>downloadTheme(currentTheme())}>Exportar tema atual</Button><LinkButton href="#/configuracoes?secao=temas">Editar / importar tema</LinkButton></div>}>Tema</SectionTitle>
      {THEME_LOAD_ERRORS.length>0 && <p role="alert" class="mb-3 text-sm text-bad">Arquivos de tema ignorados: {THEME_LOAD_ERRORS.join(" · ")}</p>}
      <div class="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6" role="group" aria-label="Temas">
        {THEMES.filter(t=>t.mode!=="auto").map(t=><button type="button" aria-pressed={prefs.theme===t.id} aria-label={`${t.label} · ${t.mode==="dark"?"Escuro":"Claro"}`} title={getTheme(t.id).description} onClick={()=>set({theme:t.id})} class={`min-w-0 rounded-lg border p-2 text-left transition hover:bg-surface-2 ${prefs.theme===t.id?"border-accent bg-accent-soft":"border-line bg-surface"}`}>
          <span class="mb-2 flex h-7 overflow-hidden rounded" aria-hidden="true">{t.colors.map(color=><span class="flex-1" style={{background:color}}/>)}</span>
          <span class="flex min-h-8 items-start justify-between gap-1 text-xs font-medium leading-snug"><span>{t.label}</span>{prefs.theme===t.id&&<span aria-hidden="true" class="text-accent">✓</span>}</span>
          <span class="mt-1 block text-[11px] text-muted">{t.mode==="dark"?"Escuro":"Claro"}</span>
        </button>)}
      </div>
      <div class="mt-3 grid items-end gap-3 rounded-lg border border-line bg-surface p-3 md:grid-cols-[minmax(160px,0.8fr)_1fr_1fr]" role="group" aria-label="Temas do modo Automático">
        <button type="button" aria-pressed={prefs.theme==="auto"} onClick={()=>set({theme:"auto"})} class={`h-full rounded-md border px-3 py-2 text-left ${prefs.theme==="auto"?"border-accent bg-accent-soft":"border-line hover:bg-surface-2"}`}><span class="block text-sm font-medium">Automático{prefs.theme==="auto"?" ✓":""}</span><span class="block text-xs text-muted">Segue o claro/escuro do sistema</span></button>
        <Field label="Tema claro"><select class="field" value={prefs.autoLightTheme} onChange={e=>set({autoLightTheme:e.currentTarget.value})}>{THEMES.filter(t=>t.mode==="light").map(t=><option value={t.id}>{t.label}</option>)}</select></Field>
        <Field label="Tema escuro"><select class="field" value={prefs.autoDarkTheme} onChange={e=>set({autoDarkTheme:e.currentTarget.value})}>{THEMES.filter(t=>t.mode==="dark").map(t=><option value={t.id}>{t.label}</option>)}</select></Field>
      </div>
      <div class="my-5 grid gap-4 sm:grid-cols-2">
        <Field label="Densidade"><select class="field" value={prefs.density} onChange={e=>set({density:e.currentTarget.value as typeof prefs.density})}><option value="comfortable">Confortável</option><option value="compact">Compacta</option></select></Field>
        <Field label="Animações"><select class="field" value={prefs.motion} onChange={e=>set({motion:e.currentTarget.value as typeof prefs.motion})}><option value="system">Sistema</option><option value="reduced">Reduzidas</option></select></Field>
      </div>
      <SectionTitle>Switches</SectionTitle>
      <p class="mb-5 text-sm"><LinkButton href="#/switches">Configurar e monitorar switches</LinkButton></p>
      <SectionTitle>Endereços MAC</SectionTitle>
      <Field label="Formato de exibição">
        <select class="field" value={prefs.macFormat} onChange={e=>set({macFormat:e.currentTarget.value as typeof prefs.macFormat})}>
          {MAC_FORMATS.map(f=><option value={f.value}>{f.label} · {f.example}</option>)}
        </select>
      </Field>
      <p class="mb-5 mt-2 text-xs text-muted">Aplica-se neste navegador. Os quatro formatos representam o mesmo endereço.</p>
      <SectionTitle>Imagens</SectionTitle><Appearance />
    </>}
    {section === "atualizacao" && <>
      <Card><Kv items={[
        ["Intervalo após cada coleta", `${c.pollIntervalSeconds} s`], ["Detalhes", `A cada ${c.detailEvery} coletas`],
        ["Tolerância de desconexão", `${c.disconnectGraceSeconds} s`],
        ["Última coleta", dateTime(status?.fetchedAt ?? null)], ["Idade dos dados", ago(status?.fetchedAt ?? null, now)],
        ["Detalhes coletados", dateTime(status?.detailTakenAt ?? null)],
        ["Próxima coleta", status?.polling ? "Lendo o Deco…" : status?.pausedUntil && Date.parse(status.pausedUntil) > now ? `Pausada até ${dateTime(status.pausedUntil)}` : status?.breaker !== "closed" ? "Em espera ou bloqueada" : dateTime(status?.nextPollAt ?? null)],
      ]} /></Card>
      <p class="my-3 text-sm text-muted">Valores definidos no servidor, somente para consulta. Nó de conexão, Wi-Fi e CPU/memória dependem da coleta detalhada. A atualização automática da tela não altera a frequência das consultas ao Deco.</p>
      <PollDiagnostics />
    </>}
    {section === "alertas" && <Card><Kv items={[
      ["Dispositivo novo", enabled(c.alerts.newDevice)], ["Nó offline", threshold(c.alerts.nodeOfflineSeconds)], ["Internet indisponível", threshold(c.alerts.internetDownSeconds)],
      ["ntfy", c.channels.ntfy ? "Configurado" : "Não configurado"], ["Telegram", c.channels.telegram ? "Configurado" : "Não configurado"],
    ]} /><p class="mt-4 text-sm text-muted">Regras definidas no servidor. <a class="text-accent" href="#/alertas">Abrir alertas</a></p></Card>}
    {section === "sistema" && <Card><Kv items={[
      ["Versão", c.version], ["Origem", c.mode.mock ? "Dados simulados" : "Deco real"], ["Escritas", enabled(c.mode.allowWrite)],
      ["Operações perigosas", enabled(c.mode.allowDangerous)], ["Recurso experimental de Wi-Fi", enabled(c.mode.wifiWrite)],
      ["Coleta", status?.polling ? "Em andamento" : status?.pausedUntil && Date.parse(status.pausedUntil) > now ? "Pausada" : status?.breaker === "locked" ? "Bloqueada" : status?.breaker === "open" ? "Em espera após falha" : status?.lastError ? "Falha na última leitura" : "Pronta"],
    ]} /></Card>}
    {section === "dados" && <Card>
      <p class="mb-3">Retenção de eventos e amostras: <strong>{c.retentionDays} dias</strong>.</p>
      <a class="text-accent underline" href="#/backup">Backup e restauração dos cadastros</a>
      <p class="my-4 text-sm text-muted">Temas personalizados, preferências e filtros pertencem a este navegador. Favoritos e cadastros são compartilhados e incluídos no backup. O diagnóstico mantém até 200 tentativas e não entra no backup.</p>
      <Button onClick={() => { if (confirm("Restaurar temas, preferências e filtros deste navegador? Os cadastros e favoritos serão preservados.")) resetLocalPreferences(); }}>Restaurar preferências locais</Button>
    </Card>}
  </>;
}
function PollDiagnostics() {
  const {data,error} = useQuery("poll-diagnostics", api.pollDiagnostics, ["status"]);
  if (!data) return <PageLoading error={error} />;
  return <>
    <SectionTitle>Diagnóstico da coleta</SectionTitle>
    <p class="mb-3 text-sm text-muted">Duração total da tentativa, incluindo espera na fila e complementação local. Últimas 100 tentativas concluídas; consultar esta tela não acessa o Deco.</p>
    <Card><Kv items={[
      ["Última duração", data.attempts[0] ? `${(data.attempts[0].durationMs/1000).toFixed(1)} s` : "—"],
      ["Duração média", data.summary.averageDurationMs === null ? "—" : `${(data.summary.averageDurationMs/1000).toFixed(1)} s`],
      ["Sucessos / falhas", `${data.summary.successes} / ${data.summary.failures}`], ["Falhas consecutivas", String(data.summary.consecutiveFailures)],
    ]} /></Card>
    <div class="mt-4 overflow-x-auto"><table class="rtable"><thead><tr><th>Início</th><th>Duração</th><th>Resultado</th></tr></thead><tbody>
      {data.attempts.map(a => <tr key={a.id}><td>{dateTime(a.startedAt)}</td><td>{(a.durationMs/1000).toFixed(1)} s</td><td>{a.outcome === "success" ? "Sucesso" : a.category === "auth" ? "Falha de autenticação" : a.category === "busy" ? "Deco ocupado" : "Falha de comunicação ou processamento"}</td></tr>)}
    </tbody></table>{!data.attempts.length && <p class="p-4 text-muted">Nenhuma tentativa concluída registrada.</p>}</div>
  </>;
}
