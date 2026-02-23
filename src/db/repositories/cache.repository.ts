import type Database from "better-sqlite3";

export class CacheRepository {
  constructor(private db: Database.Database) {}

  get(key: string): string | undefined {
    const row = this.db
      .prepare("SELECT value FROM state_cache WHERE key = ?")
      .get(key) as { value: string } | undefined;
    return row?.value;
  }

  set(key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO state_cache (key, value, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = datetime('now')`
      )
      .run(key, value, value);
  }

  delete(key: string): void {
    this.db.prepare("DELETE FROM state_cache WHERE key = ?").run(key);
  }
}
