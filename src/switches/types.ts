export interface SwitchConfig {
  id: string;
  name: string;
  host: string;
  model: string;
  username: string;
  portCount: number;
  enabled: boolean;
  intervalSeconds: number;
  /** Apenas descrição física cadastrada; não inferida da tabela MAC. */
  uplink: string;
  portNotes: Record<string, string>;
}
export interface SwitchPort {
  port: string;
  status: string;
  speed: string;
  duplex: string;
  txBytes: number;
  rxBytes: number;
  txBps: number | null;
  rxBps: number | null;
  totalTx: number;
  totalRx: number;
  estimated: boolean;
  countersValid: boolean;
}
export interface SwitchMac { mac: string; port: string; vlan: string; type: string }
export interface SwitchSnapshot {
  counterVersion: number;
  at: string;
  mac: string;
  model: string;
  firmware: string;
  uptime: string;
  ports: SwitchPort[];
  macs: SwitchMac[];
  macError: string | null;
  dhcpSnooping: unknown;
  igmp: unknown;
  jumboFrame: unknown;
}
export interface SwitchView extends SwitchConfig {
  hasPassword: boolean;
  polling: boolean;
  lastAttemptAt: string | null;
  lastError: string | null;
  stale: boolean;
  snapshot: SwitchSnapshot | null;
}
export interface SwitchesView { switches: SwitchView[]; models: string[] }
export interface PortSample {
  at: string; txBps: number | null; rxBps: number | null;
  txBytes: number; rxBytes: number; totalTx: number; totalRx: number; estimated: boolean;
}
