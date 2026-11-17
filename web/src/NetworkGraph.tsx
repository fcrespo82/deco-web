import {applySavedPositions} from "./lib/map-geometry";
import {EquipmentArtEditor} from "./network/EquipmentArtEditor";
import {ARTWORK_KEY,validArtworkRecords,type EquipmentArtwork} from "./network/artwork";
import {lazy,Suspense} from "preact/compat";
const JointNetworkMap=lazy(()=>import("./network/JointNetworkMap").then(m=>({default:m.JointNetworkMap})));
import {addPhysicalLink,removePhysicalLink,externalPort,type NetworkNode as GraphNode,type NetworkLink as GraphLink} from "./network/adapter";
import {categoryOf} from "./art/devices";
import {mapMatches} from "./lib/map-search";
import {WiringEditor} from "./WiringEditor";
import { MapContextMenu, mapMenuContext, type MapMenuContext } from "./MapContextMenu";
import { cardHeight, modelPortCount } from "./lib/port-points";
import { readStored, useStored } from "./lib/preferences";
import { useNodePositions } from "./lib/node-positions";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { api } from "./api";
import { useClients, useOverview, useSwitches } from "./data";
import { useQuery, invalidate, getQueryData, setQueryData } from "./lib/query";
import { selectNode, openClient } from "./lib/ui-state";
import { Button, Dialog, Field, PageLoading } from "./ui";
import type { PhysicalLink, PhysicalTopology } from "../../src/switches/topology";

