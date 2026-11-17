import {useMemo,useState} from "preact/hooks";
import {Maximize,Minimize,Router,Search} from "lucide-preact";
import {useMapFullscreen} from "../lib/map-fullscreen";
import {mapMatches} from "../lib/map-search";
import {NetworkGraph} from "../NetworkGraph";
import {Topology,TopologyLegend} from "../Topology";
import {useClients,useOverview,useStatus} from "../data";
import {useNow} from "../hooks";
import {openClient as openClientSheet,selectNode,setUi,useUi} from "../lib/ui-state";
import type {ClientView} from "../api";
import {clientLabel} from "../ClientSheet";
import {Button,Card,cx,Empty,PageLoading} from "../ui";
import {NodePanel,TopTalkers} from "./Overview";

export function NetworkTopology(){
 const mapFull=useMapFullscreen(),now=useNow(),{data,error}=useOverview(),clientsQ=useClients(),status=useStatus();
 const {node:selected}=useUi(),setSelected=selectNode;
 const [q,setQ]=useState("");
 const [physicalFocus,setPhysicalFocus]=useState<string|null>(null);
 const [mapMode,setMapMode]=useState<"physical"|"mesh">("physical");
 const clients=clientsQ.data?.clients??[];
 const highlight=useMemo(()=>{const needle=q.trim().toLowerCase();return needle?(c:ClientView)=>mapMatches(needle,clientLabel(c),c.name,c.ip,c.mac,c.vendor,c.device?.owner):undefined;},[q]);
 if(!data)return <PageLoading error={error}/>;
 if(!data.nodes.length)return <Empty icon={<Router/>}>Ainda sem dados do Deco.</Empty>;
 const dangerous=(status?.mode??data.status.mode).allowDangerous;
 const node=data.nodes.find(n=>n.mac===selected)??null;
 const openClient=(c:ClientView)=>openClientSheet(c.mac);
 const matches=highlight?clients.filter(c=>c.online&&highlight(c)).length+data.nodes.filter(n=>mapMatches(q,n.name,n.mac,n.model)).length:0;
 return (
      <div class="grid gap-3 lg:grid-cols-[minmax(0,1fr)_330px]">
        <div ref={mapFull.ref} class={cx("min-w-0",mapFull.full&&"map-fullscreen")}><Card class={cx("hero-glow relative overflow-hidden p-0 max-sm:-mx-1",mapFull.full&&"flex h-full min-h-0 flex-col overflow-y-auto")} >
          <div class="shrink-0 space-y-3 border-b border-line px-4 py-3">
            <div class="flex flex-wrap items-center justify-between gap-2"><h2 class="text-[15px] font-semibold tracking-tight">Mapa da rede</h2><div class="flex items-center gap-3"><span class="inline-flex items-center gap-1.5 text-[11px] text-ok"><span class="size-1.5 rounded-full bg-ok"/>Última coleta</span><Button size="sm" aria-pressed={mapFull.full} onClick={mapFull.toggle}>{mapFull.full?<Minimize class="size-4"/>:<Maximize class="size-4"/>}{mapFull.full?"Sair da tela cheia":"Ver em tela cheia"}</Button></div></div>
            <div class="flex flex-wrap items-center gap-2"><div class="flex shrink-0 gap-1 rounded-lg bg-surface-2 p-1" role="group" aria-label="Tipo de mapa"><Button size="sm" aria-pressed={mapMode==="physical"} onClick={()=>setMapMode("physical")}>Físico</Button><Button size="sm" aria-pressed={mapMode==="mesh"} onClick={()=>setMapMode("mesh")}>Mesh</Button></div><div class="relative min-w-48 flex-1"><Search class="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted"/><input type="search" class="field py-1.5 pl-8 text-[13px]" placeholder="Buscar dispositivo por nome, IP ou MAC…" value={q} onInput={e=>setQ(e.currentTarget.value)} aria-label="Achar aparelho no mapa"/></div></div>
          </div>
          {mapMode==="physical"?<NetworkGraph expanded={mapFull.full} search={q} focusWiringId={physicalFocus} onWiringOpened={()=>setPhysicalFocus(null)}/>:<>
          <p class="px-4 pt-2 text-xs text-muted">Relações reportadas pelo Deco. As linhas entre nós cabeados não representam necessariamente o cabeamento físico. <a href="#/switches" class="text-accent underline">Consultar switches e portas</a></p>
          {highlight && <p class="px-4 pt-1 text-[12px] text-muted">{matches === 0 ? "Nenhum nó ou aparelho online com esse nome." : `${matches} resultado(s) destacado(s).`}</p>}
          <div class="px-1 sm:px-2">
            <Topology search={q} onEditWiring={id=>{setPhysicalFocus(id);setMapMode("physical");}} onOpenPhysical={()=>setMapMode("physical")} nodes={data.nodes} clients={clients} internet={data.internet} selected={selected} onSelectNode={setSelected} onSelectClient={openClient} highlight={highlight} />
          </div>
          <div class="border-t border-line/70 px-4 py-2.5">
            <TopologyLegend />
          </div>
          </>}
        </Card></div>
        <Card class="lg:sticky lg:top-[72px] lg:self-start">
          {node ? (
            <NodePanel node={node} clients={clients} now={now} onReboot={dangerous ? () => setUi({ reboot: node.mac }) : undefined} onOpen={openClient} onClose={() => setSelected(null)} />
          ) : (
            <TopTalkers clients={clients} onOpen={openClient} />
          )}
        </Card>
      </div>
 );
}
