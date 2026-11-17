import ELK from 'elkjs/lib/elk.bundled.js';
import {W,H,ports,portId,portOffset} from './geometry.js';
const elk=new ELK();
export async function organize(data,direction='DOWN'){
 const horizontal=direction==='RIGHT',out=horizontal?'right':'bottom',input=horizontal?'left':'top';
 const result=await elk.layout({id:'root',layoutOptions:{'elk.algorithm':'layered','elk.direction':direction,'elk.edgeRouting':'ORTHOGONAL','elk.spacing.nodeNode':'65','elk.layered.spacing.nodeNodeBetweenLayers':'105','elk.layered.spacing.edgeNodeBetweenLayers':'24','elk.spacing.edgeEdge':'16','elk.layered.mergeEdges':'false'},children:data.nodes.map(n=>({id:n.id,width:n.width??W,height:n.height??H,layoutOptions:{'elk.portConstraints':'FIXED_POS'},ports:ports(n).flatMap(p=>[input,out].map(side=>({id:portId(n.id,p,side),width:0,height:0,x:side==='left'?0:side==='right'?W:portOffset(n,p),y:side==='top'?0:side==='bottom'?H:12+(p==='wifi'||p==='unknown'?n.ports:Number(p)-1)*(H-24)/(n.ports+1),layoutOptions:{'elk.port.side':side.toUpperCase()}})))})),edges:data.links.map(l=>({id:l.id,sources:[portId(l.source,l.sp,out)],targets:[portId(l.target,l.tp,input)]}))});
 return {...result,input,out};
}
