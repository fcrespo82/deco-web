/**
 * Plano de IPs: cruza faixas nomeadas, reservas, clientes online e o
 * histórico para montar a grade do /24, apontar anomalias e sugerir o
 * próximo IP livre de uma faixa. Puro — tudo entra por parâmetro.
 *
 * O pool de DHCP e os leases do Deco não são legíveis pela API local (só
 * pelo app); "em uso" vem da lista de clientes, e "visto há pouco" protege
 * IPs de aparelhos offline cujo lease provavelmente ainda vale.
 */
import type { Snapshot } from "../deco-client/types.js";
import type { ClientSeen } from "../db/store.js";
import type { Device, DeviceType } from "../db/inventory.js";
import type { IpRange } from "../db/ipranges.js";
import { intToIp, ipToInt, subnetOf, type Subnet } from "./ipmath.js";
import type { Anomaly, AnomalyCode, CellStatus, IpCell, IpPlan, RangeSummary } from "../server/api-types.js";

export type { Anomaly, AnomalyCode, CellStatus, IpCell, IpPlan, RangeSummary };

export interface IpPlanInput {
  snapshot: Snapshot | null;
  ranges: IpRange[];
  inventory: Map<string, Device>;
  seen: Map<string, ClientSeen>;
  now: Date;
  /** IP de aparelho offline visto nesse período não é sugerido. */
  recentMs?: number;
}

const TYPE_LABEL: Record<DeviceType, string> = {
  pc: "PC",
  notebook: "notebook",
  celular: "celular",
  tablet: "tablet",
  tv: "TV",
  iot: "IoT",
  servidor: "servidor",
  rede: "rede",
  outro: "outro",
};

export function lanSubnet(snapshot: Snapshot | null): { subnet: Subnet; gateway: string | null } | null {
  if (snapshot?.lan) return { subnet: subnetOf(snapshot.lan.ip, snapshot.lan.mask), gateway: snapshot.lan.ip };
  const master = snapshot?.nodes.find((n) => n.role === "master" && n.ip);
  return master?.ip ? { subnet: subnetOf(master.ip, "255.255.255.0"), gateway: master.ip } : null;
}

