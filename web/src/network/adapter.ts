import type {PhysicalLink,PhysicalTopology} from '../../../src/switches/topology';
export interface NetworkNode {id:string;name:string;kind:string;sub:string;online:boolean|null;mac?:string;portCount?:number|null;portNames?:string[];portStates?:Record<string,string>;model?:string;manualKind?:string;deviceType?:string}
export interface NetworkLink {source:string;target:string;label:string;sourceType:'manual'|'mesh'|'association'|'fdb';kind:'wired'|'wireless';sourcePort?:string;targetPort?:string}
export function portNames(n:NetworkNode){return n.portNames?.slice(0,n.portCount??128)??Array.from({length:n.portCount??0},(_,i)=>String(i+1));}
export function internalPort(n:NetworkNode,p:string|undefined){const i=p?portNames(n).indexOf(p):-1;return i<0?'unknown':String(i+1);}
export function externalPort(n:NetworkNode,p:string){return portNames(n)[Number(p)-1]??'';}
export function graphLinks(nodes:NetworkNode[],links:NetworkLink[]){const byId=new Map(nodes.map(n=>[n.id,n]));return links.filter(l=>byId.has(l.source)&&byId.has(l.target)).map((l,i)=>({...l,id:`link:${i}`,sp:l.kind==='wireless'?'wifi':internalPort(byId.get(l.source)!,l.sourcePort),tp:l.kind==='wireless'?'wifi':internalPort(byId.get(l.target)!,l.targetPort),wifi:l.kind==='wireless'}));}
/** Never replace an existing uplink or an occupied physical port implicitly. */
export function addPhysicalLink(config:PhysicalTopology,link:PhysicalLink):PhysicalTopology {
 const isDevice=(id:string)=>id.startsWith('client:')||config.nodes.some(n=>n.id===id&&n.kind==='device');
 const incoming=(id:string)=>config.links.some(l=>l.target===id);
 // Drag direction is a gesture, not the logical uplink direction.
 if(link.target==='internet'||(link.source!=='internet'&&((isDevice(link.source)&&!isDevice(link.target))||(incoming(link.target)&&!incoming(link.source)&&!isDevice(link.target)))))link={...link,source:link.target,target:link.source,sourcePort:link.targetPort,targetPort:link.sourcePort};
 if(link.source===link.target)throw Error('Escolha equipamentos diferentes.');
 if(config.links.some(l=>l.source===link.source&&l.target===link.target&&l.kind===link.kind&&l.sourcePort===link.sourcePort&&l.targetPort===link.targetPort))throw Error('Esta ligação já está cadastrada.');
 if(link.kind==='wired')for(const [id,p]of [[link.source,link.sourcePort],[link.target,link.targetPort]])if(!p||config.links.some(l=>l.kind==='wired'&&((l.source===id&&l.sourcePort===p)||(l.target===id&&l.targetPort===p))))throw Error(p?`A porta ${p} já está ocupada. Remova a ligação existente antes de reconectar.`:'Configure a porta física antes de cabear.');
 return {...config,links:[...config.links,link]};
}
export function removePhysicalLink(config:PhysicalTopology,link:NetworkLink):PhysicalTopology {return {...config,links:config.links.filter(l=>!(l.source===link.source&&l.target===link.target&&l.kind===link.kind&&l.sourcePort===(link.sourcePort??'')&&l.targetPort===(link.targetPort??'')))};}
