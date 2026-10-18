/**
 * Inventário: o que o Deco não guarda. Um dispositivo tem apelido, dono,
 * tipo, tags, notas e um ou mais MACs (ex.: PC com cabo + Wi-Fi). Cada MAC
 * pertence a no máximo um dispositivo.
 */
import type Database from "better-sqlite3";
import { NotFoundError, optionalText, requireMac, requireText, stringList, ValidationError } from "./errors.js";

export const DEVICE_TYPES = ["pc", "notebook", "celular", "tablet", "tv", "iot", "impressora", "servidor", "rede", "outro"] as const;
export type DeviceType = (typeof DEVICE_TYPES)[number];

export interface Device {
  id: number;
  alias: string;
  owner: string | null;
  type: DeviceType | null;
  tags: string[];
  notes: string | null;
  /** Aprovado como conhecido (alertas de dispositivo novo). */
  approved: boolean;
  macs: string[];
  createdAt: string;
  updatedAt: string;
}

export interface DeviceInput {
  alias?: unknown;
  owner?: unknown;
  type?: unknown;
  tags?: unknown;
  notes?: unknown;
  approved?: unknown;
}

interface Row {
  id: number;
  alias: string;
  owner: string | null;
  type: string | null;
  tags: string;
  notes: string | null;
  approved: number;
  created_at: string;
  updated_at: string;
  macs: string | null;
}

