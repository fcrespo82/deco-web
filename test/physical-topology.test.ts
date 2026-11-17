import { describe,expect,it } from "vitest";
import {parsePhysicalTopology} from "../src/switches/topology.js";
const refs=()=>new Set(["internet","mesh:gateway","mesh:bedroom","switch:office"]);
const link=(source:string,target:string)=>({source,target,sourcePort:"",targetPort:"",kind:"wired"});
describe("cabeamento físico",()=>{
 it("preserva switches intermediários e portas cadastradas",()=>{
  const graph=parsePhysicalTopology({nodes:[{id:"infra:main",name:"Principal"}],links:[link("internet","mesh:gateway"),link("mesh:gateway","infra:main"),{...link("infra:main","switch:office"),targetPort:"1"},link("infra:main","mesh:bedroom")]},refs());
  expect(graph.links[3]?.source).toBe("infra:main");expect(graph.links[2]?.targetPort).toBe("1");
 });
 it("rejeita ciclos, pais duplicados e equipamentos desconhecidos",()=>{
  expect(()=>parsePhysicalTopology({nodes:[],links:[link("mesh:gateway","mesh:bedroom"),link("mesh:bedroom","mesh:gateway")]},refs())).toThrow(/ciclo/);
  expect(()=>parsePhysicalTopology({nodes:[],links:[link("mesh:gateway","mesh:bedroom"),link("switch:office","mesh:bedroom")]},refs())).toThrow(/único/);
  expect(()=>parsePhysicalTopology({nodes:[],links:[link("unknown","mesh:bedroom")]},refs())).toThrow(/inválido/);
 });
 it("não aceita IDs repetidos nem nomes vazios",()=>{
  expect(()=>parsePhysicalTopology({nodes:[{id:"infra:1",name:"A"},{id:"infra:1",name:"B"}],links:[]},refs())).toThrow(/repetido/);
  expect(()=>parsePhysicalTopology({nodes:[{id:"infra:1",name:" "}],links:[]},refs())).toThrow(/inválido/);
 });
 it("preserva tipos de equipamentos e quantidades de portas sem aceitar valores inválidos",()=>{
  const graph=parsePhysicalTopology({nodes:[{id:"infra:printer",name:"Impressora",kind:"device",portCount:1}],links:[],portCounts:{"mesh:gateway":3}},refs());
  expect(graph.nodes[0]).toMatchObject({kind:"device",portCount:1});expect(graph.portCounts).toEqual({"mesh:gateway":3});
  for(const portCount of [-1,129,2.5,"8"])expect(()=>parsePhysicalTopology({nodes:[{id:"infra:x",name:"X",portCount}],links:[]},refs())).toThrow(/portas/);
  expect(()=>parsePhysicalTopology({nodes:[],links:[],portCounts:{unknown:8}},refs())).toThrow(/portas/);
 });

 it("aceita interfaces distintas em um dispositivo e rejeita reutilizar a mesma porta",()=>{
  const n={id:"infra:nas",name:"NAS",kind:"device",portCount:2};
  const cables=[{...link("mesh:gateway","infra:nas"),sourcePort:"1",targetPort:"eth0"},{...link("switch:office","infra:nas"),sourcePort:"2",targetPort:"eth1"}];
  expect(parsePhysicalTopology({nodes:[n],links:cables,portNames:{"infra:nas":["eth0","eth1"]}},refs()).links).toHaveLength(2);
  expect(()=>parsePhysicalTopology({nodes:[n],links:[cables[0],{...cables[1],targetPort:"eth0"}]},refs())).toThrow(/porta/);
 });

});
