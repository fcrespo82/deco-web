import {describe,expect,it} from "vitest";
import {routeCable,routeCables,cableSegmentClear,type CableObstacle} from "../web/src/lib/cable-routing.js";
const source={nodeId:"a",x:60,y:60,side:"bottom" as const},target={nodeId:"b",x:360,y:260,side:"bottom" as const};
const boxes:CableObstacle[]=[{id:"a",x:10,y:10,width:100,height:60},{id:"b",x:310,y:210,width:100,height:60}];
describe("roteamento de cabos",()=>{
 it("preserva as posições exatas das portas nas duas pontas",()=>{const r=routeCable(source,target,boxes);expect(r.blocked).toBe(false);expect(r.points[0]).toEqual(source);expect(r.points.at(-1)).toEqual(target);expect(r.points.every((p,i)=>!i||p.x===r.points[i-1]!.x||p.y===r.points[i-1]!.y)).toBe(true);});
 it("desvia de equipamento intermediário sem atravessar seu retângulo",()=>{
  const obstacle={id:"middle",x:130,y:80,width:140,height:140};const r=routeCable(source,target,[...boxes,obstacle]);expect(r.blocked).toBe(false);
  for(let i=1;i<r.points.length;i++)expect(cableSegmentClear(r.points[i-1]!,r.points[i]!,[obstacle])).toBe(true);
 });
 it("não modifica o cadastro dos equipamentos ao calcular o caminho",()=>{const original=JSON.stringify(boxes);routeCable(source,target,boxes);expect(JSON.stringify(boxes)).toBe(original);});
});

 describe("roteamento conjunto sem perda de ligações",()=>{
  const cables=[{a:source,b:target},{a:{...source,x:76},b:{...target,x:376}}];
  for(const style of ["smooth","rounded"] as const){
   it(`${style}: mantém todas as linhas com nós próximos ou sobrepostos`,()=>{
    const crowded=[...boxes,{id:"cover",x:20,y:0,width:420,height:320}];
    const routes=routeCables(cables,crowded,style);
    expect(routes).toHaveLength(cables.length);
    routes.forEach((r,i)=>{expect(r.d.length).toBeGreaterThan(10);expect(r.d).not.toMatch(/NaN|Infinity/);expect(r.points[0]).toEqual(cables[i]!.a);expect(r.points.at(-1)).toEqual(cables[i]!.b);});
   });
  }
  it("mantém as chegadas às portas inferiores e arredonda os cantos",()=>{
   const [r]=routeCables([{a:source,b:target}],boxes,"rounded");
   expect(r!.d).toContain(" Q ");const last=r!.points.at(-1)!,before=r!.points.at(-2)!;expect(last.x).toBe(before.x);expect(before.y).toBeGreaterThan(last.y);
  });
  it("mantém os extremos ao alternar estilos",()=>{
   const smooth=routeCables(cables,boxes,"smooth"),rounded=routeCables(cables,boxes,"rounded");
   expect(smooth[0]!.d).toContain(" C ");expect(rounded[0]!.d).toContain(" Q ");
   expect(smooth.map(r=>[r.points[0],r.points.at(-1)])).toEqual(rounded.map(r=>[r.points[0],r.points.at(-1)]));
  });
  it("preserva todos os cabos em um mapa com muitos nós",()=>{
   const many=Array.from({length:2000},(_,i)=>({a:{...source,x:i*3},b:{...target,x:i*4}}));
   const nodes=Array.from({length:1000},(_,i)=>({id:`extra-${i}`,x:i*4,y:i*2,width:168,height:80}));
   for(const style of ["smooth","rounded"] as const){const routes=routeCables(many,[...boxes,...nodes],style);expect(routes).toHaveLength(many.length);expect(routes.every(r=>r.d.length>0&&!/NaN|Infinity/.test(r.d))).toBe(true);}
  });
 });

describe("POC adaptativa",()=>{
 it("separa os corredores de portas vizinhas",()=>{
  const routes=routeCables([{a:source,b:target},{a:{...source,x:76},b:{...target,x:376}}],boxes,"adaptive");
  expect(routes.every(r=>!r.blocked)).toBe(true);
  const horizontal=routes.map(r=>r.points.slice(1).flatMap((p,i)=>p.y===r.points[i]!.y?[p.y]:[]));
  expect(horizontal[0]!.some(y=>!horizontal[1]!.includes(y))).toBe(true);
 });
 it("permite chegada pelo topo sem atravessar um obstáculo intermediário",()=>{
  const obstacle={id:"middle",x:130,y:80,width:140,height:140};
  const top={...target,y:210,side:"top" as const};
  const [r]=routeCables([{a:source,b:top}],[...boxes,obstacle],"adaptive");
  expect(r!.blocked).toBe(false);expect(r!.points.at(-2)!.y).toBeLessThan(top.y);
  for(let i=1;i<r!.points.length;i++)expect(cableSegmentClear(r!.points[i-1]!,r!.points[i]!,[obstacle])).toBe(true);
 });
});

it("mantém cabos próximos no vão entre switch e servidor, mesmo após outras ligações",()=>{
 const boxes=[{id:"switch",x:400,y:300,width:200,height:90},{id:"server",x:420,y:185,width:200,height:90}];
 const cables=Array.from({length:5},(_,i)=>({a:{nodeId:"switch",x:440+i*20,y:300,side:"top" as const},b:{nodeId:"server",x:450+i*20,y:275,side:"bottom" as const}}));
 const routes=routeCables(cables,boxes,"adaptive");
 for(const route of routes){
  expect(route.blocked).toBe(false);
  expect(route.points.every(p=>p.x>=400&&p.x<=620&&p.y>=275&&p.y<=300)).toBe(true);
 }
});

it("não funde duas ligações paralelas em uma junção num vão estreito",()=>{
 const obstacles=[{id:"switch",x:400,y:300,width:200,height:90},{id:"server",x:420,y:185,width:200,height:90}];
 const cables=[0,1].map(i=>({a:{nodeId:"switch",x:490+i*20,y:300,side:"top" as const},b:{nodeId:"server",x:540+i*20,y:275,side:"bottom" as const}}));
 const routes=routeCables(cables,obstacles,"adaptive");
 const horizontal=routes.map(r=>r.points.slice(1).flatMap((p,i)=>p.y===r.points[i]!.y?[{y:p.y,left:Math.min(p.x,r.points[i]!.x),right:Math.max(p.x,r.points[i]!.x)}]:[]));
 for(const a of horizontal[0]!)for(const b of horizontal[1]!)expect(a.y===b.y&&Math.min(a.right,b.right)>Math.max(a.left,b.left)).toBe(false);
 expect(routes.every(r=>!r.blocked)).toBe(true);
});
