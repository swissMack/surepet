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
}

export class CatRepository {
  constructor(private db: Database.Database) {}

  upsert(cat: Omit<CatRow, "updated_at">): void {
    this.db
      .prepare(
        `INSERT INTO cats (id, name, tag_id, device_id, location, current_profile, curfew_active, raw_data, updated_at)
       VALUES (@id, @name, @tag_id, @device_id, @location, @current_profile, @curfew_active, @raw_data, datetime('now'))
       ON CONFLICT(id) DO UPDATE SET
         name = @name,
         tag_id = @tag_id,
         device_id = @device_id,
         location = @location,
         current_profile = @current_profile,
         curfew_active = @curfew_active,
         raw_data = @raw_data,
         updated_at = datetime('now')`
      )
      .run(cat);
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
