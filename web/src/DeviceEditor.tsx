/**
 * Edição de um dispositivo do inventário: apelido, dono, tipo, tags, notas,
 * MACs agrupados e os últimos eventos desses MACs. Abre a partir de um MAC
 * (cliente, talvez sem cadastro) ou de um dispositivo existente.
 *
 * Salvar e excluir são otimistas: o diálogo fecha e as telas mudam na hora;
 * se o servidor recusar, a mudança é desfeita e um aviso explica.
 */
import { useEffect, useState } from "preact/hooks";
import { Link2, Trash, Unlink } from "lucide-preact";
import { api, type AlertsView, type ClientView, type DeviceInput, type DeviceSummary, type DeviceView, type EventView, type InventoryView } from "./api";
import { KEYS, useInventory } from "./data";
import { BAND_LABEL, EVENT_LABEL, EVENT_TONE, INVENTORY_TYPE_LABEL, ago, dateTime, eventDetail, parseTags } from "./format";
import { errorText, mutate } from "./lib/mutate";
import { setQueryData } from "./lib/query";
import { toast } from "./lib/toast";
import { Badge, Button, Check, Dialog, Dot, Field, Skeleton } from "./ui";

interface Props {
  mac?: string;
  deviceId?: number;
  /** Nome sugerido para um MAC ainda sem cadastro (o nome do Deco). */
  suggestedName?: string;
  /** Tipo sugerido (fabricante + categoria do Deco) para um MAC sem cadastro. */
  suggestedType?: string;
  /** Fabricante do MAC; null = MAC privado/aleatório; undefined = não informado. */
  vendor?: string | null;
  onClose: () => void;
}

type Clients = { status: unknown; clients: ClientView[] };

/** Aplica o cadastro novo nos caches das telas (Clientes, Inventário, Alertas). */
function applyLocally(macs: string[], device: DeviceView | null, input: Required<Pick<DeviceInput, "alias" | "tags" | "approved">> & DeviceInput) {
  const summary = (prev: DeviceSummary | null): DeviceSummary => ({
    id: prev?.id ?? device?.id ?? -1,
    alias: input.alias,
    owner: input.owner ?? null,
    type: input.type ?? null,
    tags: input.tags,
    approved: input.approved,
  });
  return [
    setQueryData<Clients>(KEYS.clients, (d) => ({
      ...d,
      clients: d.clients.map((c) => (macs.includes(c.mac) ? { ...c, device: summary(c.device) } : c)),
    })),
    setQueryData<InventoryView>(KEYS.inventory, (d) =>
      device
        ? { ...d, devices: d.devices.map((x) => (x.id === device.id ? { ...x, ...summary(x), notes: input.notes ?? null } : x)) }
        : d,
    ),
    setQueryData<AlertsView>(KEYS.alerts, (d) =>
      input.approved ? { ...d, pending: d.pending.filter((c) => !macs.includes(c.mac)) } : d,
    ),
  ];
}

