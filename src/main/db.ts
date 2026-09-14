import Database from "better-sqlite3";
import { app } from "electron";
import path from "node:path";

let db: Database.Database | undefined;

const migrations: string[] = [
  `CREATE TABLE IF NOT EXISTS kv (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS agent_sessions (
    claude_session_id TEXT PRIMARY KEY,
    agent TEXT NOT NULL DEFAULT 'claude',
    cwd TEXT NOT NULL,
    title TEXT,
    status TEXT NOT NULL,
    term_id TEXT,
    transcript_path TEXT,
    started_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS indexed_files (
    path TEXT PRIMARY KEY,
    offset INTEGER NOT NULL,
    mtime INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS conv_sessions (
    session_id TEXT PRIMARY KEY,
    project TEXT NOT NULL,
    cwd TEXT,
    title TEXT,
    started_at INTEGER,
    last_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS conv_messages (
    id INTEGER PRIMARY KEY,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL,
    ts INTEGER,
    text TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_conv_messages_session ON conv_messages(session_id);
  CREATE VIRTUAL TABLE IF NOT EXISTS conv_fts USING fts5(
    text, content='conv_messages', content_rowid='id', tokenize='porter unicode61'
  );
  CREATE TRIGGER IF NOT EXISTS conv_messages_ai AFTER INSERT ON conv_messages BEGIN
    INSERT INTO conv_fts(rowid, text) VALUES (new.id, new.text);
  END;`,
  `ALTER TABLE agent_sessions ADD COLUMN issue_key TEXT`,
  `ALTER TABLE agent_sessions ADD COLUMN review_note TEXT`,
  `ALTER TABLE agent_sessions RENAME COLUMN claude_session_id TO session_id;
   ALTER TABLE conv_sessions ADD COLUMN agent TEXT NOT NULL DEFAULT 'claude';
   ALTER TABLE indexed_files ADD COLUMN metadata TEXT;
   ALTER TABLE conv_messages ADD COLUMN source_key TEXT;
   CREATE UNIQUE INDEX idx_conv_source ON conv_messages(session_id, source_key);`,
  `ALTER TABLE agent_sessions ADD COLUMN workspace TEXT`,
];

export function openDb(): Database.Database {
  if (db) return db;
  db = new Database(path.join(app.getPath("userData"), "deck.db"));
  db.pragma("journal_mode = WAL");
  const applied = db.pragma("user_version", { simple: true }) as number;
  for (let i = applied; i < migrations.length; i++) {
    db.transaction(() => {
      db!.exec(migrations[i]);
      db!.pragma(`user_version = ${i + 1}`);
    })();
  }
  return db;
}

export function kvGet<T>(key: string): T | undefined {
  const row = openDb().prepare("SELECT value FROM kv WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row ? (JSON.parse(row.value) as T) : undefined;
}

export function kvSet(key: string, value: unknown): void {
  openDb()
    .prepare("INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(key, JSON.stringify(value));
}
