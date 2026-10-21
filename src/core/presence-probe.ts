/**
 * Presença vista pelo próprio painel. O Deco só lista um número limitado de
 * aparelhos por porta cabeada (medido: 8 atrás do host Proxmox); os demais
 * funcionam, mas somem da lista. Para os MACs que esperamos ver (reservados ou
 * cadastrados) e que o Deco não listou, o painel:
 * 1. manda um datagrama UDP inofensivo (porta discard) a cada IP conhecido do
 *    aparelho — o que obriga o kernel a resolver o ARP;
 * 2. lê /proc/net/arp e confirma o MAC que respondeu naquele IP.
 * Só conta quem responde com o MAC esperado. O próprio host do painel se
 * reconhece pelas interfaces locais. Não precisa de root (sem ICMP).
 */
import { createSocket } from "node:dgram";
import { readFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import type { NetworkClient, Snapshot } from "../deco-client/types.js";

export interface ProbeTarget {
  mac: string;
  /** IPs a tentar: a reserva e o último IP visto. */
  ips: string[];
}

export interface ProbeHit {
  mac: string;
  ip: string;
  /** É a máquina onde o painel roda. */
  self: boolean;
}

export interface ProbeDeps {
  sendProbe(ip: string): void;
  readArp(): string;
  localInterfaces(): { mac: string; ip: string }[];
  wait(ms: number): Promise<void>;
}

const normMac = (mac: string) => mac.trim().toUpperCase().replace(/:/g, "-");

/** /proc/net/arp → IP → MAC, só entradas completas (flag 0x2). */
export function parseArp(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split("\n").slice(1)) {
    const [ip, , flags, mac] = line.trim().split(/\s+/);
    if (!ip || !mac || !flags) continue;
    if ((Number.parseInt(flags, 16) & 0x2) === 0) continue;
    if (mac === "00:00:00:00:00:00") continue;
    out.set(ip, normMac(mac));
  }
  return out;
}

export async function probePresence(targets: ProbeTarget[], deps: ProbeDeps, waitMs = 1500): Promise<ProbeHit[]> {
  const hits = new Map<string, ProbeHit>();
  const local = deps.localInterfaces().map((i) => ({ mac: normMac(i.mac), ip: i.ip }));
  for (const l of local) hits.set(l.mac, { mac: l.mac, ip: l.ip, self: true });

  const pending = targets.filter((t) => !hits.has(normMac(t.mac)) && t.ips.length > 0);
  if (pending.length) {
    for (const t of pending) for (const ip of new Set(t.ips)) deps.sendProbe(ip);
    await deps.wait(waitMs);
    const arp = parseArp(deps.readArp());
    for (const t of pending) {
      const mac = normMac(t.mac);
      const ip = [...new Set(t.ips)].find((candidate) => arp.get(candidate) === mac);
      if (ip) hits.set(mac, { mac, ip, self: false });
    }
  }
  return [...hits.values()];
}

/** Implementação real (Linux). */
export const systemProbeDeps: ProbeDeps = {
  sendProbe(ip) {
    const socket = createSocket("udp4");
    socket.on("error", () => socket.close());
    // Porta 9 (discard): ninguém precisa responder; basta o kernel resolver o ARP.
    socket.send(Buffer.alloc(0), 9, ip, () => socket.close());
  },
  readArp: () => readFileSync("/proc/net/arp", "utf8"),
  localInterfaces() {
    const out: { mac: string; ip: string }[] = [];
    for (const list of Object.values(networkInterfaces())) {
      for (const i of list ?? []) {
        if (i.family === "IPv4" && !i.internal && i.mac !== "00:00:00:00:00:00") out.push({ mac: i.mac, ip: i.address });
      }
    }
    return out;
  },
  wait: (ms) => new Promise((r) => setTimeout(r, ms)),
};

/**
 * Quem conferir: MACs reservados ou cadastrados que o Deco não listou. Tenta
 * o IP reservado e o último IP visto (o aparelho pode ainda não ter renovado).
 */
export function presenceTargets(
  snap: Snapshot,
  lastIpOf: (mac: string) => string | null,
  expectedMacs: Iterable<string>,
): ProbeTarget[] {
  const listed = new Set(snap.clients.map((c) => c.mac));
  const reserved = new Map(snap.reservations.map((r) => [r.mac, r.ip]));
  const macs = new Set([...reserved.keys(), ...expectedMacs]);
  const out: ProbeTarget[] = [];
  for (const mac of macs) {
    if (listed.has(mac)) continue;
    const ips = [reserved.get(mac), lastIpOf(mac)].filter((ip): ip is string => !!ip);
    if (ips.length) out.push({ mac, ips });
  }
  return out;
}

/**
 * Snapshot com os aparelhos vistos pelo painel. O próprio host só entra se o
 * IP dele estiver na rede do Deco (num container com rede própria, não está).
 */
export function withPanelClients(
  snap: Snapshot,
  hits: ProbeHit[],
  inLan: (ip: string) => boolean,
  nameOf: (mac: string, self: boolean) => string,
): Snapshot {
  const listed = new Set(snap.clients.map((c) => c.mac));
  const extra: NetworkClient[] = hits
    .filter((h) => !listed.has(h.mac) && inLan(h.ip))
    .map((h) => ({
      mac: h.mac,
      name: nameOf(h.mac, h.self),
      ip: h.ip,
      deviceType: "",
      // Visto por ARP na LAN: na prática, cabeado (é o caso que o Deco esconde).
      band: "wired",
      network: "main",
      nodeMac: null,
      upKBps: 0,
      downKBps: 0,
      source: "panel",
    }));
  return extra.length ? { ...snap, clients: [...snap.clients, ...extra] } : snap;
}
