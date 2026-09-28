import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Redis, Cluster } from 'ioredis';
import type { RemoteState, SessionSnapshot } from '../src/types/remote';

/** `tenantId`: the product whose API key created the session; only that key can read or control it. */
export type SessionRecord = SessionSnapshot & { tokenHash: string; tenantId: string };
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export const matchesSecret = (value: string, expected: string) => timingSafeEqual(Buffer.from(digest(value)), Buffer.from(digest(expected)));
export const snapshot = ({ id, studyId, state, revision, expiresAt }: SessionRecord): SessionSnapshot => ({ id, studyId, state, revision, expiresAt });

export interface Sessions {
  create(tenantId: string, studyId: string, state: RemoteState, ttl: number): Promise<{ session: SessionRecord; token: string }>;
  get(id: string): Promise<SessionRecord | undefined>;
  update(id: string, expectedRevision: number, studyId: string, state: RemoteState): Promise<number>;
  remove(id: string): Promise<void>;
  status(id: string, value?: string): Promise<string | null>;
}

export function createSessions(redis: Redis | Cluster): Sessions {
  const key = (id: string) => `viewer:session:${id}`;
  return {
    async create(tenantId, studyId, state, ttl) {
      const token = randomBytes(32).toString('base64url');
      const session: SessionRecord = { id: randomUUID(), tenantId, studyId, state, revision: 0, expiresAt: Date.now() + ttl * 1000, tokenHash: digest(token) };
      await redis.multi().hset(key(session.id), {
        tenantId, studyId, state: JSON.stringify(state), revision: '0', expiresAt: String(session.expiresAt), tokenHash: session.tokenHash
      }).expire(key(session.id), ttl).exec();
      return { session, token };
    },
    async get(id) {
      const fields = await redis.hgetall(key(id));
      if (!fields.state || Number(fields.expiresAt) <= Date.now()) return undefined;
      // Sessions from before tenants existed belong to the single-product "default" tenant.
      return { id, tenantId: fields.tenantId || 'default', studyId: fields.studyId, state: JSON.parse(fields.state) as RemoteState, revision: Number(fields.revision), expiresAt: Number(fields.expiresAt), tokenHash: fields.tokenHash };
    },
    async update(id, expectedRevision, studyId, state) {
      // Compare and update atomically: concurrent controllers cannot silently overwrite each other.
      return Number(await redis.eval(`
        if redis.call('EXISTS', KEYS[1]) == 0 then return -1 end
        local revision = tonumber(redis.call('HGET', KEYS[1], 'revision'))
        if revision ~= tonumber(ARGV[1]) then return -2 end
        redis.call('HSET', KEYS[1], 'state', ARGV[2], 'studyId', ARGV[3], 'revision', revision + 1)
        return revision + 1
      `, 1, key(id), String(expectedRevision), JSON.stringify(state), studyId));
    },
    async remove(id) { await redis.del(key(id)); },
    async status(id, value) {
      if (value !== undefined) {
        await redis.eval(`
          if redis.call('EXISTS', KEYS[1]) == 1 then redis.call('HSET', KEYS[1], 'status', ARGV[1]) end
          return 1
        `, 1, key(id), value);
      }
      return redis.hget(key(id), 'status');
    }
  };
}
