import { describe,expect,it } from "vitest";
import { applySavedPositions,dragPoint,validNodePositions,snapPoint } from "../web/src/lib/map-geometry.js";
describe("posições visuais dos mapas",()=>{
 it("valida posições persistidas sem aceitar valores corrompidos",()=>{
  expect(validNodePositions({"mesh:AA-BB":{x:-140,y:250},internet:{x:0,y:1}})).toBe(true);
  for(const value of [null,[],{node:{x:NaN,y:0}},{node:{x:0,y:Infinity}},{node:{x:"1",y:0}},{node:{x:100001,y:0}}]) expect(validNodePositions(value)).toBe(false);
 });
 it("aplica deslocamento e mantém o nó dentro dos limites do mapa",()=>{
  const initial={x:100,y:200};
  expect(dragPoint(initial,40,-50)).toEqual({x:140,y:150});
  expect(dragPoint(initial,1000,-1000,{minX:20,maxX:600,minY:40,maxY:800})).toEqual({x:600,y:40});
  expect(initial).toEqual({x:100,y:200});
 });
 it("encaixa posições positivas e negativas na grade e permite arraste livre",()=>{
  expect(snapPoint({x:31,y:49},20)).toEqual({x:40,y:40});
  expect(snapPoint({x:-31,y:-49},20)).toEqual({x:-40,y:-40});
  expect(snapPoint({x:31,y:49},0)).toEqual({x:31,y:49});
 });

});

it("aplica as posições persistidas sobre a distribuição automática sem recriar nós removidos",()=>{
 const generated=new Map([["internet",{x:300,y:60}],["infra:sala",{x:400,y:240}]]);
 const saved={internet:{x:-120,y:180},"infra:sala":{x:800,y:460},"infra:removido":{x:0,y:0}};
 const shown=applySavedPositions(generated,saved);
 expect(shown.get("internet")).toEqual(saved.internet);expect(shown.get("infra:sala")).toEqual(saved["infra:sala"]);
 expect(shown.has("infra:removido")).toBe(false);expect(generated.get("internet")).toEqual({x:300,y:60});
 expect(applySavedPositions(generated,{})).toEqual(generated);
});
