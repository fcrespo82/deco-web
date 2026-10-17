/**
 * Backup em JSON: reservas (do Deco), inventário e plano de IPs.
 *
 * A importação é uma mesclagem: acrescenta e atualiza, nunca apaga o que só
 * existe aqui. Antes de aplicar, `diffBackup` mostra exatamente o que muda,
 * seção por seção. Reservas passam pela mesma porta de escrita do resto
 * (DECO_ALLOW_WRITE, fila, verificação, auditoria).
 *
 * Nada de segredo entra no arquivo: nem senha, nem PSK, nem tokens.
 */
import type { Reservation, Snapshot } from "../deco-client/types.js";
import { requireMac, ValidationError } from "../db/errors.js";
import { DEVICE_TYPES, type Device } from "../db/inventory.js";
import type { IpRange } from "../db/ipranges.js";
import { intToIp, parseRangeSpec, type Subnet } from "./ipmath.js";
import { lanSubnet } from "./ipplan.js";
import type { ReservationChange } from "./reservations.js";

export const BACKUP_FORMAT = "deco-web-backup";
export const BACKUP_VERSION = 1;

export interface BackupDevice {
  alias: string;
  owner: string | null;
  type: string | null;
  tags: string[];
  notes: string | null;
  approved: boolean;
  macs: string[];
}

export interface BackupRange {
  name: string;
  /** IPs completos: "192.168.68.40-192.168.68.59". */
  spec: string;
  kind: "static" | "dynamic";
  types: string[];
  notes: string | null;
}

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  version: number;
  exportedAt: string;
  /** Rede de origem, ex.: "192.168.68.0/24". */
  network: string | null;
  /** null quando o painel ainda não tinha lido o Deco. */
  reservations: Reservation[] | null;
  devices: BackupDevice[];
  ranges: BackupRange[];
}

const networkOf = (snap: Snapshot | null): string | null => {
  const lan = lanSubnet(snap);
  return lan ? `${intToIp(lan.subnet.base)}/${lan.subnet.prefix}` : null;
};

export function buildBackup(input: { snapshot: Snapshot | null; devices: Device[]; ranges: IpRange[]; now: Date }): BackupFile {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: input.now.toISOString(),
    network: networkOf(input.snapshot),
    reservations: input.snapshot ? input.snapshot.reservations.map((r) => ({ mac: r.mac, ip: r.ip })) : null,
    devices: input.devices.map((d) => ({
      alias: d.alias,
      owner: d.owner,
      type: d.type,
      tags: d.tags,
      notes: d.notes,
      approved: d.approved,
      macs: d.macs,
    })),
    ranges: input.ranges.map((r) => ({
      name: r.name,
      spec: `${intToIp(r.start)}-${intToIp(r.end)}`,
      kind: r.kind,
      types: r.types,
      notes: r.notes,
    })),
  };
}

// --- validação do arquivo ----------------------------------------------

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown, field: string, max: number, optional = false): string | null => {
  if (v === null || v === undefined || v === "") {
    if (optional) return null;
    throw new ValidationError(`Backup: ${field} ausente`);
  }
  if (typeof v !== "string" || v.length > max) throw new ValidationError(`Backup: ${field} inválido`);
  return v;
};
const list = (v: unknown, field: string, max: number): unknown[] => {
  if (!Array.isArray(v) || v.length > max) throw new ValidationError(`Backup: ${field} deve ser uma lista (máx. ${max})`);
  return v;
};
const strings = (v: unknown, field: string): string[] =>
  list(v ?? [], field, 32).map((x) => text(x, field, 60)!);

