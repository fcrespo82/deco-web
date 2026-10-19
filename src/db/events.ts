/** Histórico de eventos da rede, com retenção configurável. */
import type Database from "better-sqlite3";
import type { NetEvent, NetEventType } from "../core/events.js";

export interface StoredEvent extends NetEvent {
  id: number;
}

export interface EventQuery {
  limit?: number;
  beforeId?: number;
  types?: NetEventType[];
  macs?: string[];
  sinceIso?: string;
}

export class EventRepo {
  constructor(private readonly db: Database.Database) {}

  insert(events: NetEvent[]): void {
    if (events.length === 0) return;
    const stmt = this.db.prepare("INSERT INTO events (at, type, mac, data) VALUES (?, ?, ?, ?)");
    this.db.transaction(() => {
      for (const e of events) stmt.run(e.at, e.type, e.mac, JSON.stringify(e.data));
    })();
  }

  list(q: EventQuery = {}): StoredEvent[] {
    const where: string[] = [];
    const args: unknown[] = [];
    if (q.beforeId) {
      where.push("id < ?");
      args.push(q.beforeId);
    }
    if (q.types?.length) {
      where.push(`type IN (${q.types.map(() => "?").join(",")})`);
      args.push(...q.types);
    }
    if (q.macs?.length) {
      where.push(`mac IN (${q.macs.map(() => "?").join(",")})`);
      args.push(...q.macs);
    }
    if (q.sinceIso) {
      where.push("at >= ?");
      args.push(q.sinceIso);
    }
    const limit = Math.min(Math.max(q.limit ?? 100, 1), 500);
    const rows = this.db
      .prepare(`SELECT * FROM events ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY id DESC LIMIT ?`)
      .all(...args, limit) as { id: number; at: string; type: string; mac: string | null; data: string }[];
    return rows.map((r) => ({
      id: r.id,
      at: r.at,
      type: r.type as NetEventType,
      mac: r.mac,
      data: JSON.parse(r.data) as Record<string, unknown>,
    }));
  }

  /** Eventos dos tipos dados na janela [from, to], do mais antigo ao mais novo. */
  between(fromIso: string, toIso: string, types: NetEventType[], max = 50_000): StoredEvent[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM events WHERE at >= ? AND at <= ? AND type IN (${types.map(() => "?").join(",")}) ORDER BY at, id LIMIT ?`,
      )
      .all(fromIso, toIso, ...types, max) as { id: number; at: string; type: string; mac: string | null; data: string }[];
    return rows.map((r) => ({ id: r.id, at: r.at, type: r.type as NetEventType, mac: r.mac, data: JSON.parse(r.data) as Record<string, unknown> }));
  }

  /** Último evento (dos tipos dados) de cada MAC antes de `beforeIso`. */
  lastBefore(beforeIso: string, types: NetEventType[]): Map<string, NetEventType> {
    // No SQLite, colunas soltas num GROUP BY com MAX() vêm da linha do máximo.
    const rows = this.db
      .prepare(
        `SELECT mac, type, MAX(at) AS at FROM events WHERE at < ? AND mac IS NOT NULL AND type IN (${types.map(() => "?").join(",")}) GROUP BY mac`,
      )
      .all(beforeIso, ...types) as { mac: string; type: string }[];
    return new Map(rows.map((r) => [r.mac, r.type as NetEventType]));
  }

  prune(beforeIso: string): number {
    return this.db.prepare("DELETE FROM events WHERE at < ?").run(beforeIso).changes;
  }
}
