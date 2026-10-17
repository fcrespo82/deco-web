/**
 * Persistência em SQLite. Guarda só o que o Deco não guarda: quando cada MAC
 * foi visto, desde quando cada nó está online, amostras para o gráfico de
 * clientes, e estado interno (último snapshot, circuit breaker).
 *
 * Nunca recebe a senha do Deco nem PSKs: o Snapshot já chega sem eles.
 */
import Database from "better-sqlite3";
import type { Snapshot } from "../deco-client/types.js";

/** Cada item roda uma vez, em ordem; o índice + 1 vira o user_version. */
export const MIGRATIONS: string[] = [
  `
  CREATE TABLE kv (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE client_seen (
    mac           TEXT PRIMARY KEY,
    first_seen    TEXT NOT NULL,
    last_seen     TEXT NOT NULL,
    last_ip       TEXT,
    last_name     TEXT,
    last_node_mac TEXT,
    last_band     TEXT
  );
  CREATE TABLE node_seen (
    mac          TEXT PRIMARY KEY,
    first_seen   TEXT NOT NULL,
    last_seen    TEXT NOT NULL,
    online_since TEXT,
    last_name    TEXT
  );
  CREATE TABLE samples (
    taken_at       TEXT PRIMARY KEY,
    online_clients INTEGER NOT NULL,
    nodes_online   INTEGER NOT NULL,
    nodes_total    INTEGER NOT NULL,
    by_band        TEXT NOT NULL
  );
  `,
  `
  CREATE TABLE devices (
    id         INTEGER PRIMARY KEY,
    alias      TEXT NOT NULL,
    owner      TEXT,
    type       TEXT,
    tags       TEXT NOT NULL DEFAULT '[]',
    notes      TEXT,
    approved   INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE device_macs (
    mac       TEXT PRIMARY KEY,
    device_id INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE
  );
  CREATE INDEX device_macs_device ON device_macs(device_id);
  CREATE TABLE ip_ranges (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    start_ip   INTEGER NOT NULL,
    end_ip     INTEGER NOT NULL,
    kind       TEXT NOT NULL,
    types      TEXT NOT NULL DEFAULT '[]',
    notes      TEXT,
    position   INTEGER NOT NULL
  );
  CREATE TABLE events (
    id   INTEGER PRIMARY KEY,
    at   TEXT NOT NULL,
    type TEXT NOT NULL,
    mac  TEXT,
    data TEXT NOT NULL DEFAULT '{}'
  );
  CREATE INDEX events_at ON events(at);
  CREATE INDEX events_mac ON events(mac, at);
  CREATE TABLE audit_log (
    id     INTEGER PRIMARY KEY,
    at     TEXT NOT NULL,
    actor  TEXT NOT NULL,
    action TEXT NOT NULL,
    target TEXT,
    before TEXT,
    after  TEXT,
    result TEXT NOT NULL DEFAULT 'ok'
  );
  CREATE INDEX audit_at ON audit_log(at);
  `,
];

export interface ClientSeen {
  mac: string;
  firstSeen: string;
  lastSeen: string;
  lastIp: string | null;
  lastName: string | null;
  lastNodeMac: string | null;
  lastBand: string | null;
}

export interface NodeSeen {
  mac: string;
  firstSeen: string;
  lastSeen: string;
  /** Início do período online atual, medido pelo poller. null se offline. */
  onlineSince: string | null;
  lastName: string | null;
}

export interface Sample {
  takenAt: string;
  onlineClients: number;
  nodesOnline: number;
  nodesTotal: number;
  byBand: Record<string, number>;
}

export class Store {
  readonly db: Database.Database;

  constructor(path: string) {
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.migrate();
  }

  private migrate(): void {
    const current = this.db.pragma("user_version", { simple: true }) as number;
    for (let i = current; i < MIGRATIONS.length; i++) {
      this.db.transaction(() => {
        this.db.exec(MIGRATIONS[i]!);
        this.db.pragma(`user_version = ${i + 1}`);
      })();
    }
  }

  close(): void {
    this.db.close();
  }

  // --- kv -------------------------------------------------------------

  getJson<T>(key: string): T | null {
    const row = this.db.prepare("SELECT value FROM kv WHERE key = ?").get(key) as
      | { value: string }
      | undefined;
    return row ? (JSON.parse(row.value) as T) : null;
  }

