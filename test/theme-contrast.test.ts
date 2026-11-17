import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseTheme } from "../src/core/theme-config.js";
function luminance(hex:string) {
  return [1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255)
    .map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4)
    .reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i]!,0);
}
describe("contraste dos temas",()=>{
  it.each(["professional-light","latte","mocha","dracula","professional-dark","papel","duna","jardim","abissal","fosforo","cereja"])("%s mantém contraste de texto e estados",theme=>{
    const tokens=parseTheme(JSON.parse(readFileSync(new URL(`../web/src/themes/${theme}.json`,import.meta.url),"utf8"))).colors;
    for(const [fg,bg] of [["text","bg"],["muted","bg"],["accent","surface"],["accent-text","accent"],["sidebar-text","sidebar"],["ok","ok-soft"],["warn","warn-soft"],["bad","bad-soft"]]) {
      const [low,high]=[luminance(tokens[fg! as keyof typeof tokens]!),luminance(tokens[bg! as keyof typeof tokens]!)].sort((a,b)=>a-b);
      expect((high!+.05)/(low!+.05),`${theme}: ${fg}/${bg}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
