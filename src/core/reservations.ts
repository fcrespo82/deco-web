/**
 * Reservas de DHCP: validação, permissão, auditoria e sugestão de IP.
 *
 * A única porta de escrita no Deco. Antes de chegar nele:
 * - exige DECO_ALLOW_WRITE=1;
 * - valida o pedido contra o cache (IP na LAN, não é gateway/nó/rede, não
 *   está reservado nem em uso por outro aparelho), para recusar cedo e sem
 *   abrir sessão;
 * - passa pela fila + breaker do gateway, onde a escrita é reconferida contra
 *   a lista fresca e verificada depois (deco-client/reservations.ts).
 * Toda tentativa que chega ao Deco vai para a auditoria, com o resultado.
 */
import type { ReservationChange, ReservationWriteResult } from "../deco-client/reservations.js";
import type { Snapshot } from "../deco-client/types.js";
import type { AuditRepo } from "../db/audit.js";
import { requireMac, ValidationError } from "../db/errors.js";
import type { Logger } from "../log.js";
import type { IpPlan } from "../server/api-types.js";
import type { DecoGateway } from "./gateway.js";
import { inSubnet, intToIp, ipToInt } from "./ipmath.js";
import { lanSubnet } from "./ipplan.js";
import type { Poller } from "./poller.js";

export type { ReservationChange, ReservationWriteResult };

export class WriteDisabledError extends Error {
  constructor() {
    super("Escrita desabilitada. Inicie o painel com DECO_ALLOW_WRITE=1 para alterar o Deco.");
    this.name = "WriteDisabledError";
  }
}

/** Pedido recusado pelo estado atual (IP ocupado etc.); a API responde 409. */
export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
  }
}

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function requireIp(value: unknown): string {
  const text = typeof value === "string" ? value.trim() : "";
  const m = IPV4.exec(text);
  if (!m || m.slice(1).some((o) => Number(o) > 255)) throw new ValidationError(`IP inválido: ${String(value)}`);
  return m.slice(1).map(Number).join(".");
}

/**
 * Confere um IP para reserva contra o snapshot. Lança ValidationError
 * (pedido malformado) ou ConflictError (endereço ocupado).
 */
export function checkReservationIp(snapshot: Snapshot | null, mac: string, rawIp: unknown): string {
  const ip = requireIp(rawIp);
  const lan = lanSubnet(snapshot);
  if (!snapshot || !lan) throw new ValidationError("Ainda sem dados do Deco para saber a rede.");
  const { subnet, gateway } = lan;
  const n = ipToInt(ip);
  if (!inSubnet(n, subnet)) throw new ValidationError(`${ip} está fora da rede ${intToIp(subnet.base)}/${subnet.prefix}.`);
  if (n === subnet.base || n === subnet.base + subnet.size - 1) {
    throw new ValidationError(`${ip} é o endereço de rede ou de broadcast.`);
  }
  if (ip === gateway) throw new ConflictError(`${ip} é o próprio Deco principal.`);
  const node = snapshot.nodes.find((x) => x.ip === ip);
  if (node) throw new ConflictError(`${ip} é o nó "${node.name}".`);
  const reserved = snapshot.reservations.find((r) => r.ip === ip && r.mac !== mac);
  if (reserved) throw new ConflictError(`${ip} já está reservado para ${reserved.mac}.`);
  const user = snapshot.clients.find((c) => c.ip === ip && c.mac !== mac);
  if (user) throw new ConflictError(`${ip} está em uso por "${user.name}" (${user.mac}).`);
  return ip;
}

export interface IpSuggestion {
  ip: string;
  rangeId: number | null;
  rangeName: string | null;
  /** A faixa espera este tipo de dispositivo. */
  matchesType: boolean;
}

/**
 * IPs sugeridos para fixar um aparelho, do mais ao menos indicado:
 * 1. faixas fixas que esperam o tipo do aparelho;
 * 2. faixas fixas sem tipo definido;
 * 3. demais faixas fixas.
 * Faixas dinâmicas (pool do DHCP) ficam de fora. Sem nenhuma faixa fixa,
 * sugere o primeiro IP livre fora das faixas dinâmicas.
 */
export function suggestReservationIps(plan: IpPlan, deviceType: string | null): IpSuggestion[] {
  const statics = plan.ranges.filter((r) => r.kind === "static" && r.suggestion);
  const rank = (types: string[]) => (deviceType && types.includes(deviceType) ? 0 : types.length === 0 ? 1 : 2);
  const out: IpSuggestion[] = [...statics]
    .sort((a, b) => rank(a.types) - rank(b.types) || a.start - b.start)
    .map((r) => ({
      ip: r.suggestion!,
      rangeId: r.id,
      rangeName: r.name,
      matchesType: Boolean(deviceType && r.types.includes(deviceType)),
    }));
  if (out.length === 0) {
    const dynamicIds = new Set(plan.ranges.filter((r) => r.kind === "dynamic").map((r) => r.id));
    const free = plan.cells.find((c) => c.status === "free" && !(c.rangeId && dynamicIds.has(c.rangeId)));
    if (free) out.push({ ip: free.ip, rangeId: free.rangeId, rangeName: null, matchesType: false });
  }
  return out;
}

