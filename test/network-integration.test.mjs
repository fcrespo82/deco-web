import {describe,it,expect} from 'vitest';
import {dia,shapes} from '@joint/core';
import {initAvoidRouter} from '@joint/router-avoid';
import {graphLinks,internalPort,externalPort,addPhysicalLink,removePhysicalLink} from '../web/src/network/adapter.ts';
import {genericGeometry} from '../web/src/network/generic-device.js';
import {photoHeight,photoPoint,radioPoint} from '../web/src/network/photo-geometry.js';
import {populateGraph} from '../web/src/network/joint-model.js';
import {organize} from '../web/src/network/layout.js';
const nodes=[{id:'switch:a',name:'Switch',kind:'switch',sub:'',online:true,portCount:3,portNames:['eth0','wifi','SFP+']},{id:'client:b',name:'Tablet',kind:'client',sub:'',online:true,portCount:0}];
const wired={source:nodes[0].id,target:nodes[1].id,sourcePort:'wifi',targetPort:'',kind:'wired',sourceType:'manual',label:'cabo'};
describe('topologia integrada',()=>{
 it('mantém aliases físicos separados do rádio e não inventa uma porta desconhecida',()=>{expect(internalPort(nodes[0],'wifi')).toBe('2');expect(externalPort(nodes[0],'2')).toBe('wifi');const [l]=graphLinks(nodes,[wired]);expect(l.sp).toBe('2');expect(l.tp).toBe('unknown');expect(l.wifi).toBe(false);expect(graphLinks(nodes,[{...wired,kind:'wireless'}])[0].sp).toBe('wifi');});
 it('preserva o cadastro e rejeita portas ocupadas sem substituir ligações',()=>{const config={nodes:[],links:[{...wired,targetPort:'LAN'}],portNames:{'switch:a':['eth0','wifi','SFP+']}};const before=JSON.stringify(config);expect(()=>addPhysicalLink(config,{...wired,target:'client:c',targetPort:'LAN'})).toThrow(/ocupada/);expect(JSON.stringify(config)).toBe(before);const next=addPhysicalLink(config,{source:'switch:a',target:'client:c',sourcePort:'SFP+',targetPort:'LAN',kind:'wired'});expect(next.links).toHaveLength(2);expect(next.portNames).toEqual(config.portNames);expect(removePhysicalLink(next,{...wired,targetPort:'LAN'}).links).toHaveLength(1);});
 it('gera até 128 portas únicas e mantém celular/tablet sem Ethernet quando a quantidade é zero',()=>{for(const count of [0,1,3,8,48,128]){const geometry=genericGeometry({name:'Switch',kind:'Switch',ports:count});const points=Object.values(geometry.pins);expect(points).toHaveLength(count);expect(points.every(p=>p.x>=0&&p.x<=1&&p.y>=0&&p.y<=1)).toBe(true);expect(new Set(points.map(p=>`${p.x}:${p.y}`)).size).toBe(count);}expect(Object.keys(genericGeometry({name:'Tablet',kind:'client',ports:0}).pins)).toHaveLength(0);});
 it('ELK e libavoid preservam aliases, portas desconhecidas e extremos na imagem',async()=>{
  const links=graphLinks(nodes,[wired,{...wired,kind:'wireless',sourceType:'mesh',label:'Wi-Fi'}]);
  const data={nodes:nodes.map((n,i)=>{const g=genericGeometry({name:n.name,kind:n.kind,ports:n.portCount});const photo={src:'data:image/png;base64,AA==',pins:g.pins,imageWidth:g.bounds.width,imageHeight:g.bounds.height};return {...n,ports:n.portCount,radio:true,unknownPort:i===1,photo,width:224,height:photoHeight(photo),x:i*300,y:i*300};}),links};
  const layout=await organize(data);for(const n of data.nodes){const p=layout.children.find(p=>p.id===n.id);n.x=p.x;n.y=p.y;}
  const graph=new dia.Graph({}, {cellNamespace:shapes});populateGraph(graph,data);
  const model=graph.getCell(nodes[0].id),physical=model.getPort('ethernet:2');expect(physical.attrs.portLabel.text).toBe('wifi');expect(physical.args).toEqual(photoPoint(data.nodes[0].photo.pins['2'],data.nodes[0].photo));expect(model.getPort('radio:wifi').args).toEqual(radioPoint());expect(graph.getCell(nodes[1].id).getPort('ethernet:unknown')).toBeTruthy();
  const router=await initAvoidRouter(graph,{shapeBufferDistance:6,idealNudgingDistance:10});const origins=[];router.on('link:routed',(_link,{origin})=>origins.push(origin));try{await router.routeAll();expect(origins).toHaveLength(2);expect(origins.every(v=>v==='avoid')).toBe(true);}finally{router.destroy();}
 });
});

it('aceita arraste do cliente para o switch sem inverter o uplink existente',()=>{
 const config={nodes:[],links:[{source:'internet',target:'switch:a',sourcePort:'WAN',targetPort:'1',kind:'wired'}]};
 const next=addPhysicalLink(config,{source:'client:b',target:'switch:a',sourcePort:'LAN',targetPort:'2',kind:'wired'});
 expect(next.links[1]).toEqual({source:'switch:a',target:'client:b',sourcePort:'2',targetPort:'LAN',kind:'wired'});
 expect(next.links[0]).toEqual(config.links[0]);
});
