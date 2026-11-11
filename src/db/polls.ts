import type Database from "better-sqlite3";
export interface PollAttempt {
  id: number; startedAt: string; endedAt: string; durationMs: number;
  outcome: "success" | "failure"; category: "auth" | "busy" | "other" | null;
}
export class PollRepo {
  constructor(private db: Database.Database) {}
  record(attempt: Omit<PollAttempt, "id">): void {
    this.db.transaction(() => {
      this.db.prepare("INSERT INTO poll_attempts (startedAt, endedAt, durationMs, outcome, category) VALUES (?, ?, ?, ?, ?)")
        .run(attempt.startedAt, attempt.endedAt, attempt.durationMs, attempt.outcome, attempt.category);
      this.db.prepare("DELETE FROM poll_attempts WHERE id NOT IN (SELECT id FROM poll_attempts ORDER BY id DESC LIMIT 200)").run();
    })();
  }
  list(): PollAttempt[] { return this.db.prepare("SELECT * FROM poll_attempts ORDER BY id DESC LIMIT 100").all() as PollAttempt[]; }
  view() {
    const attempts = this.list();
    const successes = attempts.filter(a => a.outcome === "success").length;
    const firstSuccess = attempts.findIndex(a => a.outcome === "success");
    return { attempts, summary: { count: attempts.length, successes, failures: attempts.length - successes,
      consecutiveFailures: firstSuccess < 0 ? attempts.length : firstSuccess,
      averageDurationMs: attempts.length ? Math.round(attempts.reduce((n,a) => n+a.durationMs,0)/attempts.length) : null } };
  }
}
