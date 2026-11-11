/** Formato portável de temas; não aceita CSS ou URLs arbitrárias. */
export const THEME_COLOR_KEYS = ["bg", "surface", "surface-2", "surface-3", "line", "text", "muted", "accent", "accent-soft", "accent-text", "brand-from", "brand-to", "ok", "ok-soft", "warn", "warn-soft", "bad", "bad-soft", "bad-text", "series-1", "series-2", "series-3", "series-4", "series-5", "series-6", "series-7", "series-8", "series-other", "grid", "band-wired", "band-5", "band-24", "band-6", "flow-down", "flow-up", "led-on", "led-off", "deco-light", "deco-mid", "deco-shade", "deco-floor", "deco-cap", "deco-cap-top", "hero-from", "hero-to", "deco-pedestal", "sidebar", "sidebar-2", "sidebar-text", "sidebar-strong", "edge-light", "edge-dark", "titlebar", "device-icon-bg", "shadow"] as const;
export type ThemeColorKey = typeof THEME_COLOR_KEYS[number];
export interface ThemeConfig {
  format: "deco-web-theme"; version: 1; id: string; label: string; description: string; mode: "light" | "dark"; order: number;
  colors: Record<ThemeColorKey, string>;
  geometry: { controlRadius: number; cardRadius: number; dialogRadius: number; badgeRadius: number; iconRadius: number; borderWidth: number };
  typography: { family: "plex" | "system" | "arial"; size: number };
  effects: { gradients: boolean; glow: boolean; bevel: boolean; colorfulIcons: boolean };
  shadow: "none" | "soft" | "hard";
}
const object = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("Configuração de tema inválida.");
  return v as Record<string,unknown>;
};
function fields(raw: Record<string,unknown>, keys: readonly string[]) {
  if (Object.keys(raw).some(k=>!keys.includes(k))) throw new Error("O tema contém campos não reconhecidos.");
}
function text(v: unknown, max: number, optional = false): string {
  if (typeof v !== "string" || v.length>max || (!optional && !v.trim())) throw new Error("Nome ou descrição do tema inválidos.");
  return v.trim();
}
function number(v: unknown, max: number, min = 0): number {
  if (typeof v !== "number" || !Number.isFinite(v) || v<min || v>max) throw new Error(`Medida do tema fora do intervalo ${min}–${max}.`);
  return v;
}
const HEX=/^#[\da-f]{6}([\da-f]{2})?$/i;
function luminance(hex: string): number {
  const [r,g,b]=[1,3,5].map(i=>{ const v=parseInt(hex.slice(i,i+2),16)/255; return v<=0.03928?v/12.92:((v+0.055)/1.055)**2.4; });
  return 0.2126*r!+0.7152*g!+0.0722*b!;
}
export function contrast(a: string, b: string): number {
  const [x,y]=[luminance(a),luminance(b)].sort((m,n)=>m-n);
  return (y!+0.05)/(x!+0.05);
}
/** Chaves acrescentadas depois da versão 1: temas exportados antes delas recebem um valor derivado. */
const DERIVED: Partial<Record<ThemeColorKey,(c: Record<string,unknown>)=>string|undefined>> = {
  "bad-text": c => {
    if(typeof c.bad!=="string" || !HEX.test(c.bad)) return undefined;
    const bad=c.bad.slice(0,7);
    return ["#ffffff",c.bg,c.text].filter((v): v is string=>typeof v==="string" && HEX.test(v)).map(v=>v.slice(0,7))
      .reduce((best,v)=>contrast(v,bad)>contrast(best,bad)?v:best,"#ffffff");
  },
};
export function parseTheme(input: unknown): ThemeConfig {
  const raw=object(input);
  fields(raw,["format","version","id","label","description","mode","order","colors","geometry","typography","effects","shadow"]);
  if(raw.format!=="deco-web-theme" || raw.version!==1) throw new Error("Formato ou versão de tema não suportado.");
  const id=text(raw.id,64);
  if(!/^[a-z][a-z0-9-]*$/.test(id) || id==="auto") throw new Error("Identificador de tema inválido.");
  if(raw.mode!=="light" && raw.mode!=="dark") throw new Error("Escolha claro ou escuro.");
  const c=object(raw.colors); fields(c,THEME_COLOR_KEYS);
  const colors=Object.fromEntries(THEME_COLOR_KEYS.map(k=>{
    const value=k in DERIVED && c[k]===undefined ? DERIVED[k]!(c) : c[k];
    if(typeof value!=="string" || !HEX.test(value)) throw new Error(`Cor inválida: ${k}. Use hexadecimal #RRGGBB ou #RRGGBBAA.`);
    return [k,value.toLowerCase()];
  })) as ThemeConfig["colors"];
  const g=object(raw.geometry); fields(g,["controlRadius","cardRadius","dialogRadius","badgeRadius","iconRadius","borderWidth"]);
  const geometry={controlRadius:number(g.controlRadius,32),cardRadius:number(g.cardRadius,32),dialogRadius:number(g.dialogRadius,32),badgeRadius:number(g.badgeRadius,999),iconRadius:number(g.iconRadius,32),borderWidth:number(g.borderWidth,3)};
  const t=object(raw.typography); fields(t,["family","size"]);
  if(t.family!=="plex" && t.family!=="system" && t.family!=="arial") throw new Error("Fonte não suportada.");
  const e=object(raw.effects); fields(e,["gradients","glow","bevel","colorfulIcons"]);
  for(const key of ["gradients","glow","bevel","colorfulIcons"]) if(typeof e[key]!=="boolean") throw new Error("Opção de acabamento inválida.");
  if(raw.shadow!=="none" && raw.shadow!=="soft" && raw.shadow!=="hard") throw new Error("Sombra não suportada.");
  return {format:"deco-web-theme",version:1,id,label:text(raw.label,80),description:text(raw.description,300,true),mode:raw.mode,order:number(raw.order,10000),colors,geometry,typography:{family:t.family,size:number(t.size,18,12)},effects:{gradients:e.gradients as boolean,glow:e.glow as boolean,bevel:e.bevel as boolean,colorfulIcons:e.colorfulIcons as boolean},shadow:raw.shadow};
}
export function serializeTheme(theme: ThemeConfig): string { return JSON.stringify(parseTheme(theme),null,2)+"\n"; }
export function themeVariables(theme: ThemeConfig): Record<string,string> {
  const vars: Record<string,string>=Object.fromEntries(Object.entries(theme.colors).map(([k,v])=>[`--${k}`,v]));
  const rgb=(hex:string)=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16));
  vars["--glow"]=rgb(theme.colors.accent).join(" ");
  // Mantém compatibilidade com regras antigas que usam o canal HSL para sombras.
  vars["--shadow-color"]="0 0% 0%";
  for(const [key,value] of Object.entries(theme.geometry)) vars[`--theme-${key.replace(/[A-Z]/g,m=>`-${m.toLowerCase()}`)}`]=`${value}px`;
  vars["--theme-font-family"]=theme.typography.family==="plex"?'"IBM Plex Sans Variable", "IBM Plex Sans", sans-serif':theme.typography.family==="arial"?'Arial, Helvetica, sans-serif':'system-ui, sans-serif';
  vars["--theme-font-size"]=`${theme.typography.size}px`;
  vars["--shadow-card"]=theme.shadow==="soft"?`0 1px 3px ${theme.colors.shadow.slice(0,7)}20`:"none";
  vars["--shadow-pop"]=theme.shadow==="none"?"none":theme.shadow==="hard"?`2px 2px 0 ${theme.colors["edge-dark"]}`:`0 10px 30px ${theme.colors.shadow.slice(0,7)}40`;
  vars["--deco-photo-filter"]=theme.shadow==="none"?"none":theme.shadow==="hard"?`drop-shadow(2px 2px 0 ${theme.colors["edge-dark"]})`:`drop-shadow(0 6px 6px ${theme.colors.shadow.slice(0,7)}40)`;
  vars["--theme-shadow-card"]=vars["--shadow-card"];
  vars["--theme-shadow-pop"]=vars["--shadow-pop"];
  return vars;
}
