/**
 * Converte as respostas cruas do firmware nos tipos de types.ts.
 *
 * O firmware é inconsistente: lista vazia vem como `{}` em vez de `[]`,
 * números vêm como string, e campos somem conforme o modelo/papel do nó
 * (o gateway não tem `device_id` nem `connection_type`). Tudo aqui é tolerante:
 * um campo ausente vira null/valor neutro, nunca uma exceção. Só a ausência
 * das listas centrais (nós e clientes) invalida o snapshot.
 */
import type {
  Band,
  InternetStatus,
  MeshNode,
  NetworkClient,
  RawSnapshot,
  Reservation,
  Snapshot,
  WifiNetwork,
} from "./types.js";

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** Lista do firmware: `[]`, `{}` (vazia) ou ausente. */
export function asArray(value: unknown): Obj[] {
  return Array.isArray(value) ? value.filter(isObj) : [];
}

const str = (v: unknown): string | null =>
  typeof v === "string" && v !== "" ? v : typeof v === "number" ? String(v) : null;

const num = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
};

/** Mesmo formato que o firmware usa nas reservas: maiúsculo com hífen. */
export function canonicalMac(mac: string): string {
  return mac.trim().toUpperCase().replace(/[:.]/g, "-");
}

export function parseBand(value: unknown): Band | null {
  switch (String(value ?? "").toLowerCase()) {
    case "wired":
      return "wired";
    case "band2_4":
    case "2.4g":
      return "2.4GHz";
    case "band5":
    case "band5_1":
    case "band5_2":
    case "5g":
      return "5GHz";
    case "band6":
    case "6g":
      return "6GHz";
    default:
      return null;
  }
}

export function parseNodes(deviceList: unknown): MeshNode[] {
  const list = isObj(deviceList) ? asArray(deviceList.device_list) : [];
  return list
    .filter((n) => typeof n.mac === "string")
    .map((n) => {
      const signal = isObj(n.signal_level) ? n.signal_level : {};
      const role = String(n.role ?? "").toLowerCase() === "master" ? "master" : "slave";
      const backhaul = Array.isArray(n.connection_type)
        ? n.connection_type.map(parseBand).filter((b): b is Band => b !== null)
        : [];
      return {
        mac: canonicalMac(n.mac as string),
        parentMac: str(n.previous) ? canonicalMac(n.previous as string) : null,
        name: str(n.custom_nickname) ?? str(n.nickname) ?? str(n.device_model) ?? "Deco",
        model: str(n.device_model) ?? "?",
        hardware: str(n.hardware_ver) ?? "?",
        firmware: str(n.software_ver) ?? "?",
        ip: str(n.device_ip),
        role,
        online:
          String(n.group_status ?? "").toLowerCase() === "connected" ||
          String(n.inet_status ?? "").toLowerCase() === "online",
        backhaul,
        // O gateway reporta 0/0: não tem uplink, então não há sinal a mostrar.
        signal:
          role === "master"
            ? { "2.4GHz": null, "5GHz": null }
            : { "2.4GHz": num(signal.band2_4), "5GHz": num(signal.band5) },
      } satisfies MeshNode;
    });
}

export function parseClients(
  clientList: unknown,
  clientsByNode: Record<string, unknown> = {},
): NetworkClient[] {
  const nodeOf = new Map<string, string>();
  for (const [nodeMac, perNode] of Object.entries(clientsByNode)) {
    const list = isObj(perNode) ? asArray(perNode.client_list) : [];
    for (const c of list) {
      if (typeof c.mac === "string") nodeOf.set(canonicalMac(c.mac), canonicalMac(nodeMac));
    }
  }

  const list = isObj(clientList) ? asArray(clientList.client_list) : [];
  return list
    .filter((c) => typeof c.mac === "string" && c.online !== false)
    .map((c) => {
      const mac = canonicalMac(c.mac as string);
      const wired = String(c.wire_type ?? "").toLowerCase() === "wired";
      return {
        mac,
        name: str(c.name) ?? mac,
        ip: str(c.ip),
        deviceType: str(c.client_type) ?? "unknown",
        band: wired ? "wired" : (parseBand(c.connection_type) ?? "2.4GHz"),
        network: str(c.interface) ?? "main",
        nodeMac: nodeOf.get(mac) ?? null,
        upKBps: num(c.up_speed) ?? 0,
        downKBps: num(c.down_speed) ?? 0,
      } satisfies NetworkClient;
    });
}

export function parseReservations(raw: unknown): { list: Reservation[]; max: number | null } {
  if (!isObj(raw)) return { list: [], max: null };
  const list = asArray(raw.reservation_list)
    .filter((r) => typeof r.mac === "string" && typeof r.ip === "string")
    .map((r) => ({ mac: canonicalMac(r.mac as string), ip: (r.ip as string).trim() }));
  return { list, max: num(raw.reservation_list_max_count) };
}

