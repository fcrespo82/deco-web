import { useState } from "preact/hooks";
import type { SwitchConfig, SwitchView } from "../../src/switches/types";
import { api } from "./api";
import { invalidate } from "./lib/query";
import { Button, Dialog, Field } from "./ui";
const message=(e:unknown)=>e instanceof Error?e.message:"Não foi possível salvar";
export function SwitchEditor({device,models,onClose,onSaved}:{device?:SwitchView;models:string[];onClose:()=>void;onSaved?:(saved:SwitchConfig)=>void}) {
  const [name,setName]=useState(device?.name??"");
  const [host,setHost]=useState(device?.host??"");
  const [model,setModel]=useState(device?.model??models.find(m=>m!=="builtin")??"builtin");
  const [username,setUsername]=useState(device?.username??"admin");
  const [password,setPassword]=useState("");
  const [enabled,setEnabled]=useState(device?.enabled??true);
  const [interval,setInterval]=useState(device?.intervalSeconds??30);
  const [portCount,setPortCount]=useState(device?.portCount??9);
  const [uplink,setUplink]=useState(device?.uplink??"");
  const [notes,setNotes]=useState(device?.portNotes??{});
  const [error,setError]=useState<string|null>(null);
  const [busy,setBusy]=useState(false);
  async function save(event:Event) {
    event.preventDefault();setError(null);setBusy(true);
    try {
      const saved=await api.saveSwitch({name,host,model,username,password:password||undefined,enabled,intervalSeconds:interval,portCount,uplink,portNotes:notes},device?.id);
      invalidate(["switches"]);onSaved?.(saved);onClose();
    } catch(e){setError(message(e));}finally{setBusy(false);}
  }
  const ports=device?.snapshot?.ports.map(p=>p.port)??Array.from({length:portCount},(_,i)=>String(i+1));
  return <Dialog title={device?"Configurar switch":"Adicionar switch"} onClose={onClose}>
    <form onSubmit={save} class="space-y-3">
      <Field label="Nome"><input class="field" value={name} onInput={e=>setName(e.currentTarget.value)} required maxLength={200}/></Field>
      <Field label="IP ou hostname"><input class="field" value={host} onInput={e=>setHost(e.currentTarget.value)} required/></Field>
      <Field label="Modelo"><select class="field" value={model} onChange={e=>setModel(e.currentTarget.value)}>{models.map(m=><option value={m}>{m==="builtin"?"HORACO / compatível (parser padrão)":m}</option>)}</select></Field>
      <div class="grid gap-3 sm:grid-cols-2">
        <Field label="Usuário"><input class="field" value={username} onInput={e=>setUsername(e.currentTarget.value)} autoComplete="off"/></Field>
        <Field label={device?.hasPassword?"Nova senha (vazio mantém a atual)":"Senha do switch"}><input class="field" type="password" value={password} onInput={e=>setPassword(e.currentTarget.value)} autoComplete="new-password" required={!device?.hasPassword}/></Field>
        <Field label="Portas"><input class="field" type="number" min="1" max="128" value={portCount} onInput={e=>setPortCount(Number(e.currentTarget.value))}/></Field>
        <Field label="Intervalo de coleta (segundos)"><input class="field" type="number" min="30" max="3600" value={interval} onInput={e=>setInterval(Number(e.currentTarget.value))}/></Field>
      </div>
      <Field label="Uplink físico cadastrado" hint="Ex.: porta 1 → switch principal ao lado do Hallway. Esta anotação é manual."><input class="field" value={uplink} onInput={e=>setUplink(e.currentTarget.value)} maxLength={500}/></Field>
      <label class="flex items-center gap-2"><input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.currentTarget.checked)}/>Monitoramento ativo</label>
      <details><summary class="cursor-pointer text-sm">Anotações das portas</summary><div class="mt-3 grid gap-3 sm:grid-cols-2">{ports.map(port=><Field label={`Porta ${port}`}><input class="field" value={notes[port]??""} onInput={e=>setNotes({...notes,[port]:e.currentTarget.value})} maxLength={300}/></Field>)}</div></details>
      {error&&<p role="alert" class="text-sm text-bad">{error}</p>}
      <div class="flex justify-end gap-2"><Button onClick={onClose}>Cancelar</Button><Button type="submit" variant="primary" loading={busy}>Salvar</Button></div>
    </form>
  </Dialog>;
}