export function buildIpPlan(input: IpPlanInput): IpPlan {
  const { snapshot, ranges, inventory, seen, now } = input;
  const recentMs = input.recentMs ?? 7 * 24 * 60 * 60 * 1000;
  const lan = lanSubnet(snapshot);
  const empty = (message: string): IpPlan => ({
    network: null,
    message,
    cells: [],
    ranges: ranges.map((r) => ({ ...r, size: r.end - r.start + 1, reserved: 0, inUse: 0, free: 0, suggestion: null })),
    anomalies: [],
  });
  if (!snapshot || !lan) return empty("Ainda sem dados do Deco para saber a rede.");
  if (lan.subnet.prefix !== 24) return empty(`A grade cobre só redes /24; esta LAN é /${lan.subnet.prefix}.`);

  const { subnet, gateway } = lan;
  const nameOf = (mac: string | null): string | null => {
    if (!mac) return null;
    return (
      inventory.get(mac)?.alias ??
      snapshot.clients.find((c) => c.mac === mac)?.name ??
      seen.get(mac)?.lastName ??
      mac
    );
  };
  const rangeAt = (ip: number) => ranges.find((r) => ip >= r.start && ip <= r.end) ?? null;

  // Índices por IP (inteiro).
  const reservedBy = new Map<number, string>();
  for (const r of snapshot.reservations) {
    try {
      reservedBy.set(ipToInt(r.ip), r.mac);
    } catch {
      // IP malformado vindo do firmware: ignora.
    }
  }
  const reservationOf = new Map(snapshot.reservations.map((r) => [r.mac, r.ip]));
  const onlineAt = new Map<number, string>();
  for (const c of snapshot.clients) if (c.ip) onlineAt.set(ipToInt(c.ip), c.mac);
  const nodeAt = new Map<number, string>();
  for (const n of snapshot.nodes) if (n.ip) nodeAt.set(ipToInt(n.ip), n.mac);
  const recentAt = new Map<number, string>();
  for (const s of seen.values()) {
    if (s.lastIp && now.getTime() - Date.parse(s.lastSeen) <= recentMs) recentAt.set(ipToInt(s.lastIp), s.mac);
  }
  const gatewayInt = gateway ? ipToInt(gateway) : null;

  const anomalies: Anomaly[] = [];
  const cells: IpCell[] = [];
  for (let i = 0; i < subnet.size; i++) {
    const ip = subnet.base + i;
    const reservedMac = reservedBy.get(ip) ?? null;
    const onlineMac = onlineAt.get(ip) ?? null;
    let status: CellStatus;
    let mac: string | null = null;
    if (i === 0) status = "network";
    else if (i === subnet.size - 1) status = "broadcast";
    else if (ip === gatewayInt) status = "gateway";
    else if (nodeAt.has(ip)) {
      status = "node";
      mac = nodeAt.get(ip)!;
    } else if (reservedMac && onlineMac) {
      status = "reserved-online";
      mac = reservedMac;
    } else if (reservedMac) {
      status = "reserved";
      mac = reservedMac;
    } else if (onlineMac) {
      status = "online";
      mac = onlineMac;
    } else if (recentAt.has(ip)) {
      status = "recent";
      mac = recentAt.get(ip)!;
    } else status = "free";

    const range = rangeAt(ip);
    const cell: IpCell = {
      ip: intToIp(ip),
      octet: ip & 255,
      status,
      rangeId: range?.id ?? null,
      mac,
      name: status === "node" ? (snapshot.nodes.find((n) => n.mac === mac)?.name ?? null) : nameOf(mac),
      anomalies: [],
    };
    const flag = (code: AnomalyCode, who: string | null, message: string) => {
      cell.anomalies.push(code);
      anomalies.push({ code, ip: cell.ip, mac: who, name: nameOf(who), message });
    };

    if (reservedMac && ranges.length > 0 && !range) {
      flag("outside-plan", reservedMac, "Reserva fora de qualquer faixa do plano.");
    }
    if (reservedMac && onlineMac && onlineMac !== reservedMac) {
      flag("reservation-conflict", onlineMac, `IP reservado para ${nameOf(reservedMac)} está em uso por outro aparelho.`);
    }
    if (onlineMac && !reservedMac && range?.kind === "static") {
      flag("dynamic-in-static", onlineMac, `Endereço dinâmico dentro da faixa fixa "${range.name}".`);
    }
    const holder = reservedMac ?? onlineMac;
    const type = holder ? inventory.get(holder)?.type : null;
    if (range && type && range.types.length > 0 && !range.types.includes(type)) {
      flag("type-mismatch", holder, `${TYPE_LABEL[type]} na faixa "${range.name}", que espera ${range.types.map((t) => TYPE_LABEL[t]).join(", ")}.`);
    }
    cells.push(cell);
  }

  // Cliente com reserva usando outro IP: a reserva só vale na próxima renovação do DHCP.
  for (const c of snapshot.clients) {
    const reserved = reservationOf.get(c.mac);
    if (reserved && c.ip && c.ip !== reserved) {
      const cell = cells.find((x) => x.ip === c.ip);
      cell?.anomalies.push("reservation-not-applied");
      anomalies.push({
        code: "reservation-not-applied",
        ip: c.ip,
        mac: c.mac,
        name: nameOf(c.mac),
        message: `Tem reserva para ${reserved}, mas está usando ${c.ip}. Reconectar o aparelho aplica a reserva.`,
      });
    }
  }

  const summaries = ranges.map((r): RangeSummary => {
    const inRange = cells.filter((c) => c.rangeId === r.id);
    const free = inRange.filter((c) => c.status === "free");
    return {
      ...r,
      size: r.end - r.start + 1,
      reserved: inRange.filter((c) => c.status === "reserved" || c.status === "reserved-online").length,
      inUse: inRange.filter((c) => c.status === "online" || c.status === "reserved-online" || c.status === "node").length,
      free: free.length,
      suggestion: free[0]?.ip ?? null,
    };
  });

  return {
    network: { address: intToIp(subnet.base), prefix: subnet.prefix, gateway },
    message: null,
    cells,
    ranges: summaries,
    anomalies,
  };
}

/** Próximo IP livre de uma faixa, ou null. */
export function suggestIp(plan: IpPlan, rangeId: number): string | null {
  return plan.ranges.find((r) => r.id === rangeId)?.suggestion ?? null;
}
