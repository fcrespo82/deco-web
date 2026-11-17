import {useEffect,useRef,useState} from "preact/hooks";
import type {Point} from "./map-geometry.js";
export interface MapView {x:number;y:number;k:number}
export function zoomMap(view:MapView,anchor:Point,factor:number):MapView {
 const k=Math.max(0.25,Math.min(5,view.k*factor)),ratio=k/view.k;
 return {k,x:anchor.x-(anchor.x-view.x)*ratio,y:anchor.y-(anchor.y-view.y)*ratio};
}
export function useMapViewport(disabled=false){
 const svg=useRef<SVGSVGElement>(null),space=useRef(false),gesture=useRef<{point:Point;view:MapView;id:number}|null>(null),moved=useRef(false);
 const fitted=useRef<{x:number;y:number;width:number;height:number}|null>(null);
 const [view,setView]=useState<MapView>({x:0,y:0,k:1});const current=useRef(view);current.current=view;
 const [panning,setPanning]=useState(false);
 const rootPoint=(x:number,y:number)=>{const m=svg.current?.getScreenCTM();return m?new DOMPoint(x,y).matrixTransform(m.inverse()):{x,y};};
 useEffect(()=>{
  if(disabled)return;const element=svg.current;if(!element)return;
  const wheel=(e:WheelEvent)=>{e.preventDefault();e.stopPropagation();const p=rootPoint(e.clientX,e.clientY);setView(v=>zoomMap(v,p,Math.exp(-e.deltaY*0.0015)));};
  const down=(e:KeyboardEvent)=>{if(e.code==="Space"&&!/INPUT|SELECT|TEXTAREA/.test((e.target as Element)?.tagName??"")){space.current=true;if(element.contains(document.activeElement))e.preventDefault();}};
  const up=(e:KeyboardEvent)=>{if(e.code==="Space")space.current=false;};
  element.addEventListener("wheel",wheel,{passive:false});window.addEventListener("keydown",down);window.addEventListener("keyup",up);
  return()=>{element.removeEventListener("wheel",wheel);window.removeEventListener("keydown",down);window.removeEventListener("keyup",up);};
 });
 const finish=(e:PointerEvent)=>{if(gesture.current?.id!==e.pointerId)return;e.stopPropagation();gesture.current=null;setPanning(false);if(svg.current?.hasPointerCapture(e.pointerId))svg.current.releasePointerCapture(e.pointerId);};
 return {svg,view,panning,transform:`translate(${view.x} ${view.y}) scale(${view.k})`,
  frame:(bounds:{x:number;y:number;width:number;height:number},ready=true)=>{if(disabled||!ready)return bounds;return fitted.current??(fitted.current=bounds);},
  focus:(point:Point)=>{const box=svg.current?.getAttribute("viewBox")?.split(/\s+/).map(Number);if(!box)return;setView(v=>({...v,x:box[0]!+box[2]!/2-point.x*v.k,y:box[1]!+box[3]!/2-point.y*v.k}));},
  reset:()=>{fitted.current=null;setView({x:0,y:0,k:1});},zoom:(factor:number)=>{const box=svg.current?.getAttribute("viewBox")?.split(/\s+/).map(Number);setView(v=>zoomMap(v,box?{x:box[0]!+box[2]!/2,y:box[1]!+box[3]!/2}:{x:0,y:0},factor));},
  allowClick:()=>{const result=!moved.current;moved.current=false;return result;},
  events:{onPointerDownCapture:(e:PointerEvent)=>{
   if(disabled)return;const target=e.target as Element;
   if(e.button!==1&&!(e.button===0&&(space.current||!target.closest("[data-map-node]"))))return;
   e.preventDefault();e.stopPropagation();moved.current=false;gesture.current={point:rootPoint(e.clientX,e.clientY),view:current.current,id:e.pointerId};svg.current?.setPointerCapture(e.pointerId);svg.current?.focus({preventScroll:true});setPanning(true);
  },onPointerMove:(e:PointerEvent)=>{const g=gesture.current;if(!g||g.id!==e.pointerId)return;e.stopPropagation();const p=rootPoint(e.clientX,e.clientY),dx=p.x-g.point.x,dy=p.y-g.point.y;if(Math.abs(dx)+Math.abs(dy)>3)moved.current=true;setView({...g.view,x:g.view.x+dx,y:g.view.y+dy});},onPointerUp:finish,onPointerCancel:finish,onLostPointerCapture:finish},
 };
}