/** Valida e normaliza um arquivo de backup. Lança ValidationError. */
export function parseBackup(raw: unknown): BackupFile {
  if (!isObj(raw) || raw.format !== BACKUP_FORMAT) throw new ValidationError("Não é um backup do Deco Dashboard.");
  if (raw.version !== BACKUP_VERSION) throw new ValidationError(`Versão de backup não suportada: ${String(raw.version)}`);
  const ipv4 = /^(\d{1,3}\.){3}\d{1,3}$/;
  const reservations =
    raw.reservations === null
      ? null
      : list(raw.reservations, "reservas", 512).map((r, i) => {
          if (!isObj(r) || typeof r.ip !== "string" || !ipv4.test(r.ip)) throw new ValidationError(`Backup: reserva ${i + 1} inválida`);
          return { mac: requireMac(r.mac), ip: r.ip };
        });
  const devices = list(raw.devices ?? [], "dispositivos", 2000).map((d, i) => {
    if (!isObj(d)) throw new ValidationError(`Backup: dispositivo ${i + 1} inválido`);
    const type = text(d.type, "tipo", 20, true);
    if (type && !(DEVICE_TYPES as readonly string[]).includes(type)) throw new ValidationError(`Backup: tipo inválido "${type}"`);
    const macs = list(d.macs, "MACs", 16).map(requireMac);
    if (macs.length === 0) throw new ValidationError(`Backup: dispositivo "${String(d.alias)}" sem MAC`);
    return {
      alias: text(d.alias, "apelido", 80)!,
      owner: text(d.owner, "dono", 80, true),
      type,
      tags: strings(d.tags, "tags"),
      notes: text(d.notes, "notas", 2000, true),
      approved: d.approved === true,
      macs,
    };
  });
  const ranges = list(raw.ranges ?? [], "faixas", 256).map((r, i) => {
    if (!isObj(r) || (r.kind !== "static" && r.kind !== "dynamic")) throw new ValidationError(`Backup: faixa ${i + 1} inválida`);
    return {
      name: text(r.name, "nome da faixa", 60)!,
      spec: text(r.spec, "endereços da faixa", 60)!,
      kind: r.kind,
      types: strings(r.types, "tipos da faixa"),
      notes: text(r.notes, "notas da faixa", 500, true),
    } satisfies BackupRange;
  });
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: text(raw.exportedAt, "data", 40) ?? "",
    network: text(raw.network, "rede", 40, true),
    reservations,
    devices,
    ranges,
  };
}

// --- diferença ------------------------------------------------------------

export interface FieldChange {
  field: string;
  from: unknown;
  to: unknown;
}

export interface DeviceDiff {
  /** Posição em backup.devices. */
  index: number;
  action: "add" | "update";
  alias: string;
  macs: string[];
  /** Dispositivos locais que serão atualizados/juntados (por MAC em comum). */
  localIds: number[];
  changes: FieldChange[];
}

export interface RangeDiff {
  /** Posição em backup.ranges. */
  index: number;
  action: "add" | "update" | "conflict";
  name: string;
  label: string;
  localId: number | null;
  changes: FieldChange[];
  reason?: string;
}

export interface ReservationDiff {
  action: "add" | "move" | "conflict";
  mac: string;
  name: string | null;
  from: string | null;
  to: string;
  reason?: string;
}

export interface BackupDiff {
  exportedAt: string;
  network: { backup: string | null; current: string | null; matches: boolean };
  devices: { changes: DeviceDiff[]; unchanged: number; localOnly: number };
  ranges: { changes: RangeDiff[]; unchanged: number; localOnly: number };
  reservations: {
    /** Motivo para não poder importar (somente leitura, outra rede, sem dados). */
    blocked: string | null;
    changes: ReservationDiff[];
    unchanged: number;
    localOnly: number;
  };
}

const sameList = (a: readonly string[], b: readonly string[]) => [...a].sort().join("\n") === [...b].sort().join("\n");

function deviceChanges(local: Device, b: BackupDevice): FieldChange[] {
  const out: FieldChange[] = [];
  const cmp = (field: string, from: unknown, to: unknown, equal = from === to) => {
    if (!equal) out.push({ field, from, to });
  };
  cmp("alias", local.alias, b.alias);
  cmp("owner", local.owner, b.owner);
  cmp("type", local.type, b.type);
  cmp("tags", local.tags, b.tags, sameList(local.tags, b.tags));
  cmp("notes", local.notes, b.notes);
  cmp("approved", local.approved, b.approved);
  const merged = [...new Set([...local.macs, ...b.macs])];
  cmp("macs", local.macs, merged, sameList(local.macs, merged));
  return out;
}