export function NetworkGraph({ambient=false,focusWiringId,onWiringOpened,search="",expanded=false,readOnly=false}:{ambient?:boolean;expanded?:boolean;readOnly?:boolean;search?:string;focusWiringId?:string|null;onWiringOpened?:()=>void}={}){
  const topology=useQuery("physical-topology",api.networkTopology,["switches"]);
  const overview=useOverview();const switches=useSwitches();const clients=useClients();
  const [editing,setEditing]=useState<string|true|false>(false);
  useEffect(()=>{if(focusWiringId&&!readOnly){setEditing(focusWiringId);onWiringOpened?.();}},[focusWiringId]);const [showClients,setShowClients]=useState(false);
  const [selected,setSelected]=useState<string|null>(null);
  const [focus,setFocus]=useState<string|null>(null);
  const [selectedLink,setSelectedLink]=useState<GraphLink|null>(null);
  const savingRef=useRef(false);
  const artQuery=useQuery("equipment-artwork",api.equipmentArtwork,["images"]);
  const artwork=artQuery.data??{};
  const importedArtwork=useRef(false);
  useEffect(()=>{if(!artQuery.data||importedArtwork.current||ambient||readOnly)return;importedArtwork.current=true;const legacy=readStored<Record<string,EquipmentArtwork>>(ARTWORK_KEY,{},validArtworkRecords);if(!Object.keys(legacy).length)return;
   void api.importEquipmentArtwork(legacy).then(records=>{setQueryData<Record<string,EquipmentArtwork>>("equipment-artwork",()=>records);try{localStorage.removeItem(ARTWORK_KEY);}catch{/* A cópia local pode permanecer: a importação nunca sobrescreve o banco. */}}).catch(e=>setWireError("Não foi possível importar os PNGs locais: "+e.message));
  },[artQuery.data,ambient,readOnly]);
  const [artId,setArtId]=useState<string|null>(null);
  const [wireError,setWireError]=useState<string|null>(null);
  const [wireSaving,setWireSaving]=useState(false);
  const [grid,setGrid]=useStored("maps.physical.grid",true,(v):v is boolean=>typeof v==="boolean");
  const [moveChildren,setMoveChildren]=useStored("maps.physical.moveChildren",false,(v):v is boolean=>typeof v==="boolean");
  const [context,setContext]=useState<MapMenuContext|null>(null);
  const [appearance,setAppearance]=useStored<"cards"|"equipment">("maps.physical.appearance","equipment",(v):v is "cards"|"equipment"=>v==="cards"||v==="equipment");
  const positioning=useNodePositions("maps.physical.positions",grid?20:0,readOnly);
  const graph=useMemo(()=>{
    const config=topology.data??{nodes:[],links:[]};
    let nodes:GraphNode[]=[{id:"internet",name:"Internet",kind:"internet",sub:"WAN",online:overview.data?.internet?.ipv4Online??null},
      ...(overview.data?.nodes??[]).map(n=>({id:`mesh:${n.mac}`,name:n.name,kind:"mesh" as const,sub:`Deco ${n.model}${n.role==="master"?" · gateway":""}`,online:n.online,mac:n.mac,portCount:config.portCounts?.[`mesh:${n.mac}`]??modelPortCount(n.model),model:n.model})),
      ...(switches.data?.switches??[]).map(s=>({id:`switch:${s.id}`,name:s.name,kind:"switch" as const,sub:`${s.host} · ${s.snapshot?.ports.filter(p=>p.status==="up").length??0} portas ativas`,online:s.enabled&&!s.stale,model:s.model,portCount:s.snapshot?.ports.length||s.portCount,portNames:s.snapshot?.ports.map(p=>p.port),portStates:!s.stale?Object.fromEntries(s.snapshot?.ports.map(p=>[p.port,p.status])??[]):{}})),
      ...config.nodes.map(n=>({...n,kind:"infra" as const,sub:`${n.kind==="node"?"Nó de rede":n.kind==="device"?"Dispositivo":"Switch"} · cadastro físico`,online:null,portCount:n.portCount??null,manualKind:n.kind??"switch"})),
    ];
    const referenced=new Set(config.links.flatMap(l=>[l.source,l.target]));
    for(const c of clients.data?.clients??[]){const id=`client:${c.mac}`;if(referenced.has(id)||config.portCounts?.[id]!==undefined||config.portNames?.[id])nodes.push({id,name:c.device?.alias??c.name,kind:"client",sub:c.ip??"Dispositivo",online:c.online,mac:c.mac,portCount:null});}
    for(const n of nodes){
      if(config.portCounts?.[n.id]!==undefined)n.portCount=config.portCounts[n.id];
      const aliases=config.portNames?.[n.id];
      if(aliases){const original=n.portNames??Array.from({length:n.portCount??aliases.length},(_,i)=>String(i+1));if(n.portStates)n.portStates=Object.fromEntries(aliases.map((name,i)=>[name,n.portStates?.[original[i]!]??"unknown"]));n.portNames=aliases;n.portCount=aliases.length;}
    }
    const ids=new Set(nodes.map(n=>n.id));
    let links:GraphLink[]=config.links.filter(l=>ids.has(l.source)&&ids.has(l.target)).map(l=>({source:l.source,target:l.target,label:l.kind==="wired"?`cabo · ${l.sourcePort||"?"} → ${l.targetPort||"?"}`:"Wi-Fi",sourceType:"manual",kind:l.kind,sourcePort:l.sourcePort,targetPort:l.targetPort}));
    const hasParent=(id:string)=>links.some(l=>l.target===id);
    // Somente relações de backhaul sem fio são usadas como topologia automática.
    for(const n of overview.data?.nodes??[]){
      const id=`mesh:${n.mac}`;
      if(hasParent(id))continue;
      if(n.role==="master")links.push({source:"internet",target:id,label:"WAN · Deco",sourceType:"mesh",kind:"wired"});
      else if(!n.backhaul.includes("wired")&&n.parentMac&&ids.has(`mesh:${n.parentMac}`))links.push({source:`mesh:${n.parentMac}`,target:id,label:"Wi-Fi · Deco",sourceType:"mesh",kind:"wireless"});
    }
    if(showClients)for(const c of clients.data?.clients??[]){
      if(!c.online||nodes.some(n=>n.mac===c.mac))continue;
      const id=`client:${c.mac}`;
      if(c.band&&c.band!=="wired"&&c.nodeMac&&ids.has(`mesh:${c.nodeMac}`)){
        nodes.push({id,name:c.device?.alias??c.name,kind:"client",sub:c.ip??"Cliente Wi-Fi",online:true,mac:c.mac,portCount:config.portCounts?.[id]??null});
        links.push({source:`mesh:${c.nodeMac}`,target:id,label:c.band,sourceType:"association",kind:"wireless"});
      }else{
        // Exclui portas de uplink cadastradas: elas enxergam a rede além do switch.
        const sightings=(switches.data?.switches??[]).filter(s=>!s.stale).flatMap(s=>s.snapshot?.macs.filter(m=>m.mac===c.mac&&!config.links.some(l=>l.target===`switch:${s.id}`&&l.targetPort&&l.targetPort===m.port)).map(m=>({s,m}))??[]);
        if(sightings.length===1){const {s,m}=sightings[0]!;nodes.push({id,name:c.device?.alias??c.name,kind:"client",sub:c.ip??"MAC observado",online:true,mac:c.mac,portCount:config.portCounts?.[id]??null});links.push({source:`switch:${s.id}`,target:id,label:`via porta ${m.port}`,sourceType:"fdb",kind:"wired",sourcePort:config.portNames?.[`switch:${s.id}`]?.[s.snapshot!.ports.findIndex(p=>p.port===m.port)]??m.port});}
      }
    }
    if(search.trim())for(const c of clients.data?.clients??[])if(!nodes.some(n=>n.mac===c.mac)&&mapMatches(search,c.device?.alias,c.name,c.ip,c.mac))nodes.push({id:`client:${c.mac}`,name:c.device?.alias??c.name,kind:"client",sub:c.ip??"Dispositivo sem conexão mapeada",online:c.online,mac:c.mac,portCount:config.portCounts?.[`client:${c.mac}`]??null,portNames:config.portNames?.[`client:${c.mac}`]});
    if(readOnly&&!showClients){const hidden=new Set(nodes.filter(n=>n.kind==="client"||n.manualKind==="device").map(n=>n.id));nodes=nodes.filter(n=>!hidden.has(n.id));links=links.filter(l=>!hidden.has(l.source)&&!hidden.has(l.target));}
    const parent=new Map(links.map(l=>[l.target,l.source]));
    const depth=(id:string,seen=new Set<string>()):number=>{if(seen.has(id))return 0;seen.add(id);const p=parent.get(id);return p?Math.min(8,depth(p,seen)+1):id==="internet"?0:1;};
    const levels=new Map<number,GraphNode[]>();
    for(const n of nodes){const level=depth(n.id);levels.set(level,[...(levels.get(level)??[]),n]);}
    const width=Math.max(760,...[...levels.values()].map(row=>row.length*190+40));
    const rowStep=Math.max(130,...nodes.map(n=>cardHeight(n.portCount??null)+65));
    const height=(Math.max(...levels.keys(),1)+1)*rowStep+60;
    const positions=new Map<string,{x:number;y:number}>();
    for(const [level,row]of levels)row.forEach((n,i)=>positions.set(n.id,{x:width/(row.length+1)*(i+1),y:level*rowStep+65}));
    const clientByMac=new Map((clients.data?.clients??[]).map(c=>[c.mac,c]));
    for(const n of nodes)if(n.kind==="client"&&n.mac){const c=clientByMac.get(n.mac);if(c){const category=categoryOf(c);if(["phone","tablet","laptop","desktop","tv"].includes(category))n.deviceType=category;}}
    return {nodes,links,positions:applySavedPositions(positions,positioning.positions)};
  },[topology.data,overview.data,switches.data,clients.data,showClients,positioning.positions,search,readOnly]);
  if(!topology.data||!overview.data||!switches.data)return <PageLoading error={topology.error??overview.error??switches.error}/>;
  const selectedNode=graph.nodes.find(n=>n.id===selected);
  const observations=selectedNode?.mac?switches.data.switches.flatMap(s=>s.snapshot?.macs.filter(m=>m.mac===selectedNode.mac).map(m=>`${s.name} · porta ${m.port} · VLAN ${m.vlan}${s.stale?" · leitura desatualizada":""}`)??[]):[];
  const matches=search.trim()?graph.nodes.filter(n=>mapMatches(search,n.name,n.sub,n.mac)):[];
  async function saveTopology(next:PhysicalTopology){
    if(readOnly)return;
    if(savingRef.current)throw Error("Aguarde a gravação da ligação anterior.");
    savingRef.current=true;setWireSaving(true);setWireError(null);
    try{const saved=await api.saveNetworkTopology(next);setQueryData<PhysicalTopology>("physical-topology",()=>saved);invalidate(["switches"]);}catch(e){const message=e instanceof Error?e.message:"Não foi possível salvar o cabeamento";setWireError(message);throw e;}finally{savingRef.current=false;setWireSaving(false);}
  }
  async function connect(source:string,sp:string,target:string,tp:string){
    if(ambient||readOnly)return;
    if(target==="internet"){[source,target]=[target,source];[sp,tp]=[tp,sp];}
    const a=graph.nodes.find(n=>n.id===source)!,b=graph.nodes.find(n=>n.id===target)!;
    const wifi=sp==="wifi"&&tp==="wifi";
    if((sp==="wifi")!==(tp==="wifi"))throw Error("Conecte Ethernet a Ethernet ou Wi-Fi a Wi-Fi.");
    await saveTopology(addPhysicalLink(getQueryData<PhysicalTopology>("physical-topology")??topology.data!,{source,target,sourcePort:wifi?"":externalPort(a,sp),targetPort:wifi?"":externalPort(b,tp),kind:wifi?"wireless":"wired"}));
  }
  return <div class={ambient?"flex h-full min-h-0 flex-col pt-12":expanded?"flex min-h-0 flex-1 flex-col":""}>
    {!ambient&&!readOnly&&<div class="border-b border-line px-4 py-2">
      <div class="flex flex-wrap items-center justify-between gap-2"><p class="text-xs text-muted">Mapa físico da rede</p><Button size="sm" onClick={()=>setEditing(true)}>Editar cabeamento</Button></div>
      <details class="mt-2"><summary class="cursor-pointer py-1 text-xs font-medium text-muted">Opções do mapa</summary><div class="mt-2 grid gap-4 rounded-lg bg-surface-2 p-3 sm:grid-cols-2"><fieldset class="space-y-3"><legend class="mb-2 text-xs font-semibold">Visualização</legend><label class="grid gap-1 text-xs">Aparência<select class="field !py-1.5" value={appearance} onChange={e=>setAppearance(e.currentTarget.value as typeof appearance)}><option value="equipment">Equipamentos</option><option value="cards">Cartões</option></select></label><label class="flex items-center gap-2 text-xs"><input type="checkbox" checked={showClients} onChange={e=>setShowClients(e.currentTarget.checked)}/>Mostrar clientes</label></fieldset><fieldset class="space-y-3"><legend class="mb-2 text-xs font-semibold">Organização</legend><label class="flex items-center gap-2 text-xs"><input type="checkbox" checked={grid} onChange={e=>setGrid(e.currentTarget.checked)}/>Encaixar na grade</label><label class="flex items-center gap-2 text-xs"><input type="checkbox" checked={moveChildren} onChange={e=>setMoveChildren(e.currentTarget.checked)}/>Mover filhos juntos</label><Button size="sm" onClick={()=>{positioning.reset();}}>Restaurar posições</Button></fieldset></div></details>
      <details class="mt-1"><summary class="cursor-pointer py-1 text-xs text-muted">Ajuda e legenda</summary><p class="py-2 text-xs leading-relaxed text-muted">Use a roda para zoom e arraste o fundo para navegar. Ative “Mover filhos juntos” para mover um ramo inteiro. Clique direito para editar; arraste entre portas livres para cabear. Linha contínua: cabo; tracejada: Wi-Fi. Relações observadas continuam identificadas no painel da ligação. Use Organizar rede para reorganizar todos os equipamentos automaticamente.</p></details>
    </div>}
    {!ambient&&readOnly&&<div class="flex items-center justify-between border-b border-line px-4 py-2"><label class="flex items-center gap-2 text-xs"><input type="checkbox" checked={showClients} onChange={e=>setShowClients(e.currentTarget.checked)}/>Mostrar clientes</label><span class="text-xs text-muted">Consulta</span></div>}
    {!ambient&&search.trim()&&<div class="flex flex-wrap items-center gap-2 px-4 pt-2" role="region" aria-label="Resultados da busca no mapa"><span class="text-xs text-muted" role="status">{matches.length?`${matches.length} resultado(s). Clique para localizar.`:"Nenhum dispositivo encontrado."}</span>{matches.map(n=><Button size="sm" onClick={()=>{setSelected(n.id);setFocus(n.id);}}>{n.name}</Button>)}</div>}
    {artQuery.error&&<p role="alert" class="px-4 pt-2 text-xs text-bad">Não foi possível carregar os PNGs compartilhados: {artQuery.error.message}</p>}
    {wireError&&<p role="alert" class="px-4 pt-2 text-xs text-bad">{wireError}</p>}
    {wireSaving&&<p role="status" class="px-4 text-xs text-muted">Salvando ligação entre portas…</p>}
    {!ambient&&positioning.saveError&&<p role="alert" class="px-4 pt-2 text-xs text-bad">{positioning.saveError}</p>}
    {!ambient&&positioning.saving&&<p role="status" class="px-4 pt-2 text-xs text-muted">Salvando posições no servidor…</p>}
    <div class={ambient||expanded?"min-h-0 flex-1":"relative h-[70vh] min-h-[500px] overflow-hidden"}>
      {positioning.ready?<Suspense fallback={<p class="p-4 text-sm text-muted">Carregando mapa…</p>}><JointNetworkMap nodes={graph.nodes} links={graph.links} positions={graph.positions} artwork={artwork} hasSavedPositions={Object.keys(positioning.savedPositions).length>0} appearance={appearance} grid={grid} ambient={ambient} readOnly={readOnly} moveChildren={moveChildren} search={search} selected={selected} focusId={focus} saving={wireSaving}
        onMoveMany={positioning.placeMany} onConnect={connect} onSelect={(id:string)=>{setSelected(id);setSelectedLink(null);const n=graph.nodes.find(n=>n.id===id);if(n?.kind==="mesh")selectNode(n.mac!);if(n?.kind==="client")openClient(n.mac!);}}
        onSelectLink={(link:GraphLink)=>{setSelectedLink(link);setSelected(null);}} onContextMenu={ambient||readOnly?undefined:(e:MouseEvent)=>setContext(mapMenuContext(e))}/></Suspense>:<p class="p-4 text-sm text-muted">Carregando posições do mapa…</p>}
    </div>
    {!ambient&&!readOnly&&selectedLink&&<div class="mx-4 mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-line p-3 text-xs"><span>{graph.nodes.find(n=>n.id===selectedLink.source)?.name} → {graph.nodes.find(n=>n.id===selectedLink.target)?.name} · {selectedLink.label} · {selectedLink.sourceType==="manual"?"cadastro físico":selectedLink.sourceType==="fdb"?"MAC observado; pode haver equipamentos intermediários":"relação reportada pela rede"}</span>{selectedLink.sourceType==="manual"&&<Button size="sm" disabled={wireSaving} onClick={()=>{void saveTopology(removePhysicalLink(getQueryData<PhysicalTopology>("physical-topology")??topology.data!,selectedLink)).then(()=>setSelectedLink(null)).catch(()=>{});}}>Remover ligação cadastrada</Button>}</div>}
    {!ambient&&!readOnly&&selectedNode&&<div class="mx-4 mb-3 rounded-lg border border-line p-3 text-xs"><strong>{selectedNode.name}</strong> <span class="text-muted">{selectedNode.online===null?"Estado não informado":selectedNode.online?"Online":"Offline"}</span> <Button size="sm" disabled={!artQuery.data} onClick={()=>setArtId(selectedNode.id)}>PNG e portas…</Button>{observations.map(text=><div class="mt-1">Observado: {text}</div>)}{selectedNode.mac&&!observations.length&&<p class="mt-1 text-muted">Sem observação deste MAC nas tabelas atuais dos switches.</p>}{selectedNode.kind==="switch"&&<p class="mt-1"><a class="text-accent underline" href="#/switches">Abrir portas e diagnóstico</a></p>}{selectedNode.kind==="infra"&&<p class="mt-1 text-muted">Switch sem gerenciamento: sem coleta própria.</p>}</div>}
    {topology.data.links.length===0&&<p class="px-4 pb-3 text-sm text-muted">Cadastre o cabeamento para conectar os switches e Decos cabeados. A relação mesh não é usada para adivinhar essas ligações.</p>}
    {context&&!ambient&&!readOnly&&<MapContextMenu context={context} mode="physical" onEditWiring={id=>setEditing(id)} onResetPosition={positioning.resetNode} onClose={()=>setContext(null)} onPlaced={(id,p)=>positioning.place(id,p)}/>}
    {!readOnly&&artId&&graph.nodes.find(n=>n.id===artId)&&<EquipmentArtEditor node={graph.nodes.find(n=>n.id===artId)!} initial={artwork[artId]} onClose={()=>setArtId(null)} onSave={async spec=>{const saved=await api.saveEquipmentArtwork(artId,spec);setQueryData<Record<string,EquipmentArtwork>>("equipment-artwork",old=>({...old,[artId]:saved}));invalidate(["images"]);setArtId(null);}}/>}
    {!readOnly&&editing&&<WiringEditor config={topology.data} focusId={typeof editing==="string"?editing:undefined} nodes={graph.nodes.map(n=>({id:n.id,name:n.name,ports:n.portNames??Array.from({length:n.portCount??0},(_,i)=>String(i+1))}))} onClose={()=>setEditing(false)}/>}
  </div>;
}