export function parseInternet(internet: unknown, wan: unknown): InternetStatus | null {
  if (!isObj(internet)) return null;
  const v4 = isObj(internet.ipv4) ? internet.ipv4 : {};
  const v6 = isObj(internet.ipv6) ? internet.ipv6 : {};
  const ipInfo = isObj(wan) && isObj(wan.wan) && isObj(wan.wan.ip_info) ? wan.wan.ip_info : {};
  const wanIp = str(ipInfo.ip);
  return {
    ipv4Online: String(v4.inet_status ?? "").toLowerCase() === "online",
    ipv6Online: String(v6.inet_status ?? "").toLowerCase() === "online",
    connectType: str(v4.connect_type) ?? "unknown",
    dialStatus: str(v4.dial_status) ?? "unknown",
    cablePlugged: String(internet.link_status ?? "").toLowerCase() === "plugged",
    wanIp: wanIp === "0.0.0.0" ? null : wanIp,
    wanGateway: str(ipInfo.gateway),
    dns: [str(ipInfo.dns1), str(ipInfo.dns2)].filter((d): d is string => !!d && d !== "0.0.0.0"),
  };
}

export function parseLan(wan: unknown): { ip: string; mask: string } | null {
  const info = isObj(wan) && isObj(wan.lan) && isObj(wan.lan.ip_info) ? wan.lan.ip_info : null;
  const ip = info && str(info.ip);
  const mask = info && str(info.mask);
  return ip && mask ? { ip, mask } : null;
}

/**
 * Redes Wi-Fi sem qualquer campo de senha: só copiamos campos conhecidos,
 * então uma PSK nunca chega ao snapshot (nem redigida).
 */
export function parseWifi(wlan: unknown): WifiNetwork[] | null {
  if (!isObj(wlan)) return null;
  const out: WifiNetwork[] = [];
  for (const [bandKey, bandValue] of Object.entries(wlan)) {
    if (!isObj(bandValue)) continue;
    if (bandKey === "iot") {
      const host = isObj(bandValue.host) ? bandValue.host : null;
      if (!host || !str(host.ssid)) continue;
      for (const [flag, band] of [["enable_2g", "2.4GHz"], ["enable_5g", "5GHz"]] as const) {
        out.push({
          band,
          kind: "iot",
          ssid: str(host.ssid)!,
          enabled: host.enable === true && host[flag] === true,
          channel: null,
          channelWidth: null,
        });
      }
      continue;
    }
    const band = parseBand(bandKey);
    if (!band) continue;
    for (const kind of ["host", "guest"]) {
      const net = isObj(bandValue[kind]) ? (bandValue[kind] as Obj) : null;
      if (!net || !str(net.ssid)) continue;
      out.push({
        band,
        kind,
        ssid: str(net.ssid)!,
        enabled: net.enable === true,
        channel: num(net.channel),
        channelWidth: str(net.channel_width),
      });
    }
  }
  return out;
}

export function parsePerformance(raw: unknown): { cpu: number; memory: number } | null {
  if (!isObj(raw)) return null;
  const cpu = num(raw.cpu_usage);
  const memory = num(raw.mem_usage);
  return cpu === null || memory === null ? null : { cpu, memory };
}

export class SnapshotParseError extends Error {}

export function parseSnapshot(raw: RawSnapshot, takenAt: Date): Snapshot {
  if (!isObj(raw.deviceList) || !("device_list" in raw.deviceList)) {
    throw new SnapshotParseError("device_list ausente na resposta");
  }
  if (!isObj(raw.clientList) || !("client_list" in raw.clientList)) {
    throw new SnapshotParseError("client_list ausente na resposta");
  }
  // As reservas são centrais: uma lista vazia por falha de leitura pareceria
  // "todas as reservas sumiram" para quem compara snapshots.
  if (!isObj(raw.reservations)) {
    throw new SnapshotParseError("addr_reservation ausente na resposta");
  }
  const reservations = parseReservations(raw.reservations);
  return {
    takenAt: takenAt.toISOString(),
    nodes: parseNodes(raw.deviceList),
    clients: parseClients(raw.clientList, raw.clientsByNode),
    reservations: reservations.list,
    reservationMax: reservations.max,
    internet: parseInternet(raw.internet, raw.wan),
    wifi: parseWifi(raw.wlan),
    performance: parsePerformance(raw.performance),
    lan: parseLan(raw.wan),
    detailTakenAt: raw.detailTakenAt ?? takenAt.toISOString(),
  };
}
