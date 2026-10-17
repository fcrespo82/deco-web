/**
 * Log dos alertas enviados (ou tentados), com o resultado por canal.
 */
import type Database from "better-sqlite3";
import type { Delivery } from "../notify/channels.js";

export type AlertKind = "new_device" | "node_offline" | "node_online" | "internet_down" | "internet_up" | "test";

export interface AlertEntry {
  id: number;
  at: string;
  kind: AlertKind;
  mac: string | null;
  title: string;
  body: string;
  delivery: Delivery[];
}

export class AlertRepo {
  constructor(private readonly db: Database.Database) {}

  insert(e: Omit<AlertEntry, "id">): AlertEntry {
    const { lastInsertRowid } = this.db
      .prepare("INSERT INTO alerts (at, kind, mac, title, body, delivery) VALUES (?, ?, ?, ?, ?, ?)")
      .run(e.at, e.kind, e.mac, e.title, e.body, JSON.stringify(e.delivery));
    return { ...e, id: Number(lastInsertRowid) };
  }

  list(limit = 100, beforeId?: number): AlertEntry[] {
    const rows = this.db
      .prepare(`SELECT * FROM alerts ${beforeId ? "WHERE id < ?" : ""} ORDER BY id DESC LIMIT ?`)
      .all(...(beforeId ? [beforeId, limit] : [limit])) as Record<string, string | number | null>[];
    return rows.map((r) => ({
      id: r.id as number,
      at: r.at as string,
      kind: r.kind as AlertKind,
      mac: r.mac as string | null,
      title: r.title as string,
      body: r.body as string,
      delivery: JSON.parse(r.delivery as string) as Delivery[],
    }));
  }

  prune(beforeIso: string): number {
    return this.db.prepare("DELETE FROM alerts WHERE at < ?").run(beforeIso).changes;
  }
}
