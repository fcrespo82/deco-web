/// <reference types="vite/client" />
import { parseTheme, type ThemeConfig } from "../../../src/core/theme-config.js";
export { parseTheme, serializeTheme, themeVariables, THEME_COLOR_KEYS } from "../../../src/core/theme-config.js";
export type { ThemeConfig, ThemeColorKey } from "../../../src/core/theme-config.js";
const files = import.meta.glob<unknown>("../themes/*.json", { eager: true, import: "default" });
export const THEME_LOAD_ERRORS: string[] = [];
const bundled: ThemeConfig[] = [];
for(const [file,input] of Object.entries(files)) {
  try {
    const theme=parseTheme(input);
    if(bundled.some(t=>t.id===theme.id)) throw new Error("Identificador duplicado.");
    bundled.push(theme);
  } catch(e) { THEME_LOAD_ERRORS.push(`${file.split("/").at(-1)}: ${e instanceof Error?e.message:"Tema inválido."}`); }
}
export const BUILTIN_THEMES = bundled.sort((a,b)=>a.order-b.order || a.label.localeCompare(b.label));
if(!BUILTIN_THEMES.length) throw new Error("Nenhum arquivo de tema válido encontrado.");
const STORAGE = "dashboard.custom-themes";
let custom: ThemeConfig[] = [];
const listeners = new Set<()=>void>();
function load() {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(STORAGE) ?? "[]");
    const seen = new Set(BUILTIN_THEMES.map(t=>t.id));
    custom = [];
    if (!Array.isArray(raw)) return;
    for (const item of raw.slice(0,50)) {
      try { const theme=parseTheme(item); if(!seen.has(theme.id)) { seen.add(theme.id); custom.push(theme); } } catch { /* invalid entries are ignored */ }
    }
  } catch { custom = []; }
}
if (typeof window !== "undefined") load();
export const listThemes = () => [...BUILTIN_THEMES, ...[...custom].sort((a,b)=>a.order-b.order || a.label.localeCompare(b.label))];
export const getTheme = (id: string): ThemeConfig => listThemes().find(t=>t.id===id) ?? (BUILTIN_THEMES.find(t=>t.id==="professional-light") ?? BUILTIN_THEMES[0]!);
export const isBuiltin = (id: string) => BUILTIN_THEMES.some(t=>t.id===id);
export function subscribeThemes(listener:()=>void) { listeners.add(listener); return ()=>{listeners.delete(listener);}; }
function notify() { for(const listener of listeners) listener(); }
export function saveTheme(input: unknown): {theme:ThemeConfig; persisted:boolean} {
  const theme=parseTheme(input);
  if(isBuiltin(theme.id)) throw new Error("Salve os ajustes com um identificador novo; os temas incluídos são preservados.");
  if(!custom.some(t=>t.id===theme.id) && custom.length>=50) throw new Error("Limite de 50 temas personalizados atingido.");
  custom=[...custom.filter(t=>t.id!==theme.id),theme];
  let persisted=true;
  try { localStorage.setItem(STORAGE, JSON.stringify(custom)); } catch { persisted=false; }
  notify(); return {theme,persisted};
}
export function importTheme(input:unknown) {
  const source=parseTheme(input);
  let id=source.id;
  if(listThemes().some(t=>t.id===id)) {
    const base=`${id.slice(0,45)}-copia`;
    id=base; let i=2;
    while(listThemes().some(t=>t.id===id)) id=`${base}-${i++}`;
  }
  return saveTheme({...source,id,label:id===source.id?source.label:`${source.label.slice(0,71)} (cópia)`,order:Math.max(100,source.order)});
}
export function removeTheme(id:string) {
  if(isBuiltin(id)) throw new Error("Os temas incluídos não podem ser removidos.");
  custom=custom.filter(t=>t.id!==id);
  try { localStorage.setItem(STORAGE, JSON.stringify(custom)); } catch { /* memory only */ }
  notify();
}
export function resetCustomThemes() { custom=[]; if(typeof window!=="undefined") try { localStorage.removeItem(STORAGE); } catch { /* memory only */ } notify(); }
if(typeof window!=="undefined") addEventListener("storage",e=>{
  if(e.key===STORAGE || e.key===null) {load();notify();}
});
