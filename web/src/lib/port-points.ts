import type { Point } from "./map-geometry.js";
// Especificações TP-Link: X50 (padrão) 3; M5 e M4/M4R 2. Variantes não são inferidas.
export function modelPortCount(model:string):number|null {
  const normalized=model.toUpperCase().replace(/^DECO\s+/, "").trim();
  return normalized==="X50"?3:["M4","M4R","M5"].includes(normalized)?2:null;
}
export function cardHeight(count:number|null):number {return 58+Math.ceil((count??0)/9)*22;}
export function portPoint(center:Point,index:number,count:number):Point {
  const columns=Math.min(9,count),row=Math.floor(index/9),inRow=Math.min(9,count-row*9);
  return {x:center.x+(index%columns-(inRow-1)/2)*16,y:center.y-cardHeight(count)/2+57+row*22};
}
