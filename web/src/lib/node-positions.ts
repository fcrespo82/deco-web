import { useEffect,useMemo,useRef,useState } from "preact/hooks";
import { readStored } from "./preferences.js";
import { useQuery,setQueryData } from "./query.js";
import { api } from "../api.js";
import {type MapLayoutView} from "../../../src/core/map-layout.js";
import {snapPoint,dragPoint,validNodePositions,type Point,type NodePositions,type Bounds} from "./map-geometry.js";
export {snapPoint,dragPoint,validNodePositions} from "./map-geometry.js";
export type {Point,NodePositions,Bounds} from "./map-geometry.js";
/** Posições compartilhadas no SQLite. Escreve só no fim do gesto e por nó. */
export function useNodePositions(key:string,gridStep=0,readOnly=false){
 const map=key.includes("physical")?"physical":"mesh";
 const queryKey=`map-layout:${map}`;
 const query=useQuery(queryKey,()=>api.mapLayout(map),["layouts"]);
 const [legacy]=useState(()=>readStored<NodePositions>(key,{},validNodePositions));
 const [optimistic,setOptimistic]=useState<Record<string,{point:Point;token:number}>>({});
 const [resetting,setResetting]=useState(false);
 const [error,setError]=useState<string|null>(null);
 const [pending,setPending]=useState(0);
 const queue=useRef(Promise.resolve());const token=useRef(0);const migrated=useRef(false);
 const [draft,setDraft]=useState<{id:string;points:NodePositions}|null>(null);
 const gesture=useRef<{id:string;pointerId:number;origin:Point;start:Point;inverse:DOMMatrix;point:Point;moved:boolean;bounds?:Bounds;followers:NodePositions}|null>(null);
 const suppressed=useRef(false);
 const cache=(view:MapLayoutView)=>setQueryData<MapLayoutView>(queryKey,old=>old&&old.revision>view.revision?old:view);
 const enqueue=(work:()=>Promise<void>)=>{
  if(readOnly)return;
  setPending(n=>n+1);queue.current=queue.current.then(work).catch(()=>setError("Não foi possível salvar as posições no servidor. Confira a conexão e tente novamente.")).finally(()=>setPending(n=>n-1));
 };
 useEffect(()=>{
  if(readOnly||!query.data||query.data.initialized||migrated.current||!Object.keys(legacy).length)return;
  migrated.current=true;enqueue(async()=>{cache(await api.importMapLayout(map,legacy));setError(null);});
 },[query.data,readOnly]);
 const saved=query.data?.initialized?query.data.positions:legacy;
 const base=useMemo(()=>resetting?{}:{...saved,...Object.fromEntries(Object.entries(optimistic).map(([id,v])=>[id,v.point]))},[resetting,saved,optimistic]);
 const visible=useMemo(()=>draft?{...base,...draft.points}:base,[base,draft]);
 const moveMany=(positions:NodePositions)=>{
  if(readOnly)return;
  const current=++token.current;
  setOptimistic(old=>({...old,...Object.fromEntries(Object.entries(positions).map(([id,point])=>[id,{point,token:current}]))}));
  enqueue(async()=>{try{cache(await api.moveMapNodes(map,positions));setError(null);}finally{setOptimistic(old=>{const next={...old};for(const id of Object.keys(positions))if(next[id]?.token===current)delete next[id];return next;});}});
 };
 const move=(id:string,p:Point)=>moveMany({[id]:p});
 const point=(inverse:DOMMatrix,e:PointerEvent)=>new DOMPoint(e.clientX,e.clientY).matrixTransform(inverse);
 const finish=(e:PointerEvent,cancel=false)=>{
  const g=gesture.current;if(!g||g.pointerId!==e.pointerId)return;e.stopPropagation();gesture.current=null;
  if(g.moved&&!cancel)moveMany({[g.id]:g.point,...Object.fromEntries(Object.entries(g.followers).map(([id,p])=>[id,{x:p.x+g.point.x-g.origin.x,y:p.y+g.point.y-g.origin.y}]))});setDraft(null);
  const element=e.currentTarget as SVGGraphicsElement;if(element.hasPointerCapture(e.pointerId))element.releasePointerCapture(e.pointerId);
 };
 return {
  savedPositions:base,dragging:draft?.id??null,positions:visible,
  ready:!!query.data,saving:pending>0,saveError:error??(query.error?"Não foi possível carregar as posições salvas.":null),
  place:(id:string,p:Point)=>move(id,snapPoint(p,gridStep)),
  placeMany:(points:NodePositions)=>moveMany(Object.fromEntries(Object.entries(points).map(([id,p])=>[id,snapPoint(p,gridStep)]))),
  resetNode:(id:string)=>enqueue(async()=>{cache(await api.resetMapNode(map,id));setError(null);}),
  reset:()=>{if(readOnly)return;gesture.current=null;setDraft(null);setOptimistic({});setResetting(true);enqueue(async()=>{try{cache(await api.resetMapLayout(map));setError(null);}finally{setResetting(false);}});},
  allowClick:()=>{const allowed=!suppressed.current;suppressed.current=false;return allowed;},
  bind:(id:string,origin:Point,bounds?:Bounds,followers:NodePositions={})=>({
   onPointerDown:(e:PointerEvent)=>{
    if(readOnly||e.button!==0)return;const element=e.currentTarget as SVGGraphicsElement,matrix=element.getScreenCTM();if(!matrix)return;
    e.stopPropagation();suppressed.current=false;const inverse=matrix.inverse();
    gesture.current={id,pointerId:e.pointerId,origin,start:point(inverse,e),inverse,point:origin,moved:false,bounds,followers};element.setPointerCapture(e.pointerId);
   },
   onPointerMove:(e:PointerEvent)=>{
    const g=gesture.current;if(!g||g.pointerId!==e.pointerId)return;e.stopPropagation();const current=point(g.inverse,e),dx=current.x-g.start.x,dy=current.y-g.start.y;
    if(Math.abs(dx)+Math.abs(dy)<4&&!g.moved)return;g.moved=true;suppressed.current=true;g.point=dragPoint(snapPoint(dragPoint(g.origin,dx,dy),gridStep),0,0,g.bounds);setDraft({id:g.id,points:{[g.id]:g.point,...Object.fromEntries(Object.entries(g.followers).map(([id,p])=>[id,{x:p.x+g.point.x-g.origin.x,y:p.y+g.point.y-g.origin.y}]))}});
   },
   onPointerUp:(e:PointerEvent)=>finish(e),onPointerCancel:(e:PointerEvent)=>finish(e,true),onLostPointerCapture:(e:PointerEvent)=>finish(e,true),
  }),
 };
}
