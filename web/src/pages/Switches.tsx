import {DevicePortsEditor} from "../DevicePortsEditor";
import { SwitchEditor } from "../SwitchEditor";
import { useState } from "preact/hooks";
import type { SwitchView, PortSample } from "../../../src/switches/types";
import { api } from "../api";
import { useClients, useOverview, useSwitches } from "../data";
import { useQuery, invalidate } from "../lib/query";
import { Mac } from "../Mac";
import { ago, dateTime, rate } from "../format";
import { openClient } from "../lib/ui-state";
import { Badge, Button, Card, Dialog, Field, Kv, PageLoading, SectionTitle, TableCard } from "../ui";

const flag = (v:unknown) => v && typeof v === "object" && "enabled" in v ? (v.enabled ? "Ativado" : "Desativado") : "Indisponível";
const message = (error:unknown) => error instanceof Error ? error.message : "Não foi possível concluir a operação";

function Traffic({samples,field,label}:{samples:PortSample[];field:"txBps"|"rxBps";label:string}) {
  const values=samples.map(s=>s[field]);
  const max=Math.max(1,...values.filter((v):v is number=>v!==null));
  const start=samples[0]?Date.parse(samples[0].at):0,end=samples.at(-1)?Date.parse(samples.at(-1)!.at):1;
  const segments:string[]=[];let current:string[]=[];
  samples.forEach((s,i)=>{
    const value=s[field];
    if(value===null || (i>0 && Date.parse(s.at)-Date.parse(samples[i-1]!.at)>300_000)) {if(current.length)segments.push(current.join(" "));current=[];}
    if(value!==null)current.push(`${10+(Date.parse(s.at)-start)/Math.max(1,end-start)*580},${105-value/max*90}`);
  });if(current.length)segments.push(current.join(" "));
  return <div><div class="flex justify-between text-xs text-muted"><span>{label}</span><span>máx. {rate(max/1000)}</span></div>
    <svg viewBox="0 0 600 120" class="my-2 w-full text-accent" role="img" aria-label={label}><line x1="10" y1="105" x2="590" y2="105" stroke="currentColor" opacity="0.15"/>{segments.map(points=><polyline points={points} fill="none" stroke="currentColor" stroke-width="2"/>)}{samples.filter(s=>s[field]!==null).map(s=><circle cx={10+(Date.parse(s.at)-start)/Math.max(1,end-start)*580} cy={105-s[field]!/max*90} r="2.5" fill="currentColor"/>)}</svg>
  </div>;
}
function PortHistory({device,port,onClose}:{device:SwitchView;port:string;onClose:()=>void}) {
  const [hours,setHours]=useState(24);
  const query=useQuery(`switch-history:${device.id}:${port}:${hours}`,()=>api.switchHistory(device.id,port,hours),["switches"]);
  return <Dialog title={`${device.name} · porta ${port}`} onClose={onClose}>
    <Field label="Período"><select class="field" value={hours} onChange={e=>setHours(Number(e.currentTarget.value))}><option value="1">Última hora</option><option value="24">24 horas</option><option value="168">7 dias</option></select></Field>
    {query.error&&<p role="alert" class="text-bad">{message(query.error)}</p>}
    {query.data&&<><p class="my-3 text-xs text-muted">{query.data.samples.length} amostras mais recentes do período (máximo 2.000). RX: recebido pelo switch; TX: enviado pelo switch. Reinícios dos contadores interrompem a série.</p>
      <Traffic samples={query.data.samples} field="rxBps" label="Recebido (RX)"/><Traffic samples={query.data.samples} field="txBps" label="Enviado (TX)"/>
      {!query.data.samples.length&&<p class="text-muted">O histórico começa com a primeira coleta. A taxa requer duas leituras.</p>}
      {query.data.samples.some(s=>s.estimated)&&<Badge tone="warn">Contadores estimados a partir de pacotes</Badge>}
      <details class="mt-3"><summary class="cursor-pointer text-sm">Ver amostras recentes</summary><table class="rtable"><thead><tr><th>Quando</th><th>RX</th><th>TX</th></tr></thead><tbody>{query.data.samples.slice(-100).reverse().map(s=><tr key={s.at}><td>{dateTime(s.at)}</td><td>{s.rxBps===null?"—":rate(s.rxBps/1000)}</td><td>{s.txBps===null?"—":rate(s.txBps/1000)}</td></tr>)}</tbody></table></details>
    </>}
  </Dialog>;
}
export function Switches() {
  const query=useSwitches();
  const clients=useClients().data?.clients??[];
  const nodes=useOverview().data?.nodes??[];
  const [selected,setSelected]=useState<string|null>(null);
  const [editing,setEditing]=useState<SwitchView|"new"|null>(null);
  const [history,setHistory]=useState<string|null>(null);
  const [portsEditing,setPortsEditing]=useState(false);
  const [sfp,setSfp]=useState<Record<string,unknown>|null>(null);
  const [error,setError]=useState<string|null>(null);
  const [busy,setBusy]=useState(false);
  if(!query.data)return <PageLoading error={query.error}/>;
  const {switches,models}=query.data;
  const device=switches.find(s=>s.id===selected)??switches[0];
  const snapshot=device?.snapshot;
  async function action(run:()=>Promise<unknown>){setBusy(true);setError(null);try{await run();invalidate(["switches"]);}catch(e){setError(message(e));}finally{setBusy(false);}}
  return <>
    <SectionTitle actions={<Button onClick={()=>setEditing("new")}>Adicionar switch</Button>}>Switches</SectionTitle>
    <p class="mb-4 text-sm text-muted">Coleta direta nos equipamentos. O monitoramento de switches e o do Deco têm intervalos independentes.</p>
    {error&&<p role="alert" class="mb-3 text-bad">{error}</p>}
    <div class="mb-5 flex flex-wrap gap-2">{switches.map(s=><Button aria-pressed={device?.id===s.id} onClick={()=>{setSelected(s.id);setHistory(null);setError(null);}}>{s.name} · {s.polling?"lendo…":!s.enabled?"pausado":s.stale?"sem leitura atual":"online"}</Button>)}</div>
    {!device&&<Card>Adicione um switch para monitorar portas, tabela MAC e diagnósticos SFP.</Card>}
    {device&&<>
      <SectionTitle actions={<div class="flex flex-wrap gap-2"><Button onClick={()=>setEditing(device)} disabled={device.polling}>Configurar</Button><Button disabled={busy||device.polling||!device.enabled} onClick={()=>action(()=>api.refreshSwitch(device.id))}>{device.polling?"Lendo…":"Atualizar"}</Button><Button disabled={busy||device.polling||!device.enabled} onClick={()=>action(async()=>{const result=await api.switchTransceiver(device.id);setSfp(result.data);})}>Diagnóstico SFP</Button></div>}>{device.name}</SectionTitle>
      <Card><Kv items={[
        ["Endereço",device.host],["Modelo",snapshot?.model||device.model],["MAC",<Mac value={snapshot?.mac}/>],
        ["Firmware",snapshot?.firmware||"—"],["Tempo ligado informado",snapshot?.uptime||"—"],
        ["Última leitura",snapshot?`${dateTime(snapshot.at)} · ${ago(snapshot.at)}`:"Aguardando primeira coleta"],
        ["Coleta",`${device.intervalSeconds} s · ${device.enabled?"ativa":"pausada"}`],
        ["Uplink físico cadastrado",device.uplink||"Não cadastrado"],
      ]}/>{device.lastError&&<p role="alert" class="mt-3 text-sm text-bad">{device.lastError}</p>}{device.stale&&snapshot&&<p class="mt-2 text-xs text-warn">Os dados abaixo são da última leitura salva e podem estar desatualizados.</p>}</Card>
      <SectionTitle actions={<Button onClick={()=>setPortsEditing(true)}>Editar portas físicas…</Button>}>Portas</SectionTitle>
      <p class="mb-2 text-xs text-muted">RX e TX são vistos pelo switch. Totais observados desde o início do monitoramento, sem somar períodos sem leitura.</p>
      <TableCard><table class="rtable"><thead><tr><th>Porta</th><th>Link</th><th>Velocidade</th><th>RX / TX</th><th>Volume RX / TX</th><th>Anotação</th><th/></tr></thead><tbody>{snapshot?.ports.map(p=><tr key={p.port}><td>{p.port}</td><td>{p.status}</td><td>{p.speed||"—"}{p.duplex&&` · ${p.duplex}`}</td><td class="whitespace-nowrap">{p.rxBps===null?"—":rate(p.rxBps/1000)} / {p.txBps===null?"—":rate(p.txBps/1000)}{p.estimated&&<Badge tone="warn">estimado</Badge>}{!p.countersValid&&<Badge tone="warn">contadores indisponíveis</Badge>}</td><td>{(p.totalRx/1e6).toFixed(1)} / {(p.totalTx/1e6).toFixed(1)} MB</td><td>{device.portNotes[p.port]||"—"}</td><td><Button size="sm" onClick={()=>setHistory(p.port)}>Histórico</Button></td></tr>)}</tbody></table>{!snapshot&&<p class="p-4 text-sm text-muted">Aguardando dados do equipamento.</p>}</TableCard>
      <SectionTitle>Tabela MAC</SectionTitle>
      <p class="mb-2 text-xs text-muted">Indica por qual porta cada MAC é alcançável; pode haver switches intermediários. A associação Wi-Fi continua sendo informada pelo Deco.</p>
      {snapshot?.macError&&<p class="mb-3 text-warn">{snapshot.macError}</p>}
      <TableCard><table class="rtable"><thead><tr><th>MAC</th><th>Aparelho</th><th>Porta</th><th>VLAN</th><th>Tipo</th></tr></thead><tbody>{snapshot?.macs.map((m,i)=>{const client=clients.find(c=>c.mac===m.mac),node=nodes.find(n=>n.mac===m.mac);return <tr key={`${m.mac}:${m.port}:${m.vlan}:${i}`}><td class="font-mono text-xs"><Mac value={m.mac}/></td><td>{client?<button class="text-accent underline" onClick={()=>openClient(client.mac)}><Mac value={client.device?.alias??client.name}/></button>:node?.name??"Sem identificação"}</td><td>{m.port}</td><td>{m.vlan}</td><td>{m.type}</td></tr>;})}</tbody></table></TableCard>
      <details class="mt-4"><summary class="cursor-pointer text-sm">Leituras adicionais</summary><Kv class="mt-3" items={[
        ["DHCP snooping",flag(snapshot?.dhcpSnooping)], ["IGMP snooping",flag(snapshot?.igmp)],["Jumbo frame",flag(snapshot?.jumboFrame)],
      ]}/></details>
      <div class="mt-5"><Button variant="danger" disabled={device.polling||busy} onClick={()=>{if(confirm(`Remover ${device.name}, suas credenciais e o histórico de portas?`))void action(()=>api.deleteSwitch(device.id));}}>Remover cadastro…</Button></div>
    </>}
    {portsEditing&&device&&<DevicePortsEditor nodeId={`switch:${device.id}`} name={device.name} onClose={()=>setPortsEditing(false)}/>}
    {editing&&<SwitchEditor device={editing==="new"?undefined:editing} models={models} onClose={()=>setEditing(null)}/>}
    {history&&device&&<PortHistory device={device} port={history} onClose={()=>setHistory(null)}/>}
    {sfp&&<Dialog title="Diagnóstico do módulo SFP" onClose={()=>setSfp(null)}><Kv items={Object.entries(sfp).filter(([key])=>!key.endsWith("_raw")).map(([key,value])=>[key,String(value)])}/></Dialog>}
  </>;
}
