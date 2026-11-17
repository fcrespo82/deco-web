import { usePreferences } from "./lib/preferences";
import { formatMacText } from "./lib/mac-format";

/** Texto reativo à preferência local, inclusive em detalhes de eventos. */
export function Mac({ value }: { value: string | null | undefined }) {
  const [prefs] = usePreferences();
  return <>{value ? formatMacText(value, prefs.macFormat) : "—"}</>;
}
