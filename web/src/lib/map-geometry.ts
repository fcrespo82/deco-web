import {validMapPositions,type MapPoint,type MapPositions} from "../../../src/core/map-layout.js";
export type Point=MapPoint;
export type NodePositions=MapPositions;
export const validNodePositions=validMapPositions;
export interface Bounds {minX:number;maxX:number;minY:number;maxY:number}
export function snapPoint(point:Point,step:number):Point{return step>0?{x:Math.round(point.x/step)*step,y:Math.round(point.y/step)*step}:point;}
export function dragPoint(origin:Point,dx:number,dy:number,bounds?:Bounds):Point{
 const x=origin.x+dx,y=origin.y+dy;return bounds?{x:Math.max(bounds.minX,Math.min(bounds.maxX,x)),y:Math.max(bounds.minY,Math.min(bounds.maxY,y))}:{x,y};
}

export function descendantPositions(id:string,links:{source:string;target:string}[],positions:Map<string,Point>):NodePositions {
 const out:NodePositions={},seen=new Set([id]),queue=[id];
 for(let i=0;i<queue.length;i++)for(const link of links)if(link.source===queue[i]&&!seen.has(link.target)){seen.add(link.target);queue.push(link.target);const p=positions.get(link.target);if(p)out[link.target]={...p};}
 return out;
}

/** Saved centers override the generated layout; stale IDs do not create nodes. */
export function applySavedPositions(generated:Map<string,Point>,saved:NodePositions):Map<string,Point>{
 const positions=new Map(generated);
 for(const [id,point]of Object.entries(saved))if(positions.has(id))positions.set(id,{...point});
 return positions;
}
