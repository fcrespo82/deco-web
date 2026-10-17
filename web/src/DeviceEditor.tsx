/**
 * Edição de um dispositivo do inventário: apelido, dono, tipo, tags, notas,
 * MACs agrupados e os últimos eventos desses MACs. Abre a partir de um MAC
 * (cliente, talvez sem cadastro) ou de um dispositivo existente.
 */
import { useEffect, useState } from "preact/hooks";
import { api, ApiError, type DeviceView, type EventView, type InventoryView } from "./api";
import { BAND_LABEL, EVENT_LABEL, EVENT_TONE, INVENTORY_TYPE_LABEL, ago, dateTime, eventDetail, parseTags } from "./format";
import { Modal } from "./Modal";

interface Props {
  mac?: string;
  deviceId?: number;
  /** Nome sugerido para um MAC ainda sem cadastro (o nome do Deco). */
  suggestedName?: string;
  onClose: (changed: boolean) => void;
}

export function DeviceEditor({ mac, deviceId, suggestedName, onClose }: Props) {
  const [inventory, setInventory] = useState<InventoryView | null>(null);
  const [events, setEvents] = useState<EventView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [changed, setChanged] = useState(false);
  const [form, setForm] = useState({ alias: "", owner: "", type: "", tags: "", notes: "", approved: false });
  const [mergeInto, setMergeInto] = useState("");

  const device: DeviceView | null =
    inventory?.devices.find((d) => (deviceId ? d.id === deviceId : d.macs.some((m) => m.mac === mac))) ?? null;
  const macs = device ? device.macs.map((m) => m.mac) : mac ? [mac] : [];
  const unassigned = inventory?.unassigned.find((m) => m.mac === mac);

  async function load() {
    const inv = await api.inventory();
    setInventory(inv);
    const d = inv.devices.find((x) => (deviceId ? x.id === deviceId : x.macs.some((m) => m.mac === mac)));
    setForm({
      alias: d?.alias ?? suggestedName ?? "",
      owner: d?.owner ?? "",
      type: d?.type ?? "",
      tags: d?.tags.join(", ") ?? "",
      notes: d?.notes ?? "",
      approved: d?.approved ?? false,
    });
    const targetMacs = d ? d.macs.map((m) => m.mac) : mac ? [mac] : [];
    if (targetMacs.length) setEvents((await api.events({ mac: targetMacs.join(","), limit: 15 })).events);
  }

  useEffect(() => {
    load().catch((e) => setError((e as Error).message));
  }, []);

  const close = () => onClose(changed);

  async function run(action: () => Promise<unknown>, after: "reload" | "close" = "reload") {
    setBusy(true);
    setError(null);
    try {
      await action();
      setChanged(true);
      if (after === "close") onClose(true);
      else await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Falha ao salvar.");
    } finally {
      setBusy(false);
    }
  }

  function save(e: Event) {
    e.preventDefault();
    const input = {
      alias: form.alias,
      owner: form.owner || null,
      type: form.type || null,
      tags: parseTags(form.tags),
      notes: form.notes || null,
      approved: form.approved,
    };
    void run(() => (device ? api.updateDevice(device.id, input) : api.saveClientDevice(mac!, input)), "close");
  }

  function merge() {
    const target = inventory?.devices.find((d) => d.id === Number(mergeInto));
    if (!target) return;
    const lose = device && device.macs.length === 1 ? ` O cadastro "${device.alias}" deixa de existir.` : "";
    if (!confirm(`Juntar ${macs.join(", ")} ao dispositivo "${target.alias}"?${lose}`)) return;
    void run(async () => {
      for (const m of macs) await api.attachMac(target.id, m);
    }, "close");
  }

  const set = (k: keyof typeof form) => (e: Event) => {
    const el = e.target as HTMLInputElement;
    setForm({ ...form, [k]: el.type === "checkbox" ? el.checked : el.value });
  };

  const title = device ? `Dispositivo: ${device.alias}` : `Cadastrar ${mac}`;
  const others = inventory?.devices.filter((d) => d.id !== device?.id) ?? [];

  return (
    <Modal title={title} onClose={close}>
      {!inventory ? (
        <div class="empty">{error ?? "Carregando…"}</div>
      ) : (
        <>
          <form class="form" onSubmit={save}>
            <label>
              Apelido
              <input value={form.alias} onInput={set("alias")} required maxLength={80} />
            </label>
            <div class="form-row">
              <label>
                Dono
                <input value={form.owner} onInput={set("owner")} maxLength={80} />
              </label>
              <label>
                Tipo
                <select value={form.type} onChange={set("type")}>
                  <option value="">—</option>
                  {inventory.deviceTypes.map((t) => (
                    <option value={t}>{INVENTORY_TYPE_LABEL[t] ?? t}</option>
                  ))}
                </select>
              </label>
            </div>
            <label>
              Tags <span class="muted small">(separadas por vírgula)</span>
              <input value={form.tags} onInput={set("tags")} placeholder="ex.: escritório, backup" />
            </label>
            <label>
              Notas
              <textarea value={form.notes} onInput={set("notes")} rows={3} maxLength={2000} />
            </label>
            <label class="check">
              <input type="checkbox" checked={form.approved} onChange={set("approved")} />
              Aprovado (dispositivo conhecido; não gera alerta de "novo")
            </label>
            {error && <div class="error">{error}</div>}
            <div class="form-actions">
              {device && (
                <button
                  type="button"
                  class="btn danger"
                  disabled={busy}
                  onClick={() => confirm(`Excluir o cadastro "${device.alias}"? Os MACs continuam aparecendo como clientes.`) && run(() => api.deleteDevice(device.id), "close")}
                >
                  Excluir cadastro
                </button>
              )}
              <span class="spacer" />
              <button type="button" class="btn" onClick={close}>
                Cancelar
              </button>
              <button class="btn primary" disabled={busy || !form.alias.trim()}>
                Salvar
              </button>
            </div>
          </form>

          <h4>MACs</h4>
          <ul class="mac-list">
            {(device?.macs ?? (unassigned ? [unassigned] : macs.map((m) => ({ mac: m, online: false, ip: null, band: null, nodeName: null, decoName: null, lastSeen: null })))).map((m) => (
              <li>
                <span class={`dot ${m.online ? "ok" : ""}`} />
                <span class="mono">{m.mac}</span>
                <span class="muted small">
                  {[m.decoName, m.ip, m.band && BAND_LABEL[m.band], m.nodeName, !m.online && m.lastSeen ? `visto ${ago(m.lastSeen)}` : null]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
                {device && device.macs.length > 1 && (
                  <button class="btn small-btn" disabled={busy} onClick={() => run(() => api.detachMac(device.id, m.mac))}>
                    Separar
                  </button>
                )}
              </li>
            ))}
          </ul>
          {others.length > 0 && (
            <div class="form-row merge">
              <select value={mergeInto} onChange={(e) => setMergeInto((e.target as HTMLSelectElement).value)} aria-label="Juntar com">
                <option value="">Juntar com outro dispositivo…</option>
                {others.map((d) => (
                  <option value={d.id}>
                    {d.alias} ({d.macs.length} MAC{d.macs.length > 1 ? "s" : ""})
                  </option>
                ))}
              </select>
              <button class="btn" disabled={!mergeInto || busy} onClick={merge}>
                Juntar
              </button>
            </div>
          )}

          <h4>Últimos eventos</h4>
          {events.length === 0 ? (
            <p class="muted small">Nenhum evento registrado.</p>
          ) : (
            <ul class="event-list compact">
              {events.map((e) => (
                <li>
                  <span class={`badge ${EVENT_TONE[e.type] ?? ""}`}>{EVENT_LABEL[e.type] ?? e.type}</span>
                  <span class="small">{eventDetail(e.type, e.data)}</span>
                  <span class="muted small" title={dateTime(e.at)}>
                    {ago(e.at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Modal>
  );
}
