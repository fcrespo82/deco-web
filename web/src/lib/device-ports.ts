import type {PhysicalTopology} from "../../../src/switches/topology.js";
export function configureDevicePorts(topology:PhysicalTopology,id:string,names:string[],previous:string[],name?:string):PhysicalTopology {
 if(names.length>128||names.some(n=>!n.trim()||n.length>32)||new Set(names).size!==names.length)throw new Error("Use até 128 nomes de porta únicos e não vazios.");
 const rename=(port:string)=>{if(!port)return "";const index=previous.indexOf(port);return index>=0?names[index]??"":names.includes(port)?port:"";};
 return {...topology,nodes:topology.nodes.map(n=>n.id===id?{...n,portCount:names.length,...(name?.trim()?{name:name.trim()}:{})}:n),portCounts:{...topology.portCounts,[id]:names.length},portNames:{...topology.portNames,[id]:names},links:topology.links.map(l=>({...l,...(l.source===id?{sourcePort:rename(l.sourcePort)}:{}),...(l.target===id?{targetPort:rename(l.targetPort)}:{})}))};
}
