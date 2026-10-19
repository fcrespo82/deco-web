/**
 * Estado de interface compartilhado entre telas: ficha de cliente aberta, nó
 * selecionado no mapa, paleta de comandos e diálogo de reinício. Assim a
 * paleta (ou qualquer tela) abre a mesma ficha sem passar props.
 */
import { useEffect, useState } from "preact/hooks";

export interface UiState {
  client: string | null;
  node: string | null;
  palette: boolean;
  shortcuts: boolean;
  reboot: string | null;
}

let state: UiState = { client: null, node: null, palette: false, shortcuts: false, reboot: null };
const listeners = new Set<() => void>();

export function setUi(patch: Partial<UiState>) {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

export const openClient = (mac: string | null) => setUi({ client: mac });
export const selectNode = (mac: string | null) => setUi({ node: mac });

export function useUi(): UiState {
  const [, tick] = useState(0);
  useEffect(() => {
    const l = () => tick((n) => n + 1);
    listeners.add(l);
    return () => listeners.delete(l);
  }, []);
  return state;
}
