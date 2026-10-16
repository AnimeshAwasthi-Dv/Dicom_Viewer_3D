// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { Server } from 'node:http';
import { createApp, studyIdFor } from '../app';
import type { Sessions, SessionRecord } from '../sessions';
import { digest } from '../sessions';
import { config, manifest, studyId } from './fixtures';
import { remoteStateSchema } from '../../src/types/remote';
import { initialState, validateState } from '../validation';
import type { Config } from '../config';
import type { SourceObject } from '../sources';

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); })));
});
async function harness(overrides: Partial<Config> = {}) {
  // Fake import queue and source bucket: object versions by key, job states by study ID.
  const versions = new Map<string, string>([['studies/a.zip', '"etag-1"']]);
  const jobs = new Map<string, string>([[studyId, 'completed']]);
  const enqueued: string[] = [];
  const selections: SourceObject[][] = [];
  const records = new Map<string, SessionRecord>();
  const events = new EventEmitter();
  const statuses = new Map<string, string>();
  const sessions: Sessions = {
    async create(studyId, state, ttl) {
      const token = randomUUID();
      const session = { id: randomUUID(), studyId, state, revision: 0, tokenHash: digest(token), expiresAt: Date.now() + ttl * 1000 };
      records.set(session.id, session);
      return { session, token };
    },
    async get(id) { return records.get(id); },
    async update(id, expected, studyId, state) {
      const record = records.get(id);
      if (!record) return -1;
      if (record.revision !== expected) return -2;
      records.set(id, { ...record, studyId, state, revision: record.revision + 1 });
      return record.revision + 1;
    },
    async remove(id) { records.delete(id); },
    async status(id, value) { if (value) statuses.set(id, value); return statuses.get(id) ?? null; }
  };
  const app = createApp({
    config: { ...config, ...overrides }, sessions, manifest: async () => manifest, sign: async key => `https://s3.example.com/${key}`,
    sourceVersion: async (_bucket, key) => versions.get(key),
    listSource: async (_bucket, prefix) => [...versions.keys()].filter(key => key.startsWith(prefix)),
    enqueue: async (id, objects) => { enqueued.push(id); selections.push(objects); jobs.set(id, 'waiting'); },
    job: async id => jobs.has(id) ? { status: jobs.get(id)!, progress: 0 } : undefined,
    publish: async id => { events.emit(id); },
    subscribe: (id, notify) => { events.on(id, notify); return () => { events.off(id, notify); }; }, healthy: () => true
  });
  const server = app.listen(0, '127.0.0.1');
  servers.push(server);
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test server');
  const request = (url: string, method = 'GET', data?: unknown, token = config.SERVICE_API_KEY) => fetch(`http://127.0.0.1:${address.port}${url}`, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: data === undefined ? undefined : JSON.stringify(data)
  });
  const create = async () => {
    const response = await request('/api/v1/sessions', 'POST', { studyId });
    expect(response.status).toBe(201);
    const session = await response.json() as { id: string; revision: number; viewerUrl: string };
    const token = new URLSearchParams(new URL(session.viewerUrl).hash.slice(1)).get('token')!;
    return { ...session, token };
  };
  return { request, create, versions, jobs, enqueued, selections };
}
describe('viewer API', () => {
  it('queues a viewer link then creates usable, independent sessions for the completed selection', async () => {
    const { request, versions, jobs, enqueued } = await harness();
    versions.set('studies/case/photo.png', 'png-v1');
    const source = { sourcePrefix: 'studies/case/' };
    const pending = await request('/api/v1/viewer-links', 'POST', source);
    expect(pending.status).toBe(202);
    expect(pending.headers.get('Retry-After')).toBe('2');
    expect(pending.headers.get('Cache-Control')).toBe('no-store');
    const queued = await pending.json();
    expect(queued).toMatchObject({ status: 'queued', reused: false, retryAfterSeconds: 2 });
    expect(queued.viewerUrl).toBeUndefined();
    expect((await (await request(queued.statusUrl)).json()).status).toBe('waiting');
    expect((await request('/api/v1/viewer-links', 'POST', source)).status).toBe(202);
    expect(enqueued).toEqual([queued.studyId]);

    jobs.set(queued.studyId, 'completed');
    const ready = await request('/api/v1/viewer-links', 'POST', source);
    expect(ready.status).toBe(201);
    const session = await ready.json();
    expect(session).toMatchObject({ status: 'ready', studyId: queued.studyId, reused: true });
    const token = new URLSearchParams(new URL(session.viewerUrl).hash.slice(1)).get('token')!;
    expect((await request(`/api/viewer/${session.id}/manifest`, 'GET', undefined, token)).status).toBe(200);
    const second = await (await request('/api/v1/viewer-links', 'POST', source)).json();
    expect(second.id).not.toBe(session.id);
    expect(enqueued).toHaveLength(1);
    expect((await request(`/api/v1/sessions/${session.id}`, 'DELETE')).status).toBe(204);
    expect((await request(`/api/viewer/${session.id}/manifest`, 'GET', undefined, token)).status).toBe(401);
  });

  it('protects viewer-link creation and shares import validation and failed-job retry', async () => {
    const { request, jobs, enqueued } = await harness();
    const source = { zipKey: 'studies/a.zip' };
    expect((await request('/api/v1/viewer-links', 'POST', source, 'invalid')).status).toBe(401);
    expect((await request('/api/v1/viewer-links', 'POST', { sourcePrefix: 'studies/' })).status).toBe(400);
    expect((await request('/api/v1/viewer-links', 'POST', { objectKeys: ['reports/a.png'] })).status).toBe(400);
    expect((await request('/api/v1/viewer-links', 'POST', { ...source, objectKeys: ['studies/a.zip'] })).status).toBe(400);
    expect((await request('/api/v1/viewer-links', 'POST', { zipKey: 'studies/missing.zip' })).status).toBe(404);
    expect(enqueued).toHaveLength(0);
    const queued = await (await request('/api/v1/viewer-links', 'POST', source)).json();
    jobs.set(queued.studyId, 'failed');
    const retry = await request('/api/v1/viewer-links', 'POST', source);
    expect(retry.status).toBe(202);
    expect(await retry.json()).toMatchObject({ studyId: queued.studyId, status: 'queued', reused: false });
    expect(enqueued).toEqual([queued.studyId, queued.studyId]);
  });

  it('imports mixed source selections, deduplicates keys and reuses the selection regardless of key order', async () => {
    const { request, versions, selections } = await harness();
    versions.set('studies/image.JPG', 'jpeg-v1');
    versions.set('studies/slice', 'dicom-v1');
    const first = await request('/api/v1/studies', 'POST', { objectKeys: ['studies/a.zip', 'studies/image.JPG', 'studies/slice'] });
    expect(first.status).toBe(202);
    const imported = await first.json();
    const again = await request('/api/v1/studies', 'POST', { objectKeys: ['studies/slice', 'studies/a.zip', 'studies/image.JPG', 'studies/a.zip'] });
    expect(await again.json()).toMatchObject({ id: imported.id, reused: true });
    expect(selections).toHaveLength(1);
    expect(selections[0]).toEqual([
      { key: 'studies/a.zip', version: '"etag-1"' },
      { key: 'studies/image.JPG', version: 'jpeg-v1' },
      { key: 'studies/slice', version: 'dicom-v1' }
    ]);
    versions.set('studies/image.JPG', 'jpeg-v2');
    expect((await (await request('/api/v1/studies', 'POST', { objectKeys: selections[0].map(object => object.key) })).json()).id).not.toBe(imported.id);
  });

  it('snapshots one study folder and gives additions a new import ID', async () => {
    const { request, versions, selections } = await harness();
    versions.set('studies/case/1.dcm', 'v1');
    versions.set('studies/case/2.png', 'v2');
    versions.set('studies/case-other/unrelated.png', 'v3');
    const response = await request('/api/v1/studies', 'POST', { sourcePrefix: 'studies/case/' });
    expect(response.status).toBe(202);
    const first = await response.json();
    expect(selections[0].map(object => object.key)).toEqual(['studies/case/1.dcm', 'studies/case/2.png']);
    versions.set('studies/case/3.jpeg', 'v3');
    expect((await (await request('/api/v1/studies', 'POST', { sourcePrefix: 'studies/case/' })).json()).id).not.toBe(first.id);
    expect((await request('/api/v1/studies', 'POST', { sourcePrefix: 'studies/empty/' })).status).toBe(404);
  });

  it('rejects ambiguous inputs, broad folder imports, traversal and files outside the allowed sources', async () => {
    const { request, enqueued } = await harness();
    for (const body of [
      {}, { zipKey: 'studies/a.zip', objectKeys: ['studies/a.zip'] }, { objectKeys: [] },
      { sourcePrefix: 'studies/' }, { sourcePrefix: 'studies/case' }, { sourcePrefix: 'other/case/' },
      { objectKeys: ['studies/a.zip', 'reports/a.png'] }, { objectKeys: ['studies/../reports/a.png'] },
      { objectKeys: ['studies/a/'] }, { objectKeys: ['studies/..\\reports/a.png'] }
    ]) expect((await request('/api/v1/studies', 'POST', body)).status).toBe(400);
    expect(enqueued).toEqual([]);
  });

  it('uses the supplied domain and shared portal prefixes for all modalities', async () => {
    const { request, create, versions } = await harness({
      PUBLIC_URL: 'https://dicom.admindectrocel.online', S3_BUCKET: 'animesh-arn',
      S3_SOURCE_PREFIX: 'test/hospitals/', S3_ADDITIONAL_SOURCE_PREFIXES: 'test/studies/', S3_DERIVED_PREFIX: 'test/viewer-derived/'
    });
    versions.set('test/hospitals/hospital/study/image.png', 'v1');
    versions.set('test/studies/study/archive.zip', 'v2');
    expect((await request('/api/v1/studies', 'POST', { modality: 'MRI', objectKeys: ['test/hospitals/hospital/study/image.png', 'test/studies/study/archive.zip'] })).status).toBe(202);
    expect((await request('/api/v1/studies', 'POST', { objectKeys: ['test/reports/report.png'] })).status).toBe(400);
    expect(new URL((await create()).viewerUrl).origin).toBe('https://dicom.admindectrocel.online');
  });
  it('uses a new import ID when the derived-frame format changes', () => {
    const bucket = 'test-bucket';
    const key = 'studies/a.zip';
    const version = '"etag-1"';
    const legacyHash = createHash('sha256').update(`${bucket}\n${key}\n${version}`).digest('hex');
    const legacyId = `${legacyHash.slice(0, 8)}-${legacyHash.slice(8, 12)}-8${legacyHash.slice(13, 16)}-${((parseInt(legacyHash[16], 16) & 0x3) | 0x8).toString(16)}${legacyHash.slice(17, 20)}-${legacyHash.slice(20, 32)}`;
    expect(studyIdFor(bucket, key, version)).not.toBe(legacyId);
  });

  it('requires service authentication and constrains source keys', async () => {
    const { request } = await harness();
    expect((await request('/api/v1/studies', 'POST', { zipKey: 'studies/a.zip' }, 'bad')).status).toBe(401);
    expect((await request('/api/v1/studies', 'POST', { zipKey: 'other/a.zip' })).status).toBe(400);
    expect((await request('/api/v1/studies', 'POST', { zipKey: 'studies/a.zip' })).status).toBe(202);
    expect((await request('/api/v1/studies', 'POST', { modality: 'MRI', zipKey: 'MRI/a.zip' })).status).toBe(400);
    expect((await request('/api/v1/studies', 'POST', { zipKey: 'studies/missing.zip' })).status).toBe(404);
  });
  it('imports a ZIP once and reuses the study on later requests', async () => {
    const { request, enqueued, jobs, versions } = await harness();
    const first = await (await request('/api/v1/studies', 'POST', { zipKey: 'studies/a.zip' })).json() as { id: string; reused: boolean };
    expect(first.reused).toBe(false);
    const again = await request('/api/v1/studies', 'POST', { zipKey: 'studies/a.zip' });
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ id: first.id, reused: true });
    expect(enqueued).toEqual([first.id]);
    // A failed import runs again under the same ID.
    jobs.set(first.id, 'failed');
    expect((await request('/api/v1/studies', 'POST', { zipKey: 'studies/a.zip' })).status).toBe(202);
    expect(enqueued).toEqual([first.id, first.id]);
    // A replaced ZIP is a new version: new ID, fresh import.
    versions.set('studies/a.zip', '"etag-2"');
    const replaced = await (await request('/api/v1/studies', 'POST', { zipKey: 'studies/a.zip' })).json() as { id: string };
    expect(replaced.id).not.toBe(first.id);
    expect((await request(`/api/v1/studies/${replaced.id}`)).status).toBe(200);
  });
  it('scopes viewer credentials to one session and prevents them from controlling sessions', async () => {
    const { request, create } = await harness();
    const one = await create();
    const two = await create();
    expect((await request(`/api/viewer/${one.id}/manifest`, 'GET', undefined, one.token)).status).toBe(200);
    expect((await request(`/api/viewer/${two.id}/manifest`, 'GET', undefined, one.token)).status).toBe(401);
    expect((await request(`/api/v1/sessions/${one.id}`, 'GET', undefined, one.token)).status).toBe(401);
    expect((await request(`/api/viewer/${one.id}/frames`, 'POST', { instanceIds: ['foreign-instance'] }, one.token)).status).toBe(404);
    const frames = await request(`/api/viewer/${one.id}/frames`, 'POST', { instanceIds: ['1.2.3.4.1', '1.2.3.4.2'] }, one.token);
    expect(frames.status).toBe(200);
    // Only instances imported with a preview get a preview URL; the manifest says which have one, never the keys.
    const signed = await frames.json() as { frames: Array<{ id: string; url: string; previewUrl?: string }> };
    expect(signed.frames).toEqual([
      { id: '1.2.3.4.1', url: 'https://s3.example.com/derived/1.dcm', previewUrl: 'https://s3.example.com/derived/1.bin' },
      { id: '1.2.3.4.2', url: 'https://s3.example.com/derived/2.dcm' }
    ]);
    const publicManifest = await (await request(`/api/viewer/${one.id}/manifest`, 'GET', undefined, one.token)).json() as { instances: Array<Record<string, unknown>> };
    expect(publicManifest.instances.map(instance => [instance.preview, 'key' in instance, 'previewKey' in instance])).toEqual([[true, false, false], [undefined, false, false]]);
  });
  it('validates slices, detects conflicting writes and restores latest state on reconnect', async () => {
    const { request, create } = await harness();
    const session = await create();
    const state = initialState(manifest);
    state.viewports[0].instanceIndex = 999;
    expect((await request(`/api/v1/sessions/${session.id}/state`, 'PUT', { expectedRevision: 0, state })).status).toBe(400);
    state.viewports[0].instanceIndex = 1;
    expect((await request(`/api/v1/sessions/${session.id}/state`, 'PUT', { expectedRevision: 0, state })).status).toBe(200);
    expect((await request(`/api/v1/sessions/${session.id}/state`, 'PUT', { expectedRevision: 0, state })).status).toBe(409);
    const stream = await request(`/api/viewer/${session.id}/events`, 'GET', undefined, session.token);
    const reader = stream.body!.getReader();
    const first = await reader.read();
    const event = JSON.parse(new TextDecoder().decode(first.value).split('\n')[0]);
    expect(event.session.revision).toBe(1);
    expect(event.session.state.viewports[0].instanceIndex).toBe(1);
    state.viewports[0].instanceIndex = 0;
    expect((await request(`/api/v1/sessions/${session.id}/state`, 'PUT', { expectedRevision: 1, state })).status).toBe(200);
    const update = await reader.read();
    const updateEvent = JSON.parse(new TextDecoder().decode(update.value).split('\n')[0]);
    expect(updateEvent.session.revision).toBe(2);
    expect(updateEvent.session.state.viewports[0].instanceIndex).toBe(0);
    await reader.cancel();
  });
  it('reports applied state separately and revokes further access', async () => {
    const { request, create } = await harness();
    const session = await create();
    expect((await request(`/api/viewer/${session.id}/status`, 'POST', { clientId: randomUUID(), appliedRevision: 1 }, session.token)).status).toBe(400);
    expect((await request(`/api/viewer/${session.id}/status`, 'POST', { clientId: randomUUID(), appliedRevision: 0, state: initialState(manifest) }, session.token)).status).toBe(204);
    const result = await (await request(`/api/v1/sessions/${session.id}`)).json();
    expect(result.lastClientStatus.appliedRevision).toBe(0);
    expect((await request(`/api/v1/sessions/${session.id}`, 'DELETE')).status).toBe(204);
    expect((await request(`/api/viewer/${session.id}/manifest`, 'GET', undefined, session.token)).status).toBe(401);
  });
});
describe('control validation', () => {
  it('rejects mismatched layouts, nonfinite camera values and foreign measurements', () => {
    const state = initialState(manifest);
    expect(remoteStateSchema.safeParse({ ...state, layout: '2x2' }).success).toBe(false);
    expect(remoteStateSchema.safeParse({ ...state, viewports: [{ ...state.viewports[0], windowWidth: Infinity, windowCenter: 0 }] }).success).toBe(false);
    state.measurements.push({ id: 'a', type: 'annotation', studyInstanceUID: 'wrong', seriesInstanceUID: 'wrong', sopInstanceUID: 'wrong', points: [{ x: 0, y: 0 }], createdAt: '2026-09-23' });
    expect(validateState(state, manifest)).toBe(false);
  });
});
