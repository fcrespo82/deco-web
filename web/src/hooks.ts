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
    const onChange = () => {
      const next = read();
      // Transição entre telas (View Transitions): a página nova é revelada por
      // uma varredura. Sem suporte ou com movimento reduzido, troca direto.
      const doc = document as Document & { startViewTransition?: (cb: () => Promise<void>) => unknown };
      if (!doc.startViewTransition || matchMedia("(prefers-reduced-motion: reduce)").matches) return setRoute(next);
      doc.startViewTransition(
        () =>
          new Promise<void>((resolve) => {
            setRoute(next);
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
          }),
      );
    };
    addEventListener("hashchange", onChange);
    return () => removeEventListener("hashchange", onChange);
  }, []);
  return route;
}

export type ThemePref = "auto" | "light" | "dark";

function readTheme(): ThemePref {
  try {
    const v = localStorage.getItem("theme");
    return v === "light" || v === "auto" ? v : "dark";
  } catch {
    return "dark";
  }
}

export function useTheme(): [ThemePref, () => void] {
  const [theme, setTheme] = useState<ThemePref>(readTheme);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("theme", theme);
    } catch {
      // Sem storage (aba privada): o tema vale só nesta visita.
    }
  }, [theme]);
  const cycle = () => setTheme((t) => (t === "dark" ? "light" : t === "light" ? "auto" : "dark"));
  return [theme, cycle];
}
