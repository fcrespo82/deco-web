import { ValidationError } from "../db/errors.js";
export type ManualNodeKind = "switch" | "node" | "device";
export interface InfrastructureNode { id:string; name:string; kind?:ManualNodeKind; portCount?:number }
export interface PhysicalLink { source:string; target:string; sourcePort:string; targetPort:string; kind:"wired"|"wireless" }
export interface PhysicalTopology { nodes:InfrastructureNode[]; links:PhysicalLink[]; portCounts?:Record<string,number>; portNames?:Record<string,string[]> }
export function parsePhysicalTopology(value: unknown, known: Set<string>): PhysicalTopology {
  if(!value || typeof value!=="object")throw new ValidationError("Cabeamento inválido");
  const input=value as Record<string,unknown>;
  if(!Array.isArray(input.nodes)||!Array.isArray(input.links)||input.nodes.length>64||input.links.length>256)throw new ValidationError("Limite de equipamentos ou ligações excedido");
  const nodes:InfrastructureNode[]=input.nodes.map((n:Record<string,unknown>)=>{
    if(!n||typeof n.id!=="string"||!/^infra:[\w-]{1,80}$/.test(n.id)||typeof n.name!=="string"||!n.name.trim()||n.name.length>120)throw new ValidationError("Switch intermediário inválido");
    if(known.has(n.id))throw new ValidationError("Identificador de equipamento repetido");
    if(n.kind!==undefined&&!["switch","node","device"].includes(String(n.kind)))throw new ValidationError("Tipo de equipamento inválido");
    if(n.portCount!==undefined&&(!Number.isInteger(n.portCount)||Number(n.portCount)<0||Number(n.portCount)>128))throw new ValidationError("Quantidade de portas deve estar entre 0 e 128");
    known.add(n.id);return {id:n.id,name:n.name.trim(),...(n.kind!==undefined?{kind:n.kind as ManualNodeKind}:{}),...(n.portCount!==undefined?{portCount:Number(n.portCount)}:{})};
  });
  const parents=new Map<string,string>();
  const incoming=new Map<string,PhysicalLink[]>();
  const occupied=new Set<string>();
  const links:PhysicalLink[]=input.links.map((l:Record<string,unknown>)=>{
    if(!l||typeof l.source!=="string"||typeof l.target!=="string"||!known.has(l.source)||!known.has(l.target)||l.source===l.target||l.target==="internet")throw new ValidationError("Ligação com equipamento inválido");
    const prior=incoming.get(l.target)??[];
    const multiInterface=l.target.startsWith("client:")||nodes.some(n=>n.id===l.target&&n.kind==="device");
    if(prior.length&&(!multiInterface||!l.targetPort||!l.sourcePort||prior.some(p=>!p.targetPort||!p.sourcePort)))throw new ValidationError("Cada equipamento deve ter um único uplink cadastrado; dispositivos com várias interfaces exigem portas distintas");
    if(l.kind!=="wired"&&l.kind!=="wireless")throw new ValidationError("Tipo de ligação inválido");
    parents.set(l.target,l.source);
    const port=(v:unknown)=>typeof v==="string"?v.trim().slice(0,40):"";
    const link:PhysicalLink={source:l.source,target:l.target,sourcePort:port(l.sourcePort),targetPort:port(l.targetPort),kind:l.kind};
    if(link.kind==="wired")for(const [node,name]of [[link.source,link.sourcePort],[link.target,link.targetPort]])if(name){const key=`${node}\0${name}`;if(occupied.has(key))throw new ValidationError(`A porta ${name} já está ligada a outro cabo`);occupied.add(key);}
    incoming.set(link.target,[...prior,link]);return link;
  });
  for(const id of parents.keys()){
    const seen=new Set<string>();let current:string|undefined=id;
    while(current){if(seen.has(current))throw new ValidationError("O cabeamento contém um ciclo");seen.add(current);current=parents.get(current);}
  }
  const portCounts:Record<string,number>={};
  if(input.portCounts!==undefined){
    if(!input.portCounts||typeof input.portCounts!=="object"||Array.isArray(input.portCounts)||Object.keys(input.portCounts).length>256)throw new ValidationError("Cadastro de portas inválido");
    for(const [id,count]of Object.entries(input.portCounts)){
      if(!known.has(id)||!Number.isInteger(count)||Number(count)<0||Number(count)>128)throw new ValidationError("Quantidade de portas inválida");
      portCounts[id]=Number(count);
    }
  }
  const portNames:Record<string,string[]>={};
  if(input.portNames!==undefined){
    if(!input.portNames||typeof input.portNames!=="object"||Array.isArray(input.portNames)||Object.keys(input.portNames).length>256)throw new ValidationError("Nomes de portas inválidos");
    for(const [id,names]of Object.entries(input.portNames)){
      if(!known.has(id)||!Array.isArray(names)||names.length>128||names.some(n=>typeof n!=="string"||!n.trim()||n.trim().length>32)||new Set(names.map(n=>n.trim())).size!==names.length)throw new ValidationError("Informe nomes de portas únicos, com até 32 caracteres");
      portNames[id]=names.map(n=>n.trim());
    }
  }
  return {nodes,links,...(input.portCounts!==undefined?{portCounts}:{}),...(input.portNames!==undefined?{portNames}:{})};
}
