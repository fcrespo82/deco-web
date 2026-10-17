/**
 * Modelo tipado do que o Deco expõe. O resto da aplicação só conhece estes
 * tipos; o formato cru do firmware fica confinado a parse.ts.
 */

export type Band = "2.4GHz" | "5GHz" | "6GHz" | "wired";

export interface MeshNode {
  /** MAC no formato do firmware: maiúsculo, separado por hífen. */
  mac: string;
  /** MAC do nó acima na topologia (campo `previous`); null para o gateway. */
  parentMac: string | null;
  name: string;
  model: string;
  hardware: string;
  firmware: string;
  ip: string | null;
  role: "master" | "slave";
  online: boolean;
  /** Como o nó chega ao pai. Vazio no gateway. */
  backhaul: Band[];
  /** Barras de sinal do uplink (0–3), por banda. null quando não se aplica. */
  signal: { "2.4GHz": number | null; "5GHz": number | null };
}

export interface NetworkClient {
  mac: string;
  name: string;
  ip: string | null;
  /** Classificação do próprio Deco: Computer, Mobile, IP Camera... */
  deviceType: string;
  band: Band;
  /** Rede lógica: main, iot, guest. */
  network: string;
  /** MAC do nó ao qual o cliente está conectado, quando conhecido. */
  nodeMac: string | null;
  /** Taxa instantânea, em KB/s. O firmware não tem contador acumulado. */
  upKBps: number;
  downKBps: number;
}

export interface Reservation {
  mac: string;
  ip: string;
}

export interface InternetStatus {
  ipv4Online: boolean;
  ipv6Online: boolean;
  connectType: string;
  dialStatus: string;
  cablePlugged: boolean;
  wanIp: string | null;
  wanGateway: string | null;
  dns: string[];
}

export interface WifiNetwork {
  band: Band;
  /** host (principal), guest, iot. */
  kind: string;
  ssid: string;
  enabled: boolean;
  channel: number | null;
  channelWidth: string | null;
}

export interface Snapshot {
  takenAt: string;
  nodes: MeshNode[];
  clients: NetworkClient[];
  reservations: Reservation[];
  reservationMax: number | null;
  /** Seções opcionais: null quando a leitura falhou, sem derrubar o snapshot. */
  internet: InternetStatus | null;
  wifi: WifiNetwork[] | null;
  performance: { cpu: number; memory: number } | null;
  lan: { ip: string; mask: string } | null;
  /**
   * Quando foram lidos cliente→nó, Wi-Fi e CPU/memória. Essas leituras são
   * lentas e feitas a cada N polls, então podem ser mais antigas que takenAt.
   */
  detailTakenAt: string;
}

/** Respostas cruas (já normalizadas/redigidas) que compõem um snapshot. */
export interface RawSnapshot {
  deviceList: unknown;
  clientList: unknown;
  /** client_list de cada nó, indexado pelo MAC do nó. */
  clientsByNode: Record<string, unknown>;
  reservations: unknown;
  internet?: unknown;
  wan?: unknown;
  wlan?: unknown;
  performance?: unknown;
  detailTakenAt?: string;
}

/** Leitura que o resto do sistema faz do Deco. Implementações: live e mock. */
export interface DecoApi {
  fetchSnapshot(): Promise<Snapshot>;
}
