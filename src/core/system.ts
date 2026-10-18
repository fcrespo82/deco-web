/**
 * Operações perigosas: reiniciar nós e alterar Wi-Fi. Exigem
 * DECO_ALLOW_WRITE=1 e DECO_ALLOW_DANGEROUS=1.
 *
 * Como nas reservas: valida contra o cache antes de abrir sessão, passa pela
 * fila + breaker do gateway e registra toda tentativa na auditoria. Senhas de
 * Wi-Fi nunca vão para a auditoria nem para a resposta — só "senha alterada".
 *
 * Proteções além da confirmação na UI:
 * - a rede principal não pode ser desligada por aqui (derrubaria todos os
 *   aparelhos e, provavelmente, o acesso a este painel);
 * - um nó só pode ser reiniciado de novo depois de 5 minutos;
 * - depois de reiniciar o gateway, as leituras param por 3 minutos.
 */
import type { RebootResult, WifiChange, WifiKind, WifiWriteResult } from "../deco-client/system.js";
import { WIFI_KINDS } from "../deco-client/system.js";
import type { AuditRepo } from "../db/audit.js";
import { requireMac, ValidationError } from "../db/errors.js";
import type { Logger } from "../log.js";
import type { DecoGateway } from "./gateway.js";
import type { Poller } from "./poller.js";
import { ConflictError } from "./reservations.js";

export type { RebootResult, WifiChange, WifiWriteResult };

export class DangerousDisabledError extends Error {
  constructor() {
    super("Operação perigosa desabilitada. Inicie o painel com DECO_ALLOW_WRITE=1 e DECO_ALLOW_DANGEROUS=1.");
    this.name = "DangerousDisabledError";
  }
}

export class WifiWriteDisabledError extends Error {
  constructor() {
    super(
      "Alterar Wi-Fi está desligado: o firmware do X50 recusa o formato usado. " +
        "Para testar outro firmware, inicie com DECO_EXPERIMENTAL_WIFI_WRITE=1.",
    );
    this.name = "WifiWriteDisabledError";
  }
}

export const REBOOT_COOLDOWN_MS = 5 * 60_000;
export const GATEWAY_REBOOT_PAUSE_MS = 3 * 60_000;

const PSK = /^[\x20-\x7E]{8,63}$/;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;

export interface SystemServiceOptions {
  allowDangerous: boolean;
  /** Escrita de Wi-Fi (experimental, ver config.ts). */
  wifiWrite?: boolean;
  gateway: DecoGateway;
  poller: Poller;
  audit: AuditRepo;
  logger: Logger;
  now?: () => number;
}

export class SystemService {
  private readonly now: () => number;
  private readonly lastReboot = new Map<string, number>();

  constructor(private readonly opts: SystemServiceOptions) {
    this.now = opts.now ?? Date.now;
  }

  get allowDangerous(): boolean {
    return this.opts.allowDangerous;
  }

  private requireDangerous(): void {
    if (!this.opts.allowDangerous) throw new DangerousDisabledError();
  }

  /** Valida a lista de MACs contra o cache e o intervalo mínimo entre reinícios. */
  prepareReboot(raw: unknown): string[] {
    this.requireDangerous();
    if (!Array.isArray(raw) || raw.length === 0) throw new ValidationError("Informe ao menos um nó (macs).");
    const macs = [...new Set(raw.map(requireMac))];
    const nodes = this.opts.poller.cache.snapshot?.nodes ?? [];
    for (const mac of macs) {
      const node = nodes.find((n) => n.mac === mac);
      if (!node) throw new ConflictError(`${mac} não é um nó deste mesh.`);
      const last = this.lastReboot.get(mac);
      if (last !== undefined && this.now() - last < REBOOT_COOLDOWN_MS) {
        const wait = Math.ceil((REBOOT_COOLDOWN_MS - (this.now() - last)) / 60_000);
        throw new ConflictError(`"${node.name}" foi reiniciado há pouco. Aguarde ${wait} min.`);
      }
    }
    return macs;
  }

