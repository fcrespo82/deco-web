/**
 * Log de auditoria: quem, quando, o quê, antes/depois. Registra mudanças
 * locais (inventário, plano) e, a partir da etapa de escrita, ações no Deco.
 * Nunca recebe senhas: os valores gravados são objetos de domínio.
 */
import type Database from "better-sqlite3";

export interface AuditEntry {
  id: number;
  at: string;
  actor: string;
  action: string;
  target: string | null;
  before: unknown;
  after: unknown;
  result: string;
}

export interface AuditInput {
  actor: string;
  action: string;
  target?: string | null;
  before?: unknown;
  after?: unknown;
  result?: string;
}

export class AuditRepo {
  constructor(
    private readonly db: Database.Database,
    private readonly now: () => Date = () => new Date(),
  ) {}

  record(e: AuditInput): void {
    this.db
      .prepare("INSERT INTO audit_log (at, actor, action, target, before, after, result) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(
        this.now().toISOString(),
        e.actor,
        e.action,
        e.target ?? null,
        e.before === undefined ? null : JSON.stringify(e.before),
        e.after === undefined ? null : JSON.stringify(e.after),
        e.result ?? "ok",
      );
  }

  list(limit = 100, beforeId?: number): AuditEntry[] {
    const rows = this.db
      .prepare(`SELECT * FROM audit_log ${beforeId ? "WHERE id < ?" : ""} ORDER BY id DESC LIMIT ?`)
      .all(...(beforeId ? [beforeId, limit] : [limit])) as Record<string, string | number | null>[];
    return rows.map((r) => ({
      id: r.id as number,
      at: r.at as string,
      actor: r.actor as string,
      action: r.action as string,
      target: r.target as string | null,
      before: r.before ? JSON.parse(r.before as string) : null,
      after: r.after ? JSON.parse(r.after as string) : null,
      result: r.result as string,
    }));
  }
}
