import { useMemo, useState } from "preact/hooks";
import { Lock, Plus, Search } from "lucide-preact";
import type { ClientView } from "../api";
import { useClients, useReservations } from "../data";
import { INVENTORY_TYPE_LABEL, ago, deviceType } from "../format";
import { ReservationDialog } from "../ReservationDialog";
import { Badge, Banner, Button, Dialog, Dot, Empty, PageLoading, SectionTitle, TableCard } from "../ui";

const label = (c: ClientView) => c.device?.alias ?? c.name;
const ipKey = (ip: string) => ip.split(".").reduce((acc, part) => acc * 256 + Number(part), 0);

type Editing = { client: ClientView; mode: "edit" | "remove" };

function State({ c }: { c: ClientView }) {
  if (!c.online) {
    return <span class="text-[12.5px] text-muted">{c.lastSeen ? `offline · visto ${ago(c.lastSeen)}` : "nunca visto por este painel"}</span>;
  }
  if (c.reservation?.matchesCurrentIp === false) {
    return (
      <Badge tone="warn" title="A reserva vale na próxima renovação do DHCP">
        usando {c.ip} — aguardando renovação
      </Badge>
    );
  }
  return <Badge tone="ok">em uso</Badge>;
}

/** Escolhe um cliente sem reserva para fixar o IP. */
function PickClient({ onPick, onCancel }: { onPick: (c: ClientView) => void; onCancel: () => void }) {
  const { data } = useClients();
  const [q, setQ] = useState("");
  const options = useMemo(
    () =>
      (data?.clients ?? [])
        .filter((c) => !c.reservation && c.online)
        .filter((c) => !q || [label(c), c.mac, c.ip].join(" ").toLowerCase().includes(q.toLowerCase())),
    [data, q],
  );
  return (
    <Dialog title="Fixar IP de qual aparelho?" subtitle="Aparelhos online sem reserva" onClose={onCancel}>
      <div class="relative">
        <Search class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
        <input type="search" class="field pl-9" placeholder="Buscar nome, MAC, IP…" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} aria-label="Buscar aparelho" autofocus />
      </div>
      <ul class="mt-3 grid gap-1">
        {options.map((c) => (
          <li>
            <button type="button" onClick={() => onPick(c)} class="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition hover:bg-surface-2">
              <Dot tone="ok" />
              <span class="min-w-0 flex-1 truncate font-medium">{label(c)}</span>
              <span class="font-mono text-[12px] text-muted">{c.ip}</span>
            </button>
          </li>
        ))}
        {!data && <li class="h-20 animate-pulse rounded-lg bg-surface-2" />}
        {data && options.length === 0 && <li class="px-3 py-4 text-center text-muted">Nenhum aparelho online sem reserva.</li>}
      </ul>
    </Dialog>
  );
}

export function Reservations() {
  const { data, error } = useReservations();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [picking, setPicking] = useState(false);

  const rows = useMemo(() => [...(data?.clients ?? [])].sort((a, b) => ipKey(a.reservation!.ip) - ipKey(b.reservation!.ip)), [data]);

  if (!data) return <PageLoading error={error} />;

  return (
    <>
      <SectionTitle
        actions={
          data.allowWrite && (
            <Button variant="primary" icon={<Plus class="size-4" />} onClick={() => setPicking(true)}>
              Nova reserva
            </Button>
          )
        }
      >
        Reservas de DHCP{" "}
        <span class="font-normal text-muted">
          · {data.used}
          {data.max ? ` de ${data.max}` : ""}
        </span>
      </SectionTitle>
      {data.max && (
        <div class="-mt-1 mb-4 h-1.5 overflow-hidden rounded-full bg-surface-2">
          <div class="h-full rounded-full bg-accent transition-all" style={{ width: `${Math.min(100, (data.used / data.max) * 100)}%` }} />
        </div>
      )}
      {!data.allowWrite && (
        <div class="mb-4">
          <Banner>
            Somente leitura. Para criar, mudar ou remover reservas, inicie o painel com <code>DECO_ALLOW_WRITE=1</code>.
          </Banner>
        </div>
      )}
      {picking && (
        <PickClient
          onCancel={() => setPicking(false)}
          onPick={(c) => {
            setPicking(false);
            setEditing({ client: c, mode: "edit" });
          }}
        />
      )}

      {rows.length === 0 ? (
        <Empty icon={<Lock />}>Nenhuma reserva no Deco.</Empty>
      ) : (
        <TableCard>
          <table class="rtable">
            <thead>
              <tr>
                <th>IP reservado</th>
                <th>Aparelho</th>
                <th>MAC</th>
                <th>Estado</th>
                {data.allowWrite && <th />}
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.mac} class={c.online ? "" : "is-off"}>
                  <td class="cell-primary">
                    <span class="inline-flex items-center gap-2 font-mono font-medium text-fg">
                      <Dot tone={c.online ? "ok" : "off"} />
                      {c.reservation!.ip}
                    </span>
                  </td>
                  <td data-label="Aparelho">
                    <div class="font-medium text-fg">{label(c)}</div>
                    <div class="text-[12px] text-muted">{c.device?.type ? INVENTORY_TYPE_LABEL[c.device.type] : deviceType(c.deviceType)}</div>
                  </td>
                  <td data-label="MAC" class="whitespace-nowrap font-mono text-[12.5px]">
                    {c.mac}
                  </td>
                  <td data-label="Estado">
                    <State c={c} />
                  </td>
                  {data.allowWrite && (
                    <td class="cell-actions">
                      <div class="flex justify-end gap-1.5">
                        <Button size="sm" onClick={() => setEditing({ client: c, mode: "edit" })}>
                          Mudar IP
                        </Button>
                        <Button size="sm" variant="danger" onClick={() => setEditing({ client: c, mode: "remove" })} aria-label={`Remover reserva de ${label(c)}`}>
                          Remover
                        </Button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </TableCard>
      )}
      <p class="mt-4 text-[12.5px] text-muted">
        Cada alteração abre uma sessão própria no Deco (login, conferência, escrita, releitura, logout) e fica registrada na auditoria, em Histórico. Enquanto
        ela roda, o app do Deco no celular pode ser desconectado.
      </p>

      {editing && (
        <ReservationDialog
          mac={editing.client.mac}
          name={label(editing.client)}
          current={editing.client.reservation?.ip ?? null}
          currentIp={editing.client.online ? editing.client.ip : null}
          mode={editing.mode}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}
