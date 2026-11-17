import type { PhysicalTopology } from "./topology.js";
import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { isIP } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ValidationError, NotFoundError } from "../db/errors.js";
import type { Store } from "../db/store.js";
import { collectSwitch, type Collect } from "./collector.js";
import type { PortSample, SwitchConfig, SwitchPort, SwitchSnapshot, SwitchView, SwitchesView } from "./types.js";

const text = (v: unknown, max = 200) => typeof v === "string" ? v.trim().slice(0, max) : "";
const num = (v: unknown) => typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : 0;
export function normalizeSwitchMac(v: unknown): string | null {
  const hex = text(v).replace(/[-:.]/g, "").toUpperCase();
  return /^[0-9A-F]{12}$/.test(hex) ? hex.match(/../g)!.join("-") : null;
}
export function counterRate(current: number, previous: number | undefined, seconds: number, reset: boolean): number | null {
  return reset || previous === undefined || seconds <= 0 || current < previous ? null : (current - previous) / seconds;
}
function uptimeSeconds(value: string): number | null {
  const day = /([\d]+)\s*d(?:ay)?/i.exec(value);
  const time = /(\d+):(\d+):(\d+)/.exec(value);
  return time ? Number(day?.[1] ?? 0) * 86400 + Number(time[1]) * 3600 + Number(time[2]) * 60 + Number(time[3]) : null;
}
export function switchSnapshot(raw: Record<string, unknown>, previous: SwitchSnapshot | null, at: string): SwitchSnapshot {
  const seconds = previous ? (Date.parse(at) - Date.parse(previous.at)) / 1000 : 0;
  const oldUptime = previous && uptimeSeconds(previous.uptime);
  const uptime = text(raw.uptime);
  const newUptime = uptimeSeconds(uptime);
  const rebooted = oldUptime !== null && oldUptime !== undefined && newUptime !== null && newUptime < oldUptime;
  const ports: SwitchPort[] = (Array.isArray(raw.ports) ? raw.ports : []).slice(0, 256).map((p: Record<string, unknown>) => {
    const port = text(p.port, 40);
    const old = previous?.ports.find(p => p.port === port);
    const txBytes = num(p.tx_bytes), rxBytes = num(p.rx_bytes);
    const estimated = p.counters_estimated === true;
    const countersValid = p.counters_valid !== false;
    const schemaChanged = previous?.counterVersion !== 2;
    const reset = !countersValid || old?.countersValid === false || schemaChanged || rebooted || Boolean(old && (txBytes < old.txBytes || rxBytes < old.rxBytes || estimated !== old.estimated));
    const txBps = counterRate(txBytes, old?.txBytes, seconds, reset);
    const rxBps = counterRate(rxBytes, old?.rxBytes, seconds, reset);
    return { port, status: text(p.status), speed: text(p.speed), duplex: text(p.duplex), txBytes, rxBytes, txBps, rxBps,
      totalTx: (schemaChanged ? 0 : old?.totalTx ?? 0) + (txBps === null ? 0 : txBytes - old!.txBytes),
      totalRx: (schemaChanged ? 0 : old?.totalRx ?? 0) + (rxBps === null ? 0 : rxBytes - old!.rxBytes), estimated, countersValid };
  });
  const macs = (Array.isArray(raw.mac_table) ? raw.mac_table : []).slice(0, 20000).flatMap((m: Record<string, unknown>) => {
    const mac = normalizeSwitchMac(m.mac);
    return mac ? [{ mac, port: text(m.port, 40), vlan: text(m.vlan, 20), type: text(m.type, 40) }] : [];
  });
  return { counterVersion: 2, at, mac: normalizeSwitchMac(raw.mac) ?? "", model: text(raw.model), firmware: text(raw.firmware), uptime, ports, macs,
    macError: raw.mac_error ? "Tabela MAC indisponível nesta coleta" : null,
    dhcpSnooping: raw.dhcp_snooping ?? null, igmp: raw.igmp ?? null, jumboFrame: raw.jumbo_frame ?? null };
}

