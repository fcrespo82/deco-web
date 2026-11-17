import type {Point} from "./map-geometry.js";
export interface CableObstacle {id:string;x:number;y:number;width:number;height:number}
export interface CableAnchor extends Point {nodeId:string;side:"top"|"bottom"}
export type CableStyle = "smooth" | "rounded" | "adaptive";
interface RoutingOptions {padding?:number}
export function roundedCablePath(points:Point[],radius=10):string {
 let d=`M ${points[0]!.x} ${points[0]!.y}`;
 for(let i=1;i<points.length-1;i++){const a=points[i-1]!,b=points[i]!,c=points[i+1]!,u=Math.hypot(b.x-a.x,b.y-a.y),v=Math.hypot(c.x-b.x,c.y-b.y),r=Math.min(radius,u/2,v/2);if(!u||!v)continue;const x=b.x+(a.x-b.x)*r/u,y=b.y+(a.y-b.y)*r/u,xx=b.x+(c.x-b.x)*r/v,yy=b.y+(c.y-b.y)*r/v;d+=` L ${x} ${y} Q ${b.x} ${b.y} ${xx} ${yy}`;}
 const last=points.at(-1)!;return d+` L ${last.x} ${last.y}`;
}
interface State {x:number;y:number;dir:number;cost:number;score:number;key:string}
function intersects(a:Point,b:Point,r:CableObstacle):boolean {
 const eps=0.01;
 return a.x===b.x?a.x>r.x+eps&&a.x<r.x+r.width-eps&&Math.max(a.y,b.y)>r.y+eps&&Math.min(a.y,b.y)<r.y+r.height-eps:
 a.y>r.y+eps&&a.y<r.y+r.height-eps&&Math.max(a.x,b.x)>r.x+eps&&Math.min(a.x,b.x)<r.x+r.width-eps;
}
export function cableSegmentClear(a:Point,b:Point,rects:CableObstacle[]):boolean{return !rects.some(r=>intersects(a,b,r));}
function simplify(points:Point[]):Point[]{
 const out:Point[]=[];
 for(const p of points){if(out.at(-1)?.x===p.x&&out.at(-1)?.y===p.y)continue;while(out.length>1){const a=out[out.length-2]!,b=out[out.length-1]!;if((a.x===b.x&&b.x===p.x)||(a.y===b.y&&b.y===p.y))out.pop();else break;}out.push(p);}
 return out;
}
/** Rota ortogonal sobre corredores de visibilidade; preserva os extremos nas portas. */
export function routeCable(a:CableAnchor,b:CableAnchor,obstacles:CableObstacle[],lane=0,options:RoutingOptions={}){
 const padding=options.padding??(12+Math.max(0,lane)*4);
 const inflated=obstacles.map(r=>({...r,x:r.x-padding,y:r.y-padding,width:r.width+padding*2,height:r.height+padding*2}));
 const escape=(p:CableAnchor):Point=>{const r=inflated.find(r=>r.id===p.nodeId);return {x:p.x,y:r?(p.side==="bottom"?r.y+r.height+2:r.y-2):p.y+(p.side==="bottom"?16:-16)};};
 const start=escape(a),end=escape(b);
 const xs=[...new Set([start.x,end.x,...inflated.flatMap(r=>[r.x,r.x+r.width])])].sort((a,b)=>a-b);
 const ys=[...new Set([start.y,end.y,...inflated.flatMap(r=>[r.y,r.y+r.height])])].sort((a,b)=>a-b);
 const heap:State[]=[];
 const push=(v:State)=>{heap.push(v);let i=heap.length-1;while(i){const p=(i-1)>>1;if(heap[p]!.score<=v.score)break;heap[i]=heap[p]!;i=p;}heap[i]=v;};
 const pop=()=>{const first=heap[0]!,last=heap.pop()!;if(heap.length){let i=0;while(true){let c=i*2+1;if(c>=heap.length)break;if(c+1<heap.length&&heap[c+1]!.score<heap[c]!.score)c++;if(heap[c]!.score>=last.score)break;heap[i]=heap[c]!;i=c;}heap[i]=last;}return first;};
 const key=(x:number,y:number,d:number)=>`${x}:${y}:${d}`;
 const sx=xs.indexOf(start.x),sy=ys.indexOf(start.y),tx=xs.indexOf(end.x),ty=ys.indexOf(end.y);
 const initial=key(sx,sy,0),best=new Map<string,number>([[initial,0]]),previous=new Map<string,string>();
 push({x:sx,y:sy,dir:0,cost:0,score:0,key:initial});let found:string|null=null;
 while(heap.length){
  const current=pop();if(current.cost!==best.get(current.key))continue;
  if(current.x===tx&&current.y===ty){found=current.key;break;}
  const origin={x:xs[current.x]!,y:ys[current.y]!};
  for(const [dx,dy,dir]of [[-1,0,1],[1,0,1],[0,-1,2],[0,1,2]]){
   const x=current.x+dx!,y=current.y+dy!;if(x<0||x>=xs.length||y<0||y>=ys.length)continue;
   const point={x:xs[x]!,y:ys[y]!};if(!cableSegmentClear(origin,point,inflated))continue;
   const cost=current.cost+Math.abs(point.x-origin.x)+Math.abs(point.y-origin.y)+(current.dir&&current.dir!==dir?18:0);
   const id=key(x,y,dir!);if(cost>=(best.get(id)??Infinity))continue;
   best.set(id,cost);previous.set(id,current.key);push({x,y,dir:dir!,cost,score:cost+Math.abs(point.x-end.x)+Math.abs(point.y-end.y),key:id});
  }
 }
 let points:Point[];
 if(found){const middle:Point[]=[];let cursor:string|undefined=found;while(cursor){const [x,y]=cursor.split(":").map(Number);middle.push({x:xs[x!]!,y:ys[y!]!});cursor=previous.get(cursor);}points=simplify([a,...middle.reverse(),b]);}
 else {const side=Math.max(...xs)+24;points=simplify([a,start,{x:side,y:start.y},{x:side,y:end.y},end,b]);}
 let label={x:(a.x+b.x)/2,y:(a.y+b.y)/2},length=0;
 for(let i=1;i<points.length;i++){const p=points[i-1]!,q=points[i]!;const distance=Math.abs(p.x-q.x)+Math.abs(p.y-q.y);if(distance>length){length=distance;label={x:(p.x+q.x)/2,y:(p.y+q.y)/2};}}
 return {points,d:points.map((p,i)=>`${i?"L":"M"} ${p.x} ${p.y}`).join(" "),label,blocked:!found};
}

