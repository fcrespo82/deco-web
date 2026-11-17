import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/db/store.js";
import { counterRate, normalizeSwitchMac, switchSnapshot, SwitchService } from "../src/switches/service.js";
import { createApp, type App } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { silentLogger } from "../src/log.js";
import { buildServer } from "../src/server/http.js";

const resources: {dir:string;store?:Store;service?:SwitchService;app?:App}[]=[];
afterEach(async()=>{vi.useRealTimers();for(const r of resources.splice(0)){if(r.app)await r.app.close();if(r.service)await r.service.stop();r.store?.close();rmSync(r.dir,{recursive:true,force:true});}});
const raw=(bytes=1000,uptime="0 days 00:01:00")=>({mac:"aa:bb:cc:dd:ee:ff",uptime,ports:[{port:"1",status:"up",tx_bytes:bytes,rx_bytes:bytes*2}],mac_table:[{mac:"1122.3344.5566",port:"1",vlan:"1",type:"dynamic"}]});
function setup(collect=vi.fn(async()=>raw())){
 const dir=mkdtempSync(join(tmpdir(),"switch-test-")),store=new Store(join(dir,"test.sqlite"));
 const service=new SwitchService(store,dir,()=>undefined,90,collect);resources.push({dir,store,service});return {dir,store,service,collect};
}
const input={name:"Escritório",host:"192.168.68.10",model:"builtin",password:"segredo-de-teste"};
describe("switches integrados",()=>{
 it("normaliza MACs e preserva ausência de evidência",()=>{
  expect(normalizeSwitchMac("aabb.ccdd.eeff")).toBe("AA-BB-CC-DD-EE-FF");
  expect(normalizeSwitchMac("não é MAC")).toBeNull();
  expect(counterRate(200,100,10,false)).toBe(10);
  expect(counterRate(1,100,10,false)).toBeNull();
  expect(counterRate(200,100,0,false)).toBeNull();
 });
 it("calcula deltas, persiste totais e interrompe a série após reset de contador ou reboot",()=>{
  const first=switchSnapshot(raw(),null,"2026-01-01T00:00:00Z");
  const next=switchSnapshot(raw(2000),first,"2026-01-01T00:00:10Z");
  expect(next.ports[0]).toMatchObject({txBps:100,rxBps:200,totalTx:1000,totalRx:2000});
  expect(switchSnapshot(raw(5),next,"2026-01-01T00:00:20Z").ports[0]).toMatchObject({txBps:null,totalTx:1000});
  expect(switchSnapshot(raw(3000,"0 days 00:00:10"),next,"2026-01-01T00:00:20Z").ports[0]?.txBps).toBeNull();
  expect(switchSnapshot({...raw(3000),ports:[{port:"1",tx_bytes:3000,rx_bytes:6000,counters_valid:false}]},next,"2026-01-01T00:00:20Z").ports[0]).toMatchObject({rxBps:null,countersValid:false});
  expect(next.macs[0]?.mac).toBe("11-22-33-44-55-66");
 });
 it("guarda credencial em arquivo privado e nunca no banco ou nas views",()=>{
  const {service,dir,store}=setup();const config=service.save(input);
  expect(JSON.stringify(service.view())).not.toContain(input.password);
  expect(JSON.stringify(store.getJson("switch_configs"))).not.toContain(input.password);
  expect(statSync(join(dir,"switch-secrets",config.id)).mode&0o777).toBe(0o600);
  expect(readFileSync(join(dir,"switch-secrets",config.id),"utf8")).toBe(input.password);
  service.save({name:"Novo nome",password:""},config.id);
  expect(readFileSync(join(dir,"switch-secrets",config.id),"utf8")).toBe(input.password);
  store.setJson("physical_topology",{nodes:[],links:[{source:"internet",target:`switch:${config.id}`,kind:"wired",sourcePort:"",targetPort:""}]});
  service.remove(config.id);expect(store.getJson("physical_topology")).toMatchObject({links:[]});expect(readdirSync(join(dir,"switch-secrets"))).toEqual([]);
 });
 it("valida host, duplicatas e limites sem iniciar coleta",()=>{
  const {service,collect}=setup();service.save(input);
  expect(()=>service.save(input)).toThrow(/cadastrado/);
  expect(()=>service.save({...input,host:"http://host/path"})).toThrow(/válido/);
  expect(()=>service.save({...input,host:"example.com",intervalSeconds:1})).toThrow(/Intervalo/);
  expect(()=>service.save({...input,host:"example.com",model:"../outro"})).toThrow(/Modelo/);
  expect(collect).not.toHaveBeenCalled();
 });
 it("impede consultas simultâneas e preserva última leitura em caso de falha",async()=>{
  vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  const {service,collect}=setup();const c=service.save(input);
  const task=service.refresh(c.id);expect(()=>service.transceiver(c.id)).toThrow(/andamento/);
  expect(()=>service.remove(c.id)).toThrow(/Aguarde/);await task;
  expect(service.view().switches[0]?.snapshot?.ports).toHaveLength(1);
  expect(service.history(c.id,"1",24)).toHaveLength(1);
  vi.setSystemTime(new Date("2026-01-01T00:00:31Z"));collect.mockRejectedValueOnce(new Error(input.password));
  await service.refresh(c.id);
  expect(service.view().switches[0]).toMatchObject({stale:true,lastError:expect.any(String)});
  expect(JSON.stringify(service.view())).not.toContain(input.password);
  expect(service.view().switches[0]?.snapshot?.at).toBe("2026-01-01T00:00:00.000Z");
 });
 it("encerra o processo coletor em andamento ao parar o serviço",async()=>{
  const dir=mkdtempSync(join(tmpdir(),"switch-abort-")),store=new Store(join(dir,"test.sqlite"));
  let aborted=false;
  const service=new SwitchService(store,dir,()=>undefined,90,async(_config,_password,_action,signal)=>new Promise((_resolve,reject)=>{
    signal?.addEventListener("abort",()=>{aborted=true;reject(new Error("abort"));},{once:true});
  }));
  resources.push({dir,store,service});const c=service.save(input);
  const task=service.refresh(c.id);await new Promise(r=>setImmediate(r));await service.stop();await task;
  expect(aborted).toBe(true);expect(service.view().switches[0]?.polling).toBe(false);
  expect(service.view().switches[0]?.lastError).toBeNull();
 });
 it("API exige autenticação e não expõe senha em cadastros ou auditoria",async()=>{
  const dir=mkdtempSync(join(tmpdir(),"switch-api-"));
  const app=createApp(loadConfig({DECO_MOCK:"1",DATA_DIR:dir}),silentLogger,{switchCollect:async(_config,_password,action)=>{if(action==="transceiver")throw new Error(input.password);return raw();}});resources.push({dir,app});
  const server=await buildServer({app,uiPassword:"senha-ui",webDist:dir});
  expect((await server.inject("/api/switches")).statusCode).toBe(401);
  const login=await server.inject({method:"POST",url:"/api/auth/login",payload:{password:"senha-ui"}});
  const cookie=login.cookies[0]!;const headers={cookie:`${cookie.name}=${cookie.value}`};
  const create=await server.inject({method:"POST",url:"/api/switches",headers,payload:input});
  expect(create.statusCode).toBe(201);expect(create.body).not.toContain(input.password);
  const id=create.json().id as string;
  expect((await server.inject({method:"POST",url:`/api/switches/${id}/refresh`,headers,payload:{}})).statusCode).toBe(202);
  await new Promise(r=>setImmediate(r));
  const view=await server.inject({url:"/api/switches",headers});expect(view.json().switches[0].snapshot.ports).toHaveLength(1);
  expect((await server.inject({url:"/api/audit",headers})).body).not.toContain(input.password);
  expect((await server.inject({url:`/api/switches/${id}/history?port=1&hours=0`,headers})).statusCode).toBe(400);
  vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(new Date(Date.now()+11_000));
  const sfp=await server.inject({method:"POST",url:`/api/switches/${id}/transceiver`,headers,payload:{}});
  expect(sfp.statusCode).toBe(503);expect(sfp.body).not.toContain(input.password);
  const wiring={nodes:[{id:"infra:main",name:"Switch principal"}],links:[{source:"internet",target:"infra:main",kind:"wired",sourcePort:"",targetPort:""}]};
  expect((await server.inject({method:"PUT",url:"/api/switches/topology",headers,payload:wiring})).statusCode).toBe(200);
  expect((await server.inject({url:"/api/switches/topology",headers})).json()).toEqual(wiring);
  await server.close();
 });
});
