/**
 * Ficha de um cliente, aberta do mapa, da galeria ou das bolhas. Lê o cliente
 * do cache pelo MAC, então acompanha as atualizações ao vivo enquanto aberta.
 * Editar no inventário e fixar IP trocam a ficha pelo diálogo respectivo.
 */
import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { ArrowDown, ArrowUp, Lock, Pencil } from "lucide-preact";
import type { ClientView } from "./api";
import { CATEGORY, categoryOf, DeviceArt } from "./art/devices";
import { useClients, useImages, useStatus } from "./data";
import { removeImage, UploadButton } from "./ImageDialogs";
import { DeviceEditor } from "./DeviceEditor";
import { BAND_LABEL, INVENTORY_TYPE_LABEL, NETWORK_LABEL, ago, dateTime, deviceType, rate } from "./format";
import { usePendingReservations } from "./lib/reservation-write";
import { PendingReservationBadge, ReservationDialog } from "./ReservationDialog";
import { Badge, Button, Dialog, Kv } from "./ui";

export const clientLabel = (c: ClientView) => c.device?.alias ?? c.name;

/** Barra de taxa em escala logarítmica (1 KB/s … 10 MB/s). */
export function RateBar({ kBps, tone }: { kBps: number; tone: "down" | "up" }) {
  const ratio = kBps <= 0 ? 0 : Math.min(1, Math.log10(1 + kBps) / 4);
  return (
    <span class="block h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
      <span
        class="block h-full rounded-full transition-[width] duration-700"
        style={{ width: `${ratio * 100}%`, background: tone === "down" ? "var(--flow-down)" : "var(--flow-up)" }}
      />
    </span>
  );
}

export function ClientSheet({ mac, onClose }: { mac: string; onClose: () => void }) {
  const { data } = useClients();
  const images = useImages();
  const pending = usePendingReservations();
  const status = useStatus();
  const [mode, setMode] = useState<"view" | "edit" | "reserve">("view");
  const c = data?.clients.find((x) => x.mac === mac);
  if (!c) return null;

  if (mode === "edit") {
    return (
      <DeviceEditor
        mac={c.mac}
        suggestedName={c.name !== c.mac ? c.name : undefined}
        suggestedType={c.suggestedType ?? undefined}
        vendor={c.vendorFull ?? (c.randomMac ? null : undefined)}
        onClose={onClose}
      />
    );
  }
  if (mode === "reserve") {
    return <ReservationDialog mac={c.mac} name={clientLabel(c)} current={c.reservation?.ip ?? null} currentIp={c.online ? c.ip : null} onClose={onClose} />;
  }

  const cat = categoryOf(c);
  const allowWrite = (status ?? data!.status).mode.allowWrite;
  const kind = c.device?.type ? INVENTORY_TYPE_LABEL[c.device.type] : (deviceType(c.deviceType) ?? CATEGORY[cat].label);

  return (
    <Dialog
      title={
        <span class="flex items-center gap-4">
          <DeviceArt category={cat} size="lg" online={c.online} vendor={c.vendor} deviceId={c.device?.id} />
          <span class="min-w-0">
            <span class="block truncate">{clientLabel(c)}</span>
            <span class="mt-0.5 flex flex-wrap items-center gap-1.5 text-[12.5px] font-normal text-muted">
              <Badge tone={c.online ? "ok" : ""}>{c.online ? "online" : "offline"}</Badge>
              {kind}
              {(c.vendor || c.randomMac) && <span>· {c.vendor ?? "MAC privado"}</span>}
            </span>
          </span>
        </span>
      }
      onClose={onClose}
      footer={
        <>
          <Button icon={<Pencil class="size-4" />} onClick={() => setMode("edit")}>
            {c.device ? "Editar no inventário" : "Cadastrar no inventário"}
          </Button>
          {allowWrite && (c.online || c.reservation) && (
            <Button icon={<Lock class="size-4" />} onClick={() => setMode("reserve")} disabled={pending.has(c.mac)}>
              {c.reservation ? "Mudar reserva" : "Fixar IP"}
            </Button>
          )}
          {c.device && (
            <>
              <UploadButton kind="devices" name={String(c.device.id)} label={clientLabel(c)} square size="md">
                {images.data?.devices[String(c.device.id)] ? "Trocar foto" : "Foto"}
              </UploadButton>
              {images.data?.devices[String(c.device.id)] && (
                <Button variant="ghost" onClick={() => removeImage("devices", String(c.device!.id), clientLabel(c))}>
                  Tirar foto
                </Button>
              )}
            </>
          )}
          <span class="flex-1" />
          <Button variant="ghost" onClick={onClose}>
            Fechar
          </Button>
        </>
      }
    >
      {c.online && (
        <div class="mb-4 grid grid-cols-2 gap-3">
          {(["down", "up"] as const).map((dir) => {
            const v = dir === "down" ? c.downKBps : c.upKBps;
            return (
              <div class="rounded-xl bg-surface-2/70 p-3">
                <div class="flex items-center gap-1.5 text-[12px] text-muted">
                  {dir === "down" ? <ArrowDown class="size-3.5" /> : <ArrowUp class="size-3.5" />}
                  {dir === "down" ? "Recebendo" : "Enviando"}
                </div>
                <div class="my-1 text-[20px] font-semibold tabular-nums">{rate(v)}</div>
                <RateBar kBps={v} tone={dir} />
              </div>
            );
          })}
        </div>
      )}
      <Kv
        items={[
          ["IP", c.ip ?? c.reservation?.ip ?? "—", "font-mono text-[12.5px]"],
          ["MAC", c.mac, "font-mono text-[12.5px]"],
          [
            "Reserva",
            pending.has(c.mac) ? (
              <span class="flex flex-wrap items-center gap-1.5">
                {c.reservation && <span class="font-mono text-[12.5px]">{c.reservation.ip}</span>}
                <PendingReservationBadge mac={c.mac} />
              </span>
            ) : c.reservation ? (
              <Badge tone={c.reservation.matchesCurrentIp === false ? "warn" : "ok"}>
                <Lock class="size-3" /> {c.reservation.ip}
                {c.reservation.matchesCurrentIp === false && " (aguardando renovação)"}
              </Badge>
            ) : (
              "—"
            ),
          ],
          ["Conectado a", c.nodeName ?? "—"],
          ["Banda", c.band ? BAND_LABEL[c.band] : "—"],
          ["Rede", c.network ? (NETWORK_LABEL[c.network] ?? c.network) : "—"],
          ...(c.device?.owner ? ([["Dono", c.device.owner]] as [string, string][]) : []),
          ...(c.device && c.device.tags.length
            ? ([
                [
                  "Tags",
                  <span class="flex flex-wrap gap-1">
                    {c.device.tags.map((t) => (
                      <Badge>{t}</Badge>
                    ))}
                  </span>,
                ],
              ] as [string, ComponentChildren][])
            : []),
          ["Fabricante", c.vendorFull ?? (c.randomMac ? "MAC privado/aleatório" : "—"), "text-[12.5px]"],
          ["Primeira vez", <span title={dateTime(c.firstSeen)}>{ago(c.firstSeen)}</span>],
          ["Última vez", c.online ? "agora" : <span title={dateTime(c.lastSeen)}>{ago(c.lastSeen)}</span>],
        ]}
      />
    </Dialog>
  );
}
