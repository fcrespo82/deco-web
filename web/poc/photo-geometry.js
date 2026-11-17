export * from "../src/network/photo-geometry.js";
export function photoPreset(n){
 if(n.id==='switch'||n.id==='office')return {src:new URL('./assets/tl-sg108-ports.png',import.meta.url).href,kind:'TP-Link TL-SG108 · foto demonstrativa',pins:Object.fromEntries(Array.from({length:8},(_,i)=>[String(i+1),{x:(108+i*34)/590,y:(300+i*3.6)/590,side:'bottom'}]))};
 if(['gateway','wifi','deco2'].includes(n.id))return {src:new URL('./assets/deco-x50-ports.png',import.meta.url).href,kind:'TP-Link Deco X50 · foto demonstrativa',pins:Object.fromEntries([361,397,434].map((y,i)=>[String(i+1),{x:420/590,y:y/590,side:'right'}]))};
 return null;
}
