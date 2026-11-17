import {DevicePortsEditor} from "./DevicePortsEditor";
import { createPortal } from "preact/compat";
import { useEffect, useRef, useState } from "preact/hooks";
import type { ManualNodeKind, PhysicalTopology } from "../../src/switches/topology";
import type { Point } from "./lib/node-positions";
import { api } from "./api";
import { useSwitches } from "./data";
import { invalidate, useQuery } from "./lib/query";
import { SwitchEditor } from "./SwitchEditor";
import { Button, Dialog, Field } from "./ui";
export interface MapMenuContext { x:number;y:number;point:Point;nodeId?:string;name?:string;portCount?:number|null;portNames?:string[] }
export function mapMenuContext(e:MouseEvent):MapMenuContext|null {
  e.preventDefault();e.stopPropagation();
  const svg=e.currentTarget as SVGSVGElement, matrix=(svg.querySelector<SVGGElement>("[data-map-stage]")??svg).getScreenCTM();if(!matrix)return null;
  const node=(e.target as Element).closest("[data-map-node]") as SVGElement|null;
  const rect=node?.getBoundingClientRect()??svg.getBoundingClientRect();
  const x=e.clientX===0&&e.clientY===0?rect.x+rect.width/2:e.clientX,y=e.clientX===0&&e.clientY===0?rect.y+rect.height/2:e.clientY;
  const point=new DOMPoint(x,y).matrixTransform(matrix.inverse());
  return {x,y,point,nodeId:node?.dataset.mapNode,name:node?.dataset.mapName,portCount:node?.dataset.portCount?Number(node.dataset.portCount):null,portNames:node?.dataset.portNames?JSON.parse(node.dataset.portNames):undefined};
}
export function MapContextMenu({context,mode,onClose,onPlaced,onResetPosition,onEditWiring}:{context:MapMenuContext;mode:"physical"|"mesh";onClose:()=>void;onPlaced:(id:string,point:Point)=>void;onResetPosition?:(id:string)=>void;onEditWiring?:(id:string)=>void}){
  const topology=useQuery("physical-topology",api.networkTopology,["switches"]);
  const switches=useSwitches();
  const [action,setAction]=useState<ManualNodeKind|"ports"|"monitor"|null>(null);
  const [name,setName]=useState(context.name??"");const [count,setCount]=useState(context.portCount??2);
  const [labels,setLabels]=useState((context.portNames??[]).join(", "));
  const [error,setError]=useState<string|null>(null);const [busy,setBusy]=useState(false);
  const menu=useRef<HTMLDivElement>(null);
  useEffect(()=>{menu.current?.querySelector<HTMLButtonElement>("button")?.focus();const close=(e:KeyboardEvent)=>{if(e.key==="Escape")onClose();};window.addEventListener("keydown",close);return()=>window.removeEventListener("keydown",close);},[]);
  const begin=(kind:ManualNodeKind)=>{setAction(kind);setName("");setLabels("");setCount(kind==="switch"?8:kind==="device"?1:2);};
  async function save(event:Event){
    event.preventDefault();if(!topology.data)return;setBusy(true);setError(null);
    try{
      let next:PhysicalTopology;
      let id=context.nodeId??"";
      id=`infra:${crypto.randomUUID()}`;
      next={...topology.data,nodes:[...topology.data.nodes,{id,name:name.trim(),kind:action as ManualNodeKind,portCount:count}]};
      if(context.nodeId)next.links=[...next.links,{source:context.nodeId,target:id,sourcePort:"",targetPort:"",kind:"wired"}];
      const names=labels.trim()?labels.split(/[,;\n]/).map(n=>n.trim()).filter(Boolean):Array.from({length:count},(_,i)=>String(i+1));
      if(names.length!==count)throw new Error("Informe um nome por porta, ou deixe os nomes vazios para usar a numeração automática.");
      next={...next,portNames:{...next.portNames,[id]:names}};
      await api.saveNetworkTopology(next);invalidate(["switches"]);
      onPlaced(id,context.point);
      onClose();
    }catch(e){setError(e instanceof Error?e.message:"Não foi possível salvar");}finally{setBusy(false);}
  }
  async function removeManual(){
    const id=context.nodeId;if(!topology.data||!id?.startsWith("infra:")||!confirm(`Remover ${context.name??"equipamento"} e suas ligações do mapa?`))return;
    setBusy(true);setError(null);
    try{
      const next={...topology.data,nodes:topology.data.nodes.filter(n=>n.id!==id),links:topology.data.links.filter(l=>l.source!==id&&l.target!==id),...(topology.data.portCounts?{portCounts:Object.fromEntries(Object.entries(topology.data.portCounts).filter(([key])=>key!==id))}:{}),...(topology.data.portNames?{portNames:Object.fromEntries(Object.entries(topology.data.portNames).filter(([key])=>key!==id))}:{})};
      await api.saveNetworkTopology(next);onResetPosition?.(id);invalidate(["switches"]);onClose();
    }catch(e){setError(e instanceof Error?e.message:"Não foi possível remover");}finally{setBusy(false);}
  }
  if(action==="monitor")return <SwitchEditor models={switches.data?.models??["builtin"]} onClose={onClose} onSaved={s=>onPlaced(`switch:${s.id}`,context.point)}/>;
  if(action==="ports")return <DevicePortsEditor nodeId={context.nodeId!} name={context.name??"Equipamento"} defaultCount={context.portCount} defaultNames={context.portNames} onClose={onClose} externalError={error} onRemove={context.nodeId?.startsWith("infra:")?removeManual:undefined}/>;
  if(action)return <Dialog title={`Adicionar ${action==="switch"?"switch":action==="node"?"nó de rede":"dispositivo"}`} onClose={onClose}>
    <form onSubmit={save} class="space-y-4">
      <Field label="Nome"><input class="field" value={name} onInput={e=>setName(e.currentTarget.value)} required maxLength={120}/></Field>
      <Field label="Quantidade de portas físicas"><input class="field" type="number" min="0" max="128" value={count} onInput={e=>setCount(Number(e.currentTarget.value))} required/></Field>
      <Field label="Nomes das portas" hint="Separe por vírgula: eth0, eth1, LAN 1…"><input class="field" value={labels} onInput={e=>setLabels(e.currentTarget.value)}/></Field>
      <p class="text-xs text-muted">Equipamento cadastrado no mapa físico, sem coleta própria.{mode==="mesh"?" Aparece no modo Físico.":""}{context.nodeId?` Será ligado a ${context.name??"este equipamento"}.`:""} As portas também podem ser editadas na ficha do equipamento.</p>
      {error&&<p role="alert" class="text-bad">{error}</p>}
      <div class="flex justify-end gap-2"><Button onClick={onClose}>Cancelar</Button><Button type="submit" variant="primary" loading={busy} disabled={!topology.data}>Salvar</Button></div>
    </form>
  </Dialog>;
  const items=[...(context.nodeId?[...(onEditWiring?[{label:"Editar cabeamento…",run:()=>{onEditWiring(context.nodeId!);onClose();}}]:[]),{label:"Configurar portas…",run:()=>setAction("ports")},...(onResetPosition?[{label:"Restaurar posição deste nó",run:()=>{onResetPosition(context.nodeId!);onClose();}}]:[])]:[]),{label:"Adicionar nó de rede…",run:()=>begin("node")},{label:"Adicionar switch…",run:()=>begin("switch")},{label:"Adicionar dispositivo…",run:()=>begin("device")},{label:"Adicionar switch monitorado…",run:()=>setAction("monitor")}];
  return createPortal(<><button type="button" class="fixed inset-0 z-40 cursor-default" aria-label="Fechar menu do mapa" onClick={onClose}/><div ref={menu} role="menu" aria-label="Ações do mapa" class="fixed z-50 min-w-56 max-h-[calc(100vh-16px)] overflow-y-auto rounded-lg border border-line bg-surface p-1 shadow-pop" style={{left:Math.max(8,Math.min(context.x,window.innerWidth-260)),top:Math.max(8,Math.min(context.y,window.innerHeight-360))}} onKeyDown={e=>{const buttons=[...e.currentTarget.querySelectorAll("button")];const index=buttons.indexOf(document.activeElement as HTMLButtonElement);if(e.key==="ArrowDown"||e.key==="ArrowUp"){e.preventDefault();buttons[(index+(e.key==="ArrowDown"?1:buttons.length-1))%buttons.length]?.focus();}}}>
    {context.name&&<p class="max-w-64 truncate px-3 py-2 text-xs text-muted">{context.name}</p>}{items.map(item=><button type="button" role="menuitem" class="block w-full rounded px-3 py-2 text-left text-sm hover:bg-surface-2 focus:bg-surface-2" onClick={item.run}>{item.label}</button>)}
  </div></>,document.body);
}
