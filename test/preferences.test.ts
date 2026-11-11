import { describe, expect, it, vi } from "vitest";
import { THEMES, DEFAULTS, parsePreferences, readStored, resolveTheme } from "../web/src/lib/preferences.js";
describe("preferências locais",()=>{
  it("migra light/dark/auto e valida valores",()=>{
    expect(parsePreferences(null,"dark").theme).toBe("professional-dark");
    expect(parsePreferences(null,"light").theme).toBe("professional-light");
    expect(parsePreferences(null,"auto").theme).toBe("auto");
    expect(parsePreferences({theme:"invalid",density:"invalid",motion:"invalid"})).toEqual(DEFAULTS);
    expect(parsePreferences({theme:"mocha",density:"compact",motion:"reduced"})).toEqual({...DEFAULTS,theme:"mocha",density:"compact",motion:"reduced"});
  });
  it("tolera dados inválidos e storage indisponível e lê preferência legada",()=>{
    const valid=(v:unknown):v is string=>v==="gallery"||v==="table";
    vi.stubGlobal("localStorage",{getItem:()=>"gallery"});
    expect(readStored("clients.view","table",valid)).toBe("gallery");
    vi.stubGlobal("localStorage",{getItem:()=>'{"bad":true}'});
    expect(readStored("clients.view","table",valid)).toBe("table");
    vi.stubGlobal("localStorage",{getItem:()=>{throw Error("blocked");}});
    expect(readStored("clients.view","table",valid)).toBe("table");
    vi.unstubAllGlobals();
  });
});

it("automático resolve os dois modos do sistema sem alterar temas explícitos",()=>{
  expect(resolveTheme("auto",true)).toBe("professional-dark");
  expect(resolveTheme("auto",false)).toBe("professional-light");
  expect(resolveTheme("mocha",false)).toBe("mocha");
});

it("migra os nomes profissionais anteriores",()=>{
  expect(parsePreferences({theme:"neutral"}).theme).toBe("professional-light");
  expect(parsePreferences({theme:"professional"}).theme).toBe("professional-dark");
});

it("mantém Profissional Claro e Escuro juntos e nesta ordem",()=>{
  const index=THEMES.findIndex(t=>t.id==="professional-light");
  expect(THEMES[index+1]?.id).toBe("professional-dark");
});
