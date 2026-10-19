import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { Network, Pencil, Plus, Trash, TriangleAlert } from "lucide-preact";
import { api, type CellStatus, type ClientView, type IpCell, type IpPlan as Plan, type RangeSummary } from "../api";
import { KEYS, useClients, useIpPlan, useStatus } from "../data";
import { INVENTORY_TYPE_LABEL } from "../format";
import { errorText, mutate } from "../lib/mutate";
import { getQueryData, setQueryData } from "../lib/query";
import { usePendingReservations } from "../lib/reservation-write";
import { openClient } from "../lib/ui-state";
import { categoryOf, DeviceArt } from "../art/devices";
import { DeviceEditor } from "../DeviceEditor";
import { PickClient } from "./Reservations";
import { toast } from "../lib/toast";
import { PendingReservationBadge, ReservationDialog } from "../ReservationDialog";
import { Badge, Banner, Button, Card, Check, cx, Dialog, Empty, Field, FilterChips, IconButton, Kv, PageLoading, SectionTitle, TableCard } from "../ui";

/** Cores das faixas: ordem categórica fixa (validada); da 9ª em diante, cinza. */
const RANGE_SLOTS = 8;
const rangeColor = (index: number) => (index < RANGE_SLOTS ? `var(--series-${index + 1})` : "var(--series-other)");

const STATUS_LABEL: Record<CellStatus, string> = {
  network: "Endereço de rede",
  broadcast: "Broadcast",
  gateway: "Gateway (Deco principal)",
  node: "Nó do mesh",
  "reserved-online": "Reservado, em uso",
  reserved: "Reservado, offline",
  online: "Em uso (dinâmico)",
  recent: "Visto há pouco (lease pode valer)",
  free: "Livre",
};

/** Grupos de anomalia, na ordem em que aparecem, com o que fazer em cada um. */
const ANOMALY_GROUPS: { code: string; label: string; hint: string }[] = [
  {
    code: "dynamic-in-static",
    label: "Dinâmico em faixa fixa",
    hint: "Aparelho sem reserva usando um IP de faixa fixa. Some quando ele renovar o IP no pool do DHCP (reconectar acelera) — ou fixe o IP dele na faixa do tipo.",
  },
  {
    code: "static-in-dynamic",
    label: "Fixo em faixa dinâmica",
    hint: "Reserva dentro do pool: o DHCP pode entregar este IP a outro aparelho. Mova a reserva para a faixa do tipo.",
  },
  {
    code: "type-mismatch",
    label: "Categoria errada",
    hint: "O tipo do aparelho (do inventário, ou sugerido quando não há cadastro) não é o que a faixa espera. Mova a reserva ou corrija o tipo no inventário.",
  },
  {
    code: "untyped",
    label: "Sem categoria",
    hint: "Aparelho numa faixa com tipos definidos, sem tipo no inventário e sem sugestão possível. Defina o tipo no inventário.",
  },
  { code: "outside-plan", label: "Fora do plano", hint: "Reserva fora de qualquer faixa. Crie uma faixa ou mova a reserva." },
  { code: "reservation-conflict", label: "Conflito de reserva", hint: "IP reservado para um aparelho, em uso por outro." },
  { code: "reservation-not-applied", label: "Reserva não aplicada", hint: "Tem reserva, mas ainda usa outro IP. Reconectar o aparelho aplica a reserva." },
];
const ANOMALY_LABEL: Record<string, string> = Object.fromEntries(ANOMALY_GROUPS.map((g) => [g.code, g.label]));
const groupIndex = (code: string) => ANOMALY_GROUPS.findIndex((g) => g.code === code);

const LEGEND: CellStatus[] = ["reserved-online", "reserved", "online", "recent", "free", "node", "gateway"];

