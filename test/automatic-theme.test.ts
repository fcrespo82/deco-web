import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";
import { DEFAULTS,THEMES,currentTheme,parsePreferences,resolveTheme,setPreferences } from "../web/src/lib/preferences.js";
import { BUILTIN_THEMES,removeTheme,resetCustomThemes,saveTheme,serializeTheme } from "../web/src/lib/themes.js";
let storage: Map<string,string>;
beforeEach(()=>{
  storage=new Map();
  vi.stubGlobal("localStorage",{getItem:(key:string)=>storage.get(key)??null,setItem:(key:string,value:string)=>storage.set(key,value),removeItem:(key:string)=>storage.delete(key)});
});
afterEach(()=>{setPreferences(DEFAULTS);resetCustomThemes();vi.unstubAllGlobals();});
describe("par configurável do Automático",()=>{
  it("migra preferências antigas e rejeita temas inválidos ou da outra faixa",()=>{
    expect(parsePreferences({theme:"auto"})).toEqual({...DEFAULTS,theme:"auto"});
    expect(parsePreferences({theme:"auto",autoLightTheme:"mocha",autoDarkTheme:"latte"})).toEqual({...DEFAULTS,theme:"auto"});
    expect(parsePreferences({autoLightTheme:"missing",autoDarkTheme:12})).toEqual(DEFAULTS);
  });
  it("resolve pares diferentes e preserva temas manuais",()=>{
    const prefs=parsePreferences({theme:"auto",autoLightTheme:"latte",autoDarkTheme:"mocha"});
    expect(resolveTheme("auto",false,prefs)).toBe("latte");
    expect(resolveTheme("auto",true,prefs)).toBe("mocha");
    expect(resolveTheme("dracula",false,prefs)).toBe("dracula");
  });
  it("persiste o par e o mantém ao alternar para um tema manual",()=>{
    setPreferences({theme:"auto",autoLightTheme:"latte",autoDarkTheme:"dracula"});
    setPreferences({theme:"professional-light"});
    const saved=JSON.parse(storage.get("dashboard.preferences")!);
    expect(saved).toMatchObject({theme:"professional-light",autoLightTheme:"latte",autoDarkTheme:"dracula"});
    expect(parsePreferences(saved)).toMatchObject({autoLightTheme:"latte",autoDarkTheme:"dracula"});
    setPreferences({theme:"auto"});
    vi.stubGlobal("matchMedia",()=>({matches:false}));
    expect(currentTheme().id).toBe("latte");
    vi.stubGlobal("matchMedia",()=>({matches:true}));
    expect(currentTheme().id).toBe("dracula");
    expect(THEMES.find(t=>t.id==="auto")?.colors).toEqual([BUILTIN_THEMES.find(t=>t.id==="latte")!.colors.bg,BUILTIN_THEMES.find(t=>t.id==="dracula")!.colors.bg,BUILTIN_THEMES.find(t=>t.id==="dracula")!.colors.accent]);
    expect(JSON.parse(serializeTheme(currentTheme()))).not.toHaveProperty("autoDarkTheme");
  });
  it("inclui temas personalizados e normaliza apenas a faixa removida ou reclassificada",()=>{
    const light=BUILTIN_THEMES.find(t=>t.mode==="light")!;
    const dark=BUILTIN_THEMES.find(t=>t.mode==="dark")!;
    saveTheme({...light,id:"custom-auto-light"});
    saveTheme({...dark,id:"custom-auto-dark"});
    setPreferences({theme:"auto",autoLightTheme:"custom-auto-light",autoDarkTheme:"custom-auto-dark"});
    vi.stubGlobal("matchMedia",()=>({matches:true}));
    expect(currentTheme().id).toBe("custom-auto-dark");
    saveTheme({...light,id:"custom-auto-light",mode:"dark"});
    expect(JSON.parse(storage.get("dashboard.preferences")!)).toMatchObject({theme:"auto",autoLightTheme:"professional-light",autoDarkTheme:"custom-auto-dark"});
    removeTheme("custom-auto-dark");
    expect(JSON.parse(storage.get("dashboard.preferences")!)).toMatchObject({autoLightTheme:"professional-light",autoDarkTheme:"professional-dark"});
  });
  it("remover a faixa escura preserva uma escolha clara não padrão",()=>{
    saveTheme({...BUILTIN_THEMES.find(t=>t.mode==="dark")!,id:"temporary-dark"});
    setPreferences({theme:"auto",autoLightTheme:"latte",autoDarkTheme:"temporary-dark"});
    removeTheme("temporary-dark");
    expect(JSON.parse(storage.get("dashboard.preferences")!)).toMatchObject({autoLightTheme:"latte",autoDarkTheme:"professional-dark"});
  });
});
const bootstrap=readFileSync(new URL("../web/index.html",import.meta.url),"utf8").match(/<script>([\s\S]*?)<\/script>/)![1]!;
function boot(dark:boolean,prefs:object,cached:object) {
  const variables=new Map<string,string>();
  const root={dataset:{} as Record<string,string>,style:{setProperty:(key:string,value:string)=>variables.set(key,value),colorScheme:""}};
  runInNewContext(bootstrap,{document:{documentElement:root},matchMedia:()=>({matches:dark}),localStorage:{getItem:(key:string)=>key==="dashboard.preferences"?JSON.stringify(prefs):key==="dashboard.theme-cache"?JSON.stringify(cached):null}});
  return {root,variables};
}
describe("cache da primeira renderização",()=>{
  const prefs={theme:"auto",autoLightTheme:"latte",autoDarkTheme:"mocha"};
  const cached={preference:"auto",id:"mocha",mode:"dark",variables:{"--bg":"#1e1e2e"},effects:{gradients:true,glow:true,bevel:false,colorfulIcons:true}};
  it("não aplica o cache escuro quando o sistema mudou para claro",()=>{
    expect(boot(false,prefs,cached).variables.size).toBe(0);
  });
  it("aplica o cache da faixa correta",()=>{
    const result=boot(true,prefs,cached);
    expect(result.variables.get("--bg")).toBe("#1e1e2e");
    expect(result.root.dataset.theme).toBe("mocha");
  });
  it("descarta cache do tema anterior após trocar a escolha ativa",()=>{
    expect(boot(true,{...prefs,autoDarkTheme:"dracula"},cached).variables.size).toBe(0);
    expect(boot(true,prefs,{...cached,mode:"light"}).variables.size).toBe(0);
  });
});