  setJson(key: string, value: unknown): void {
    this.db
      .prepare("INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(key, JSON.stringify(value));
  }

  // --- snapshots ------------------------------------------------------

  latestSnapshot(): Snapshot | null {
    return this.getJson<Snapshot>("latest_snapshot");
  }

  /** Grava o snapshot e atualiza as tabelas de "visto", numa transação. */
  recordSnapshot(snap: Snapshot): void {
    const at = snap.takenAt;
    const upsertClient = this.db.prepare(`
      INSERT INTO client_seen (mac, first_seen, last_seen, last_ip, last_name, last_node_mac, last_band)
      VALUES (@mac, @at, @at, @ip, @name, @nodeMac, @band)
      ON CONFLICT(mac) DO UPDATE SET
        last_seen = excluded.last_seen,
        last_ip = excluded.last_ip,
        last_name = excluded.last_name,
        last_node_mac = COALESCE(excluded.last_node_mac, client_seen.last_node_mac),
        last_band = excluded.last_band
    `);
    const upsertNode = this.db.prepare(`
      INSERT INTO node_seen (mac, first_seen, last_seen, online_since, last_name)
      VALUES (@mac, @at, @at, CASE WHEN @online THEN @at END, @name)
      ON CONFLICT(mac) DO UPDATE SET
        last_seen = CASE WHEN @online THEN excluded.last_seen ELSE node_seen.last_seen END,
        online_since = CASE
          WHEN NOT @online THEN NULL
          ELSE COALESCE(node_seen.online_since, excluded.last_seen)
        END,
        last_name = excluded.last_name
    `);
    // Nó que sumiu da device_list também está offline.
    const markMissingNodes = this.db.prepare(
      `UPDATE node_seen SET online_since = NULL WHERE mac NOT IN (SELECT value FROM json_each(?))`,
    );
    const insertSample = this.db.prepare(`
      INSERT OR REPLACE INTO samples (taken_at, online_clients, nodes_online, nodes_total, by_band)
      VALUES (?, ?, ?, ?, ?)
    `);

    const byBand: Record<string, number> = {};
    for (const c of snap.clients) byBand[c.band] = (byBand[c.band] ?? 0) + 1;

    this.db.transaction(() => {
      for (const c of snap.clients) {
        upsertClient.run({ mac: c.mac, at, ip: c.ip, name: c.name, nodeMac: c.nodeMac, band: c.band });
      }
      for (const n of snap.nodes) {
        upsertNode.run({ mac: n.mac, at, online: n.online ? 1 : 0, name: n.name });
      }
      markMissingNodes.run(JSON.stringify(snap.nodes.map((n) => n.mac)));
      insertSample.run(
        at,
        snap.clients.length,
        snap.nodes.filter((n) => n.online).length,
        snap.nodes.length,
        JSON.stringify(byBand),
      );
      this.setJson("latest_snapshot", snap);
    })();
  }

  clientSeen(): Map<string, ClientSeen> {
    const rows = this.db.prepare("SELECT * FROM client_seen").all() as Record<string, string | null>[];
    return new Map(
      rows.map((r) => [
        r.mac!,
        {
          mac: r.mac!,
          firstSeen: r.first_seen!,
          lastSeen: r.last_seen!,
          lastIp: r.last_ip ?? null,
          lastName: r.last_name ?? null,
          lastNodeMac: r.last_node_mac ?? null,
          lastBand: r.last_band ?? null,
        },
      ]),
    );
  }

  nodeSeen(): Map<string, NodeSeen> {
    const rows = this.db.prepare("SELECT * FROM node_seen").all() as Record<string, string | null>[];
    return new Map(
      rows.map((r) => [
        r.mac!,
        {
          mac: r.mac!,
          firstSeen: r.first_seen!,
          lastSeen: r.last_seen!,
          onlineSince: r.online_since ?? null,
          lastName: r.last_name ?? null,
        },
      ]),
    );
  }

  samples(sinceIso: string): Sample[] {
    const rows = this.db
      .prepare("SELECT * FROM samples WHERE taken_at >= ? ORDER BY taken_at")
      .all(sinceIso) as Record<string, string | number>[];
    return rows.map((r) => ({
      takenAt: r.taken_at as string,
      onlineClients: r.online_clients as number,
      nodesOnline: r.nodes_online as number,
      nodesTotal: r.nodes_total as number,
      byBand: JSON.parse(r.by_band as string) as Record<string, number>,
    }));
  }

  /** Remove amostras anteriores a `beforeIso`. Retorna quantas saíram. */
  pruneSamples(beforeIso: string): number {
    return this.db.prepare("DELETE FROM samples WHERE taken_at < ?").run(beforeIso).changes;
  }
}
