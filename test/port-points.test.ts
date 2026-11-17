import {describe,expect,it} from "vitest";
import {modelPortCount,portPoint,cardHeight} from "../web/src/lib/port-points.js";
describe("pontos de conexão",()=>{
 it("reconhece modelos conhecidos sem extrapolar para variantes",()=>{
  expect(modelPortCount("X50")).toBe(3);expect(modelPortCount("M5")).toBe(2);expect(modelPortCount("M4R")).toBe(2);expect(modelPortCount("X50-PoE")).toBeNull();
 });
 it("distribui portas em linhas e mantém todos os pontos dentro do cartão",()=>{
  for(const count of [1,3,9,16,48,128]){
   const points=Array.from({length:count},(_,i)=>portPoint({x:0,y:0},i,count));
   expect(new Set(points.map(p=>`${p.x}:${p.y}`)).size).toBe(count);
   expect(points.every(p=>Math.abs(p.x)<84&&Math.abs(p.y)<cardHeight(count)/2)).toBe(true);
  }
 });
});