export interface DiffInput {
  backup: BackupFile;
  snapshot: Snapshot | null;
  devices: Device[];
  ranges: IpRange[];
  allowWrite: boolean;
  /** Nome para exibir um MAC (apelido ou nome do Deco). */
  nameOf: (mac: string) => string | null;
}

export function diffBackup(input: DiffInput): BackupDiff {
  const { backup, snapshot } = input;
  const current = networkOf(snapshot);
  const matches = !backup.network || !current || backup.network === current;

  // --- dispositivos: casam por MAC em comum ---
  const byMac = new Map<string, Device>();
  for (const d of input.devices) for (const m of d.macs) byMac.set(m, d);
  const touched = new Set<number>();
  const devChanges: DeviceDiff[] = [];
  let devUnchanged = 0;
  for (const [index, b] of backup.devices.entries()) {
    const locals = [...new Map(b.macs.map((m) => byMac.get(m)).filter((d): d is Device => !!d).map((d) => [d.id, d])).values()];
    for (const l of locals) touched.add(l.id);
    if (locals.length === 0) {
      devChanges.push({ index, action: "add", alias: b.alias, macs: b.macs, localIds: [], changes: [] });
      continue;
    }
    const changes = deviceChanges(locals[0]!, b);
    if (locals.length > 1) changes.push({ field: "merge", from: locals.map((l) => l.alias), to: b.alias });
    if (changes.length === 0) devUnchanged += 1;
    else devChanges.push({ index, action: "update", alias: b.alias, macs: b.macs, localIds: locals.map((l) => l.id), changes });
  }

  // --- faixas: casam por nome; sobreposição no resultado final é conflito ---
  const subnet = lanSubnet(snapshot)?.subnet ?? null;
  const rangeChanges: RangeDiff[] = [];
  let rangeUnchanged = 0;
  const final = new Map<string, { start: number; end: number; name: string }>();
  for (const r of input.ranges) final.set(`local:${r.id}`, { start: r.start, end: r.end, name: r.name });
  const parsed: { index: number; b: BackupRange; local: IpRange | null; start: number; end: number; error?: string }[] = [];
  for (const [index, b] of backup.ranges.entries()) {
    const local = input.ranges.find((r) => r.name.toLowerCase() === b.name.toLowerCase()) ?? null;
    try {
      if (!subnet) throw new Error("sem dados do Deco para saber a rede");
      const { start, end } = parseRangeSpec(b.spec, subnet as Subnet);
      parsed.push({ index, b, local, start, end });
      final.set(local ? `local:${local.id}` : `new:${b.name}`, { start, end, name: b.name });
    } catch (err) {
      parsed.push({ index, b, local, start: 0, end: 0, error: (err as Error).message });
    }
  }
  for (const p of parsed) {
    const label = p.error ? p.b.spec : rangeLabel(p.start, p.end);
    if (p.error) {
      rangeChanges.push({ index: p.index, action: "conflict", name: p.b.name, label, localId: p.local?.id ?? null, changes: [], reason: p.error });
      continue;
    }
    const key = p.local ? `local:${p.local.id}` : `new:${p.b.name}`;
    const clash = [...final].find(([k, r]) => k !== key && r.start <= p.end && p.start <= r.end);
    const changes: FieldChange[] = [];
    if (p.local) {
      if (p.local.start !== p.start || p.local.end !== p.end) changes.push({ field: "spec", from: p.local.label, to: label });
      if (p.local.kind !== p.b.kind) changes.push({ field: "kind", from: p.local.kind, to: p.b.kind });
      if (!sameList(p.local.types, p.b.types)) changes.push({ field: "types", from: p.local.types, to: p.b.types });
      if (p.local.notes !== p.b.notes) changes.push({ field: "notes", from: p.local.notes, to: p.b.notes });
    }
    if (clash) {
      rangeChanges.push({
        index: p.index,
        action: "conflict",
        name: p.b.name,
        label,
        localId: p.local?.id ?? null,
        changes,
        reason: `sobrepõe "${clash[1].name}"`,
      });
    } else if (!p.local) rangeChanges.push({ index: p.index, action: "add", name: p.b.name, label, localId: null, changes: [] });
    else if (changes.length) rangeChanges.push({ index: p.index, action: "update", name: p.b.name, label, localId: p.local.id, changes });
    else rangeUnchanged += 1;
  }
  const matchedRanges = new Set(parsed.map((p) => p.local?.id).filter(Boolean));

  // --- reservas: só acrescenta ou move; nunca remove ---
  const resChanges: ReservationDiff[] = [];
  let resUnchanged = 0;
  let blocked: string | null = null;
  if (!backup.reservations) blocked = "O backup não tem reservas.";
  else if (!snapshot) blocked = "Ainda sem dados do Deco.";
  else if (!matches) blocked = `O backup é da rede ${backup.network}; esta é ${current}.`;
  if (backup.reservations && snapshot) {
    const now = new Map(snapshot.reservations.map((r) => [r.mac, r.ip]));
    const holder = new Map(snapshot.reservations.map((r) => [r.ip, r.mac]));
    const target = new Map(backup.reservations.map((r) => [r.mac, r.ip]));
    for (const r of backup.reservations) {
      const from = now.get(r.mac) ?? null;
      if (from === r.ip) {
        resUnchanged += 1;
        continue;
      }
      const owner = holder.get(r.ip);
      // O IP está com outro MAC que não sai dele neste backup: conflito.
      const ownerLeaves = owner ? target.has(owner) && target.get(owner) !== r.ip : true;
      const reason = owner && !ownerLeaves ? `${r.ip} está reservado para ${input.nameOf(owner) ?? owner}` : undefined;
      resChanges.push({
        action: reason ? "conflict" : from ? "move" : "add",
        mac: r.mac,
        name: input.nameOf(r.mac),
        from,
        to: r.ip,
        reason,
      });
    }
    if (!blocked && !input.allowWrite && resChanges.some((c) => c.action !== "conflict")) {
      blocked = "Somente leitura: inicie com DECO_ALLOW_WRITE=1 para importar reservas.";
    }
  }
  const backupMacs = new Set((backup.reservations ?? []).map((r) => r.mac));

  return {
    exportedAt: backup.exportedAt,
    network: { backup: backup.network, current, matches },
    devices: { changes: devChanges, unchanged: devUnchanged, localOnly: input.devices.filter((d) => !touched.has(d.id)).length },
    ranges: {
      changes: rangeChanges,
      unchanged: rangeUnchanged,
      localOnly: input.ranges.filter((r) => !matchedRanges.has(r.id)).length,
    },
    reservations: {
      blocked,
      changes: resChanges,
      unchanged: resUnchanged,
      localOnly: snapshot ? snapshot.reservations.filter((r) => !backupMacs.has(r.mac)).length : 0,
    },
  };
}

