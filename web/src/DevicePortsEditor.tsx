import {useState} from "preact/hooks";
import {api} from "./api";
import {invalidate,useQuery} from "./lib/query";
import {configureDevicePorts} from "./lib/device-ports";
import {modelPortCount} from "./lib/port-points";
import {useOverview,useSwitches} from "./data";
import {Button,Dialog,Field,PageLoading} from "./ui";
export function DevicePortsEditor({nodeId,name,defaultCount,defaultNames,onClose,onRemove,externalError}:{nodeId:string;name:string;defaultCount?:number|null;defaultNames?:string[];onClose:()=>void;onRemove?:()=>void;externalError?:string|null}){
 const topology=useQuery("physical-topology",api.networkTopology,["switches"]),overview=useOverview(),switches=useSwitches();
 const [draft,setDraft]=useState<{count:number;labels:string;name:string}|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
 const manual=topology.data?.nodes.find(n=>n.id===nodeId),monitored=switches.data?.switches.find(s=>`switch:${s.id}`===nodeId),mesh=overview.data?.nodes.find(n=>`mesh:${n.mac}`===nodeId);
 const known=topology.data?.portNames?.[nodeId]??defaultNames??monitored?.snapshot?.ports.map(p=>p.port);
 const count=topology.data?.portCounts?.[nodeId]??manual?.portCount??known?.length??defaultCount??monitored?.portCount??(mesh?modelPortCount(mesh.model):null)??0;
 const previous=known??Array.from({length:count},(_,i)=>String(i+1));
 const form=draft??{count,labels:previous.join(", "),name:manual?.name??name};
 const change=(patch:Partial<typeof form>)=>setDraft({...form,...patch});
 async function save(e:Event){e.preventDefault();if(!topology.data)return;setBusy(true);setError(null);try{
  if(!Number.isInteger(form.count)||form.count<0||form.count>128)throw new Error("Informe de 0 a 128 portas.");
  const names=form.labels.trim()?form.labels.split(/[,;\n]/).map(n=>n.trim()).filter(Boolean):Array.from({length:form.count},(_,i)=>String(i+1));
  if(names.length!==form.count)throw new Error("Informe um nome por porta ou deixe os nomes vazios para usar números.");
  await api.saveNetworkTopology(configureDevicePorts(topology.data,nodeId,names,previous,manual?form.name:undefined));invalidate(["switches"]);onClose();
 }catch(e){setError(e instanceof Error?e.message:"Não foi possível salvar as portas");}finally{setBusy(false)}}
 return <Dialog title={`Portas · ${name}`} onClose={onClose}>{!topology.data?<PageLoading error={topology.error}/>:<form onSubmit={save} class="space-y-4">
 {manual&&<Field label="Nome do equipamento"><input class="field" value={form.name} onInput={e=>change({name:e.currentTarget.value})} required maxLength={120}/></Field>}
 <Field label="Quantidade de portas físicas" hint="Use 0 para equipamento exclusivamente sem fio."><input class="field" type="number" min="0" max="128" required value={form.count} onInput={e=>change({count:Number(e.currentTarget.value)})}/></Field>
 <Field label="Nomes das portas" hint="Separe por vírgula: eth0, eth1, LAN 1. Deixe vazio para numerar automaticamente."><input class="field" value={form.labels} onInput={e=>change({labels:e.currentTarget.value})}/></Field>
 <p class="text-xs text-muted">Estas portas pertencem ao equipamento e são usadas no mapa e no cabeamento. Renomear mantém as ligações; portas removidas ficam sem identificação no cabo.</p>
 {(error||externalError)&&<p role="alert" class="text-bad">{error||externalError}</p>}
 <div class="flex flex-wrap justify-end gap-2">{onRemove&&<Button onClick={onRemove} variant="danger" disabled={busy}>Remover equipamento…</Button>}<Button onClick={onClose}>Voltar</Button><Button type="submit" variant="primary" loading={busy}>Salvar portas</Button></div>
 </form>}</Dialog>;
}
