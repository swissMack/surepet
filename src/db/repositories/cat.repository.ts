import type Database from "better-sqlite3";

export interface CatRow {
  id: number;
  name: string;
  tag_id: number;
  device_id: number | null;
  location: string;
  current_profile: number;
  curfew_active: number;
  raw_data: string | null;
  updated_at: string;
  /** Set while the pet is absent from the Sure Petcare API; null when present. */
  missing_since: string | null;
}

export class CatRepository {
  constructor(private db: Database.Database) {}

  /** Insert/update a pet seen in the API. Seeing it clears missing_since. */
  upsert(cat: Omit<CatRow, "updated_at" | "missing_since">): void {
    this.db
      .prepare(
        `INSERT INTO cats (id, name, tag_id, device_id, location, current_profile, curfew_active, raw_data, updated_at, missing_since)
       VALUES (@id, @name, @tag_id, @device_id, @location, @current_profile, @curfew_active, @raw_data, datetime('now'), NULL)
       ON CONFLICT(id) DO UPDATE SET
         name = @name,
         tag_id = @tag_id,
         device_id = @device_id,
         location = @location,
         current_profile = @current_profile,
         curfew_active = @curfew_active,
         raw_data = @raw_data,
         updated_at = datetime('now'),
         missing_since = NULL`
      )
      .run(cat);
  }

  /** Flag a pet as absent from the API (keeps the first time it went missing). */
  markMissing(id: number): void {
    this.db
      .prepare(
        "UPDATE cats SET missing_since = COALESCE(missing_since, datetime('now')) WHERE id = ?"
      )
      .run(id);
  }

  /**
   * Delete a pet and its curfew schedules. Event history is kept but
   * detached (cat_id = NULL) — event details already carry the name.
   * Returns the ids of the deleted schedules so callers can stop their jobs.
   */
  remove(id: number): number[] {
    return this.db.transaction(() => {
      const scheduleIds = (
        this.db
          .prepare("SELECT id FROM curfew_schedules WHERE cat_id = ?")
          .all(id) as { id: number }[]
      ).map((r) => r.id);
      this.db.prepare("DELETE FROM curfew_schedules WHERE cat_id = ?").run(id);
      this.db.prepare("UPDATE event_log SET cat_id = NULL WHERE cat_id = ?").run(id);
      this.db.prepare("DELETE FROM cats WHERE id = ?").run(id);
      return scheduleIds;
    })();
  }

  getAll(): CatRow[] {
    return this.db.prepare("SELECT * FROM cats").all() as CatRow[];
  }

  getById(id: number): CatRow | undefined {
    return this.db
      .prepare("SELECT * FROM cats WHERE id = ?")
      .get(id) as CatRow | undefined;
  }

  updateLocation(id: number, location: string): void {
    this.db
      .prepare(
        "UPDATE cats SET location = ?, updated_at = datetime('now') WHERE id = ?"
      )
      .run(location, id);
  }

  updateProfile(id: number, profile: number, curfewActive: boolean): void {
    this.db
      .prepare(
        "UPDATE cats SET current_profile = ?, curfew_active = ?, updated_at = datetime('now') WHERE id = ?"
      )
      .run(profile, curfewActive ? 1 : 0, id);
  }
}