  async reboot(macs: string[], actor: string): Promise<RebootResult> {
    this.requireDangerous();
    const { gateway, poller, audit, logger } = this.opts;
    const names = (poller.cache.snapshot?.nodes ?? []).filter((n) => macs.includes(n.mac));
    const target = names.map((n) => `${n.name} (${n.mac})`).join(", ") || macs.join(", ");
    let result: RebootResult;
    try {
      result = await gateway.rebootNodes(macs);
    } catch (err) {
      audit.record({ actor, action: "node.reboot", target, result: `error: ${(err as Error).message}` });
      throw err;
    }
    audit.record({
      actor,
      action: "node.reboot",
      target,
      after: { macs },
      result: result.ok ? "ok" : `${result.outcome}: ${result.message}`,
    });
    if (result.outcome === "sent" || result.outcome === "ambiguous") {
      for (const mac of macs) this.lastReboot.set(mac, this.now());
      if (result.nodes.some((n) => n.role === "master")) poller.pause(GATEWAY_REBOOT_PAUSE_MS);
    }
    if (!result.ok) logger.warn(`reboot ${target}: ${result.outcome} — ${result.message}`);
    return result;
  }

  /** Valida o pedido cru da API. Nunca inclui a senha em mensagens de erro. */
  prepareWifi(body: Record<string, unknown> | undefined): WifiChange {
    this.requireDangerous();
    if (!this.opts.wifiWrite) throw new WifiWriteDisabledError();
    const network = body?.network;
    if (typeof network !== "string" || !(WIFI_KINDS as readonly string[]).includes(network)) {
      throw new ValidationError(`Rede inválida: use ${WIFI_KINDS.join(", ")}.`);
    }
    const change: WifiChange = { network: network as WifiKind };

    if (body?.enabled !== undefined) {
      if (typeof body.enabled !== "boolean") throw new ValidationError("enabled deve ser true ou false.");
      if (network === "host" && body.enabled === false) {
        throw new ValidationError(
          "A rede principal não pode ser desligada pelo painel: derrubaria todos os aparelhos e, provavelmente, o acesso a este painel. Use o app do Deco.",
        );
      }
      change.enabled = body.enabled;
    }
    if (body?.ssid !== undefined) {
      const ssid = body.ssid;
      if (typeof ssid !== "string" || ssid.length === 0) throw new ValidationError("SSID vazio.");
      if (Buffer.byteLength(ssid, "utf8") > 32) throw new ValidationError("SSID tem no máximo 32 bytes.");
      if (CONTROL.test(ssid)) throw new ValidationError("SSID com caractere de controle.");
      if (ssid.trim() !== ssid) throw new ValidationError("SSID não pode começar nem terminar com espaço.");
      change.ssid = ssid;
    }
    if (body?.password !== undefined) {
      if (typeof body.password !== "string" || !PSK.test(body.password)) {
        throw new ValidationError("Senha do Wi-Fi: de 8 a 63 caracteres, sem acentos.");
      }
      change.password = body.password;
    }
    if (change.enabled === undefined && change.ssid === undefined && change.password === undefined) {
      throw new ValidationError("Nada a alterar (enabled, ssid ou password).");
    }

    const wifi = this.opts.poller.cache.snapshot?.wifi;
    if (wifi && !wifi.some((w) => w.kind === network)) throw new ConflictError("Esta rede não existe neste Deco.");
    return change;
  }

  async changeWifi(change: WifiChange, actor: string): Promise<WifiWriteResult> {
    this.requireDangerous();
    if (!this.opts.wifiWrite) throw new WifiWriteDisabledError();
    const { gateway, poller, audit, logger } = this.opts;
    const target = `wifi:${change.network}`;
    const asked = {
      ...(change.ssid !== undefined && { ssid: change.ssid }),
      ...(change.enabled !== undefined && { enabled: change.enabled }),
      ...(change.password !== undefined && { passwordChanged: true }),
    };
    let result: WifiWriteResult;
    try {
      result = await gateway.changeWifi(change);
    } catch (err) {
      audit.record({ actor, action: "wifi.change", target, after: asked, result: `error: ${(err as Error).message}` });
      throw err;
    }
    const summary = (s: WifiWriteResult["before"]) => (s ? { ssid: s.ssid, enabled: s.enabled } : null);
    audit.record({
      actor,
      action: "wifi.change",
      target,
      before: summary(result.before),
      after: result.after ? { ...summary(result.after), passwordChanged: result.passwordChanged } : asked,
      result: result.ok ? "ok" : `${result.outcome}: ${result.message}`,
    });
    if (result.wifi) poller.applyWifi(result.wifi);
    if (!result.ok) logger.warn(`wifi ${change.network}: ${result.outcome} — ${result.message}`);
    return result;
  }
}
