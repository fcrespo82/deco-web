import {it,expect} from "vitest";
import {BUILTIN_THEMES} from "../web/src/lib/themes.js";
import {editThemeColor} from "../web/src/lib/theme-palette.js";
import {contrast,parseTheme} from "../src/core/theme-config.js";
it.each(BUILTIN_THEMES)("deriva destaque e estados de $label com texto legível",theme=>{
 const original=JSON.stringify(theme.colors),c=editThemeColor(theme.colors,"accent","#42a5c3");
 expect(c["accent-soft"]).not.toBe(theme.colors["accent-soft"]);expect(c["series-1"]).toBe("#42a5c3");expect(contrast(c["accent-text"],c.accent)).toBeGreaterThanOrEqual(4.5);
 const updated=editThemeColor(c,"surface",theme.colors.surface);
 for(const key of ["ok","warn","bad"] as const)expect(contrast(updated[key],updated[`${key}-soft`])).toBeGreaterThanOrEqual(4.5);
 expect(()=>parseTheme({...theme,colors:updated})).not.toThrow();expect(JSON.stringify(theme.colors)).toBe(original);
});
it("mantém ajustes independentes quando a derivação está desligada",()=>{const c=BUILTIN_THEMES[0]!.colors;expect(editThemeColor(c,"accent","#abcdef",false)).toEqual({...c,accent:"#abcdef"});});
it("preserva cores categóricas e do equipamento ao editar o destaque",()=>{const c=BUILTIN_THEMES[0]!.colors,n=editThemeColor(c,"accent","#abcdef");expect(n["series-2"]).toBe(c["series-2"]);expect(n["deco-mid"]).toBe(c["deco-mid"]);});
it("tolera digitação parcial sem propagar cores inválidas aos derivados",()=>{const c=BUILTIN_THEMES[0]!.colors,n=editThemeColor(c,"accent","#12");expect(n.accent).toBe("#12");expect(n["accent-soft"]).toBe(c["accent-soft"]);});
it("deriva fundo de estado mesmo para branco e preto escolhidos manualmente",()=>{const c=BUILTIN_THEMES[0]!.colors;for(const value of ["#ffffff","#000000"]){const n=editThemeColor(c,"bad",value);expect(contrast(n.bad,n["bad-soft"])).toBeGreaterThanOrEqual(4.5);expect(contrast(n.bad,n["bad-text"])).toBeGreaterThanOrEqual(4.5);}});
