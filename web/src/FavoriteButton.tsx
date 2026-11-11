import { useState } from "preact/hooks";
import { api, type DeviceSummary, type ClientView, type InventoryView } from "./api";
import { KEYS } from "./data";
import { mutate } from "./lib/mutate";
import { setQueryData } from "./lib/query";
import { Button, type ButtonSize } from "./ui";
export function FavoriteButton({ device, onRegister, size = "md" }: { device: DeviceSummary | null; onRegister?: () => void; size?: ButtonSize }) {
  const [busy, setBusy] = useState(false);
  const toggle = async () => {
    if (!device) { onRegister?.(); return; }
    setBusy(true);
    const favorite = !device.favorite;
    await mutate({
      optimistic: () => [
        setQueryData<InventoryView>(KEYS.inventory, d => ({...d, devices:d.devices.map(x=>x.id===device.id?{...x,favorite}:x)})),
        setQueryData<{status:unknown;clients:ClientView[]}>(KEYS.clients, d=>({...d,clients:d.clients.map(c=>c.device?.id===device.id?{...c,device:{...c.device,favorite}}:c)})),
      ],
      run: () => api.updateDevice(device.id,{favorite}), invalidates:["inventory"],
    });
    setBusy(false);
  };
  return <Button size={size} disabled={busy} onClick={toggle} aria-pressed={device?.favorite ?? false}>
    {device?.favorite ? "★ Favorito" : device ? "☆ Favoritar" : "☆ Cadastrar para favoritar"}
  </Button>;
}
