/** Peças comuns dos diálogos que escrevem no Deco (reservas, reinício, Wi-Fi). */
import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import { ApiError } from "./api";
import { Spinner } from "./ui";

export type Step = "choose" | "edit" | "confirm" | "working" | "done";

/** Tom do resultado de uma escrita, pelo `outcome` que o servidor devolve. */
export const OUTCOME_TONE: Record<string, "ok" | "warn" | "bad"> = {
  sent: "ok",
  applied: "ok",
  noop: "ok",
  conflict: "warn",
  rejected: "warn",
  "rolled-back": "warn",
  unverified: "bad",
  ambiguous: "bad",
  lost: "bad",
};

/** Segundos desde que a etapa "working" começou. */
export function useElapsed(step: Step): number {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (step !== "working") return;
    setElapsed(0);
    const started = Date.now();
    const id = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(id);
  }, [step]);
  return elapsed;
}

/** Pega o resultado de uma escrita que o servidor devolveu com status de erro. */
export function resultOf<T extends { outcome: string }>(e: unknown): T | null {
  const body = e instanceof ApiError ? (e.body as Partial<T> | undefined) : undefined;
  return body?.outcome ? (body as T) : null;
}

export function WorkingNote({ children }: { children: ComponentChildren }) {
  return (
    <span class="inline-flex items-center gap-2 text-[12.5px] text-muted" role="status">
      <Spinner class="text-accent" />
      {children}
    </span>
  );
}
