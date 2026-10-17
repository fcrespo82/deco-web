/**
 * DecoApi contra o roteador real, sobre o cliente copiado do deco-mcp.
 *
 * Cada fetchSnapshot é uma sessão curta: login → leituras em sequência →
 * logout, sempre. O Deco aceita uma única sessão admin; mantê-la aberta
 * expulsaria o app do celular. A serialização entre chamadas e o controle de
 * falhas de login ficam no DecoGateway, não aqui.
 *
 * O Deco é lento (medido num X50: login ~7–10 s, client_list por nó ~2 s
 * cada, logout ~5 s). Para a sessão não ocupar o admin metade do tempo, as
 * leituras são em dois níveis:
 * - rápido, em todo poll: nós, clientes, reservas, internet, WAN;
 * - detalhado, a cada `detailEvery` polls: cliente→nó, Wi-Fi, CPU/memória.
 *   Entre um e outro, o último resultado detalhado é reaproveitado.
 */
import { DecoClient, type DecoRequest } from "./vendor/client.js";
import { DecoLoginError } from "./vendor/errors.js";
import { normalize } from "./vendor/format.js";
import { parseNodes, parseReservations, parseSnapshot } from "./parse.js";
import { applyReservationChanges, type ReservationChange, type ReservationWriteResult } from "./reservations.js";
import type { DecoApi, RawSnapshot, Snapshot } from "./types.js";
import { silentLogger, type Logger } from "../log.js";

export interface LiveDecoOptions {
  host: string;
  username: string;
  password: string;
  timeoutMs?: number;
  /** Faz a leitura detalhada a cada N polls (1 = sempre). */
  detailEvery?: number;
  logger?: Logger;
  /** Substitui o cliente HTTP do Deco (testes). */
  client?: SessionClient;
}

/** O que esta classe usa do DecoClient. */
export type SessionClient = Pick<DecoClient, "call" | "logout">;

type Detail = Pick<RawSnapshot, "clientsByNode" | "wlan" | "performance" | "detailTakenAt">;

export class LiveDecoApi implements DecoApi {
  private readonly client: SessionClient;
  private readonly log: Logger;
  private readonly detailEvery: number;
  private pollsSinceDetail = Infinity;
  private detail: Detail | null = null;

  constructor(opts: LiveDecoOptions) {
    this.log = opts.logger ?? silentLogger;
    this.detailEvery = Math.max(1, opts.detailEvery ?? 5);
    this.client = opts.client ?? new DecoClient({
      host: opts.host,
      username: opts.username,
      password: opts.password,
      timeoutMs: opts.timeoutMs ?? 15_000,
    });
  }

  async fetchSnapshot(): Promise<Snapshot> {
    const started = Date.now();
    try {
      const raw = await this.readRaw();
      return parseSnapshot(raw, new Date());
    } finally {
      await this.client.logout();
      this.log.debug(`sessão Deco encerrada em ${Date.now() - started} ms`);
    }
  }

  /**
   * Uma sessão própria para cada alteração: login → getlist → escrita →
   * getlist → logout. O cliente copiado já nunca reenvia uma escrita após
   * timeout; a verificação fica em applyReservationChange.
   */
  async changeReservation(change: ReservationChange): Promise<ReservationWriteResult> {
    return (await this.changeReservations([change]))[0]!;
  }

  async changeReservations(changes: ReservationChange[]): Promise<ReservationWriteResult[]> {
    const started = Date.now();
    try {
      const results = await applyReservationChanges(
        {
          list: async () => {
            const parsed = parseReservations(
              await this.read({ endpoint: "admin/client", form: "addr_reservation", operation: "getlist" }),
            );
            return { reservations: parsed.list, max: parsed.max };
          },
          // add recebe objetos; remove recebe MACs soltos. A assimetria é do firmware.
          add: (mac, ip) => this.write("add", [{ mac, ip }]),
          remove: (mac) => this.write("remove", [mac]),
        },
        changes,
      );
      results.forEach((r, i) => this.log.info(`reserva ${changes[i]!.op} ${changes[i]!.mac}: ${r.outcome}`));
      return results;
    } finally {
      await this.client.logout();
      this.log.debug(`sessão Deco (escrita) encerrada em ${Date.now() - started} ms`);
    }
  }

  private async write(operation: "add" | "remove", list: unknown[]): Promise<void> {
    const started = Date.now();
    try {
      await this.client.call({
        endpoint: "admin/client",
        form: "addr_reservation",
        operation,
        params: { reservation_list: list },
      });
    } finally {
      this.log.debug(`deco addr_reservation ${operation}: ${Date.now() - started} ms`);
    }
  }

  /** Leitura redigida: nenhuma senha/PSK sai do cliente, nem para o parser. */
  private async read(request: DecoRequest): Promise<unknown> {
    const started = Date.now();
    try {
      return normalize(await this.client.call(request), false);
    } finally {
      this.log.debug(`deco ${request.endpoint}?form=${request.form}: ${Date.now() - started} ms`);
    }
  }

  /** Leituras opcionais: uma falha vira undefined e o snapshot segue. */
  private async optional(request: DecoRequest): Promise<unknown> {
    try {
      return await this.read(request);
    } catch (err) {
      if (err instanceof DecoLoginError) throw err;
      return undefined;
    }
  }

  private async readRaw(): Promise<RawSnapshot> {
    const deviceList = await this.read({
      endpoint: "admin/device",
      form: "device_list",
      operation: "read",
    });
    const clientList = await this.read({
      endpoint: "admin/client",
      form: "client_list",
      operation: "read",
      params: { device_mac: "default" },
    });
    const reservations = await this.read({
      endpoint: "admin/client",
      form: "addr_reservation",
      operation: "getlist",
    });
    const internet = await this.optional({ endpoint: "admin/network", form: "internet", operation: "read" });
    const wan = await this.optional({ endpoint: "admin/network", form: "wan_ipv4", operation: "read" });

    this.pollsSinceDetail += 1;
    if (this.pollsSinceDetail >= this.detailEvery || !this.detail) {
      this.detail = await this.readDetail(deviceList);
      this.pollsSinceDetail = 0;
    }

    return { deviceList, clientList, reservations, internet, wan, ...this.detail };
  }

  private async readDetail(deviceList: unknown): Promise<Detail> {
    // client_list "default" não diz em que nó cada cliente está; a lista por
    // nó diz. Uma chamada por nó.
    const clientsByNode: Record<string, unknown> = {};
    for (const node of parseNodes(deviceList)) {
      const perNode = await this.optional({
        endpoint: "admin/client",
        form: "client_list",
        operation: "read",
        params: { device_mac: node.mac },
      });
      if (perNode !== undefined) clientsByNode[node.mac] = perNode;
    }
    return {
      clientsByNode,
      wlan: await this.optional({ endpoint: "admin/wireless", form: "wlan", operation: "read" }),
      performance: await this.optional({
        endpoint: "admin/network",
        form: "performance",
        operation: "read",
      }),
      detailTakenAt: new Date().toISOString(),
    };
  }
}
