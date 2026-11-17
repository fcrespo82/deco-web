import type {FastifyInstance,FastifyRequest} from 'fastify';
import type {App} from '../app.js';
import {artworkId,parseEquipmentArtwork,type EquipmentArtwork} from '../core/equipment-artwork.js';
import {NotFoundError,ValidationError} from '../db/errors.js';
import {ConflictError} from '../core/reservations.js';
export function registerEquipmentArtworkRoutes(server:FastifyInstance,app:App,actorOf:(req:FastifyRequest)=>string){
 const prefix='map_artwork:';
 const imageUrl=(id:string,revision:number)=>`/api/maps/artwork/${encodeURIComponent(id)}/image?v=${revision}`;
 const read=(id:string)=>app.store.getJson<EquipmentArtwork>(prefix+artworkId(id));
 const metadata=(id:string,v:EquipmentArtwork)=>({...v,src:imageUrl(id,v.revision??0)});
 const list=()=>Object.fromEntries((app.store.db.prepare('SELECT key, value FROM kv WHERE key GLOB ?').all(prefix+'*') as {key:string;value:string}[]).map(r=>{const id=r.key.slice(prefix.length);return [id,metadata(id,JSON.parse(r.value))];}));
 const audit=(req:FastifyRequest,id:string)=>app.audit.record({actor:actorOf(req),action:'equipment_artwork.save',target:id,before:null,after:null});
 server.get('/api/maps/artwork',async()=>list());
 server.put<{Body:{records?:Record<string,unknown>}}>('/api/maps/artwork/import',{bodyLimit:8*1024*1024},async req=>{
  const records=req.body?.records;if(!records||typeof records!=='object'||Array.isArray(records)||Object.keys(records).length>256)throw new ValidationError('Importação de imagens inválida.');
  const imported:string[]=[];app.store.db.transaction(()=>{for(const [id,value]of Object.entries(records)){artworkId(id);if(read(id))continue;app.store.setJson(prefix+id,{...parseEquipmentArtwork(value),revision:1});imported.push(id);}})();
  for(const id of imported)audit(req,id);return list();
 });
 server.put<{Params:{id:string};Body:{artwork?:unknown;revision?:number}}>('/api/maps/artwork/:id',{bodyLimit:6*1024*1024},async req=>{
  const id=artworkId(req.params.id);const saved=app.store.db.transaction(()=>{
   const previous=read(id);if(req.body?.revision!==(previous?.revision??0))throw new ConflictError('A imagem foi alterada em outro navegador. Reabra a edição.');
   let value=req.body.artwork as EquipmentArtwork;
   if(previous&&value?.src===imageUrl(id,previous.revision??0))value={...value,src:previous.src};
   const next={...parseEquipmentArtwork(value),revision:(previous?.revision??0)+1};app.store.setJson(prefix+id,next);return next;
  })();audit(req,id);return metadata(id,saved);
 });
 server.get<{Params:{id:string}}>('/api/maps/artwork/:id/image',async(req,reply)=>{
  const value=read(req.params.id);if(!value)throw new NotFoundError('Imagem não encontrada.');
  const etag=`"equipment-${value.revision??0}"`;reply.header('etag',etag).header('cache-control','private, no-cache').header('x-content-type-options','nosniff');
  if(req.headers['if-none-match']===etag)return reply.code(304).send();
  return reply.type('image/png').send(Buffer.from(value.src.slice('data:image/png;base64,'.length),'base64'));
 });
}
