// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../database';
import { createSessions, digest } from '../sessions';
import { createJobs, JOB_LEASE_MS } from '../jobs';
import { initialState } from '../validation';
import { manifest, studyId } from './fixtures';

const root = path.resolve('test-data/sqlite-tests');
const directories: string[] = [];
const connections = new Set<DatabaseSync>();
function directory() {
  mkdirSync(root, { recursive: true });
  const value = mkdtempSync(path.join(root, 'case-'));
  directories.push(value);
  return value;
}
function connect(dir: string) {
  const db = openDatabase(dir);
  connections.add(db);
  return db;
}
function close(db: DatabaseSync) { db.close(); connections.delete(db); }
afterEach(() => {
  vi.restoreAllMocks();
  for (const db of connections) db.close();
  connections.clear();
  for (const dir of directories.splice(0)) {
    if (!path.resolve(dir).startsWith(root + path.sep)) throw new Error('Test cleanup outside workspace test directory');
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('persistent sessions without Redis', () => {
  it('preserves sessions and reported state across process connections and database reopen', async () => {
    const dir = directory();
    const db = connect(dir);
    const sessions = createSessions(db);
    const created = await sessions.create(studyId, initialState(manifest), 60);
    expect(created.session.tokenHash).toBe(digest(created.token));
    await sessions.status(created.session.id, JSON.stringify({ appliedRevision: 0 }));
    close(db);
    const reopened = createSessions(connect(dir));
    expect(await reopened.get(created.session.id)).toEqual(created.session);
    expect(await reopened.status(created.session.id)).toBe('{"appliedRevision":0}');
  });

  it('atomically rejects conflicting updates from separate connections and propagates revocation', async () => {
    const dir = directory();
    const a = createSessions(connect(dir));
    const b = createSessions(connect(dir));
    const { session } = await a.create(studyId, initialState(manifest), 60);
    const results = await Promise.all([
      a.update(session.id, 0, studyId, { ...session.state, cineFps: 5 }),
      b.update(session.id, 0, studyId, { ...session.state, cineFps: 20 })
    ]);
    expect(results).toEqual([1, -2]);
    expect((await b.get(session.id))?.state.cineFps).toBe(5);
    await a.remove(session.id);
    expect(await b.get(session.id)).toBeUndefined();
    expect(await b.update(session.id, 1, studyId, session.state)).toBe(-1);
  });

  it('enforces expiry for reads, updates and status even before expired rows are cleaned up', async () => {
    let now = 1000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const sessions = createSessions(connect(directory()));
    const { session } = await sessions.create(studyId, initialState(manifest), 60);
    await sessions.status(session.id, 'before');
    now += 60000;
    expect(await sessions.get(session.id)).toBeUndefined();
    expect(await sessions.update(session.id, 0, studyId, session.state)).toBe(-1);
    expect(await sessions.status(session.id, 'after')).toBeNull();
  });
});

describe('durable import queue without Redis', () => {
  const payload = { id: studyId, objects: [{ key: 'studies/scan.dcm', version: 'v1' }] };

  it('persists and deduplicates jobs across restarts and only allows one worker to claim a job', () => {
    const dir = directory();
    const db = connect(dir);
    createJobs(db).enqueue(payload);
    close(db);
    const a = createJobs(connect(dir));
    const b = createJobs(connect(dir));
    b.enqueue(payload);
    const claim = a.claim()!;
    expect(claim.payload).toEqual(payload);
    expect(claim.attempts).toBe(1);
    expect(b.claim()).toBeUndefined();
    a.progress(claim, { indexed: 5 });
    expect(b.get(studyId)).toEqual({ status: 'active', progress: { indexed: 5 } });
    a.complete(claim, manifest);
    expect(b.get(studyId)).toEqual({ status: 'completed', progress: 100 });
    expect(b.manifest(studyId)).toEqual(manifest);
    b.enqueue(payload);
    expect(b.claim()).toBeUndefined();
  });

  it('recovers an interrupted job after its lease and rejects writes from the stale worker', () => {
    let now = 1000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const dir = directory();
    const a = createJobs(connect(dir));
    const b = createJobs(connect(dir));
    a.enqueue(payload);
    const stale = a.claim()!;
    now += JOB_LEASE_MS;
    const current = b.claim()!;
    expect(current.attempts).toBe(2);
    expect(current.owner).not.toBe(stale.owner);
    expect(a.renew(stale)).toBe(false);
    expect(() => a.progress(stale, 99)).toThrow('lease lost');
    expect(() => a.complete(stale, manifest)).toThrow('lease lost');
    a.fail(stale, 'stale failure');
    expect(b.get(studyId)?.status).toBe('active');
    b.complete(current, manifest);
    expect(a.get(studyId)?.status).toBe('completed');
  });

  it('renews long imports and delays retries, then allows explicit retry after three failed attempts', () => {
    let now = 1000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const jobs = createJobs(connect(directory()));
    jobs.enqueue(payload);
    const first = jobs.claim()!;
    now += JOB_LEASE_MS - 1;
    expect(jobs.renew(first)).toBe(true);
    now += 2;
    expect(jobs.owns(first)).toBe(true);
    jobs.fail(first, 'NetworkError');
    expect(jobs.get(studyId)?.status).toBe('delayed');
    expect(jobs.claim()).toBeUndefined();
    now += 5000;
    const second = jobs.claim()!;
    expect(second.attempts).toBe(2);
    jobs.fail(second, 'NetworkError');
    now += 10000;
    const third = jobs.claim()!;
    jobs.fail(third, 'NetworkError');
    expect(jobs.get(studyId)?.status).toBe('failed');
    expect(jobs.claim()).toBeUndefined();
    jobs.enqueue(payload);
    expect(jobs.claim()?.attempts).toBe(1);
  });

  it('caps repeated worker crashes at three attempts without publishing a completed manifest', () => {
    let now = 1000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const jobs = createJobs(connect(directory()));
    jobs.enqueue(payload);
    for (let attempt = 1; attempt <= 3; attempt++) {
      expect(jobs.claim()?.attempts).toBe(attempt);
      now += JOB_LEASE_MS;
    }
    expect(jobs.claim()).toBeUndefined();
    expect(jobs.get(studyId)?.status).toBe('failed');
    expect(jobs.manifest(studyId)).toBeUndefined();
  });
});
