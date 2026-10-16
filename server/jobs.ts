import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { ImportJob } from './sourceImporter';
import type { StudyManifest } from '../src/types/remote';
import { transaction } from './database';

export const JOB_LEASE_MS = 60000;
const MAX_ATTEMPTS = 3;
export interface ClaimedJob { payload: ImportJob; owner: string; attempts: number }

export function createJobs(db: DatabaseSync) {
  const owns = (claim: ClaimedJob) => Boolean(db.prepare(`SELECT id FROM import_jobs
    WHERE id = ? AND status = 'active' AND owner = ? AND lease_until > ?`).get(claim.payload.id, claim.owner, Date.now()));
  return {
    enqueue(payload: ImportJob): void {
      // UPSERT deduplicates simultaneous requests. A failed job can be explicitly retried.
      db.prepare(`INSERT INTO import_jobs (id, payload, status, available_at) VALUES (?, ?, 'waiting', ?)
        ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, status = 'waiting', attempts = 0,
        available_at = excluded.available_at, lease_until = NULL, owner = NULL, progress = '0', error_type = NULL
        WHERE import_jobs.status = 'failed'`).run(payload.id, JSON.stringify(payload), Date.now());
    },
    get(id: string): { status: string; progress: unknown } | undefined {
      const row = db.prepare('SELECT status, progress FROM import_jobs WHERE id = ?').get(id);
      return row ? { status: String(row.status), progress: JSON.parse(String(row.progress)) } : undefined;
    },
    claim(): ClaimedJob | undefined {
      return transaction(db, () => {
        const now = Date.now();
        // A crashed worker's lease expires. Stop retrying permanently failing imports after three attempts.
        db.prepare(`UPDATE import_jobs SET status = CASE WHEN attempts >= ? THEN 'failed' ELSE 'waiting' END,
          owner = NULL, lease_until = NULL, available_at = ?, error_type = 'WorkerLeaseExpired'
          WHERE status = 'active' AND lease_until <= ?`).run(MAX_ATTEMPTS, now, now);
        const row = db.prepare(`SELECT id, payload, attempts FROM import_jobs
          WHERE status IN ('waiting', 'delayed') AND available_at <= ? ORDER BY available_at, id LIMIT 1`).get(now);
        if (!row) return undefined;
        const owner = randomUUID();
        db.prepare(`UPDATE import_jobs SET status = 'active', attempts = attempts + 1, owner = ?, lease_until = ? WHERE id = ?`)
          .run(owner, now + JOB_LEASE_MS, String(row.id));
        return { payload: JSON.parse(String(row.payload)) as ImportJob, owner, attempts: Number(row.attempts) + 1 };
      });
    },
    owns,
    renew(claim: ClaimedJob): boolean {
      const now = Date.now();
      return db.prepare(`UPDATE import_jobs SET lease_until = ?
        WHERE id = ? AND status = 'active' AND owner = ? AND lease_until > ?`)
        .run(now + JOB_LEASE_MS, claim.payload.id, claim.owner, now).changes === 1;
    },
    progress(claim: ClaimedJob, value: unknown): void {
      const result = db.prepare(`UPDATE import_jobs SET progress = ?
        WHERE id = ? AND status = 'active' AND owner = ? AND lease_until > ?`)
        .run(JSON.stringify(value), claim.payload.id, claim.owner, Date.now());
      if (result.changes !== 1) throw new Error('Import job lease lost');
    },
    complete(claim: ClaimedJob, manifest: StudyManifest): void {
      transaction(db, () => {
        if (!owns(claim)) throw new Error('Import job lease lost');
        if (manifest.id !== claim.payload.id) throw new Error('Import manifest identity mismatch');
        db.prepare('INSERT OR REPLACE INTO manifests (id, data) VALUES (?, ?)').run(manifest.id, JSON.stringify(manifest));
        db.prepare(`UPDATE import_jobs SET status = 'completed', progress = '100', owner = NULL, lease_until = NULL, error_type = NULL WHERE id = ?`)
          .run(claim.payload.id);
      });
    },
    fail(claim: ClaimedJob, errorType: string): void {
      db.prepare(`UPDATE import_jobs SET status = ?, available_at = ?, owner = NULL, lease_until = NULL, error_type = ?
        WHERE id = ? AND status = 'active' AND owner = ? AND lease_until > ?`)
        .run(claim.attempts >= MAX_ATTEMPTS ? 'failed' : 'delayed', Date.now() + 5000 * 2 ** (claim.attempts - 1),
          errorType, claim.payload.id, claim.owner, Date.now());
    },
    manifest(id: string): StudyManifest | undefined {
      const row = db.prepare('SELECT data FROM manifests WHERE id = ?').get(id);
      return row ? JSON.parse(String(row.data)) as StudyManifest : undefined;
    },
    saveManifest(manifest: StudyManifest): void {
      db.prepare('INSERT OR REPLACE INTO manifests (id, data) VALUES (?, ?)').run(manifest.id, JSON.stringify(manifest));
    }
  };
}