function toDevice(r: Row): Device {
  return {
    id: r.id,
    alias: r.alias,
    owner: r.owner,
    type: r.type as DeviceType | null,
    tags: JSON.parse(r.tags) as string[],
    notes: r.notes,
    approved: r.approved === 1,
    macs: r.macs ? r.macs.split(",").sort() : [],
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function parseType(value: unknown): DeviceType | null {
  if (value === undefined || value === null || value === "") return null;
  if (!DEVICE_TYPES.includes(value as DeviceType)) {
    throw new ValidationError(`Tipo inválido. Use: ${DEVICE_TYPES.join(", ")}`);
  }
  return value as DeviceType;
}

/** Campos validados; só os presentes em `input` (para PATCH). */
function fields(input: DeviceInput, requireAlias: boolean) {
  const out: Partial<Omit<Device, "id" | "macs" | "createdAt" | "updatedAt">> = {};
  if (requireAlias || input.alias !== undefined) out.alias = requireText(input.alias, "Apelido", 80);
  if (input.owner !== undefined) out.owner = optionalText(input.owner, "Dono", 80);
  if (input.type !== undefined) out.type = parseType(input.type);
  if (input.tags !== undefined) out.tags = stringList(input.tags, "Tags", 20, 30);
  if (input.notes !== undefined) out.notes = optionalText(input.notes, "Notas", 2000);
  if (input.approved !== undefined) {
    if (typeof input.approved !== "boolean") throw new ValidationError("approved deve ser booleano");
    out.approved = input.approved;
  }
  return out;
}

const SELECT = `
  SELECT d.*, (SELECT group_concat(mac) FROM device_macs m WHERE m.device_id = d.id) AS macs
  FROM devices d
`;

export class InventoryRepo {
  constructor(
    private readonly db: Database.Database,
    private readonly now: () => Date = () => new Date(),
  ) {}

  list(): Device[] {
    return (this.db.prepare(`${SELECT} ORDER BY d.alias COLLATE NOCASE`).all() as Row[]).map(toDevice);
  }

  get(id: number): Device {
    const row = this.db.prepare(`${SELECT} WHERE d.id = ?`).get(id) as Row | undefined;
    if (!row) throw new NotFoundError(`Dispositivo ${id} não encontrado`);
    return toDevice(row);
  }

  findByMac(mac: string): Device | null {
    const row = this.db
      .prepare(`${SELECT} WHERE d.id = (SELECT device_id FROM device_macs WHERE mac = ?)`)
      .get(requireMac(mac)) as Row | undefined;
    return row ? toDevice(row) : null;
  }

  /** MAC → dispositivo, para juntar com a lista de clientes. */
  byMac(): Map<string, Device> {
    const out = new Map<string, Device>();
    for (const d of this.list()) for (const mac of d.macs) out.set(mac, d);
    return out;
  }

  create(input: DeviceInput & { macs?: unknown }): Device {
    const f = fields(input, true);
    const macs = stringList(input.macs, "MACs", 16, 20).map(requireMac);
    if (macs.length === 0) throw new ValidationError("Informe ao menos um MAC");
    const at = this.now().toISOString();
    return this.db.transaction(() => {
      const { lastInsertRowid } = this.db
        .prepare(
          `INSERT INTO devices (alias, owner, type, tags, notes, approved, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(f.alias!, f.owner ?? null, f.type ?? null, JSON.stringify(f.tags ?? []), f.notes ?? null, f.approved ? 1 : 0, at, at);
      const id = Number(lastInsertRowid);
      for (const mac of macs) this.moveMac(mac, id);
      return this.get(id);
    })();
  }

  update(id: number, input: DeviceInput): Device {
    this.get(id);
    const f = fields(input, false);
    const sets: string[] = [];
    const values: unknown[] = [];
    for (const [key, value] of Object.entries(f)) {
      sets.push(`${key} = ?`);
      values.push(key === "tags" ? JSON.stringify(value) : key === "approved" ? (value ? 1 : 0) : value);
    }
    if (sets.length === 0) return this.get(id);
    sets.push("updated_at = ?");
    values.push(this.now().toISOString(), id);
    this.db.prepare(`UPDATE devices SET ${sets.join(", ")} WHERE id = ?`).run(...values);
    return this.get(id);
  }

  delete(id: number): Device {
    const before = this.get(id);
    this.db.prepare("DELETE FROM devices WHERE id = ?").run(id);
    return before;
  }

  /** Associa o MAC ao dispositivo, tirando-o de onde estava (o anterior some se esvaziar). */
  attachMac(id: number, mac: string): Device {
    this.get(id);
    this.db.transaction(() => this.moveMac(requireMac(mac), id))();
    return this.get(id);
  }

  detachMac(id: number, mac: string): Device {
    const device = this.get(id);
    const canonical = requireMac(mac);
    if (!device.macs.includes(canonical)) throw new NotFoundError(`${canonical} não pertence a este dispositivo`);
    if (device.macs.length === 1) {
      throw new ValidationError("É o único MAC do dispositivo; exclua o dispositivo em vez disso");
    }
    this.db.prepare("DELETE FROM device_macs WHERE mac = ?").run(canonical);
    this.touch(id);
    return this.get(id);
  }

  /** Cria ou atualiza o dispositivo do MAC (edição a partir da lista de clientes). */
  upsertForMac(mac: string, input: DeviceInput): Device {
    const existing = this.findByMac(mac);
    return existing ? this.update(existing.id, input) : this.create({ ...input, macs: [mac] });
  }

  private moveMac(mac: string, id: number): void {
    const prev = this.db.prepare("SELECT device_id FROM device_macs WHERE mac = ?").get(mac) as
      | { device_id: number }
      | undefined;
    if (prev?.device_id === id) return;
    this.db
      .prepare("INSERT INTO device_macs (mac, device_id) VALUES (?, ?) ON CONFLICT(mac) DO UPDATE SET device_id = excluded.device_id")
      .run(mac, id);
    if (prev) {
      const left = this.db.prepare("SELECT count(*) AS n FROM device_macs WHERE device_id = ?").get(prev.device_id) as { n: number };
      if (left.n === 0) this.db.prepare("DELETE FROM devices WHERE id = ?").run(prev.device_id);
      else this.touch(prev.device_id);
    }
    this.touch(id);
  }

  private touch(id: number): void {
    this.db.prepare("UPDATE devices SET updated_at = ? WHERE id = ?").run(this.now().toISOString(), id);
  }
}
