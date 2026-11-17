import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {afterEach,describe,expect,it} from 'vitest';
import {createApp,type App} from '../src/app.js';
import {loadConfig} from '../src/config.js';
import {silentLogger} from '../src/log.js';
import {buildServer} from '../src/server/http.js';
import {topicsForWrite} from '../src/server/live.js';
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jH54AAAAASUVORK5CYII=';
const art={src:'data:image/png;base64,'+png,imageWidth:1,imageHeight:1,pins:{'1':{x:.5,y:.7,side:'bottom'}},deviceType:'router'};
const apps:App[]=[],dirs:string[]=[];
afterEach(async()=>{for(const app of apps.splice(0))if(app.store.db.open)await app.close();for(const dir of dirs.splice(0))rmSync(dir,{recursive:true,force:true});});
async function setup(dir=mkdtempSync(join(tmpdir(),'equipment-artwork-')),password?:string){if(!dirs.includes(dir))dirs.push(dir);const app=createApp(loadConfig({DECO_MOCK:'1',DATA_DIR:dir}),silentLogger);apps.push(app);return {app,dir,server:await buildServer({app,webDist:dir,uiPassword:password})};}
describe('PNGs e calibração compartilhados no SQLite',()=>{
 it('persiste imagem e portas, permite outro navegador e sobrevive à reabertura do banco',async()=>{
  const first=await setup(),url='/api/maps/artwork/infra%3Arouter';
  const saved=await first.server.inject({method:'PUT',url,payload:{artwork:art,revision:0}});expect(saved.statusCode).toBe(200);expect(saved.json()).toMatchObject({revision:1,pins:art.pins});expect(saved.json().src).not.toContain('base64');
  expect((await first.server.inject({method:'PATCH',url:'/api/maps/layouts/physical',payload:{positions:{internet:{x:260,y:140}}}})).statusCode).toBe(200);
  await first.server.close();await first.app.close();const second=await setup(first.dir);
  expect((await second.server.inject('/api/maps/layouts/physical')).json().positions).toEqual({internet:{x:260,y:140}});
  const all=(await second.server.inject('/api/maps/artwork')).json();expect(all['infra:router']).toMatchObject({pins:art.pins,revision:1});
  const image=await second.server.inject(all['infra:router'].src);expect(image.statusCode).toBe(200);expect(image.headers['content-type']).toContain('image/png');expect(image.rawPayload).toEqual(Buffer.from(png,'base64'));
  expect((await second.server.inject({method:'GET',url:all['infra:router'].src,headers:{'if-none-match':image.headers.etag!}})).statusCode).toBe(304);
  const changed={...all['infra:router'],pins:{'1':{x:.2,y:.3,side:'right'}}};expect((await second.server.inject({method:'PUT',url,payload:{artwork:changed,revision:1}})).json()).toMatchObject({revision:2,pins:changed.pins});
  expect((await second.server.inject({method:'PUT',url,payload:{artwork:art,revision:1}})).statusCode).toBe(409);await second.server.close();
 });
 it('importa dados locais uma vez sem sobrescrever calibração já compartilhada',async()=>{const {server}=await setup();const importLocal=(records:unknown)=>server.inject({method:'PUT',url:'/api/maps/artwork/import',payload:{records}});expect((await importLocal({'infra:router':art})).statusCode).toBe(200);const response=await importLocal({'infra:router':{...art,pins:{}},'infra:other':art});expect(response.json()['infra:router'].pins).toEqual(art.pins);expect(response.json()['infra:other']).toBeTruthy();await server.close();});
 it('valida os bytes do PNG, dimensões, IDs e coordenadas; protege imagem e metadados',async()=>{const {server}=await setup();for(const [id,value]of [['bad/id',art],['infra:bad',{...art,src:'https://example.com/x.png'}],['infra:bad',{...art,imageWidth:50}],['infra:bad',{...art,pins:{wifi:{x:0,y:0,side:'top'}}}],['infra:bad',{...art,pins:{'1':{x:2,y:0,side:'top'}}}]])expect((await server.inject({method:'PUT',url:'/api/maps/artwork/'+encodeURIComponent(String(id)),payload:{artwork:value,revision:0}})).statusCode).toBe(400);await server.close();const protectedServer=await setup(undefined,'secret');for(const url of ['/api/maps/artwork','/api/maps/artwork/infra%3Arouter/image'])expect((await protectedServer.server.inject(url)).statusCode).toBe(401);await protectedServer.server.close();expect(topicsForWrite('/api/maps/artwork/infra%3Arouter')).toContain('images');});
});