function RangeForm({ range, onClose }: { range: RangeSummary | null; onClose: () => void }) {
  const [form, setForm] = useState({
    name: range?.name ?? "",
    spec: range?.label.replace("–", "-") ?? "",
    kind: range?.kind ?? "static",
    types: range?.types ?? [],
    notes: range?.notes ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: Event) {
    e.preventDefault();
    const input = { ...form, notes: form.notes || null };
    // Editar sem mexer nos endereços: otimista. Criar ou mudar endereços passa
    // pela validação do servidor (formato, sobreposição), então espera.
    const specChanged = !range || form.spec !== range.label.replace("–", "-");
    if (range && !specChanged) {
      onClose();
      void mutate({
        optimistic: () => [
          setQueryData<Plan>(KEYS.ipPlan, (d) => ({
            ...d,
            ranges: d.ranges.map((r) => (r.id === range.id ? { ...r, name: input.name, kind: input.kind, types: input.types, notes: input.notes } : r)),
          })),
        ],
        run: () => api.updateRange(range.id, input),
        success: `Faixa "${input.name}" salva`,
        invalidates: ["ipplan"],
      });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (range) await api.updateRange(range.id, input);
      else await api.createRange(input);
      toast(range ? `Faixa "${input.name}" salva` : `Faixa "${input.name}" criada`);
      onClose();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const toggleType = (t: string) => setForm({ ...form, types: form.types.includes(t) ? form.types.filter((x) => x !== t) : [...form.types, t] });

  return (
    <Dialog
      title={range ? `Faixa: ${range.name}` : "Nova faixa"}
      onClose={onClose}
      footer={
        <>
          <span class="flex-1" />
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" type="submit" form="range-form" loading={busy}>
            Salvar
          </Button>
        </>
      }
    >
      <form id="range-form" class="grid gap-4" onSubmit={submit}>
        <div class="grid gap-4 sm:grid-cols-2">
          <Field label="Nome">
            <input class="field" value={form.name} onInput={(e) => setForm({ ...form, name: (e.target as HTMLInputElement).value })} required maxLength={60} placeholder="ex.: Servidores" autofocus />
          </Field>
          <Field label="Endereços">
            <input class="field font-mono" value={form.spec} onInput={(e) => setForm({ ...form, spec: (e.target as HTMLInputElement).value })} required placeholder=".20-.39" />
          </Field>
        </div>
        <p class="-mt-2 text-[12.5px] text-muted">
          Formatos: <code>.8/29</code> (bloco), <code>.20-.39</code> (intervalo), <code>.100+</code> (até o fim), <code>.50</code> (um só).
        </p>
        <fieldset class="grid gap-2 rounded-xl border border-line p-3.5">
          <legend class="px-1 text-[13px] font-medium text-muted">Tipo</legend>
          <Check type="radio" name="kind" checked={form.kind === "static"} onChange={() => setForm({ ...form, kind: "static" })}>
            <strong class="font-medium">Fixa</strong> <span class="text-muted">— só por reserva (cliente dinâmico aqui é anomalia)</span>
          </Check>
          <Check type="radio" name="kind" checked={form.kind === "dynamic"} onChange={() => setForm({ ...form, kind: "dynamic" })}>
            <strong class="font-medium">Dinâmica</strong> <span class="text-muted">— onde o DHCP do Deco distribui endereços</span>
          </Check>
        </fieldset>
        <fieldset class="rounded-xl border border-line p-3.5">
          <legend class="px-1 text-[13px] font-medium text-muted">Tipos de dispositivo esperados (opcional)</legend>
          <div class="flex flex-wrap gap-1.5">
            {Object.entries(INVENTORY_TYPE_LABEL).map(([t, label]) => {
              const on = form.types.includes(t);
              return (
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleType(t)}
                  class={cx("rounded-full border px-3 py-1 text-[13px] font-medium transition", on ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:text-fg")}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </fieldset>
        <Field label="Notas">
          <input class="field" value={form.notes} onInput={(e) => setForm({ ...form, notes: (e.target as HTMLInputElement).value })} maxLength={500} />
        </Field>
        {error && <p class="text-[13px] text-bad">{error}</p>}
      </form>
    </Dialog>
  );
}

/** O que o detalhe do endereço abriu: cadastro, reserva ou escolha de aparelho. */
type Flow =
  | { kind: "edit"; client: ClientView | null; mac: string; name: string | null; suggestedType?: string; thenReserve: boolean }
  | { kind: "reserve"; client: ClientView; presetIp?: string }
  | { kind: "pick"; ip: string; range: RangeSummary };

/**
 * IP para fixar um aparelho do tipo dado: o próprio endereço, se já está numa
 * faixa fixa que aceita o tipo; senão o próximo livre da faixa fixa do tipo.
 */
function targetIp(plan: Plan, cell: IpCell | undefined, type: string | null): string | undefined {
  const here = cell?.rangeId ? plan.ranges.find((r) => r.id === cell.rangeId) : undefined;
  if (cell && here?.kind === "static" && (here.types.length === 0 || (type && here.types.includes(type)))) return cell.ip;
  const typed = type ? plan.ranges.find((r) => r.kind === "static" && r.types.includes(type) && r.suggestion) : undefined;
  return typed?.suggestion ?? undefined;
}

function CellDetail({
  cell,
  range,
  client,
  allowWrite,
  onFlow,
}: {
  cell: IpCell;
  range: RangeSummary | undefined;
  client: ClientView | undefined;
  allowWrite: boolean;
  onFlow: (f: Flow) => void;
}) {
  const pending = usePendingReservations().has(cell.mac ?? "");
  const type = client ? (client.device?.type ?? null) : null;
  // Para cadastrar: o tipo que o painel sugere, ou o que a faixa espera.
  const suggestedType = client?.suggestedType ?? range?.types[0];
  const editFlow = (thenReserve: boolean): Flow => ({
    kind: "edit",
    client: client ?? null,
    mac: cell.mac!,
    name: client?.name ?? cell.name,
    suggestedType: suggestedType ?? undefined,
    thenReserve,
  });

  return (
    <Card class="animate-fade-in" aria-live="polite">
      <div class="flex items-center gap-2">
        <span class="font-mono text-[15px] font-semibold">{cell.ip}</span>
        <span class="flex-1" />
        <Badge>{STATUS_LABEL[cell.status]}</Badge>
      </div>
      <Kv
        class="mt-3"
        items={[
          ["Faixa", range ? `${range.name} (${range.label})` : "fora do plano"],
          ...(range?.types.length ? [["Espera", range.types.map((t) => INVENTORY_TYPE_LABEL[t] ?? t).join(", ")] as [string, string]] : []),
          ...(!client && cell.name ? [["Dispositivo", cell.name] as [string, string]] : []),
          ...(!client && cell.mac ? [["MAC", cell.mac, "font-mono text-[12.5px]"] as [string, string, string]] : []),
          ...(cell.anomalies.length ? [["Atenção", <span class="text-warn">{cell.anomalies.map((a) => ANOMALY_LABEL[a] ?? a).join(", ")}</span>] as [string, ComponentChildren]] : []),
        ]}
      />

      {client && (
        <div class="mt-3 flex items-center gap-3 rounded-lg border border-line p-2.5">
          <DeviceArt category={categoryOf(client)} size="sm" online={client.online} deviceId={client.device?.id} />
          <div class="min-w-0 flex-1">
            <div class="truncate text-[13.5px] font-medium">{client.device?.alias ?? client.name}</div>
            <div class="flex flex-wrap items-center gap-1.5 text-[12px] text-muted">
              {client.device ? (type ? INVENTORY_TYPE_LABEL[type] : "sem tipo") : <Badge tone="warn">sem cadastro</Badge>}
              <span class="whitespace-nowrap font-mono">{client.mac}</span>
            </div>
          </div>
          <Button size="sm" variant="ghost" onClick={() => openClient(client.mac)}>
            Ficha
          </Button>
        </div>
      )}
      {pending && cell.mac && (
        <div class="mt-2">
          <PendingReservationBadge mac={cell.mac} />
        </div>
      )}

      <div class="mt-3 grid gap-2">
        {cell.mac && !client?.device && (
          <>
            {allowWrite && client?.online && !client.reservation && !pending ? (
              <>
                <Button variant="primary" onClick={() => onFlow(editFlow(true))}>
                  Cadastrar e fixar IP
                </Button>
                <Button onClick={() => onFlow(editFlow(false))}>Só cadastrar</Button>
              </>
            ) : (
              <Button variant="primary" onClick={() => onFlow(editFlow(false))}>
                Cadastrar no inventário
              </Button>
            )}
          </>
        )}
        {cell.mac && client?.device && <Button onClick={() => onFlow(editFlow(false))}>Editar cadastro</Button>}
        {allowWrite && client && !pending && client.device && !client.reservation && client.online && (
          <Button variant="primary" onClick={() => onFlow({ kind: "reserve", client, presetIp: targetIp(planOf(), cell, type) })}>
            Fixar IP…
          </Button>
        )}
        {allowWrite && client?.reservation && !pending && (
          <Button onClick={() => onFlow({ kind: "reserve", client })}>Mudar reserva…</Button>
        )}
        {allowWrite && !cell.mac && cell.status === "free" && range?.kind === "static" && (
          <Button variant="primary" onClick={() => onFlow({ kind: "pick", ip: cell.ip, range })}>
            Reservar para um aparelho…
          </Button>
        )}
      </div>
      {client && cell.anomalies.includes("type-mismatch") && range?.types.length ? (
        <p class="mt-2 text-[12px] text-muted">
          A faixa espera {range.types.map((t) => INVENTORY_TYPE_LABEL[t] ?? t).join(" ou ")}. Ajuste o tipo no cadastro ou mude a reserva para a faixa certa.
        </p>
      ) : null}
    </Card>
  );
}

/** Plano atual do cache (para o cálculo do IP alvo dentro do detalhe). */
const planOf = () => getQueryData<Plan>(KEYS.ipPlan)!;

export function IpPlan() {
  const { data, error } = useIpPlan();
  const status = useStatus();
  const [flow, setFlow] = useState<Flow | null>(null);
  const clients = useClients().data?.clients;
  const [anomalyFilter, setAnomalyFilter] = useState<string>("");
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<RangeSummary | "new" | null>(null);

  if (!data) return <PageLoading error={error} />;

  const colorOf = new Map(data.ranges.map((r, i) => [r.id, rangeColor(i)]));
  const rangeOf = new Map(data.ranges.map((r) => [r.id, r]));
  const cell = data.cells.find((c) => c.ip === selected);

  function remove(r: RangeSummary) {
    if (!confirm(`Excluir a faixa "${r.name}" (${r.label})? Não afeta o Deco, só o plano.`)) return;
    void mutate({
      optimistic: () => [
        setQueryData<Plan>(KEYS.ipPlan, (d) => ({
          ...d,
          ranges: d.ranges.filter((x) => x.id !== r.id),
          cells: d.cells.map((c) => (c.rangeId === r.id ? { ...c, rangeId: null } : c)),
        })),
      ],
      run: () => api.deleteRange(r.id),
      success: `Faixa "${r.name}" excluída`,
      invalidates: ["ipplan"],
      failure: "Não foi possível excluir",
    });
  }

  const anomalies = data.anomalies.filter((a) => !anomalyFilter || a.code === anomalyFilter).sort((a, b) => groupIndex(a.code) - groupIndex(b.code));

  return (
    <>
      <SectionTitle
        actions={
          <Button variant="primary" icon={<Plus class="size-4" />} onClick={() => setEditing("new")} disabled={!data.network}>
            Nova faixa
          </Button>
        }
      >
        Faixas{" "}
        {data.network && (
          <span class="font-normal text-muted">
            · rede <span class="font-mono">{data.network.address}/{data.network.prefix}</span>
          </span>
        )}
      </SectionTitle>
      {data.message && (
        <div class="mb-4">
          <Banner tone="warn">{data.message}</Banner>
        </div>
      )}
      {data.ranges.length === 0 ? (
        <Empty icon={<Network />}>
          Nenhuma faixa definida. Exemplo: <code>.8/29</code> Confiáveis, <code>.20-.39</code> Servidores, <code>.100+</code> IoT.
        </Empty>
      ) : (
        <TableCard>
          <table class="rtable">
            <thead>
              <tr>
                <th>Faixa</th>
                <th>Endereços</th>
                <th>Tipo</th>
                <th>Uso</th>
                <th>Próximo livre</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.ranges.map((r) => {
                const used = r.size ? ((r.size - r.free) / r.size) * 100 : 0;
                return (
                  <tr key={r.id}>
                    <td class="cell-primary">
                      <span class="flex items-center gap-2 font-medium text-fg">
                        <span class="size-3 shrink-0 rounded" style={{ background: colorOf.get(r.id) }} />
                        {r.name}
                      </span>
                      {r.types.length > 0 && <div class="mt-0.5 pl-5 text-[12px] text-muted">espera: {r.types.map((t) => INVENTORY_TYPE_LABEL[t] ?? t).join(", ")}</div>}
                      {r.notes && <div class="pl-5 text-[12px] text-muted">{r.notes}</div>}
                    </td>
                    <td data-label="Endereços" class="font-mono text-[12.5px]">
                      {r.label}
                    </td>
                    <td data-label="Tipo">
                      <Badge tone={r.kind === "static" ? "accent" : ""}>{r.kind === "static" ? "Fixa" : "Dinâmica"}</Badge>
                    </td>
                    <td data-label="Uso" class="min-w-[180px]">
                      <div class="text-[12.5px] tabular-nums">
                        {r.reserved} reserv. · {r.inUse} em uso · {r.free} livres <span class="text-muted">/ {r.size}</span>
                      </div>
                      <div class="mt-1 h-1 overflow-hidden rounded-full bg-surface-2">
                        <div class="h-full rounded-full transition-all" style={{ width: `${used}%`, background: colorOf.get(r.id) }} />
                      </div>
                    </td>
                    <td data-label="Próximo livre" class="font-mono text-[12.5px]">
                      {r.suggestion ?? <span class="text-muted">cheia</span>}
                    </td>
                    <td class="cell-actions">
                      <div class="flex justify-end gap-0.5">
                        <IconButton label={`Editar ${r.name}`} onClick={() => setEditing(r)}>
                          <Pencil class="size-4" />
                        </IconButton>
                        <IconButton label={`Excluir ${r.name}`} onClick={() => remove(r)} class="hover:text-bad">
                          <Trash class="size-4" />
                        </IconButton>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableCard>
      )}

      {data.cells.length > 0 && (
        <>
          <SectionTitle>Mapa do /24</SectionTitle>
          <div class="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
            <Card class="p-3 sm:p-4">
              <div class="mx-auto grid max-w-[760px] gap-[2px] sm:gap-[3px]" role="grid" aria-label="Endereços da rede" style={{ gridTemplateColumns: "repeat(16, minmax(0, 1fr))" }}>
                {data.cells.map((c) => {
                  const range = c.rangeId ? rangeOf.get(c.rangeId) : undefined;
                  const title = [c.ip, STATUS_LABEL[c.status], range && `${range.name} (${range.label})`, c.name, ...c.anomalies.map((a) => `⚠ ${ANOMALY_LABEL[a]}`)]
                    .filter(Boolean)
                    .join("\n");
                  return (
                    <button
                      type="button"
                      key={c.ip}
                      class={cx("ip-cell", `s-${c.status}`, c.anomalies.length > 0 && "has-anomaly", selected === c.ip && "is-selected")}
                      style={c.rangeId ? { "--range": colorOf.get(c.rangeId) } : undefined}
                      title={title}
                      aria-label={title.replace(/\n/g, ", ")}
                      onClick={() => setSelected(selected === c.ip ? null : c.ip)}
                    >
                      {c.octet}
                    </button>
                  );
                })}
              </div>
            </Card>
            <aside class="grid gap-4 lg:sticky lg:top-20">
              {cell ? (
                <CellDetail
                  cell={cell}
                  range={cell.rangeId ? rangeOf.get(cell.rangeId) : undefined}
                  client={cell.mac ? clients?.find((c) => c.mac === cell.mac) : undefined}
                  allowWrite={Boolean(status?.mode.allowWrite)}
                  onFlow={setFlow}
                />
              ) : (
                <p class="rounded-xl border border-dashed border-line px-4 py-3 text-[12.5px] text-muted">Toque num endereço para ver detalhes.</p>
              )}
              <Card>
                <h4 class="mb-2.5 text-[11.5px] font-semibold uppercase tracking-wide text-muted">Legenda</h4>
                <ul class="grid gap-1.5 text-[13px]">
                  {LEGEND.map((s) => (
                    <li class="flex items-center gap-2.5">
                      <span class={`ip-cell s-${s} pointer-events-none size-[18px] shrink-0`} style={{ boxShadow: "none" }} aria-hidden="true" />
                      {STATUS_LABEL[s]}
                    </li>
                  ))}
                  <li class="flex items-center gap-2.5">
                    <span class="ip-cell s-free has-anomaly pointer-events-none size-[18px] shrink-0" style={{ boxShadow: "none" }} aria-hidden="true" />
                    Anomalia
                  </li>
                  {data.ranges.map((r) => (
                    <li class="flex items-center gap-2.5">
                      <span class="ml-[3px] size-3 shrink-0 rounded" style={{ background: colorOf.get(r.id) }} />
                      {r.name} <span class="font-mono text-[12px] text-muted">{r.label}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            </aside>
          </div>
        </>
      )}

      <SectionTitle>
        Anomalias <span class="font-normal text-muted">· {data.anomalies.length}</span>
      </SectionTitle>
      {data.anomalies.length > 0 && (
        <div class="mb-3">
          <FilterChips
            label="Filtrar anomalias"
            value={anomalyFilter}
            onChange={setAnomalyFilter}
            options={[
              { value: "", label: "Todas", count: data.anomalies.length },
              ...ANOMALY_GROUPS.map((g) => ({ value: g.code, label: g.label, count: data.anomalies.filter((a) => a.code === g.code).length })).filter((o) => o.count > 0),
            ]}
          />
        </div>
      )}
      {anomalyFilter && <p class="mb-3 text-[12.5px] text-muted">{ANOMALY_GROUPS.find((g) => g.code === anomalyFilter)?.hint}</p>}
      {data.anomalies.length === 0 ? (
        <p class="text-muted">Nada fora do esperado.</p>
      ) : (
        <TableCard>
          <table class="rtable">
            <thead>
              <tr>
                <th>IP</th>
                <th>Tipo</th>
                <th>Dispositivo</th>
                <th>Detalhe</th>
              </tr>
            </thead>
            <tbody>
              {anomalies.map((a) => (
                <tr>
                  <td class="cell-primary">
                    <button type="button" class="font-mono font-medium text-fg hover:text-accent hover:underline" onClick={() => setSelected(a.ip)}>
                      {a.ip}
                    </button>
                  </td>
                  <td data-label="Tipo">
                    <Badge tone="warn">
                      <TriangleAlert class="size-3" /> {ANOMALY_LABEL[a.code] ?? a.code}
                    </Badge>
                  </td>
                  <td data-label="Dispositivo">{a.name ?? <span class="text-muted">—</span>}</td>
                  <td data-label="Detalhe" class="text-[12.5px]">
                    {a.message}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableCard>
      )}
      <p class="mt-4 text-[12.5px] text-muted">
        A faixa e o DNS do DHCP do Deco só podem ser alterados pelo app; este plano é documentação + verificação. "Em uso" vem da lista de clientes; o Deco
        não expõe a tabela de leases pela API local.
      </p>

      {flow?.kind === "edit" && (
        <DeviceEditor
          mac={flow.mac}
          deviceId={flow.client?.device?.id}
          suggestedName={flow.name && flow.name !== flow.mac ? flow.name : undefined}
          suggestedType={flow.suggestedType}
          vendor={flow.client ? (flow.client.vendorFull ?? (flow.client.randomMac ? null : undefined)) : undefined}
          onClose={() => setFlow(null)}
          onSaved={(saved) => {
            // "Cadastrar e fixar IP": com o tipo salvo, a reserva já abre no IP da faixa certa.
            if (flow.thenReserve && flow.client) {
              const name = saved.alias || flow.client.name;
              setFlow({ kind: "reserve", client: { ...flow.client, name }, presetIp: targetIp(data, cell, saved.type) });
            }
          }}
        />
      )}
      {flow?.kind === "reserve" && (
        <ReservationDialog
          mac={flow.client.mac}
          name={flow.client.device?.alias ?? flow.client.name}
          current={flow.client.reservation?.ip ?? null}
          currentIp={flow.client.online ? flow.client.ip : null}
          presetIp={flow.presetIp}
          onClose={() => setFlow(null)}
        />
      )}
      {flow?.kind === "pick" && (
        <PickClient
          title={`Reservar ${flow.ip} para…`}
          subtitle={`Faixa ${flow.range.name}${flow.range.types.length ? ` · espera ${flow.range.types.map((t) => INVENTORY_TYPE_LABEL[t] ?? t).join(", ")}` : ""}`}
          preferTypes={flow.range.types}
          includeReserved
          onCancel={() => setFlow(null)}
          onPick={(c) => setFlow({ kind: "reserve", client: c, presetIp: flow.ip })}
        />
      )}
      {editing && <RangeForm range={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}
