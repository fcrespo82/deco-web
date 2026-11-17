import { parsePhysicalTopology, type PhysicalTopology } from "../switches/topology.js";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { App } from "../app.js";
import { ValidationError } from "../db/errors.js";

type Id = { Params: { id: string } };
export function registerSwitchRoutes(server: FastifyInstance, app: App, actorOf: (req: FastifyRequest)=>string) {
  const audit=(req:FastifyRequest,action:string,id:string)=>app.audit.record({actor:actorOf(req),action,target:`switch:${id}`,before:null,after:null});
  server.get("/api/switches/topology",async()=>app.store.getJson<PhysicalTopology>("physical_topology")??{nodes:[],links:[]});
  server.put<{Body:unknown}>("/api/switches/topology",async req=>{
    const refs=new Set(["internet",...app.switches.view().switches.map(s=>`switch:${s.id}`),...(app.poller.cache.snapshot?.nodes??[]).map(n=>`mesh:${n.mac}`),...[...app.store.clientSeen().keys(),...app.inventory.byMac().keys()].map(mac=>`client:${mac}`)]);
    const topology=parsePhysicalTopology(req.body,refs);
    app.store.setJson("physical_topology",topology);audit(req,"topology.update","physical");return topology;
  });
  server.get("/api/switches",async()=>app.switches.view());
  server.post<{Body:Record<string,unknown>}>("/api/switches",async(req,reply)=>{
    const c=app.switches.save(req.body??{});audit(req,"switch.create",c.id);return reply.code(201).send(c);
  });
  server.put<Id & {Body:Record<string,unknown>}>("/api/switches/:id",async req=>{
    const c=app.switches.save(req.body??{},req.params.id);audit(req,"switch.update",c.id);return c;
  });
  server.delete<Id>("/api/switches/:id",async req=>{app.switches.remove(req.params.id);audit(req,"switch.delete",req.params.id);return {ok:true};});
  server.post<Id>("/api/switches/:id/refresh",async(req,reply)=>{
    // Valida sincronicamente conflitos antes de responder 202; coleta continua em segundo plano.
    const task=app.switches.refresh(req.params.id);void task.catch(()=>undefined);
    return reply.code(202).send({ok:true});
  });
  server.post<Id>("/api/switches/:id/transceiver",async (req,reply)=>{
    try { return {at:new Date().toISOString(),data:await app.switches.transceiver(req.params.id)}; }
    catch(error) {
      if(error instanceof ValidationError) throw error;
      return reply.code(503).send({error:"Diagnóstico SFP indisponível nesta leitura. Confira o suporte do equipamento e se há módulo conectado."});
    }
  });
  server.get<Id & {Querystring:{port?:string;hours?:string}}>("/api/switches/:id/history",async req=>{
    const hours=Number(req.query.hours??24),port=req.query.port??"";
    if(!Number.isFinite(hours)||hours<1||hours>24*31||!port||port.length>40) throw new ValidationError("Informe porta e período entre 1 e 744 horas");
    return {samples:app.switches.history(req.params.id,port,hours)};
  });
}
