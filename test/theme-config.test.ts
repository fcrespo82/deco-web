import { readFileSync,readdirSync } from "node:fs";
import { describe,it,expect,vi,afterEach } from "vitest";
import { parseTheme,serializeTheme,themeVariables,contrast } from "../src/core/theme-config.js";
import { BUILTIN_THEMES,importTheme,saveTheme,removeTheme,listThemes,resetCustomThemes } from "../web/src/lib/themes.js";
const folder=new URL("../web/src/themes/",import.meta.url);
const samples=readdirSync(folder).filter(f=>f.endsWith(".json")).map(file=>({file,config:JSON.parse(readFileSync(new URL(file,folder),"utf8"))}));
afterEach(()=>{resetCustomThemes();vi.unstubAllGlobals();});
describe("arquivos portáveis de tema",()=>{
  it.each(samples)("valida e preserva $file ao exportar e importar",({config})=>{
    const theme=parseTheme(config);
    expect(parseTheme(JSON.parse(serializeTheme(theme)))).toEqual(theme);
    expect(Object.keys(themeVariables(theme))).toContain("--theme-card-radius");
  });
  it.each(samples)("texto sobre erro de $file tem contraste AA",({config})=>{
    const {colors}=parseTheme(config);
    expect(contrast(colors["bad-text"],colors.bad.slice(0,7))).toBeGreaterThanOrEqual(4.5);
  });
  it("deriva bad-text de temas exportados antes da chave existir",()=>{
    const dark=samples.find(s=>s.config.id==="mocha")!.config;
    const {"bad-text":_,...colors}=dark.colors;
    expect(parseTheme({...dark,colors}).colors["bad-text"]).toBe(dark.colors.bg);
    const light=samples.find(s=>s.config.id==="professional-light")!.config;
    const {"bad-text":__,...lightColors}=light.colors;
    expect(parseTheme({...light,colors:lightColors}).colors["bad-text"]).toBe("#ffffff");
  });
  it("rejeita CSS, URLs, chaves desconhecidas e medidas inválidas",()=>{
    const theme=samples[0]!.config;
    for(const color of ["red","url(https://example.com/a)","#ffffff;display:none","javascript:alert(1)"]) {
      expect(()=>parseTheme({...theme,colors:{...theme.colors,bg:color}})).toThrow(/Cor inválida/);
    }
    expect(()=>parseTheme({...theme,css:"body{}"})).toThrow(/não reconhecidos/);
    expect(()=>parseTheme({...theme,version:2})).toThrow(/versão/);
    expect(()=>parseTheme({...theme,geometry:{...theme.geometry,cardRadius:100}})).toThrow(/intervalo/);
    expect(()=>parseTheme({...theme,typography:{...theme.typography,family:"url(x)"}})).toThrow(/Fonte/);
    expect(()=>parseTheme({...theme,effects:{...theme.effects,glow:"true"}})).toThrow(/acabamento/);
  });
  it("gera medidas dinâmicas usadas nos painéis, controles e ícones",()=>{
    const theme=parseTheme(samples[0]!.config);
    const vars=themeVariables({...theme,geometry:{...theme.geometry,controlRadius:0,cardRadius:7,iconRadius:2},shadow:"none"});
    expect(vars["--theme-control-radius"]).toBe("0px");
    expect(vars["--theme-card-radius"]).toBe("7px");
    expect(vars["--theme-icon-radius"]).toBe("2px");
    expect(vars["--theme-shadow-card"]).toBe("none");
    expect(vars["--theme-shadow-pop"]).toBe("none");
  });
  it("importa como cópia sem substituir arquivos incluídos e persiste JSON completo",()=>{
    const memory=new Map<string,string>();
    vi.stubGlobal("localStorage",{setItem:(k:string,v:string)=>memory.set(k,v),removeItem:(k:string)=>memory.delete(k)});
    const source=BUILTIN_THEMES[0]!;
    const one=importTheme(source); const two=importTheme(source);
    expect(one.theme.id).not.toBe(source.id);expect(two.theme.id).not.toBe(one.theme.id);
    expect(listThemes().find(t=>t.id===source.id)).toEqual(source);
    expect(JSON.parse(memory.get("dashboard.custom-themes")!)).toHaveLength(2);
    expect(()=>saveTheme(source)).toThrow(/identificador novo/);
    removeTheme(one.theme.id);expect(listThemes().some(t=>t.id===one.theme.id)).toBe(false);
  });
  it("informa quando o navegador impede persistir o tema",()=>{
    vi.stubGlobal("localStorage",{setItem:()=>{throw Error("quota");},removeItem:()=>{}});
    const result=saveTheme({...BUILTIN_THEMES[0],id:"example-memory"});
    expect(result.persisted).toBe(false);expect(listThemes().some(t=>t.id==="example-memory")).toBe(true);
  });
});
