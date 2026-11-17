import {contrast,type ThemeConfig,type ThemeColorKey} from "../../../src/core/theme-config.js";
type Colors=ThemeConfig["colors"];
export const MAIN_THEME_COLORS=["bg","surface","text","accent"] as const;
export const STATE_THEME_COLORS=["ok","warn","bad"] as const;
const hex=/^#[0-9a-f]{6}([0-9a-f]{2})?$/i;
function mix(a:string,b:string,amount:number){return "#"+[1,3,5].map(i=>Math.round(parseInt(a.slice(i,i+2),16)*(1-amount)+parseInt(b.slice(i,i+2),16)*amount).toString(16).padStart(2,"0")).join("");}
function readable(background:string,preferred:string){return [preferred,"#ffffff","#111111"].reduce((a,b)=>contrast(a,background)>=contrast(b,background)?a:b);}
function secondary(c:Colors){let color=mix(c.surface,c.text,.65);if(contrast(color,c.surface)<4.5||contrast(color,c.bg)<4.5)color=readable(c.surface,c.text);return color;}
function statusBackground(color:string,surface:string){const soft=mix(surface,color,.12);return contrast(color,soft)>=4.5?soft:readable(color,surface);}
/** Derives only related tokens; existing imported palettes remain intact until edited. */
export function editThemeColor(colors:Colors,key:ThemeColorKey,value:string,automatic=true):Colors{
 const c={...colors,[key]:value};if(!automatic||!hex.test(value)||!MAIN_THEME_COLORS.every(k=>hex.test(c[k])))return c;
 const base=key==="bg"||key==="surface"||key==="text";
 if(base){c["surface-2"]=mix(c.surface,c.text,.045);c["surface-3"]=mix(c.surface,c.text,.1);c.line=mix(c.surface,c.text,.25);c.muted=secondary(c);c.grid=c["surface-3"];c.sidebar=mix(c.surface,c.bg,.45);c["sidebar-text"]=c.text;c["edge-light"]=c.surface;c["edge-dark"]=mix(c.surface,c.text,.45);c.shadow="#000000";}
 if(base||key==="accent"){
  c["accent-soft"]=mix(c.surface,c.accent,.12);c["accent-text"]=readable(c.accent,c.bg);c["brand-from"]=c.accent;c["brand-to"]=mix(c.accent,c.text,.22);c["hero-from"]=mix(c.surface,c.accent,.14);c["hero-to"]=c.surface;c["sidebar-2"]=c["accent-soft"];c["sidebar-strong"]=readable(c["sidebar-2"],c.text);c.titlebar=c.accent;c["device-icon-bg"]=mix(c.accent,"#000000",.35);c["series-1"]=c.accent;c["flow-down"]=c.accent;c["band-5"]=c.accent;c["deco-pedestal"]=c.surface;
 }
 for(const state of STATE_THEME_COLORS)if(base||key===state){if(!hex.test(c[state]))continue;c[`${state}-soft`]=statusBackground(c[state],c.surface);if(state==="bad"){c["bad-text"]=readable(c.bad,c.bg);c["led-off"]=c.bad;}if(state==="ok")c["led-on"]=c.ok;}
 return c;
}