export function DeviceEditor({ mac, deviceId, suggestedName, suggestedType, vendor, onClose }: Props) {
  const { data: inventory, error: loadError } = useInventory();
  const [events, setEvents] = useState<EventView[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<{ alias: string; owner: string; type: string; tags: string; notes: string; approved: boolean } | null>(null);
  const [mergeInto, setMergeInto] = useState("");

  const device: DeviceView | null =
    inventory?.devices.find((d) => (deviceId ? d.id === deviceId : d.macs.some((m) => m.mac === mac))) ?? null;
  const macs = device ? device.macs.map((m) => m.mac) : mac ? [mac] : [];
  const unassigned = inventory?.unassigned.find((m) => m.mac === mac);

  // O formulário começa com o cadastro (ou as sugestões) assim que o inventário chega.
  useEffect(() => {
    if (!inventory || form) return;
    setForm({
      alias: device?.alias ?? suggestedName ?? "",
      owner: device?.owner ?? "",
      type: device?.type ?? (device ? "" : (suggestedType ?? "")),
      tags: device?.tags.join(", ") ?? "",
      notes: device?.notes ?? "",
      approved: device?.approved ?? false,
    });
  }, [inventory]);

  const macKey = macs.join(",");
  useEffect(() => {
    if (!macKey) return;
    api.events({ mac: macKey, limit: 15 }).then((r) => setEvents(r.events), () => setEvents([]));
  }, [macKey]);

  function save(e: Event) {
    e.preventDefault();
    if (!form) return;
    const input = {
      alias: form.alias.trim(),
      owner: form.owner || null,
      type: form.type || null,
      tags: parseTags(form.tags),
      notes: form.notes || null,
      approved: form.approved,
    };
    const target = device;
    onClose();
    void mutate({
      optimistic: () => applyLocally(macs, target, input),
      run: () => (target ? api.updateDevice(target.id, input) : api.saveClientDevice(mac!, input)),
      success: target ? `"${input.alias}" salvo` : `"${input.alias}" cadastrado`,
      invalidates: ["inventory"],
    });
  }

  function remove() {
    if (!device || !confirm(`Excluir o cadastro "${device.alias}"? Os MACs continuam aparecendo como clientes.`)) return;
    const target = device;
    onClose();
    void mutate({
      optimistic: () => [
        setQueryData<InventoryView>(KEYS.inventory, (d) => ({ ...d, devices: d.devices.filter((x) => x.id !== target.id) })),
        setQueryData<Clients>(KEYS.clients, (d) => ({
          ...d,
          clients: d.clients.map((c) => (c.device?.id === target.id ? { ...c, device: null } : c)),
        })),
      ],
      run: () => api.deleteDevice(target.id),
      success: `Cadastro "${target.alias}" excluído`,
      invalidates: ["inventory"],
      failure: "Não foi possível excluir",
    });
  }

  /** Separar/juntar MACs mexe na estrutura do cadastro: espera o servidor. */
  async function regroup(action: () => Promise<unknown>, done: string, close: boolean) {
    setBusy(true);
    setError(null);
    try {
      await action();
      toast(done);
      if (close) onClose();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  function merge() {
    const target = inventory?.devices.find((d) => d.id === Number(mergeInto));
    if (!target) return;
    const lose = device && device.macs.length === 1 ? ` O cadastro "${device.alias}" deixa de existir.` : "";
    if (!confirm(`Juntar ${macs.join(", ")} ao dispositivo "${target.alias}"?${lose}`)) return;
    void regroup(
      async () => {
        for (const m of macs) await api.attachMac(target.id, m);
      },
      `Juntado a "${target.alias}"`,
      true,
    );
  }

  const set = (k: "alias" | "owner" | "type" | "tags" | "notes") => (e: Event) =>
    setForm((f) => f && { ...f, [k]: (e.target as HTMLInputElement).value });

  const title = device ? device.alias : `Cadastrar ${mac}`;
  const others = inventory?.devices.filter((d) => d.id !== device?.id) ?? [];
  const macRows =
    device?.macs ?? (unassigned ? [unassigned] : macs.map((m) => ({ mac: m, online: false, ip: null, band: null, nodeName: null, decoName: null, lastSeen: null })));

  return (
    <Dialog
      title={title}
      subtitle={device ? "Dispositivo do inventário" : undefined}
      onClose={onClose}
      footer={
        form && (
          <>
            {device && (
              <Button variant="danger" icon={<Trash class="size-4" />} disabled={busy} onClick={remove}>
                Excluir
              </Button>
            )}
            <span class="flex-1" />
            <Button onClick={onClose}>Cancelar</Button>
            <Button variant="primary" type="submit" form="device-form" disabled={busy || !form.alias.trim()}>
              Salvar
            </Button>
          </>
        )
      }
    >
      {!inventory || !form ? (
        loadError ? (
          <p class="text-bad">{loadError.message}</p>
        ) : (
          <div class="grid gap-3">
            <Skeleton class="h-10" />
            <Skeleton class="h-10" />
            <Skeleton class="h-20" />
          </div>
        )
      ) : (
        <>
          <form id="device-form" class="grid gap-4" onSubmit={save}>
            {!device && vendor !== undefined && (
              <p class="rounded-lg bg-surface-2 px-3 py-2 text-[12.5px] text-muted">
                {vendor ? <>Fabricante do MAC: <span class="text-fg">{vendor}</span></> : "MAC privado/aleatório: sem fabricante (celular com endereço privado, VM ou container)."}
                {suggestedType && form.type === suggestedType && <> · tipo sugerido: {INVENTORY_TYPE_LABEL[suggestedType] ?? suggestedType}</>}
              </p>
            )}
            <Field label="Apelido">
              <input class="field" value={form.alias} onInput={set("alias")} required maxLength={80} autofocus />
            </Field>
            <div class="grid gap-4 sm:grid-cols-2">
              <Field label="Dono">
                <input class="field" value={form.owner} onInput={set("owner")} maxLength={80} />
              </Field>
              <Field label="Tipo">
                <select class="field" value={form.type} onChange={set("type")}>
                  <option value="">—</option>
                  {inventory.deviceTypes.map((t) => (
                    <option value={t}>{INVENTORY_TYPE_LABEL[t] ?? t}</option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label="Tags" hint="(separadas por vírgula)">
              <input class="field" value={form.tags} onInput={set("tags")} placeholder="ex.: escritório, backup" />
            </Field>
            <Field label="Notas">
              <textarea class="field resize-y" value={form.notes} onInput={set("notes")} rows={3} maxLength={2000} />
            </Field>
            <Check checked={form.approved} onChange={() => setForm((f) => f && { ...f, approved: !f.approved })}>
              Aprovado <span class="text-muted">(dispositivo conhecido; não gera alerta de "novo")</span>
            </Check>
            {error && <p class="text-[13px] text-bad">{error}</p>}
          </form>

          <h4 class="mb-2 mt-6 text-[11.5px] font-semibold uppercase tracking-wide text-muted">MACs</h4>
          <ul class="grid gap-1.5">
            {macRows.map((m) => (
              <li class="flex flex-wrap items-center gap-2 rounded-lg border border-line px-3 py-2">
                <Dot tone={m.online ? "ok" : "off"} />
                <span class="font-mono text-[12.5px]">{m.mac}</span>
                <span class="min-w-0 flex-1 text-[12px] text-muted">
                  {[m.decoName, m.ip, m.band && BAND_LABEL[m.band], m.nodeName, !m.online && m.lastSeen ? `visto ${ago(m.lastSeen)}` : null].filter(Boolean).join(" · ")}
                </span>
                {device && device.macs.length > 1 && (
                  <Button size="sm" variant="ghost" icon={<Unlink class="size-3.5" />} disabled={busy} onClick={() => regroup(() => api.detachMac(device.id, m.mac), `${m.mac} separado`, false)}>
                    Separar
                  </Button>
                )}
              </li>
            ))}
          </ul>
          {others.length > 0 && (
            <div class="mt-2 flex gap-2">
              <select class="field" value={mergeInto} onChange={(e) => setMergeInto((e.target as HTMLSelectElement).value)} aria-label="Juntar com">
                <option value="">Juntar com outro dispositivo…</option>
                {others.map((d) => (
                  <option value={d.id}>
                    {d.alias} ({d.macs.length} MAC{d.macs.length > 1 ? "s" : ""})
                  </option>
                ))}
              </select>
              <Button icon={<Link2 class="size-4" />} disabled={!mergeInto || busy} onClick={merge}>
                Juntar
              </Button>
            </div>
          )}

          <h4 class="mb-2 mt-6 text-[11.5px] font-semibold uppercase tracking-wide text-muted">Últimos eventos</h4>
          {events === null ? (
            <Skeleton class="h-16" />
          ) : events.length === 0 ? (
            <p class="text-[12.5px] text-muted">Nenhum evento registrado.</p>
          ) : (
            <ol class="relative grid gap-2.5 border-l border-line pl-4">
              {events.map((e) => (
                <li class="relative flex flex-wrap items-center gap-2">
                  <span class="absolute -left-[21px] top-1.5 size-2 rounded-full border-2 border-surface bg-surface-3" />
                  <Badge tone={EVENT_TONE[e.type] || ""}>{EVENT_LABEL[e.type] ?? e.type}</Badge>
                  <span class="font-mono text-[12px]">{eventDetail(e.type, e.data)}</span>
                  <span class="text-[12px] text-muted" title={dateTime(e.at)}>
                    {ago(e.at)}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </Dialog>
  );
}
