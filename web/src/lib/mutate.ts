/**
 * Escrita local (inventário, plano de IPs, aprovação) com resposta otimista:
 * aplica a mudança no cache, chama a API e, se falhar, desfaz e avisa.
 * Escritas no Deco (reservas, reinício, Wi-Fi) não passam por aqui: elas
 * levam dezenas de segundos e o resultado pode ser incerto, então os diálogos
 * delas esperam a resposta.
 */
import { ApiError, type LiveTopic } from "../api";
import { invalidate } from "./query";
import { toast } from "./toast";

interface Options<T> {
  /** Aplica a mudança no cache; devolve as funções que a desfazem. */
  optimistic?: () => (() => void)[];
  run: () => Promise<T>;
  /** Aviso de sucesso (omitido: nenhum). */
  success?: string | ((result: T) => string);
  /** Tópicos para reler já, sem esperar o canal ao vivo. */
  invalidates?: LiveTopic[];
  /** Prefixo do aviso de erro. */
  failure?: string;
}

export const errorText = (err: unknown, fallback = "Falha ao salvar.") =>
  err instanceof ApiError || err instanceof Error ? err.message : fallback;

export async function mutate<T>(opts: Options<T>): Promise<T | null> {
  const undo = opts.optimistic?.() ?? [];
  try {
    const result = await opts.run();
    if (opts.success) toast(typeof opts.success === "function" ? opts.success(result) : opts.success);
    if (opts.invalidates) invalidate(opts.invalidates);
    return result;
  } catch (err) {
    for (const u of undo.reverse()) u();
    toast(opts.failure ?? "Não foi possível salvar", { tone: "bad", detail: errorText(err) });
    return null;
  }
}