export interface ReservationServiceOptions {
  allowWrite: boolean;
  gateway: DecoGateway;
  poller: Poller;
  audit: AuditRepo;
  logger: Logger;
}

const ACTION: Record<ReservationChange["op"], string> = {
  add: "reservation.add",
  remove: "reservation.remove",
  move: "reservation.move",
};

export class ReservationService {
  constructor(private readonly opts: ReservationServiceOptions) {}

  get allowWrite(): boolean {
    return this.opts.allowWrite;
  }

  /** Valida o pedido cru da API e monta a mudança. */
  prepare(op: ReservationChange["op"], rawMac: unknown, rawIp?: unknown): ReservationChange {
    if (!this.opts.allowWrite) throw new WriteDisabledError();
    const mac = requireMac(rawMac);
    const snapshot = this.opts.poller.cache.snapshot;
    const current = snapshot?.reservations.find((r) => r.mac === mac) ?? null;
    if (op === "remove") {
      if (!current) throw new ConflictError("Este MAC não tem reserva.");
      return { op, mac };
    }
    const ip = checkReservationIp(snapshot, mac, rawIp);
    if (op === "add" && current) throw new ConflictError(`Este MAC já tem reserva em ${current.ip}; altere a existente.`);
    if (op === "move" && !current) throw new ConflictError("Este MAC não tem reserva para alterar.");
    if (current?.ip === ip) throw new ConflictError(`Já reservado em ${ip}.`);
    return { op, mac, ip };
  }

  /**
   * Lote (importação de backup): uma sessão, cada mudança auditada. Sem
   * pré-validação pelo cache — o diff já classificou; a lista fresca no Deco
   * decide conflitos.
   */
  async applyBatch(changes: ReservationChange[], actor: string): Promise<ReservationWriteResult[]> {
    if (!this.opts.allowWrite) throw new WriteDisabledError();
    if (changes.length === 0) return [];
    const { gateway, poller, audit } = this.opts;
    let results: ReservationWriteResult[];
    try {
      results = await gateway.changeReservations(changes);
    } catch (err) {
      audit.record({ actor, action: "reservation.batch", target: `${changes.length} reservas`, result: `error: ${(err as Error).message}` });
      throw err;
    }
    results.forEach((r, i) => {
      const c = changes[i]!;
      audit.record({
        actor,
        action: ACTION[c.op],
        target: c.mac,
        before: r.before,
        after: r.state ? r.after : c.op === "remove" ? null : { mac: c.mac, ip: c.ip },
        result: r.ok ? "ok" : `${r.outcome}: ${r.message}`,
      });
    });
    const last = [...results].reverse().find((r) => r.state);
    if (last?.state) poller.applyReservations(last.state.reservations, last.state.max);
    if (results.some((r) => !r.state)) void poller.pollNow();
    return results;
  }

  async apply(change: ReservationChange, actor: string): Promise<ReservationWriteResult> {
    if (!this.opts.allowWrite) throw new WriteDisabledError();
    const { gateway, poller, audit, logger } = this.opts;
    const wanted = change.op === "remove" ? null : { mac: change.mac, ip: change.ip };
    let result: ReservationWriteResult;
    try {
      result = await gateway.changeReservation(change);
    } catch (err) {
      // Não chegou a escrever (breaker, login, rede na primeira leitura).
      audit.record({
        actor,
        action: ACTION[change.op],
        target: change.mac,
        before: poller.cache.snapshot?.reservations.find((r) => r.mac === change.mac) ?? null,
        after: wanted,
        result: `error: ${(err as Error).message}`,
      });
      throw err;
    }

    audit.record({
      actor,
      action: ACTION[change.op],
      target: change.mac,
      before: result.before,
      after: result.state ? result.after : wanted,
      result: result.ok ? "ok" : `${result.outcome}: ${result.message}`,
    });
    if (result.state) poller.applyReservations(result.state.reservations, result.state.max);
    if (!result.ok) logger.warn(`reserva ${change.op} ${change.mac}: ${result.outcome} — ${result.message}`);
    // Estado desconhecido: uma leitura completa logo em seguida mostra a verdade.
    if (!result.state) void poller.pollNow();
    return result;
  }
}
