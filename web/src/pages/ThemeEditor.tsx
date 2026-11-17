import {CATEGORY,DeviceArt,type Category} from "../art/devices";
import {editThemeColor,MAIN_THEME_COLORS,STATE_THEME_COLORS} from "../lib/theme-palette";
import { useEffect, useState } from "preact/hooks";
import { currentTheme, setThemePreview, setPreferences, usePreferences } from "../lib/preferences";
import { THEME_LOAD_ERRORS, getTheme, listThemes, isBuiltin, saveTheme, importTheme, removeTheme, parseTheme, serializeTheme, THEME_COLOR_KEYS, type ThemeConfig, type ThemeColorKey } from "../lib/themes";
import { Badge, Button, Card, Check, Field, FileButton, SectionTitle } from "../ui";
import { toast } from "../lib/toast";

const LABELS: Record<string,string> = {
  bg:"Fundo da página",surface:"Superfície dos painéis","surface-2":"Superfície secundária","surface-3":"Superfície de apoio",line:"Bordas",text:"Texto principal",muted:"Texto secundário",accent:"Destaque","accent-soft":"Fundo do destaque","accent-text":"Texto sobre destaque",
  "brand-from":"Marca: início","brand-to":"Marca: fim",ok:"Sucesso","ok-soft":"Fundo de sucesso",warn:"Aviso","warn-soft":"Fundo de aviso",bad:"Erro","bad-soft":"Fundo de erro","bad-text":"Texto sobre erro","series-other":"Gráfico: outras séries",grid:"Grade dos gráficos",
  "band-wired":"Rede: cabo","band-5":"Rede: 5 GHz","band-24":"Rede: 2,4 GHz","band-6":"Rede: 6 GHz","flow-down":"Download","flow-up":"Upload","led-on":"LED online","led-off":"LED offline",
  "deco-light":"Equipamento: corpo claro","deco-mid":"Equipamento: corpo médio","deco-shade":"Equipamento: sombra","deco-floor":"Equipamento: sombra no chão","deco-cap":"Equipamento: tampa","deco-cap-top":"Equipamento: topo da tampa","deco-pedestal":"Base da foto",
  "hero-from":"Painel: início do efeito","hero-to":"Painel: fim do efeito",sidebar:"Fundo da navegação","sidebar-2":"Seleção na navegação","sidebar-text":"Texto da navegação","sidebar-strong":"Texto selecionado da navegação","edge-light":"Relevo: aresta clara","edge-dark":"Relevo: aresta escura",titlebar:"Barra de título","device-icon-bg":"Fundo dos ícones sóbrios",shadow:"Cor das sombras",
};
for(let i=1;i<=8;i++) LABELS[`series-${i}`]=`Gráfico: série ${i}`;
const GEOMETRY: [keyof ThemeConfig["geometry"],string,number][] = [
  ["controlRadius","Cantos dos controles",32],["cardRadius","Cantos dos painéis",32],["dialogRadius","Cantos dos diálogos",32],["badgeRadius","Cantos dos indicadores",999],["iconRadius","Cantos dos ícones",32],["borderWidth","Espessura das bordas",3],
];
function cloneForEdit(theme:ThemeConfig):ThemeConfig {
  const copy=structuredClone(theme);
  if(isBuiltin(theme.id)) {
    const base=`custom-${theme.id}`.slice(0,55);
    let id=base; let n=2;
    while(listThemes().some(t=>t.id===id)) id=`${base}-${n++}`;
    copy.id=id; copy.label=`${theme.label.slice(0,65)} personalizado`; copy.order=100;
  }
  return copy;
}
export function downloadTheme(config:ThemeConfig) {
  const blob=new Blob([serializeTheme(config)],{type:"application/json"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a"); a.href=url; a.download=`${config.id}.theme.json`; a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export function ThemeEditor() {
  usePreferences(); // também refaz a lista quando um tema é importado em outra aba
  const [draft,setDraft]=useState(()=>cloneForEdit(currentTheme()));
  const [base,setBase]=useState(()=>currentTheme().id);
  const [error,setError]=useState<string|null>(null);
  const [draftError,setDraftError]=useState<string|null>(null);
  const [preview,setPreview]=useState(true);
  const [expandedPreview,setExpandedPreview]=useState(false);
  const [automaticColors,setAutomaticColors]=useState(true);
  useEffect(()=>{
    if(!preview) {setThemePreview(null);return;}
    try {setThemePreview(parseTheme(draft));setDraftError(null);} catch(e){setDraftError(e instanceof Error?e.message:"Tema inválido.");}
  },[draft,preview]);
  useEffect(()=>()=>setThemePreview(null),[]);
  const patch=<K extends keyof ThemeConfig>(key:K,value:ThemeConfig[K])=>setDraft(old=>({...old,[key]:value}));
  function save() {
    try {
      if(draft.id!==base && listThemes().some(t=>t.id===draft.id)) throw new Error("Esse identificador já pertence a outro tema. Escolha um novo.");
      const result=saveTheme(draft); setThemePreview(null); setPreferences({theme:result.theme.id});
      setBase(result.theme.id);setPreview(false);setError(null);
      toast(result.persisted?"Tema salvo e aplicado neste navegador":"Tema aplicado nesta sessão; o navegador não permitiu persistir.");
    } catch(e){setError(e instanceof Error?e.message:"Não foi possível salvar.");}
  }
  async function load(file:File) {
    try {
      if(file.size>65536) throw new Error("O arquivo deve ter no máximo 64 KB.");
      const result=importTheme(JSON.parse(await file.text()));
      setDraft(structuredClone(result.theme));setBase(result.theme.id);setPreferences({theme:result.theme.id});setPreview(true);setError(null);
      toast(result.persisted?"Tema importado; o original foi preservado":"Tema importado apenas nesta sessão: armazenamento indisponível.");
    } catch(e){setError(e instanceof Error?e.message:"Não foi possível importar.");}
  }
  function choose(id:string) {setBase(id);setDraft(cloneForEdit(getTheme(id)));setPreview(true);setError(null);}
  const colorField=(key:ThemeColorKey)=><Field label={LABELS[key]??key} class="min-w-0"><div class="flex gap-2"><input type="color" class="h-9 w-10 shrink-0 rounded border border-line" aria-label={`${LABELS[key]??key}: seletor de cor`} value={/^#[\da-f]{6}/i.test(draft.colors[key])?draft.colors[key].slice(0,7):"#000000"} onInput={e=>{patch("colors",editThemeColor(draft.colors,key,e.currentTarget.value+(draft.colors[key].length===9?draft.colors[key].slice(7):""),automaticColors));setPreview(true);}}/><input class="field min-w-0 font-mono" aria-label={LABELS[key]??key} maxLength={9} value={draft.colors[key]} onInput={e=>{patch("colors",editThemeColor(draft.colors,key,e.currentTarget.value,automaticColors));setPreview(true);}}/></div></Field>;
  const advancedGroups=[
   {name:"Superfícies e navegação",keys:["surface-2","surface-3","line","muted","accent-soft","accent-text","brand-from","brand-to","hero-from","hero-to","sidebar","sidebar-2","sidebar-text","sidebar-strong","grid","ok-soft","warn-soft","bad-soft","bad-text"]},
   {name:"Gráficos e conexões",keys:THEME_COLOR_KEYS.filter(k=>k.startsWith("series-")||k.startsWith("band-")||k.startsWith("flow-")||k.startsWith("led-"))},
   {name:"Equipamentos e acabamento",keys:THEME_COLOR_KEYS.filter(k=>k.startsWith("deco-")||k.startsWith("edge-")||["titlebar","device-icon-bg","shadow"].includes(k))},
  ];
  return <>
    <SectionTitle>Editor de temas</SectionTitle>
    <p class="mb-4 max-w-3xl text-sm text-muted">A prévia altera o acabamento desta página em tempo real. Ao sair sem salvar, o tema selecionado volta. Salve e abra o modo TV para conferir a mesma configuração em tela cheia.</p>
    <div class="mb-4 flex flex-wrap items-center gap-2">
      <Button variant="primary" onClick={save} disabled={!!draftError}>Salvar e aplicar</Button>
      <Button onClick={()=>{try{downloadTheme(draft);setError(null);}catch(e){setError((e as Error).message);}}}>Exportar JSON</Button>
      <FileButton accept="application/json,.json" onFile={file=>void load(file)}>Importar JSON</FileButton>
      <Button onClick={()=>{setPreview(false);setThemePreview(null);}}>Cancelar prévia</Button>
      <Button onClick={()=>choose(base)}>Restaurar rascunho</Button>
      {!isBuiltin(draft.id) && listThemes().some(t=>t.id===draft.id) && <Button variant="danger" onClick={()=>{if(confirm("Excluir este tema personalizado deste navegador?")){removeTheme(draft.id);setPreferences({theme:"professional-light"});choose("professional-light");}}}>Excluir tema</Button>}
    </div>
    {THEME_LOAD_ERRORS.length>0 && <p class="mb-4 text-sm text-bad" role="alert">Arquivos de tema ignorados: {THEME_LOAD_ERRORS.join(" · ")}</p>}
    {(error||draftError) && <p class="mb-4 text-sm text-bad" role="alert">{error??draftError} {draftError&&"A prévia mantém o último acabamento válido."}</p>}
    <div class="theme-editor-layout">
      <div class="min-w-0 space-y-4">
        <Card>
          <div class="grid gap-4 sm:grid-cols-2">
            <Field label="Começar de"><select class="field" value={base} onChange={e=>choose(e.currentTarget.value)}>{listThemes().map(t=><option value={t.id}>{t.label}</option>)}</select></Field>
            <Field label="Nome"><input class="field" value={draft.label} maxLength={80} onInput={e=>{patch("label",e.currentTarget.value);setPreview(true);}}/></Field>
            <Field label="Identificador"><input class="field" value={draft.id} maxLength={64} onInput={e=>{patch("id",e.currentTarget.value);setPreview(true);}}/></Field>
            <Field label="Modo"><select class="field" value={draft.mode} onChange={e=>{patch("mode",e.currentTarget.value as ThemeConfig["mode"]);setPreview(true);}}><option value="light">Claro</option><option value="dark">Escuro</option></select></Field>
            <Field label="Descrição" class="sm:col-span-2"><input class="field" value={draft.description} maxLength={300} onInput={e=>patch("description",e.currentTarget.value)}/></Field>
            <Field label="Posição entre temas personalizados"><input class="field" type="number" min={0} max={10000} value={draft.order} onInput={e=>patch("order",e.currentTarget.valueAsNumber)}/></Field>
          </div>
        </Card>
        <Card><h3 class="mb-3 font-semibold">Geometria e tipografia</h3><div class="grid gap-4 sm:grid-cols-2">
          {GEOMETRY.map(([key,label,max])=><Field label={`${label} (px)`}><input class="field" type="number" min={0} max={max} step={1} value={draft.geometry[key]} onInput={e=>{patch("geometry",{...draft.geometry,[key]:e.currentTarget.valueAsNumber});setPreview(true);}}/></Field>)}
          <Field label="Fonte"><select class="field" value={draft.typography.family} onChange={e=>{patch("typography",{...draft.typography,family:e.currentTarget.value as ThemeConfig["typography"]["family"]});setPreview(true);}}><option value="plex">IBM Plex Sans</option><option value="system">Sistema</option><option value="arial">Arial</option></select></Field>
          <Field label="Tamanho base do texto (px)"><input class="field" type="number" min={12} max={18} value={draft.typography.size} onInput={e=>{patch("typography",{...draft.typography,size:e.currentTarget.valueAsNumber});setPreview(true);}}/></Field>
        </div></Card>
        <Card><h3 class="mb-3 font-semibold">Efeitos</h3><div class="grid gap-3 sm:grid-cols-2">
          {([["gradients","Gradientes decorativos"],["glow","Brilho decorativo"],["bevel","Relevo clássico dos controles"],["colorfulIcons","Ícones com cores por categoria"]] as const).map(([key,label])=><Check checked={draft.effects[key]} onChange={()=>{patch("effects",{...draft.effects,[key]:!draft.effects[key]});setPreview(true);}}>{label}</Check>)}
          <Field label="Sombras"><select class="field" value={draft.shadow} onChange={e=>{patch("shadow",e.currentTarget.value as ThemeConfig["shadow"]);setPreview(true);}}><option value="none">Sem sombra</option><option value="soft">Suave</option><option value="hard">Clássica, sem desfoque</option></select></Field>
        </div></Card>
        <Card><h3 class="mb-2 font-semibold">Cores principais</h3><p class="mb-3 text-xs text-muted">Escolha fundo, painéis, texto e destaque. Bordas, tons secundários, navegação e fundos dos estados acompanham as cores principais.</p><Check checked={automaticColors} onChange={()=>setAutomaticColors(!automaticColors)}>Derivar tons relacionados ao editar</Check><div class="mt-4 grid gap-3 sm:grid-cols-2">{MAIN_THEME_COLORS.map(colorField)}</div>
          <details class="mt-4 border-t border-line pt-3"><summary class="cursor-pointer text-sm font-medium">Estados: sucesso, aviso e erro</summary><div class="mt-3 grid gap-3 sm:grid-cols-2">{STATE_THEME_COLORS.map(colorField)}</div></details>
          <details class="mt-3 border-t border-line pt-3"><summary class="cursor-pointer text-sm font-medium">Ajustes avançados de cor</summary><p class="mt-2 text-xs text-muted">Os temas importados mantêm suas cores. Ajustes manuais ficam preservados até uma cor principal relacionada ser alterada; desative a derivação para editar cada tom independentemente.</p>{advancedGroups.map(group=><details class="mt-3"><summary class="cursor-pointer py-1 text-xs font-medium text-muted">{group.name}</summary><div class="mt-3 grid gap-3 sm:grid-cols-2">{group.keys.map(key=>colorField(key as ThemeColorKey))}</div></details>)}</details>
        </Card>
      </div>
      <aside class={`theme-editor-preview ${expandedPreview?"is-expanded":""}`} aria-label="Prévia do acabamento">
        <Card>
          <div class="theme-preview-heading"><h3 class="font-semibold">Prévia {preview?"temporária":"do tema aplicado"}</h3><button type="button" class="theme-preview-expand text-xs text-accent underline" aria-expanded={expandedPreview} onClick={()=>setExpandedPreview(!expandedPreview)}>{expandedPreview?"Compactar":"Mais exemplos"}</button></div>
          <div class="theme-effect-panel theme-preview-effect rounded-xl border border-line bg-surface p-4"><p class="font-medium">Painel em destaque</p><p class="mt-1 text-xs text-muted">Gradiente no fundo · brilho ao redor da borda</p></div>
          <div class="theme-preview-icons" role="group" aria-label="Ícones por categoria"><p class="mb-2 text-xs text-muted">Ícones: {draft.effects.colorfulIcons?"cores por categoria":"cor única do tema"}</p><div class="theme-preview-categories">{(["phone","laptop","tv","server","network","light"] as Category[]).map(category=><div class="flex min-w-0 flex-col items-center gap-1"><DeviceArt category={category} size="sm" preferIcon/><span class="text-[11px] text-muted">{CATEGORY[category].label}</span></div>)}</div></div>
          <div class="mb-3 flex flex-wrap gap-2"><Badge tone="ok">Online</Badge><Badge tone="warn">Aviso</Badge><Badge tone="bad">Falha</Badge></div>
          <div class="theme-preview-extra">
          <div class="mb-4 flex flex-wrap gap-2"><Button variant="primary">Ação principal</Button><Button>Secundária</Button><Button disabled>Desativada</Button></div>
          <input class="field mb-3" aria-label="Campo de exemplo" placeholder="Campo de exemplo"/>
          <div class="mb-4 flex flex-wrap gap-2"><Badge tone="ok">Online</Badge><Badge tone="warn">Aviso</Badge><Badge tone="bad">Falha</Badge></div>
          <table class="rtable mb-4"><thead><tr><th>Dispositivo</th><th>Estado</th></tr></thead><tbody><tr><td>Servidor</td><td>Online</td></tr><tr><td>Impressora</td><td>Offline</td></tr></tbody></table>
          <div class="mb-4 h-20 rounded-xl border border-line bg-surface-2 p-3"><div class="flex h-full items-end gap-2">{[40,75,55,95,65].map((height,i)=><span class="flex-1" style={{height:`${height}%`,background:`var(--series-${i+1})`}}/>)}</div></div>
          <div class="tv-bg border border-line p-3"><p class="mb-2 text-xs text-muted">Prévia do modo TV</p><div class="tv-card"><strong>6 / 6 nós online</strong><p class="text-sm text-muted">Painel com o mesmo raio e borda da TV</p><div class="theme-icon mt-2 inline-flex size-9 items-center justify-center bg-ok-soft text-ok">✓</div></div></div>
          </div>
        </Card>
        <p class="theme-preview-extra mt-3 text-xs text-muted">Temas personalizados ficam neste navegador e podem ser transferidos pelo JSON. Importar um identificador existente cria uma cópia.</p>
      </aside>
    </div>
  </>;
}
