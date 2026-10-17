/**
 * Alertas a partir dos eventos de cada snapshot:
 * - dispositivo novo: MAC nunca visto e não aprovado no inventário;
 * - nó offline há mais de N minutos (e aviso quando volta);
 * - internet fora há mais de N minutos (e aviso quando volta — que chega
 *   mesmo quando o de queda não chegou, por falta de internet).
 *
 * O primeiro snapshot da vida do painel é a linha de base: todos os aparelhos
 * ali são "novos" para o detector, mas não geram alerta — a aprovação em massa
 * fica na tela de Alertas.
 *
 * Quedas em andamento ficam no SQLite (kv), para um restart não repetir nem
 * perder um alerta. Cada alerta é enviado uma vez; falhas ficam registradas.
 */
import type { Snapshot } from "../deco-client/types.js";
import type { AlertEntry, AlertKind, AlertRepo } from "../db/alerts.js";
import type { Logger } from "../log.js";
import { broadcast, type Channel, type Notification } from "../notify/channels.js";
import type { NetEvent } from "./events.js";

const STATE_KEY = "alert_state";
/** Acima disso, os dispositivos novos de um mesmo poll vão num alerta só. */
const MAX_INDIVIDUAL = 5;

interface Outage {
  since: string;
  name: string;
  alerted: boolean;
}

interface AlertState {
  nodes: Record<string, Outage>;
  internet: Outage | null;
}

export interface AlertSettings {
  newDevice: boolean;
  nodeOfflineMs: number | null;
  internetDownMs: number | null;
  publicUrl: string | null;
}

export interface AlertEngineOptions {
  settings: AlertSettings;
  channels: Channel[];
  repo: AlertRepo;
  kv: { getJson<T>(key: string): T | null; setJson(key: string, value: unknown): void };
  /** MAC pertence a um dispositivo aprovado no inventário. */
  isApproved: (mac: string) => boolean;
  /** Apelido do inventário, se houver. */
  aliasOf: (mac: string) => string | null;
  logger: Logger;
  now?: () => Date;
}