export class SwitchService {
  readonly models = ["builtin", ...readdirSync(fileURLToPath(new URL("../../collectors/switches/device-templates/", import.meta.url))).filter(f=>f.endsWith(".yaml")).map(f=>f.slice(0,-5)).sort()];
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;
  private controllers = new Map<string, AbortController>();
  private pending = new Map<string, Promise<unknown>>();
  private attempts = new Map<string, number>();
  private directory: string;
  constructor(private store: Store, dataDir: string, private notify: () => void, private retentionDays: number, private collect: Collect = collectSwitch) {
    this.directory = join(dataDir, "switch-secrets");
  }
  private configs(): SwitchConfig[] { return this.store.getJson<SwitchConfig[]>("switch_configs") ?? []; }
  private config(id: string) {
    const config = this.configs().find(c=>c.id===id);
    if (!config) throw new NotFoundError("Switch não encontrado");
    return config;
  }
  private secret(id: string) { return join(this.directory, id); }
  private state(id: string) { return this.store.getJson<{ snapshot: SwitchSnapshot | null; lastError: string | null; lastAttemptAt: string | null }>(`switch:${id}`) ?? { snapshot: null, lastError: null, lastAttemptAt: null }; }
  view(): SwitchesView {
    return { models: this.models, switches: this.configs().map(c=>{
      const state = this.state(c.id);
      return { ...c, ...state, hasPassword: existsSync(this.secret(c.id)), polling: this.pending.has(c.id),
        stale: !c.enabled || Boolean(state.lastError) || !state.snapshot || Date.now() - Date.parse(state.snapshot.at) > c.intervalSeconds * 2500 } satisfies SwitchView;
    }) };
  }
  save(input: Record<string, unknown>, id?: string): SwitchConfig {
    const old = id ? this.config(id) : undefined;
    if (id && this.pending.has(id)) throw new ValidationError("Aguarde a coleta terminar antes de alterar este switch");
    const name = text(input.name ?? old?.name);
    const host = text(input.host ?? old?.host);
    const model = text(input.model ?? old?.model ?? "builtin");
    const username = text(input.username ?? old?.username ?? "admin");
    const intervalSeconds = Number(input.intervalSeconds ?? old?.intervalSeconds ?? 30);
    const portCount = Number(input.portCount ?? old?.portCount ?? 9);
    if (!name || !host || !(isIP(host) === 4 || /^(?=.{1,253}$)[a-z\d](?:[a-z\d.-]*[a-z\d])?$/i.test(host))) throw new ValidationError("Informe nome e IP ou hostname válido do switch");
    if (!this.models.includes(model)) throw new ValidationError("Modelo não suportado");
    if (!Number.isInteger(intervalSeconds) || intervalSeconds < 30 || intervalSeconds > 3600) throw new ValidationError("Intervalo deve estar entre 30 e 3600 segundos");
    if (!Number.isInteger(portCount) || portCount < 1 || portCount > 128) throw new ValidationError("Número de portas inválido");
    if (input.enabled !== undefined && typeof input.enabled !== "boolean") throw new ValidationError("enabled deve ser booleano");
    if (input.password !== undefined && (typeof input.password !== "string" || input.password.length > 4096)) throw new ValidationError("Senha inválida");
    const configs = this.configs();
    if (configs.some(c=>c.host.toLowerCase()===host.toLowerCase() && c.id!==id)) throw new ValidationError("Switch já cadastrado neste endereço");
    if (!old && configs.length >= 32) throw new ValidationError("Limite de 32 switches");
    const portNotes: Record<string,string> = {};
    const notes = input.portNotes ?? old?.portNotes ?? {};
    if (!notes || typeof notes !== "object" || Array.isArray(notes)) throw new ValidationError("Anotações de portas inválidas");
    for (const [key,value] of Object.entries(notes).slice(0,256)) {
      if (/^[\w .-]{1,40}$/.test(key) && typeof value === "string") portNotes[key]=text(value,300);
    }
    const next: SwitchConfig = { id: old?.id ?? randomUUID(), name, host, model, username, portCount, intervalSeconds,
      enabled: input.enabled as boolean | undefined ?? old?.enabled ?? true, uplink: text(input.uplink ?? old?.uplink,500), portNotes };
    if (input.password) {
      mkdirSync(this.directory, {recursive:true,mode:0o700}); chmodSync(this.directory,0o700);
      const temp = this.secret(next.id)+".tmp";
      writeFileSync(temp,input.password as string,{mode:0o600}); chmodSync(temp,0o600); renameSync(temp,this.secret(next.id));
    }
    this.store.setJson("switch_configs", [...configs.filter(c=>c.id!==next.id), next]);
    if (old && (old.host !== host || old.model !== model || old.username !== username)) this.store.setJson(`switch:${next.id}`, {snapshot:null,lastError:null,lastAttemptAt:null});
    this.attempts.delete(next.id); this.notify(); return next;
  }
  remove(id: string) {
    this.config(id);
    if (this.pending.has(id)) throw new ValidationError("Aguarde a coleta terminar antes de remover este switch");
    this.store.db.transaction(()=>{
      this.store.setJson("switch_configs", this.configs().filter(c=>c.id!==id));
      this.store.db.prepare("DELETE FROM kv WHERE key = ?").run(`switch:${id}`);
      this.store.db.prepare("DELETE FROM switch_port_samples WHERE switch_id = ?").run(id);
      const topology=this.store.getJson<PhysicalTopology>("physical_topology");
      if(topology)this.store.setJson("physical_topology",{...topology,...(topology.portNames?{portNames:Object.fromEntries(Object.entries(topology.portNames).filter(([key])=>key!==`switch:${id}`))}:{}),...(topology.portCounts?{portCounts:Object.fromEntries(Object.entries(topology.portCounts).filter(([key])=>key!==`switch:${id}`))}:{}),links:topology.links.filter(l=>l.source!==`switch:${id}`&&l.target!==`switch:${id}`)});
    })();
    if (existsSync(this.secret(id))) unlinkSync(this.secret(id));
    this.notify();
  }
  start() {
    if (this.timer) return;
    this.stopped=false;
    const tick=()=>{
      if (this.stopped) return;
      for (const c of this.configs()) {
        if(c.enabled && Date.now()-(this.attempts.get(c.id)??0) >= c.intervalSeconds*1000 && !this.pending.has(c.id)) void this.refresh(c.id).catch(()=>undefined);
      }
    };
    this.timer=setInterval(tick,5000); this.timer.unref(); tick();
  }
  async stop() {
    this.stopped=true;
    if(this.timer) clearInterval(this.timer); this.timer=null;
    for(const controller of this.controllers.values()) controller.abort();
    await Promise.allSettled([...this.pending.values()]);
  }
  private run<T>(id: string, action: (config: SwitchConfig, password: string, signal: AbortSignal)=>Promise<T>): Promise<T> {
    const config=this.config(id);
    if(!config.enabled) throw new ValidationError("Ative o switch para consultar");
    if(this.stopped) throw new ValidationError("Coletor encerrando");
    if(this.pending.has(id)) throw new ValidationError("Este switch já tem uma consulta em andamento");
    if(Date.now()-(this.attempts.get(id)??0)<10_000) throw new ValidationError("Aguarde 10 segundos entre consultas ao switch");
    this.attempts.set(id,Date.now());
    const controller=new AbortController();this.controllers.set(id,controller);
    const promise=Promise.resolve().then(()=>{
      if(controller.signal.aborted) throw new Error("Coleta cancelada");
      if(!existsSync(this.secret(id))) throw new ValidationError("Configure a senha do switch");
      return action(config,readFileSync(this.secret(id),"utf8"),controller.signal);
    }).finally(()=>{this.pending.delete(id);this.controllers.delete(id);this.notify();});
    this.pending.set(id,promise); this.notify();return promise;
  }
  refresh(id: string): Promise<void> {
    return this.run(id,async (config,password,signal)=>{
      const state=this.state(id);
      const lastAttemptAt=new Date().toISOString();
      this.store.setJson(`switch:${id}`,{...state,lastAttemptAt});
      try {
        const raw=await this.collect(config,password,"collect",signal);
        const snapshot=switchSnapshot(raw,state.snapshot,new Date().toISOString());
        if(!snapshot.mac || !snapshot.ports.length) throw new Error("Resposta inválida do coletor");
        this.store.db.transaction(()=>{
          this.store.setJson(`switch:${id}`,{snapshot,lastError:null,lastAttemptAt});
          const insert=this.store.db.prepare("INSERT OR REPLACE INTO switch_port_samples (switch_id,port,at,data) VALUES (?,?,?,?)");
          for(const p of snapshot.ports) insert.run(id,p.port,snapshot.at,JSON.stringify({at:snapshot.at,...p}));
          this.store.db.prepare("DELETE FROM switch_port_samples WHERE at < ?").run(new Date(Date.now()-this.retentionDays*86400_000).toISOString());
        })();
      } catch {
        if(signal.aborted) return;
        this.store.setJson(`switch:${id}`,{...state,lastAttemptAt,lastError:"Falha na coleta. Confira conexão, modelo, credenciais e dependências Python."});
      }
    }).catch(error=>{
      if(this.stopped) return;
      // Falhas anteriores à execução (senha ausente, por exemplo) também ficam visíveis.
      if (!this.pending.has(id) && !(error instanceof ValidationError && /andamento|10 segundos|Ative|encerrando/.test(error.message))) {
        const state=this.state(id);this.store.setJson(`switch:${id}`,{...state,lastError:"Configure a senha e confira as dependências do coletor."});this.notify();
      }
      throw error;
    });
  }
  transceiver(id: string) { return this.run(id,(config,password,signal)=>this.collect(config,password,"transceiver",signal)); }
  history(id: string, port: string, hours: number): PortSample[] {
    this.config(id);
    return (this.store.db.prepare("SELECT data FROM switch_port_samples WHERE switch_id = ? AND port = ? AND at >= ? ORDER BY at DESC LIMIT 2000")
      .all(id,port,new Date(Date.now()-hours*3600_000).toISOString()) as {data:string}[]).reverse().map(row=>JSON.parse(row.data) as PortSample);
  }
}
