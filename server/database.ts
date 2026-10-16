import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

// Load the prefix-only Node builtin natively, including under older Vite/Vitest resolvers.
const { DatabaseSync: SqliteDatabase } = process.getBuiltinModule('node:sqlite') as typeof import('node:sqlite');

/** API and worker share this database on the same host's persistent local volume. */
export function openDatabase(directory: string): DatabaseSync {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const db = new SqliteDatabase(path.join(directory, 'viewer.sqlite'), { timeout: 10000 });
  try {
    db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY, study_id TEXT NOT NULL, state TEXT NOT NULL,
        revision INTEGER NOT NULL, expires_at INTEGER NOT NULL, token_hash TEXT NOT NULL, status TEXT
      );
      CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
      CREATE TABLE IF NOT EXISTS import_jobs (
        id TEXT PRIMARY KEY, payload TEXT NOT NULL, status TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0, available_at INTEGER NOT NULL,
        lease_until INTEGER, owner TEXT, progress TEXT NOT NULL DEFAULT '0', error_type TEXT
      );
      CREATE INDEX IF NOT EXISTS jobs_available ON import_jobs(status, available_at);
      CREATE TABLE IF NOT EXISTS manifests (id TEXT PRIMARY KEY, data TEXT NOT NULL);
    `);
    return db;
  } catch (error) { db.close(); throw error; }
}

/** Synchronous transaction: no network or asynchronous work may run inside it. */
export function transaction<T>(db: DatabaseSync, operation: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = operation();
    db.exec('COMMIT');
    return result;
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
