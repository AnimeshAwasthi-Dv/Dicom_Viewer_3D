import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { RemoteState, SessionSnapshot } from '../src/types/remote';

export type SessionRecord = SessionSnapshot & { tokenHash: string };
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export const matchesSecret = (value: string, expected: string) => timingSafeEqual(Buffer.from(digest(value)), Buffer.from(digest(expected)));
export const snapshot = ({ id, studyId, state, revision, expiresAt }: SessionRecord): SessionSnapshot => ({ id, studyId, state, revision, expiresAt });

export interface Sessions {
  create(studyId: string, state: RemoteState, ttl: number): Promise<{ session: SessionRecord; token: string }>;
  get(id: string): Promise<SessionRecord | undefined>;
  update(id: string, expectedRevision: number, studyId: string, state: RemoteState): Promise<number>;
  remove(id: string): Promise<void>;
  status(id: string, value?: string): Promise<string | null>;
}

export function createSessions(db: DatabaseSync): Sessions {
  return {
    async create(studyId, state, ttl) {
      const token = randomBytes(32).toString('base64url');
      const session: SessionRecord = { id: randomUUID(), studyId, state, revision: 0, expiresAt: Date.now() + ttl * 1000, tokenHash: digest(token) };
      db.prepare('INSERT INTO sessions (id, study_id, state, revision, expires_at, token_hash) VALUES (?, ?, ?, 0, ?, ?)')
        .run(session.id, studyId, JSON.stringify(state), session.expiresAt, session.tokenHash);
      return { session, token };
    },
    async get(id) {
      const row = db.prepare('SELECT * FROM sessions WHERE id = ? AND expires_at > ?').get(id, Date.now());
      if (!row) return undefined;
      return { id, studyId: String(row.study_id), state: JSON.parse(String(row.state)) as RemoteState,
        revision: Number(row.revision), expiresAt: Number(row.expires_at), tokenHash: String(row.token_hash) };
    },
    async update(id, expectedRevision, studyId, state) {
      // Compare and update atomically: concurrent controllers cannot silently overwrite each other.
      const now = Date.now();
      const row = db.prepare(`UPDATE sessions SET state = ?, study_id = ?, revision = revision + 1
        WHERE id = ? AND revision = ? AND expires_at > ? RETURNING revision`)
        .get(JSON.stringify(state), studyId, id, expectedRevision, now);
      if (row) return Number(row.revision);
      return db.prepare('SELECT id FROM sessions WHERE id = ? AND expires_at > ?').get(id, now) ? -2 : -1;
    },
    async remove(id) { db.prepare('DELETE FROM sessions WHERE id = ?').run(id); },
    async status(id, value) {
      if (value !== undefined) {
        db.prepare('UPDATE sessions SET status = ? WHERE id = ? AND expires_at > ?').run(value, id, Date.now());
      }
      const row = db.prepare('SELECT status FROM sessions WHERE id = ? AND expires_at > ?').get(id, Date.now());
      return row?.status === null || row?.status === undefined ? null : String(row.status);
    }
  };
}
