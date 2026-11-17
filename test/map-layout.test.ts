import {applySavedPositions} from "../web/src/lib/map-geometry.js";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach,describe,expect,it} from "vitest";
import {createApp,type App} from "../src/app.js";
import {loadConfig} from "../src/config.js";
import {silentLogger} from "../src/log.js";
import {buildServer} from "../src/server/http.js";
import {parseMapPositions} from "../src/core/map-layout.js";
const opened:{app:App;dir:string}[]=[];
afterEach(async()=>{for(const {app,dir}of opened.splice(0)){await app.close();rmSync(dir,{recursive:true,force:true});}});
async function setup(password?:string){const dir=mkdtempSync(join(tmpdir(),"map-layout-")),app=createApp(loadConfig({DECO_MOCK:"1",DATA_DIR:dir}),silentLogger);opened.push({app,dir});return {app,dir,server:await buildServer({app,uiPassword:password,webDist:dir})};}
describe("layouts compartilhados",()=>{
 it("protege consultas e alterações com a autenticação da interface",async()=>{const {server}=await setup("secret");for(const method of ["GET","PATCH","DELETE"]as const)expect((await server.inject({method,url:"/api/maps/layouts/physical",...(method==="GET"?{}:{payload:{id:"internet",point:{x:20,y:40}}})})).statusCode).toBe(401);await server.close();});
 it("mescla alterações por nó, separa mapas e mantém dados no SQLite",async()=>{
  const {app,server}=await setup();const url="/api/maps/layouts/physical";
  expect((await server.inject(url)).json()).toMatchObject({initialized:false,revision:0,positions:{}});
  for(const [id,x]of [["internet",40],["infra:main",80]]as const)expect((await server.inject({method:"PATCH",url,payload:{id,point:{x,y:100}}})).statusCode).toBe(200);
  expect((await server.inject(url)).json()).toMatchObject({initialized:true,revision:2,positions:{internet:{x:40,y:100},"infra:main":{x:80,y:100}}});
  expect((await server.inject("/api/maps/layouts/mesh")).json().positions).toEqual({});
  expect(app.store.getJson("map_layout:physical")).toMatchObject({revision:2});
  const reloaded=(await server.inject(url)).json();
  const shown=applySavedPositions(new Map([["internet",{x:999,y:999}],["infra:main",{x:888,y:888}]]),reloaded.positions);
  expect(shown.get("internet")).toEqual({x:40,y:100});expect(shown.get("infra:main")).toEqual({x:80,y:100});
  const removed=await server.inject({method:"DELETE",url:`${url}/nodes/internet`,payload:{}});
  expect(removed.statusCode).toBe(200);expect(removed.json().positions).toEqual({"infra:main":{x:80,y:100}});
  const batch=await server.inject({method:"PATCH",url,payload:{positions:{internet:{x:10,y:20},"infra:main":{x:40,y:60}}}});
  expect(batch.statusCode).toBe(200);expect(batch.json().positions).toEqual({internet:{x:10,y:20},"infra:main":{x:40,y:60}});
  await server.close();
 });
 it("importa apenas uma vez e restaurar não ressuscita posições antigas",async()=>{
  const {server}=await setup();const url="/api/maps/layouts/mesh";
  const upload=()=>server.inject({method:"PUT",url,payload:{positions:{internet:{x:20,y:20}}}});
  expect((await upload()).json().positions.internet).toEqual({x:20,y:20});
  await server.inject({method:"PATCH",url,payload:{id:"internet",point:{x:80,y:80}}});
  expect((await upload()).json().positions.internet.x).toBe(80);
  await server.inject({method:"DELETE",url,payload:{}});
  expect((await upload()).json()).toMatchObject({initialized:true,positions:{}});await server.close();
 });
 it("valida coordenadas, identificadores e mapas",async()=>{
  expect(()=>parseMapPositions({internet:{x:Infinity,y:0}})).toThrow();
  const {server}=await setup();
  expect((await server.inject({method:"PATCH",url:"/api/maps/layouts/physical",payload:{id:"bad/id",point:{x:0,y:0}}})).statusCode).toBe(400);
  expect((await server.inject("/api/maps/layouts/other")).statusCode).toBe(400);await server.close();
 });
});
