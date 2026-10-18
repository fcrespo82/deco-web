import { useMemo, useState } from "preact/hooks";
import { Boxes, Plus, Search } from "lucide-preact";
import type { DeviceMacView, DeviceView } from "../api";
import { useInventory } from "../data";
import { DeviceEditor } from "../DeviceEditor";
import { BAND_LABEL, INVENTORY_TYPE_LABEL, ago } from "../format";
import { Badge, Button, Dot, Empty, PageLoading, SectionTitle, TableCard } from "../ui";

function MacLine({ m }: { m: DeviceMacView }) {
  return (
    <div class="flex flex-wrap items-center gap-x-2 gap-y-0.5">
      <Dot tone={m.online ? "ok" : "off"} label={m.online ? "online" : "offline"} />
      <span class="font-mono text-[12.5px]">{m.mac}</span>
      <span class="text-[12px] text-muted">
        {[m.ip, m.band && BAND_LABEL[m.band], m.nodeName, !m.online && m.lastSeen ? `visto ${ago(m.lastSeen)}` : null].filter(Boolean).join(" · ")}
      </span>
    </div>
  );
}

type Editing = { deviceId: number } | { mac: string; name?: string };

export function Inventory() {
  const { data, error } = useInventory();
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [editing, setEditing] = useState<Editing | null>(null);

  const devices = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (data?.devices ?? []).filter((d: DeviceView) => {
      if (type && d.type !== type) return false;
      if (!needle) return true;
      return [d.alias, d.owner, d.notes, ...d.tags, ...d.macs.flatMap((m) => [m.mac, m.ip, m.decoName])]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(needle.replace(/:/g, "-"));
    });
  }, [data, q, type]);

  if (!data) return <PageLoading error={error} />;

  return (
    <>
      <div class="mb-4 flex flex-wrap gap-2">
        <div class="relative min-w-0 flex-[1_1_260px]">
          <Search class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <input type="search" class="field pl-9" placeholder="Buscar apelido, dono, tag, MAC…" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} aria-label="Buscar" />
        </div>
        <select class="field w-auto" value={type} onChange={(e) => setType((e.target as HTMLSelectElement).value)} aria-label="Tipo">
          <option value="">Todos os tipos</option>
          {data.deviceTypes.map((t) => (
            <option value={t}>{INVENTORY_TYPE_LABEL[t] ?? t}</option>
          ))}
        </select>
      </div>

      <SectionTitle>
        Dispositivos cadastrados <span class="font-normal text-muted">· {data.devices.length}</span>
      </SectionTitle>
      {data.devices.length === 0 ? (
        <Empty icon={<Boxes />}>Nada cadastrado ainda. Use "Cadastrar" na lista abaixo ou clique num nome na tela de Clientes.</Empty>
      ) : devices.length === 0 ? (
        <Empty>Nenhum dispositivo com esses filtros.</Empty>
      ) : (
        <TableCard>
          <table class="rtable">
            <thead>
              <tr>
                <th>Dispositivo</th>
                <th>Dono</th>
                <th>MACs</th>
                <th>Tags</th>
                <th>Notas</th>
              </tr>
            </thead>
            <tbody>
              {devices.map((d) => (
                <tr key={d.id} class={d.online ? "" : "is-off"}>
                  <td class="cell-primary">
                    <div class="flex items-center gap-2">
                      <Dot tone={d.online ? "ok" : "off"} />
                      <button type="button" class="truncate text-left font-medium text-fg hover:text-accent hover:underline" onClick={() => setEditing({ deviceId: d.id })}>
                        {d.alias}
                      </button>
                    </div>
                    <div class="mt-0.5 flex flex-wrap gap-1 pl-4 text-[12px] text-muted">
                      {d.type && <span>{INVENTORY_TYPE_LABEL[d.type]}</span>}
                      {!d.approved && <Badge tone="warn">não aprovado</Badge>}
                    </div>
                  </td>
                  <td data-label="Dono">{d.owner ?? <span class="text-muted">—</span>}</td>
                  <td data-label="MACs">
                    <div class="grid gap-1">
                      {d.macs.map((m) => (
                        <MacLine m={m} />
                      ))}
                    </div>
                  </td>
                  <td data-label="Tags">
                    <div class="flex flex-wrap gap-1">
                      {d.tags.map((t) => (
                        <Badge>{t}</Badge>
                      ))}
                    </div>
                  </td>
                  <td data-label="Notas" class="max-w-[260px] whitespace-pre-wrap text-[12.5px]">
                    {d.notes ?? ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableCard>
      )}

      <SectionTitle>
        Sem cadastro <span class="font-normal text-muted">· {data.unassigned.length}</span>
      </SectionTitle>
      {data.unassigned.length === 0 ? (
        <p class="text-muted">Todos os MACs vistos estão cadastrados.</p>
      ) : (
        <TableCard>
          <table class="rtable">
            <thead>
              <tr>
                <th>Nome no Deco</th>
                <th>MAC</th>
                <th>Último estado</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.unassigned.map((m) => (
                <tr key={m.mac} class={m.online ? "" : "is-off"}>
                  <td class="cell-primary">
                    <span class="flex items-center gap-2 font-medium text-fg">
                      <Dot tone={m.online ? "ok" : "off"} />
                      {m.decoName ?? <span class="text-muted">sem nome</span>}
                    </span>
                  </td>
                  <td data-label="MAC" class="whitespace-nowrap font-mono text-[12.5px]">
                    {m.mac}
                  </td>
                  <td data-label="Estado" class="text-[12.5px]">
                    {[m.ip, m.band && BAND_LABEL[m.band], m.nodeName, m.online ? "online" : m.lastSeen ? `visto ${ago(m.lastSeen)}` : null].filter(Boolean).join(" · ")}
                  </td>
                  <td class="cell-actions text-right">
                    <Button size="sm" icon={<Plus class="size-3.5" />} onClick={() => setEditing({ mac: m.mac, name: m.decoName ?? undefined })}>
                      Cadastrar
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableCard>
      )}

      {editing && (
        <DeviceEditor
          {...("deviceId" in editing ? { deviceId: editing.deviceId } : { mac: editing.mac, suggestedName: editing.name })}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}
