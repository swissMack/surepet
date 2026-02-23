import type Database from "better-sqlite3";

export interface DeviceRow {
  id: number;
  name: string;
  product_id: number | null;
  battery_level: number | null;
  battery_voltage: number | null;
  online: number;
  lock_mode: number;
  signal_strength: number | null;
  raw_data: string | null;
  updated_at: string;
}

export class DeviceRepository {
  constructor(private db: Database.Database) {}

  upsert(device: Omit<DeviceRow, "updated_at">): void {
    this.db
      .prepare(
        `INSERT INTO devices (id, name, product_id, battery_level, battery_voltage, online, lock_mode, signal_strength, raw_data, updated_at)
       VALUES (@id, @name, @product_id, @battery_level, @battery_voltage, @online, @lock_mode, @signal_strength, @raw_data, datetime('now'))
       ON CONFLICT(id) DO UPDATE SET
         name = @name,
         product_id = @product_id,
         battery_level = @battery_level,
         battery_voltage = @battery_voltage,
         online = @online,
         lock_mode = @lock_mode,
         signal_strength = @signal_strength,
         raw_data = @raw_data,
         updated_at = datetime('now')`
      )
      .run(device);
  }

  getAll(): DeviceRow[] {
    return this.db.prepare("SELECT * FROM devices").all() as DeviceRow[];
  }

  getById(id: number): DeviceRow | undefined {
    return this.db
      .prepare("SELECT * FROM devices WHERE id = ?")
      .get(id) as DeviceRow | undefined;
  }

  updateLockMode(id: number, lockMode: number): void {
    this.db
      .prepare(
        "UPDATE devices SET lock_mode = ?, updated_at = datetime('now') WHERE id = ?"
      )
      .run(lockMode, id);
  }
}
