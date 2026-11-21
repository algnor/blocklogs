import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { dbPath } from "./config";

const SCHEMA = `
PRAGMA journal_mode=WAL;
PRAGMA synchronous=NORMAL;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS servers(
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  game TEXT NOT NULL DEFAULT 'minecraft',
  backend TEXT NOT NULL DEFAULT 'ptero',   -- 'ptero' (panel API) | 'sftp' | 'local'
  panel_id TEXT,                           -- pterodactyl server identifier, or a directory for 'local'
  log_dir TEXT NOT NULL DEFAULT '/logs',
  crash_dir TEXT NOT NULL DEFAULT '/crash-reports',
  sync_interval_min INTEGER NOT NULL DEFAULT 15,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_sync_at TEXT,
  last_sync_status TEXT,                   -- 'ok' | 'error' | 'running'
  last_sync_error TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS files(
  id INTEGER PRIMARY KEY,
  server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,                      -- 'log' | 'crash' | 'meta'
  name TEXT NOT NULL,
  size INTEGER, mtime INTEGER,             -- of the remote file
  local_path TEXT,
  lines INTEGER, events INTEGER, error TEXT,
  ingested_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(server_id, kind, name)
);

CREATE TABLE IF NOT EXISTS events(
  server_id INTEGER NOT NULL,
  file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  line INTEGER NOT NULL,
  ts TEXT NOT NULL,
  type TEXT NOT NULL,
  player TEXT,
  data TEXT,
  PRIMARY KEY(file_id, line)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS ev_server_type_ts ON events(server_id, type, ts);
CREATE INDEX IF NOT EXISTS ev_player ON events(player, type);

CREATE TABLE IF NOT EXISTS sessions(
  server_id INTEGER NOT NULL,
  player TEXT NOT NULL,
  start TEXT NOT NULL,
  end TEXT NOT NULL,
  secs REAL NOT NULL,
  ip TEXT,
  closed_by TEXT NOT NULL                  -- leave | rejoin | stop | crash | open
);
CREATE INDEX IF NOT EXISTS s_server_start ON sessions(server_id, start);
CREATE INDEX IF NOT EXISTS s_player ON sessions(player);

CREATE TABLE IF NOT EXISTS usercache(
  server_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  uuid TEXT NOT NULL,
  PRIMARY KEY(server_id, uuid)
);

CREATE TABLE IF NOT EXISTS crash_reports(
  file_id INTEGER PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,
  server_id INTEGER NOT NULL,
  ts TEXT,
  side TEXT,                               -- server | client
  loader TEXT,
  description TEXT,
  exception TEXT,
  suspects TEXT
);
CREATE INDEX IF NOT EXISTS crash_server_ts ON crash_reports(server_id, ts);
`;

export function openDb(path = dbPath): Database {
	if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
	const db = new Database(path, { create: true, strict: true });
	db.exec(SCHEMA);
	return db;
}

export const db = openDb();

export type ServerRow = {
	id: number;
	name: string;
	game: string;
	backend: "ptero" | "sftp" | "local";
	panel_id: string | null;
	log_dir: string;
	crash_dir: string;
	sync_interval_min: number;
	enabled: number;
	last_sync_at: string | null;
	last_sync_status: string | null;
	last_sync_error: string | null;
};
