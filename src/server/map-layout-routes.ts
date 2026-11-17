import type { FastifyInstance,FastifyRequest } from "fastify";
import type { App } from "../app.js";
import { parseMapPositions,type MapLayoutView } from "../core/map-layout.js";
import { ValidationError } from "../db/errors.js";
type MapParams={Params:{map:string}};
export function registerMapLayoutRoutes(server:FastifyInstance,app:App,actorOf:(req:FastifyRequest)=>string){
 const key=(map:string)=>{if(map!=="physical"&&map!=="mesh")throw new ValidationError("Mapa inválido");return `map_layout:${map}`;};
 const read=(map:string):MapLayoutView=>app.store.getJson<MapLayoutView>(key(map))??{positions:{},revision:0,initialized:false};
 const record=(map:string,positions:MapLayoutView["positions"]):MapLayoutView=>{
  positions=parseMapPositions(positions);
  const previous=read(map);const next={positions,revision:previous.revision+1,initialized:true};app.store.setJson(key(map),next);return next;
 };
 const audit=(req:FastifyRequest,action:string)=>app.audit.record({actor:actorOf(req),action,target:`map:${(req.params as {map:string}).map}`,before:null,after:null});
 server.get<MapParams>("/api/maps/layouts/:map",async req=>read(req.params.map));
 server.patch<MapParams&{Body:{id?:unknown;point?:unknown;positions?:unknown}}>("/api/maps/layouts/:map",async req=>{
  if(!req.body?.positions&&typeof req.body?.id!=="string")throw new ValidationError("Informe o nó a mover");
  const patch=parseMapPositions(req.body.positions??{[req.body.id as string]:req.body.point});
  const result=app.store.db.transaction(()=>record(req.params.map,{...read(req.params.map).positions,...patch}))();
  audit(req,"layout.move");return result;
 });
 // Migração única: importar posições locais nunca sobrescreve um layout já inicializado.
 server.put<MapParams&{Body:{positions?:unknown}}>("/api/maps/layouts/:map",async req=>{
  const positions=parseMapPositions(req.body?.positions);
  const result=app.store.db.transaction(()=>{const current=read(req.params.map);return current.initialized?current:record(req.params.map,positions);})();
  audit(req,"layout.import");return result;
 });
 server.delete<{Params:{map:string;id:string}}>("/api/maps/layouts/:map/nodes/:id",async req=>{
  parseMapPositions({[req.params.id]:{x:0,y:0}});
  const result=app.store.db.transaction(()=>{const current=read(req.params.map);const positions={...current.positions};delete positions[req.params.id];return record(req.params.map,positions);})();
  audit(req,"layout.reset_node");return result;
 });
 server.delete<MapParams>("/api/maps/layouts/:map",async req=>{
  const result=app.store.db.transaction(()=>record(req.params.map,{}))();audit(req,"layout.reset");return result;
 });
}
