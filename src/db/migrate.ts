import type Database from "better-sqlite3";

const migrations: { version: number; name: string; sql: string }[] = [
  {
    version: 1,
    name: "initial_schema",
    sql: `
      CREATE TABLE IF NOT EXISTS devices (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        product_id INTEGER,
        battery_level REAL,
        battery_voltage REAL,
        online INTEGER DEFAULT 1,
        lock_mode INTEGER DEFAULT 0,
        signal_strength REAL,
        raw_data TEXT,
        updated_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS cats (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        tag_id INTEGER NOT NULL,
        device_id INTEGER REFERENCES devices(id),
        location TEXT DEFAULT 'unknown',
        current_profile INTEGER DEFAULT 2,
        curfew_active INTEGER DEFAULT 0,
        raw_data TEXT,
        updated_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS curfew_schedules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cat_id INTEGER NOT NULL REFERENCES cats(id),
        name TEXT NOT NULL,
        days_of_week TEXT NOT NULL DEFAULT '[]',
        lock_time TEXT NOT NULL,
        unlock_time TEXT NOT NULL,
        enabled INTEGER DEFAULT 1,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS event_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_type TEXT NOT NULL,
        cat_id INTEGER REFERENCES cats(id),
        device_id INTEGER REFERENCES devices(id),
        details TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_event_log_type ON event_log(event_type);
      CREATE INDEX IF NOT EXISTS idx_event_log_cat ON event_log(cat_id);
      CREATE INDEX IF NOT EXISTS idx_event_log_created ON event_log(created_at);

      CREATE TABLE IF NOT EXISTS state_cache (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT DEFAULT (datetime('now'))
      );
    `,
  },
];

export function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT DEFAULT (datetime('now'))
    );
  `);

  const applied = new Set(
    db
      .prepare("SELECT version FROM _migrations")
      .all()
      .map((r) => (r as { version: number }).version)
  );

  for (const migration of migrations) {
    if (applied.has(migration.version)) continue;

    db.transaction(() => {
      db.exec(migration.sql);
      db.prepare("INSERT INTO _migrations (version, name) VALUES (?, ?)").run(
        migration.version,
        migration.name
      );
    })();

    console.log(`Applied migration ${migration.version}: ${migration.name}`);
  }
}
