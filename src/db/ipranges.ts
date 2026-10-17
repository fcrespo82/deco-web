/** Faixas nomeadas do plano de IPs (ex.: ".8/29 Confiáveis"). */
import type Database from "better-sqlite3";
import { formatRange, parseRangeSpec, type Subnet } from "../core/ipmath.js";
import { DEVICE_TYPES, type DeviceType } from "./inventory.js";
import { NotFoundError, optionalText, requireText, stringList, ValidationError } from "./errors.js";

/**
 * static: endereços fixos, só por reserva (um cliente dinâmico aqui é anomalia).
 * dynamic: onde o DHCP do Deco distribui endereços (documentação; o pool real
 * só é configurável pelo app).
 */
export type RangeKind = "static" | "dynamic";

export interface IpRange {
  id: number;
  name: string;
  start: number;
  end: number;
  /** Representação curta: ".8/29", ".20–.39". */
  label: string;
  kind: RangeKind;
  /** Tipos de dispositivo esperados; vazio = qualquer. */
  types: DeviceType[];
  notes: string | null;
  position: number;
}

export interface RangeInput {
  name?: unknown;
  spec?: unknown;
  kind?: unknown;
  types?: unknown;
  notes?: unknown;
}

interface Row {
  id: number;
  name: string;
  start_ip: number;
  end_ip: number;
  kind: string;
  types: string;
  notes: string | null;
  position: number;
}

const toRange = (r: Row): IpRange => ({
  id: r.id,
  name: r.name,
  start: r.start_ip,
  end: r.end_ip,
  label: formatRange(r.start_ip, r.end_ip),
  kind: r.kind as RangeKind,
  types: JSON.parse(r.types) as DeviceType[],
  notes: r.notes,
  position: r.position,
});

export class IpRangeRepo {
  constructor(private readonly db: Database.Database) {}

  list(): IpRange[] {
    return (this.db.prepare("SELECT * FROM ip_ranges ORDER BY start_ip").all() as Row[]).map(toRange);
  }

  get(id: number): IpRange {
    const row = this.db.prepare("SELECT * FROM ip_ranges WHERE id = ?").get(id) as Row | undefined;
    if (!row) throw new NotFoundError(`Faixa ${id} não encontrada`);
    return toRange(row);
  }

  private validate(input: RangeInput, subnet: Subnet, current?: IpRange) {
    const name = input.name !== undefined || !current ? requireText(input.name, "Nome", 60) : current.name;
    let start = current?.start;
    let end = current?.end;
    if (input.spec !== undefined || !current) {
      try {
        ({ start, end } = parseRangeSpec(requireText(input.spec, "Faixa", 60), subnet));
      } catch (err) {
        throw new ValidationError((err as Error).message);
      }
    }
    const kind = input.kind !== undefined || !current ? input.kind : current.kind;
    if (kind !== "static" && kind !== "dynamic") throw new ValidationError('Tipo de faixa: "static" ou "dynamic"');
    const types =
      input.types !== undefined || !current ? stringList(input.types, "Tipos", DEVICE_TYPES.length, 20) : current.types;
    for (const t of types) {
      if (!DEVICE_TYPES.includes(t as DeviceType)) throw new ValidationError(`Tipo de dispositivo inválido: ${t}`);
    }
    const notes = input.notes !== undefined || !current ? optionalText(input.notes, "Notas", 500) : current.notes;

    const clash = this.list().find((r) => r.id !== current?.id && r.start <= end! && start! <= r.end);
    if (clash) throw new ValidationError(`Sobrepõe a faixa "${clash.name}" (${clash.label})`);
    return { name, start: start!, end: end!, kind: kind as RangeKind, types: types as DeviceType[], notes };
  }

  create(input: RangeInput, subnet: Subnet): IpRange {
    const v = this.validate(input, subnet);
    const position = (this.db.prepare("SELECT coalesce(max(position), -1) + 1 AS p FROM ip_ranges").get() as { p: number }).p;
    const { lastInsertRowid } = this.db
      .prepare("INSERT INTO ip_ranges (name, start_ip, end_ip, kind, types, notes, position) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(v.name, v.start, v.end, v.kind, JSON.stringify(v.types), v.notes, position);
    return this.get(Number(lastInsertRowid));
  }

  update(id: number, input: RangeInput, subnet: Subnet): IpRange {
    const v = this.validate(input, subnet, this.get(id));
    this.db
      .prepare("UPDATE ip_ranges SET name = ?, start_ip = ?, end_ip = ?, kind = ?, types = ?, notes = ? WHERE id = ?")
      .run(v.name, v.start, v.end, v.kind, JSON.stringify(v.types), v.notes, id);
    return this.get(id);
  }

  delete(id: number): IpRange {
    const before = this.get(id);
    this.db.prepare("DELETE FROM ip_ranges WHERE id = ?").run(id);
    return before;
  }
}