function rangeLabel(start: number, end: number): string {
  return start === end ? `.${start & 255}` : `.${start & 255}–.${end & 255}`;
}

/**
 * Ordena as mudanças de reserva para que quem libera um IP vá antes de quem
 * o ocupa. Ciclos (troca A↔B) ficam no fim e falham com conflito — o painel
 * não inventa um IP temporário.
 */
export function orderReservationChanges(diffs: ReservationDiff[], current: Reservation[]): ReservationChange[] {
  const pending = diffs.filter((d) => d.action !== "conflict");
  const holder = new Map(current.map((r) => [r.ip, r.mac]));
  const out: ReservationChange[] = [];
  let progress = true;
  while (pending.length && progress) {
    progress = false;
    for (let i = 0; i < pending.length; i++) {
      const d = pending[i]!;
      const owner = holder.get(d.to);
      if (owner && owner !== d.mac) continue;
      out.push(d.from ? { op: "move", mac: d.mac, ip: d.to } : { op: "add", mac: d.mac, ip: d.to });
      if (d.from) holder.delete(d.from);
      holder.set(d.to, d.mac);
      pending.splice(i, 1);
      i -= 1;
      progress = true;
    }
  }
  for (const d of pending) out.push(d.from ? { op: "move", mac: d.mac, ip: d.to } : { op: "add", mac: d.mac, ip: d.to });
  return out;
}

