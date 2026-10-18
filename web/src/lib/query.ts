/**
 * Cache de leituras da API, compartilhado entre telas.
 *
 * - Cada leitura tem uma chave e os tópicos do canal ao vivo de que depende;
 *   quando o servidor avisa um tópico, só as leituras ativas dele são relidas.
 * - Trocar de tela mostra na hora o que já estava no cache e relê por baixo.
 * - `setQueryData` muda o cache antes da resposta (interação otimista); uma
 *   leitura que começou antes da mudança é descartada e refeita.
 */
import { useEffect, useReducer, useRef } from "preact/hooks";
import type { LiveTopic } from "../api";

type Listener = () => void;

interface Entry<T = unknown> {
  data: T | undefined;
  error: Error | null;
  fetching: boolean;
  fetcher: () => Promise<T>;
  topics: readonly LiveTopic[];
  /** Componentes montados que usam a leitura. */
  users: number;
  listeners: Set<Listener>;
  /** Muda a cada escrita local; uma leitura antiga não sobrescreve. */
  version: number;
  inFlight: Promise<void> | null;
  again: boolean;
}

const cache = new Map<string, Entry>();

function entryOf<T>(key: string, fetcher: () => Promise<T>, topics: readonly LiveTopic[]): Entry<T> {
  let e = cache.get(key) as Entry<T> | undefined;
  if (!e) {
    e = { data: undefined, error: null, fetching: false, fetcher, topics, users: 0, listeners: new Set(), version: 0, inFlight: null, again: false };
    cache.set(key, e as Entry);
  }
  e.fetcher = fetcher;
  e.topics = topics;
  return e;
}

const emit = (e: Entry) => e.listeners.forEach((l) => l());

function run(e: Entry): Promise<void> {
  if (e.inFlight) {
    // Já lendo: lê de novo depois, para pegar a mudança que motivou o pedido.
    e.again = true;
    return e.inFlight;
  }
  const version = e.version;
  e.fetching = true;
  emit(e);
  e.inFlight = e
    .fetcher()
    .then(
      (data) => {
        if (e.version !== version) {
          e.again = true;
          return;
        }
        e.data = data;
        e.error = null;
      },
      (err: unknown) => {
        e.error = err instanceof Error ? err : new Error(String(err));
      },
    )
    .finally(() => {
      e.inFlight = null;
      e.fetching = false;
      if (e.again) {
        e.again = false;
        void run(e);
      } else emit(e);
    });
  return e.inFlight;
}

/** Relê as leituras ativas que dependem de algum dos tópicos (ou todas). */
export function invalidate(topics?: readonly LiveTopic[]): void {
  for (const e of cache.values()) {
    if (topics && !e.topics.some((t) => topics.includes(t))) continue;
    if (e.users > 0) void run(e);
    else e.version++; // sem ninguém olhando: relê quando alguém montar
  }
}

/** Muda o cache na hora. Devolve a função que desfaz a mudança. */
export function setQueryData<T>(key: string, update: (prev: T) => T): () => void {
  const e = cache.get(key) as Entry<T> | undefined;
  if (!e || e.data === undefined) return () => undefined;
  const before = e.data;
  e.data = update(before);
  e.version++;
  emit(e);
  return () => {
    e.data = before;
    e.version++;
    emit(e);
    void run(e);
  };
}

export function getQueryData<T>(key: string): T | undefined {
  return cache.get(key)?.data as T | undefined;
}

export interface QueryResult<T> {
  data: T | undefined;
  error: Error | null;
  /** Lendo agora (inclusive por baixo de dados já mostrados). */
  fetching: boolean;
  refetch: () => Promise<void>;
}

export function useQuery<T>(key: string, fetcher: () => Promise<T>, topics: readonly LiveTopic[]): QueryResult<T> {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const e = entryOf(key, () => fetcherRef.current(), topics);

  useEffect(() => {
    const entry = entryOf(key, () => fetcherRef.current(), topics);
    entry.users++;
    entry.listeners.add(rerender as Listener);
    void run(entry);
    return () => {
      entry.users--;
      entry.listeners.delete(rerender as Listener);
    };
  }, [key]);

  return { data: e.data, error: e.error, fetching: e.fetching, refetch: () => run(e) };
}
