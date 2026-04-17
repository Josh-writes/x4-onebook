const Database = require('better-sqlite3');

let db;

function initDb(dbPath) {
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`CREATE TABLE IF NOT EXISTS books (
      id            TEXT PRIMARY KEY,
      title         TEXT NOT NULL,
      author        TEXT,
      epub_path     TEXT NOT NULL,
      cover_path    TEXT,
      total_chars   INTEGER NOT NULL,
      added_at      TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS reading_progress (
      book_id         TEXT PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
      char_offset     INTEGER NOT NULL DEFAULT 0,
      last_synced_at  TEXT,
      on_device       INTEGER NOT NULL DEFAULT 0,
      pending_send    INTEGER NOT NULL DEFAULT 0,
      pending_return  INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS reading_sessions (
      id              TEXT PRIMARY KEY,
      book_id         TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      started_at      TEXT NOT NULL,
      ended_at        TEXT,
      start_char      INTEGER NOT NULL,
      end_char        INTEGER,
      wpm             REAL
    );

    CREATE TABLE IF NOT EXISTS bookmarks (
      id          TEXT PRIMARY KEY,
      book_id     TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      char_offset INTEGER NOT NULL,
      label       TEXT,
      created_at  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS shelves (
      id       TEXT PRIMARY KEY,
      name     TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS shelf_books (
      shelf_id TEXT NOT NULL REFERENCES shelves(id) ON DELETE CASCADE,
      book_id  TEXT NOT NULL REFERENCES books(id)   ON DELETE CASCADE,
      position INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (shelf_id, book_id)
    );

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS wifi_networks (
      id          TEXT PRIMARY KEY,
      ssid        TEXT NOT NULL,
      password   TEXT NOT NULL,
      priority   INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      synced     INTEGER NOT NULL DEFAULT 0
    );

    INSERT OR IGNORE INTO settings (key, value) VALUES
      ('libraryPaths', '[]'),
      ('port', '3001'),
      ('deviceIp', '');
  `);

  // Migrations — safe to run on existing databases
  for (const col of ['pending_send', 'pending_return']) {
    try {
      db.exec(`ALTER TABLE reading_progress ADD COLUMN ${col} INTEGER NOT NULL DEFAULT 0`);
    } catch { /* column already exists */ }
  }

  return db;
}

function getDb() {
  if (!db) throw new Error('Database not initialized');
  return db;
}

module.exports = { initDb, getDb };
