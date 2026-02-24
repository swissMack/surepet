import type Database from "better-sqlite3";

export interface EventRow {
  id: number;
  event_type: string;
  cat_id: number | null;
  device_id: number | null;
  details: string | null;
  created_at: string;
}

export class EventRepository {
  constructor(private db: Database.Database) {}

  log(
    eventType: string,
    details?: Record<string, unknown>,
    catId?: number,
    deviceId?: number
  ): void {
    this.db
      .prepare(
        "INSERT INTO event_log (event_type, cat_id, device_id, details) VALUES (?, ?, ?, ?)"
      )
      .run(
        eventType,
        catId ?? null,
        deviceId ?? null,
        details ? JSON.stringify(details) : null
      );
  }

  getAll(limit = 100, offset = 0, eventType?: string, catId?: number): EventRow[] {
    let sql = "SELECT * FROM event_log WHERE 1=1";
    const params: unknown[] = [];

    if (eventType) {
      sql += " AND event_type = ?";
      params.push(eventType);
    }
    if (catId) {
      sql += " AND cat_id = ?";
      params.push(catId);
    }

    sql += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
    params.push(limit, offset);

    return this.db.prepare(sql).all(...params) as EventRow[];
  }

  count(eventType?: string, catId?: number): number {
    let sql = "SELECT COUNT(*) as cnt FROM event_log WHERE 1=1";
    const params: unknown[] = [];

    if (eventType) {
      sql += " AND event_type = ?";
      params.push(eventType);
    }
    if (catId) {
      sql += " AND cat_id = ?";
      params.push(catId);
    }

    const row = this.db.prepare(sql).get(...params) as { cnt: number };
    return row.cnt;
  }

  getByCatId(catId: number, limit = 50): EventRow[] {
    return this.db
      .prepare(
        "SELECT * FROM event_log WHERE cat_id = ? ORDER BY created_at DESC LIMIT ?"
      )
      .all(catId, limit) as EventRow[];
  }
}
