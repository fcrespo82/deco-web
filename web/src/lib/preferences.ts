import { useEffect, useState } from "preact/hooks";
import { listThemes, getTheme, subscribeThemes, themeVariables, type ThemeConfig } from "./themes.js";
export interface ThemeOption { id: string; label: string; mode: "light" | "dark" | "auto"; colors: readonly string[] }
export interface AutomaticThemes { autoLightTheme: string; autoDarkTheme: string }
const AUTO_DEFAULTS: AutomaticThemes = { autoLightTheme: "professional-light", autoDarkTheme: "professional-dark" };
const options = (pair: AutomaticThemes = AUTO_DEFAULTS): ThemeOption[] => [...listThemes().map(t=>({id:t.id,label:t.label,mode:t.mode,colors:[t.colors.bg,t.colors.surface,t.colors.accent]})), {id:"auto",label:"Automático",mode:"auto",colors:[getTheme(pair.autoLightTheme).colors.bg,getTheme(pair.autoDarkTheme).colors.bg,getTheme(pair.autoDarkTheme).colors.accent]}];
export const THEMES: ThemeOption[] = options();
export type ThemePref = string;
export interface Preferences extends AutomaticThemes { theme: ThemePref; density: "comfortable" | "compact"; motion: "system" | "reduced" }
export const DEFAULTS: Preferences = { theme: "professional-light", ...AUTO_DEFAULTS, density: "comfortable", motion: "system" };
function automaticTheme(id: unknown, mode: "light" | "dark"): string {
  return listThemes().find(t=>t.id===id && t.mode===mode)?.id ?? (mode==="light" ? AUTO_DEFAULTS.autoLightTheme : AUTO_DEFAULTS.autoDarkTheme);
}
export function parsePreferences(raw: unknown, legacy?: string | null): Preferences {
  const p = raw && typeof raw === "object" ? raw as Partial<Preferences> : {};
  const old = legacy === "dark" ? "professional-dark" : legacy === "auto" ? "auto" : "professional-light";
  const requested = String(p.theme ?? "");
  const migrated = requested === "neutral" || requested === "light" ? "professional-light" : requested === "professional" || requested === "dark" ? "professional-dark" : requested;
  return { theme: migrated==="auto" || listThemes().some(t=>t.id===migrated) ? migrated : old,
    autoLightTheme: automaticTheme(p.autoLightTheme,"light"), autoDarkTheme: automaticTheme(p.autoDarkTheme,"dark"),
    density: p.density === "compact" ? "compact" : "comfortable", motion: p.motion === "reduced" ? "reduced" : "system" };
}
export function readStored<T>(key: string, fallback: T, valid: (value: unknown) => value is T): T {
  try {
    const raw = localStorage.getItem(key);
    let v: unknown;
    try { v = JSON.parse(raw ?? "null"); } catch { v = raw; }
    return valid(v) ? v : fallback;
  } catch { return fallback; }
}
let preferences: Preferences = { ...DEFAULTS };
if (typeof window !== "undefined") {
  try { preferences = parsePreferences(readStored("dashboard.preferences", null as unknown, (v): v is unknown => true), localStorage.getItem("theme")); } catch { /* storage unavailable */ }
}
const listeners = new Set<() => void>();
export function resolveTheme(theme: ThemePref, dark: boolean, pair: Partial<AutomaticThemes> = AUTO_DEFAULTS): string {
  return theme === "auto" ? automaticTheme(dark ? pair.autoDarkTheme : pair.autoLightTheme, dark ? "dark" : "light") : theme;
}
let preview: ThemeConfig | null = null;
function apply() {
  THEMES.splice(0,THEMES.length,...options(preferences));
  if (typeof document === "undefined") return;
  const resolved = resolveTheme(preferences.theme, matchMedia("(prefers-color-scheme: dark)").matches, preferences);
  const config = preview ?? getTheme(resolved);
  const root = document.documentElement;
  root.dataset.theme = config.id;
  root.dataset.enterprise = String(config.effects.bevel);
  root.dataset.colorMode = config.mode;
  root.dataset.gradients = String(config.effects.gradients);
  root.dataset.glow = String(config.effects.glow);
  root.dataset.bevel = String(config.effects.bevel);
  root.dataset.colorfulIcons = String(config.effects.colorfulIcons);
  root.style.colorScheme = config.mode;
  const variables = themeVariables(config);
  for(const [key,value] of Object.entries(variables)) root.style.setProperty(key,value);
  try { if(!preview) localStorage.setItem("dashboard.theme-cache", JSON.stringify({preference:preferences.theme,autoLightTheme:preferences.autoLightTheme,autoDarkTheme:preferences.autoDarkTheme,mode:config.mode,variables,effects:config.effects,id:config.id})); } catch { /* first paint cache is optional */ }

  root.dataset.density = preferences.density;
  root.dataset.motion = preferences.motion;
}
export function setPreferences(patch: Partial<Preferences>) {
  if (patch.theme !== undefined || patch.autoLightTheme !== undefined || patch.autoDarkTheme !== undefined) preview = null;
  preferences = parsePreferences({ ...preferences, ...patch });
  try { localStorage.setItem("dashboard.preferences", JSON.stringify(preferences)); } catch { /* memory only */ }
  apply(); listeners.forEach(l => l());
}
export function setThemePreview(config: ThemeConfig | null) {
  preview=config; apply(); listeners.forEach(l=>l());
}
export function currentTheme(): ThemeConfig {
  return getTheme(resolveTheme(preferences.theme, typeof matchMedia!=="undefined" && matchMedia("(prefers-color-scheme: dark)").matches, preferences));
}
subscribeThemes(()=>{
  const normalized = parsePreferences(preferences);
  if (JSON.stringify(normalized)!==JSON.stringify(preferences)) {
    try { localStorage.setItem("dashboard.preferences",JSON.stringify(normalized)); } catch { /* memory only */ }
  }
  preferences=normalized; apply(); listeners.forEach(l=>l());
});
export function resetLocalPreferences() {
  try {
    const keys = Array.from({length: localStorage.length}, (_,i) => localStorage.key(i));
    for (const key of keys) if (key && (key === "theme" || key === "dashboard.preferences" || key === "dashboard.theme-cache" || /^(clients|inventory|history)\./.test(key))) localStorage.removeItem(key);
  } catch { /* memory only */ }
  setPreferences(DEFAULTS);
  if (typeof window !== "undefined") window.dispatchEvent(new Event("dashboard-preferences-reset"));
}
export function usePreferences(): [Preferences, typeof setPreferences] {
  const [value, set] = useState(preferences);
  useEffect(() => { const l = () => set({...preferences}); listeners.add(l); return () => { listeners.delete(l); }; }, []);
  return [value, setPreferences];
}
export function useStored<T>(key: string, fallback: T, valid: (value: unknown) => value is T): [T, (value: T | ((old: T) => T)) => void] {
  const [value, set] = useState(() => readStored(key, fallback, valid));
  useEffect(() => {
    const sync = (e: StorageEvent) => { if (e.key === key || e.key === null) set(readStored(key, fallback, valid)); };
    const reset = () => set(fallback);
    addEventListener("storage", sync); addEventListener("dashboard-preferences-reset", reset);
    return () => { removeEventListener("storage", sync); removeEventListener("dashboard-preferences-reset", reset); };
  }, [key]);
  const update = (next: T | ((old: T) => T)) => set(old => {
    const v = typeof next === "function" ? (next as (old:T)=>T)(old) : next;
    try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* memory only */ }
    return v;
  });
  return [value, update];
}
if (typeof window !== "undefined") {
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    apply(); listeners.forEach(l=>l());
  });
  addEventListener("storage", e => {
    if (e.key === "dashboard.preferences" || e.key === null) {
      preferences = readStored("dashboard.preferences", DEFAULTS, (v): v is Preferences => Boolean(v && typeof v === "object"));
      preferences = parsePreferences(preferences); apply(); listeners.forEach(l => l());
    }
  });
  apply();
}

export function useReducedMotion(): boolean {
  const [prefs] = usePreferences();
  const [system, setSystem] = useState(() => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setSystem(media.matches);
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);
  return prefs.motion === "reduced" || system;
}
