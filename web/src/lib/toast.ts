/** Avisos curtos no canto da tela (salvo, falhou, enviado…). */
import { useEffect, useState } from "preact/hooks";

export type ToastTone = "ok" | "bad" | "info";

export interface Toast {
  id: number;
  tone: ToastTone;
  text: string;
  detail?: string;
}

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<(t: Toast[]) => void>();
const publish = () => listeners.forEach((l) => l(toasts));

export function dismiss(id: number): void {
  toasts = toasts.filter((t) => t.id !== id);
  publish();
}

export function toast(text: string, opts: { tone?: ToastTone; detail?: string; ms?: number } = {}): number {
  const id = nextId++;
  toasts = [...toasts.slice(-3), { id, tone: opts.tone ?? "ok", text, detail: opts.detail }];
  publish();
  setTimeout(() => dismiss(id), opts.ms ?? (opts.tone === "bad" ? 7000 : 3500));
  return id;
}

export function useToasts(): Toast[] {
  const [list, setList] = useState(toasts);
  useEffect(() => {
    listeners.add(setList);
    return () => void listeners.delete(setList);
  }, []);
  return list;
}
