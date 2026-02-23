import type Database from "better-sqlite3";

export interface ScheduleRow {
  id: number;
  cat_id: number;
  name: string;
  days_of_week: string; // JSON array e.g. [0,1,2,3,4,5,6]
  lock_time: string; // HH:MM
  unlock_time: string; // HH:MM
  enabled: number;
  created_at: string;
  updated_at: string;
}

export interface CreateSchedule {
  cat_id: number;
  name: string;
  days_of_week: number[];
  lock_time: string;
  unlock_time: string;
}

export class ScheduleRepository {
  constructor(private db: Database.Database) {}

  getAll(): ScheduleRow[] {
    return this.db
      .prepare("SELECT * FROM curfew_schedules ORDER BY cat_id, lock_time")
      .all() as ScheduleRow[];
  }

  getEnabled(): ScheduleRow[] {
    return this.db
      .prepare(
        "SELECT * FROM curfew_schedules WHERE enabled = 1 ORDER BY cat_id, lock_time"
      )
      .all() as ScheduleRow[];
  }

  getByCatId(catId: number): ScheduleRow[] {
    return this.db
      .prepare(
        "SELECT * FROM curfew_schedules WHERE cat_id = ? ORDER BY lock_time"
      )
      .all(catId) as ScheduleRow[];
  }

  getById(id: number): ScheduleRow | undefined {
    return this.db
      .prepare("SELECT * FROM curfew_schedules WHERE id = ?")
      .get(id) as ScheduleRow | undefined;
  }

  create(schedule: CreateSchedule): ScheduleRow {
    const result = this.db
      .prepare(
        `INSERT INTO curfew_schedules (cat_id, name, days_of_week, lock_time, unlock_time)
       VALUES (@cat_id, @name, @days_of_week, @lock_time, @unlock_time)`
      )
      .run({
        ...schedule,
        days_of_week: JSON.stringify(schedule.days_of_week),
      });
    return this.getById(Number(result.lastInsertRowid))!;
  }

  update(
    id: number,
    fields: Partial<Omit<CreateSchedule, "cat_id">>
  ): ScheduleRow | undefined {
    const existing = this.getById(id);
    if (!existing) return undefined;

    const updates: string[] = [];
    const params: Record<string, unknown> = { id };

    if (fields.name !== undefined) {
      updates.push("name = @name");
      params.name = fields.name;
    }
    if (fields.days_of_week !== undefined) {
      updates.push("days_of_week = @days_of_week");
      params.days_of_week = JSON.stringify(fields.days_of_week);
    }
    if (fields.lock_time !== undefined) {
      updates.push("lock_time = @lock_time");
      params.lock_time = fields.lock_time;
    }
    if (fields.unlock_time !== undefined) {
      updates.push("unlock_time = @unlock_time");
      params.unlock_time = fields.unlock_time;
    }

    if (updates.length > 0) {
      updates.push("updated_at = datetime('now')");
      this.db
        .prepare(
          `UPDATE curfew_schedules SET ${updates.join(", ")} WHERE id = @id`
        )
        .run(params);
    }

    return this.getById(id);
  }

  delete(id: number): boolean {
    const result = this.db
      .prepare("DELETE FROM curfew_schedules WHERE id = ?")
      .run(id);
    return result.changes > 0;
  }

  toggle(id: number): ScheduleRow | undefined {
    this.db
      .prepare(
        "UPDATE curfew_schedules SET enabled = CASE WHEN enabled = 1 THEN 0 ELSE 1 END, updated_at = datetime('now') WHERE id = ?"
      )
      .run(id);
    return this.getById(id);
  }
}
