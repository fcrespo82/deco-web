import { Mac } from "./Mac";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { api, type EventView } from "./api";
import { useQuery } from "./lib/query";
import { Button } from "./ui";
import { EVENT_LABEL, eventDetail, dateTime } from "./format";
export function DeviceHistory({macs}: {macs: string[]}) {
  const key = [...macs].sort().join(",");
  const first = useQuery(`device-events:${key}`, () => api.events({mac:key,limit:50}), ["snapshot","reservations","inventory"]);
  const [older,setOlder] = useState<EventView[]>([]);
  const [next,setNext] = useState<number|null|undefined>(undefined);
  const [loading,setLoading] = useState(false);
  const [error,setError] = useState<string|null>(null);
  const generation = useRef(0);
  useEffect(()=>{ generation.current++; setOlder([]); setNext(undefined); setError(null); setLoading(false); },[key]);
  useEffect(() => {
    if (!first.data) return;
    setOlder(old => [...new Map([...old,...first.data!.events].map(e=>[e.id,e])).values()]);
    setNext(old => old === undefined ? first.data!.nextBefore : old);
  }, [first.data]);
  const rows = useMemo(()=>[...new Map([...(first.data?.events??[]),...older].map(e=>[e.id,e])).values()].sort((a,b)=>b.id-a.id),[first.data,older]);
  const cursor = next === undefined ? first.data?.nextBefore : next;
  async function more() {
    if (!cursor) return;
    const current = generation.current;
    setLoading(true); setError(null);
    try {
      const page = await api.events({mac:key,limit:50,before:cursor});
      if(current===generation.current) { setOlder(old=>[...old,...page.events]); setNext(page.nextBefore); }
    } catch { if(current===generation.current) setError("Não foi possível carregar os eventos."); }
    finally { if(current===generation.current) setLoading(false); }
  }
  return <div>
    <p class="mb-3 text-xs text-muted">Interfaces atuais do cadastro. Os horários indicam observações periódicas; eventos anteriores à retenção não aparecem.</p>
    {(first.error || error) && <p role="alert" class="text-bad">{error ?? "Não foi possível carregar o histórico."}</p>}
    {!first.data && !first.error && <p>Carregando histórico…</p>}
    {first.data && !rows.length && <p class="text-muted">Nenhum evento registrado para este dispositivo.</p>}
    <ol class="device-timeline divide-y divide-line">{rows.map(e=><li key={e.id} class="py-3">
      <div class="flex flex-wrap justify-between gap-2"><strong class="text-sm">{EVENT_LABEL[e.type]??e.type}</strong><time class="text-xs text-muted">{dateTime(e.at)}</time></div>
      <p class="break-words text-sm text-muted"><Mac value={eventDetail(e.type,e.data)} /></p>
      {macs.length>1 && <span class="font-mono text-xs text-muted"><Mac value={e.mac} /></span>}
    </li>)}</ol>
    {cursor && <Button onClick={more} disabled={loading}>{loading?"Carregando…":"Carregar mais"}</Button>}
  </div>;
}
