import { useEffect, useState } from "preact/hooks";

/** Força re-render periódico para textos relativos ("há 2 min"). */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** Rota a partir do hash: "#/clientes" → "clientes". */
export function useRoute(): string {
  const read = () => location.hash.replace(/^#\/?/, "").split("?")[0] || "";
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const onChange = () => setRoute(read());
    addEventListener("hashchange", onChange);
    return () => removeEventListener("hashchange", onChange);
  }, []);
  return route;
}

export { type ThemePref } from "./lib/preferences";
export { usePreferences } from "./lib/preferences";
