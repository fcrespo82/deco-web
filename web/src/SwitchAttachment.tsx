import { useSwitches } from "./data";
/** Observação da tabela de encaminhamento, nunca apresentada como cabo direto. */
export function SwitchAttachment({mac}:{mac:string}) {
  const data=useSwitches().data;
  const entries=data?.switches.flatMap(s=>s.snapshot?.macs.filter(m=>m.mac===mac).map(m=>({s,m}))??[])??[];
  if(!entries.length)return null;
  return <div class="mt-3 rounded-lg border border-line p-3 text-xs"><div class="mb-1 font-semibold">Visto nos switches</div>{entries.map(({s,m})=><div><a class="text-accent underline" href="#/switches">{s.name}</a> · porta {m.port} · VLAN {m.vlan}{s.stale?" · leitura desatualizada":""}{s.portNotes[m.port]?` · ${s.portNotes[m.port]}`:""}</div>)}<p class="mt-1 text-muted">Porta pela qual o MAC é alcançável; pode haver equipamentos intermediários.</p></div>;
}
