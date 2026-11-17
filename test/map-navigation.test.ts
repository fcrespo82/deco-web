import {describe,expect,it} from "vitest";
import {zoomMap} from "../web/src/lib/map-viewport.js";
import {descendantPositions} from "../web/src/lib/map-geometry.js";
describe("navegação e grupos do mapa",()=>{
 it("zoom mantém o ponto sob o cursor na mesma posição da visão",()=>{const old={x:10,y:20,k:1},anchor={x:150,y:100};const next=zoomMap(old,anchor,2);expect((anchor.x-next.x)/next.k).toBe((anchor.x-old.x)/old.k);expect((anchor.y-next.y)/next.k).toBe((anchor.y-old.y)/old.k);expect(zoomMap(next,anchor,100).k).toBe(5);});
 it("seleciona descendentes uma vez, preservando a posição relativa do grupo",()=>{const p=new Map([["root",{x:0,y:0}],["child",{x:40,y:100}],["grandchild",{x:80,y:200}],["other",{x:500,y:10}]]);const group=descendantPositions("root",[{source:"root",target:"child"},{source:"child",target:"grandchild"},{source:"root",target:"grandchild"}],p);expect(Object.keys(group).sort()).toEqual(["child","grandchild"]);expect(group.grandchild).toEqual({x:80,y:200});});
});