export function formatDuration(ms: number): string {
  const min = Math.max(1, Math.round(ms / 60_000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const rest = min % 60;
  if (h < 24) return rest ? `${h} h ${rest} min` : `${h} h`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d} d ${h % 24} h` : `${d} d`;
}

export class AlertEngine {
  private state: AlertState;
  private chain: Promise<unknown> = Promise.resolve();
  private readonly now: () => Date;

  constructor(private readonly opts: AlertEngineOptions) {
    this.now = opts.now ?? (() => new Date());
    this.state = opts.kv.getJson<AlertState>(STATE_KEY) ?? { nodes: {}, internet: null };
  }

  get channels(): Channel[] {
    return this.opts.channels;
  }

  /**
   * Processa os eventos de um snapshot. As chamadas são encadeadas (uma por
   * vez); o poller não espera por elas.
   */
  process(events: NetEvent[], snap: Snapshot, previous: Snapshot | null): Promise<AlertEntry[]> {
    const run = this.chain.then(() => this.handle(events, snap, previous));
    this.chain = run.catch((err) => this.opts.logger.error(`alertas: ${(err as Error).message}`));
    return run;
  }

  /** Espera os envios em andamento (encerramento). */
  idle(): Promise<unknown> {
    return this.chain;
  }

  /** Alerta de teste, pela UI. */
  test(): Promise<AlertEntry> {
    const run = this.chain.then(() =>
      this.emit("test", null, {
        title: "Deco Dashboard: teste",
        body: "Se você recebeu isto, as notificações estão funcionando.",
        priority: 3,
        tags: ["white_check_mark"],
        url: this.link(""),
      }),
    );
    this.chain = run.catch(() => undefined);
    return run;
  }

  private link(route: string): string | null {
    return this.opts.settings.publicUrl ? `${this.opts.settings.publicUrl}/#/${route}` : null;
  }

  private async emit(kind: AlertKind, mac: string | null, n: Notification): Promise<AlertEntry> {
    const delivery = await broadcast(this.opts.channels, n);
    for (const d of delivery) {
      if (!d.ok) this.opts.logger.warn(`alerta "${n.title}" não enviado por ${d.channel}: ${d.error}`);
    }
    return this.opts.repo.insert({ at: this.now().toISOString(), kind, mac, title: n.title, body: n.body, delivery });
  }

  private async handle(events: NetEvent[], snap: Snapshot, previous: Snapshot | null): Promise<AlertEntry[]> {
    const { settings } = this.opts;
    const out: AlertEntry[] = [];
    const before = JSON.stringify(this.state);
    const nodeName = (mac: string | null) => (mac ? (snap.nodes.find((n) => n.mac === mac)?.name ?? null) : null);

    // --- dispositivos novos ---
    if (settings.newDevice && previous !== null) {
      const fresh = events.filter((e) => e.type === "client_new" && e.mac && !this.opts.isApproved(e.mac));
      const describe = (e: NetEvent) => {
        const client = snap.clients.find((c) => c.mac === e.mac);
        const name = this.opts.aliasOf(e.mac!) ?? (typeof e.data.name === "string" ? e.data.name : e.mac!);
        return { name, line: [client?.ip ?? e.data.ip, e.mac, nodeName(client?.nodeMac ?? null)].filter(Boolean).join(" · ") };
      };
      if (fresh.length > MAX_INDIVIDUAL) {
        const items = fresh.map(describe);
        out.push(
          await this.emit("new_device", null, {
            title: `${fresh.length} dispositivos novos na rede`,
            body: items.slice(0, 10).map((i) => `${i.name} (${i.line})`).join("\n") + (items.length > 10 ? `\n… e mais ${items.length - 10}` : ""),
            priority: 4,
            tags: ["new"],
            url: this.link("alertas"),
          }),
        );
      } else {
        for (const e of fresh) {
          const { name, line } = describe(e);
          out.push(
            await this.emit("new_device", e.mac, {
              title: `Dispositivo novo: ${name}`,
              body: `${line}\nAprove na tela de Alertas se for conhecido.`,
              priority: 4,
              tags: ["new"],
              url: this.link("alertas"),
            }),
          );
        }
      }
    }

    // --- quedas: abre e fecha pelos eventos ---
    const at = this.now().getTime();
    for (const e of events) {
      if (e.type === "node_offline" && settings.nodeOfflineMs !== null && e.mac) {
        this.state.nodes[e.mac] ??= { since: e.at, name: String(e.data.name ?? e.mac), alerted: false };
      } else if (e.type === "node_online" && e.mac) {
        const o = this.state.nodes[e.mac];
        delete this.state.nodes[e.mac];
        if (o?.alerted) {
          out.push(
            await this.emit("node_online", e.mac, {
              title: `Nó ${o.name} voltou`,
              body: `Ficou fora por ${formatDuration(Date.parse(e.at) - Date.parse(o.since))}.`,
              priority: 3,
              tags: ["white_check_mark"],
              url: this.link(""),
            }),
          );
        }
      } else if (e.type === "internet_down" && settings.internetDownMs !== null) {
        this.state.internet ??= { since: e.at, name: "internet", alerted: false };
      } else if (e.type === "internet_up") {
        const o = this.state.internet;
        this.state.internet = null;
        // O alerta de queda só chega se o canal funcionar sem internet (ntfy
        // na LAN). Por isso a volta é avisada sempre que a queda passou do
        // limite, mesmo que o alerta de queda tenha falhado.
        const down = o ? Date.parse(e.at) - Date.parse(o.since) : 0;
        if (o && (o.alerted || (settings.internetDownMs !== null && down >= settings.internetDownMs))) {
          out.push(
            await this.emit("internet_up", null, {
              title: "Internet voltou",
              body: `Ficou fora por ${formatDuration(down)}, desde ${new Date(o.since).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}.`,
              priority: 3,
              tags: ["white_check_mark"],
              url: this.link(""),
            }),
          );
        }
      }
    }

    // --- quedas: alerta ao passar do limite ---
    for (const [mac, o] of Object.entries(this.state.nodes)) {
      const node = snap.nodes.find((n) => n.mac === mac);
      if (node?.online) {
        // Voltou sem evento (ex.: entre restarts): encerra em silêncio se não alertou.
        delete this.state.nodes[mac];
        continue;
      }
      if (!o.alerted && settings.nodeOfflineMs !== null && at - Date.parse(o.since) >= settings.nodeOfflineMs) {
        o.alerted = true;
        out.push(
          await this.emit("node_offline", mac, {
            title: `Nó ${o.name} offline`,
            body: `Sem resposta há ${formatDuration(at - Date.parse(o.since))}. Os aparelhos ligados a ele podem estar sem rede.`,
            priority: 5,
            tags: ["warning"],
            url: this.link(""),
          }),
        );
      }
    }
    const net = this.state.internet;
    if (net && snap.internet?.ipv4Online) {
      this.state.internet = null;
    } else if (net && !net.alerted && settings.internetDownMs !== null && at - Date.parse(net.since) >= settings.internetDownMs) {
      net.alerted = true;
      out.push(
        await this.emit("internet_down", null, {
          title: "Internet fora do ar",
          body: `O Deco está sem internet há ${formatDuration(at - Date.parse(net.since))}.`,
          priority: 5,
          tags: ["warning"],
          url: this.link(""),
        }),
      );
    }

    if (JSON.stringify(this.state) !== before) this.opts.kv.setJson(STATE_KEY, this.state);
    return out;
  }
}
