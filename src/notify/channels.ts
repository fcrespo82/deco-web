/**
 * Canais de notificação: ntfy e Telegram.
 *
 * Cada envio é uma única tentativa com timeout. Falhou, fica registrado no
 * log de alertas e no log do servidor; não há fila de reenvio. Tokens nunca
 * aparecem em mensagens de erro.
 */

export interface Notification {
  title: string;
  body: string;
  /** 1 (mínima) a 5 (urgente), na escala do ntfy. */
  priority?: 1 | 2 | 3 | 4 | 5;
  /** Tags/emoji do ntfy, ex.: "warning", "new". */
  tags?: string[];
  /** Link aberto ao tocar na notificação. */
  url?: string | null;
}

export interface Channel {
  /** "ntfy" | "telegram" */
  readonly name: string;
  /** Descrição sem segredos, para a UI. */
  readonly target: string;
  send(n: Notification): Promise<void>;
}

export interface ChannelOptions {
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export class ChannelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChannelError";
  }
}

/**
 * Remove segredos de um texto de erro. Valores muito curtos são ignorados:
 * censurar "t" estragaria a mensagem sem proteger nada.
 */
function scrub(text: string, secrets: (string | null)[]): string {
  let out = text;
  for (const s of secrets) if (s && s.length >= 6) out = out.split(s).join("***");
  return out;
}

async function post(
  url: string,
  body: unknown,
  headers: Record<string, string>,
  opts: ChannelOptions,
  secrets: (string | null)[],
): Promise<void> {
  const doFetch = opts.fetch ?? fetch;
  let res: Response;
  try {
    res = await doFetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
    });
  } catch (err) {
    const e = err as Error & { cause?: { code?: string; message?: string } };
    const detail = e.name === "TimeoutError" ? "tempo esgotado" : (e.cause?.code ?? e.cause?.message ?? e.message);
    throw new ChannelError(scrub(`falha de rede: ${detail}`, secrets));
  }
  if (!res.ok) {
    const text = (await res.text().catch(() => "")).slice(0, 200);
    throw new ChannelError(scrub(`HTTP ${res.status}${text ? `: ${text}` : ""}`, secrets));
  }
}

/** ntfy: publicação em JSON (aceita UTF-8 no título, ao contrário dos headers). */
export class NtfyChannel implements Channel {
  readonly name = "ntfy";
  readonly target: string;
  private readonly server: string;
  private readonly topic: string;

  constructor(
    topicUrl: string,
    private readonly token: string | null,
    private readonly opts: ChannelOptions = {},
  ) {
    const url = new URL(topicUrl);
    const parts = url.pathname.split("/").filter(Boolean);
    this.topic = decodeURIComponent(parts.pop() ?? "");
    url.pathname = parts.length ? `/${parts.join("/")}/` : "/";
    this.server = url.toString();
    // O tópico funciona como senha num servidor público: a UI não o mostra.
    this.target = `${url.host} (tópico configurado)`;
  }

  send(n: Notification): Promise<void> {
    return post(
      this.server,
      {
        topic: this.topic,
        title: n.title,
        message: n.body,
        priority: n.priority ?? 3,
        tags: n.tags ?? [],
        ...(n.url ? { click: n.url } : {}),
      },
      this.token ? { authorization: `Bearer ${this.token}` } : {},
      this.opts,
      [this.token, this.topic],
    );
  }
}

export class TelegramChannel implements Channel {
  readonly name = "telegram";
  readonly target: string;

  constructor(
    private readonly api: string,
    private readonly token: string,
    private readonly chatId: string,
    private readonly opts: ChannelOptions = {},
  ) {
    this.target = `chat ${chatId}`;
  }

  send(n: Notification): Promise<void> {
    const text = [n.title, n.body, n.url].filter(Boolean).join("\n");
    return post(
      `${this.api}/bot${this.token}/sendMessage`,
      { chat_id: this.chatId, text, disable_web_page_preview: true },
      {},
      this.opts,
      [this.token],
    );
  }
}

export interface Delivery {
  channel: string;
  ok: boolean;
  error?: string;
}

/** Envia para todos os canais em paralelo; nunca lança. */
export async function broadcast(channels: Channel[], n: Notification): Promise<Delivery[]> {
  const results = await Promise.allSettled(channels.map((c) => c.send(n)));
  return results.map((r, i) =>
    r.status === "fulfilled"
      ? { channel: channels[i]!.name, ok: true }
      : { channel: channels[i]!.name, ok: false, error: (r.reason as Error).message },
  );
}