/** Fixed-cost geometry per cable: no global search or comparison with other cables. */
export function routeCables(cables:{a:CableAnchor;b:CableAnchor}[],obstacles:CableObstacle[],style:CableStyle="rounded"){
 const boxes=new Map(obstacles.map(r=>[r.id,r]));
 const escape=(p:CableAnchor):Point=>{const box=boxes.get(p.nodeId);return {x:p.x,y:box?(p.side==="bottom"?box.y+box.height+18:box.y-18):p.y+(p.side==="bottom"?24:-24)};};
 const lanes=new Map<string,number>();
 const degree=new Map<string,number>();
 for(const {a,b} of cables)for(const id of [a.nodeId,b.nodeId])degree.set(id,(degree.get(id)??0)+1);
 return cables.map(({a,b})=>{
  if(style==="adaptive"){
   const lane=Math.max(lanes.get(a.nodeId)??0,lanes.get(b.nodeId)??0);
   lanes.set(a.nodeId,lane+1);lanes.set(b.nodeId,lane+1);
   // Keep escape points inside narrow gaps instead of inflating them shut.
   let clearance=Infinity;
   for(const anchor of [a,b]){
    const own=boxes.get(anchor.nodeId);if(!own)continue;
    const edge=anchor.side==="top"?own.y:own.y+own.height;
    for(const box of obstacles){
     if(box.id===own.id||box.x>=own.x+own.width||box.x+box.width<=own.x)continue;
     const gap=anchor.side==="top"?edge-(box.y+box.height):box.y-edge;
     if(gap>0)clearance=Math.min(clearance,gap);
    }
   }
   const available=Math.max(0,(clearance-4)/3);
   const count=Math.max(degree.get(a.nodeId)??1,degree.get(b.nodeId)??1);
   // Distribute lanes within the available gap; clamping every lane to the
   // same maximum would merge neighboring cables into a false junction.
   const padding=Math.min(12+lane*4,available*(lane+1)/(count+1));
   const route=routeCable(a,b,obstacles,lane,{padding});
   return {...route,d:roundedCablePath(route.points,6),constrained:route.blocked};
  }
  const start=escape(a),end=escape(b),source=boxes.get(a.nodeId),target=boxes.get(b.nodeId);
  const corridor=Math.abs(a.x-b.x)>200?(a.x+b.x)/2:Math.max(source?source.x+source.width:a.x,target?target.x+target.width:b.x)+24;
  const points=simplify([a,start,{x:corridor,y:start.y},{x:corridor,y:end.y},end,b]);
  let d=roundedCablePath(points,8);
  if(style==="smooth"){const reach=Math.max(40,Math.abs(a.y-b.y)*0.6);d=`M ${a.x} ${a.y} C ${a.x} ${a.y+(a.side==="bottom"?reach:-reach)} ${b.x} ${b.y+(b.side==="bottom"?reach:-reach)} ${b.x} ${b.y}`;}
  const middle=points[Math.floor((points.length-1)/2)]!,next=points[Math.min(points.length-1,Math.floor((points.length-1)/2)+1)]!;
  return {points,d,label:{x:(middle.x+next.x)/2,y:(middle.y+next.y)/2},blocked:false,constrained:false};
 });
}
