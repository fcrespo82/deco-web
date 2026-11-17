import assert from 'node:assert/strict';
import {dia,shapes} from '@joint/core';
import {initAvoidRouter} from '@joint/router-avoid';
import {scenario,organize} from './shared.js';
import {populateGraph,linkEnds} from './joint-model.js';
for(const full of [false,true]){
 const data=scenario(full);
 for(const direction of ['DOWN','RIGHT']){
  const layout=await organize(data,direction);
  assert.equal(layout.children.length,data.nodes.length);
  assert.equal(layout.edges.length,data.links.length);
  for(const e of layout.edges){assert.ok(e.sections?.length);for(const p of [e.sections[0].startPoint,...e.sections[0].bendPoints??[],e.sections[0].endPoint])assert.ok(Number.isFinite(p.x)&&Number.isFinite(p.y));}
  console.log(`ELK ${full?'14':'6'} equipamentos ${direction}: todos os caminhos calculados`);
 }
 const graph=new dia.Graph({}, {cellNamespace:shapes});populateGraph(graph,data);
 const router=await initAvoidRouter(graph,{shapeBufferDistance:6,idealNudgingDistance:10});
 const origins=new Map();router.on('link:routed',(l,{origin})=>origins.set(l.id,origin));
 await router.routeAll();assert.equal(origins.size,data.links.length);assert.ok([...origins.values()].every(o=>o==='avoid'));
 const switchNode=graph.getCell('switch');switchNode.position(400,20);
 for(const l of data.links)graph.getCell(l.id).set(linkEnds(graph,l));
 await router.routeAll();assert.ok([...origins.values()].every(o=>o==='avoid'));router.destroy();
 console.log(`JointJS ${data.nodes.length} equipamentos: libavoid roteou todas as conexões antes e depois de mover o switch`);
}

// Shared contract: a radio endpoint cannot reuse or overlap a numbered jack.
const {photoPreset,photoPoint,radioPoint,photoPortId,validatePin,PHOTO_HEIGHT}=await import('./photo-geometry.js');
const {genericGeometry}=await import('./generic-device.js');
const {portOffset,ports}=await import('./shared.js');
for(const n of scenario(true).nodes){
 const physical=ports(n).filter(p=>p!=='wifi');
 for(const p of physical){assert.notEqual(photoPortId(p),photoPortId('wifi'));assert.ok(Math.abs(portOffset(n,p)-portOffset(n,'wifi'))>=30);}
 const spec=photoPreset(n)??{src:'data:image/png;base64,AA==',pins:genericGeometry(n).pins};
 for(const p of physical){assert.ok(spec.pins[p]);const point=photoPoint(spec.pins[p]);assert.ok(Math.hypot(point.x-radioPoint().x,point.y-radioPoint().y)>=22);}
}
assert.throws(()=>validatePin({x:.5,y:0,side:'bottom'},{}),/Wi-Fi/);
assert.throws(()=>validatePin({x:.5,y:.5,side:'bottom'},{'1':{x:.5,y:.5,side:'bottom'}}),/outra porta/);
const photos=scenario(true);for(const n of photos.nodes){n.photo=photoPreset(n)??{src:'data:image/png;base64,AA==',pins:genericGeometry(n).pins};n.height=PHOTO_HEIGHT;n.width=224;}
const layout=await organize(photos);for(const n of photos.nodes){const p=layout.children.find(p=>p.id===n.id);n.x=p.x;n.y=p.y;}
const graph=new dia.Graph({}, {cellNamespace:shapes});populateGraph(graph,photos);
for(const n of photos.nodes){const model=graph.getCell(n.id);assert.equal(model.getPorts().length,n.ports+1);for(const p of model.getPorts())if(p.id.startsWith('ethernet:')){const expected=photoPoint(n.photo.pins[p.id.split(':')[1]],n.photo);assert.deepEqual(p.args,expected);}}
for(const l of photos.links){const model=graph.getCell(l.id);assert.equal(model.source().port.startsWith('radio:'),l.wifi);assert.equal(model.target().port.startsWith('radio:'),l.wifi);}
const router=await initAvoidRouter(graph,{shapeBufferDistance:6,idealNudgingDistance:10});const photoOrigins=new Map();router.on('link:routed',(l,{origin})=>photoOrigins.set(l.id,origin));await router.routeAll();assert.equal(photoOrigins.size,photos.links.length);assert.ok([...photoOrigins.values()].every(o=>o==='avoid'));router.destroy();
console.log('Equipamentos: PNGs, coordenadas físicas e roteamento libavoid validados; Wi-Fi separado das portas numeradas.');

const {logicalPort,wiringError}=await import('./wiring.js');
const {genericKind}=await import('./generic-device.js');
assert.equal(genericKind({name:'Tablet',kind:'Cliente'}),'tablet');
assert.equal(genericKind({name:'Celular',kind:'Cliente'}),'phone');
assert.equal(genericKind({name:'Notebook',kind:'Cliente'}),'laptop');
assert.equal(genericKind({name:'Roteador',kind:'Nó'}),'router');
assert.equal(genericKind({name:'Desktop',kind:'Cliente'}),'desktop');
assert.equal(logicalPort('ethernet:3'),'3');assert.equal(logicalPort('3:top'),'3');assert.equal(logicalPort('radio:wifi'),'wifi');
const cable={id:'a',source:'s',sp:'1',target:'pc',tp:'1',wifi:false};
assert.equal(wiringError([], 's','1','pc','1'),null);
assert.match(wiringError([], 's','1','pc','wifi'),/Ethernet/);
assert.match(wiringError([cable], 's','1','tv','1'),/ocupada/);
assert.match(wiringError([cable], 'pc','1','s','1'),/já existe/);
assert.equal(wiringError([cable], 's','2','tv','1'),null);
assert.equal(wiringError([cable], 's','1','pc','1','a'),null);
assert.equal(wiringError([{id:'w',source:'ap',sp:'wifi',target:'p1',tp:'wifi'}], 'ap','wifi','p2','wifi'),null);
console.log('Cabeamento: Ethernet/Wi-Fi separados, portas ocupadas e duplicação bloqueadas; tipos de dispositivo distintos.');
