import {useState} from "preact/hooks";
import {api} from "./api";
import {invalidate} from "./lib/query";
import type {PhysicalLink,PhysicalTopology} from "../../src/switches/topology";
import {Button,Dialog,Field} from "./ui";
export interface WiringNode {id:string;name:string;ports:string[]}
export function WiringEditor({config,nodes,focusId,onClose}:{config:PhysicalTopology;nodes:WiringNode[];focusId?:string;onClose:()=>void}){
 const [links,setLinks]=useState<PhysicalLink[]>(config.links.map(l=>({...l})));
 const [error,setError]=useState<string|null>(null),[busy,setBusy]=useState(false);
 const focus=nodes.find(n=>n.id===focusId);
 const rows=links.map((l,i)=>({l,i})).filter(({l})=>!focusId||l.source===focusId||l.target===focusId);
 const update=(index:number,patch:Partial<PhysicalLink>)=>setLinks(old=>old.map((l,i)=>i===index?{...l,...patch}:l));
 async function save(){setBusy(true);setError(null);try{if(links.some(l=>!l.source||!l.target))throw new Error("Escolha os dois equipamentos de cada cabo, ou remova a ligação incompleta.");await api.saveNetworkTopology({...config,links});invalidate(["switches"]);onClose();}catch(e){setError(e instanceof Error?e.message:"Não foi possível salvar");}finally{setBusy(false);}}
 const port=(l:PhysicalLink,i:number,side:"source"|"target")=>{
  const node=nodes.find(n=>n.id===l[side]),value=l[side==="source"?"sourcePort":"targetPort"],names=node?.ports??[];
  return <Field label={`Porta ${side==="source"?"A":"B"}`}><select class="field" value={value} onChange={e=>update(i,{[side==="source"?"sourcePort":"targetPort"]:e.currentTarget.value})}><option value="">Não informada</option>{value&&!names.includes(value)&&<option value={value}>{value} (cadastro anterior)</option>}{names.map(p=><option value={p}>{p}</option>)}</select></Field>;
 };
 return <Dialog title={focus?`Cabeamento · ${focus.name}`:"Cabeamento físico"} onClose={onClose}>
  <p class="mb-4 text-sm text-muted">Cada cabo aparece uma vez, com suas duas pontas. Salvar aqui atualiza a ligação vista nos dois equipamentos. A posição no desenho é automática; as portas precisam ser informadas quando a coleta não as identifica.</p>
  <div class="space-y-4">{rows.map(({l,i})=><fieldset class="rounded-lg border border-line p-3" key={i}><legend class="px-1 text-sm font-medium">Ligação {i+1}</legend>
   <div class="grid grid-cols-2 gap-3">{(["source","target"]as const).map((side,index)=><div class="space-y-2"><Field label={`Ponta ${index?"B":"A"} · equipamento`}><select class="field" value={l[side]} onChange={e=>update(i,{[side]:e.currentTarget.value,[side==="source"?"sourcePort":"targetPort"]:""})}><option value="">Escolher equipamento</option>{nodes.filter(n=>side!=="target"||n.id!=="internet").map(n=><option value={n.id}>{n.name}</option>)}</select></Field>{l.kind==="wired"&&port(l,i,side)}</div>)}</div>
   <div class="mt-3 flex items-end justify-between gap-3"><Field label="Conexão"><select class="field" value={l.kind} onChange={e=>update(i,{kind:e.currentTarget.value as PhysicalLink["kind"],sourcePort:"",targetPort:""})}><option value="wired">Cabo</option><option value="wireless">Wi-Fi</option></select></Field><Button size="sm" onClick={()=>setLinks(old=>old.filter((_,index)=>index!==i))}>Remover ligação</Button></div>
  </fieldset>)}</div>
  {!rows.length&&<p class="mb-3 text-sm text-muted">Nenhuma ligação cadastrada para este equipamento.</p>}
  <Button class="mt-4" onClick={()=>setLinks(old=>[...old,{source:"",target:focusId??"",sourcePort:"",targetPort:"",kind:"wired"}])}>Adicionar ligação</Button>
  {error&&<p role="alert" class="mt-3 text-bad">{error}</p>}
  <div class="mt-4 flex justify-end gap-2"><Button onClick={onClose}>Cancelar</Button><Button variant="primary" onClick={save} loading={busy}>Salvar cabeamento</Button></div>
 </Dialog>;
}
