// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { Server } from 'node:http';
import { contentSecurityPolicy, createApp, studyIdFor } from '../app';
import type { Sessions, SessionRecord } from '../sessions';
import { digest } from '../sessions';
import { config, manifest, studyId, tenants } from './fixtures';
import type { Tenant } from '../tenants';
import { remoteStateSchema } from '../../src/types/remote';
import { initialState, validateState } from '../validation';

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); })));
});
async function harness() {
  // Fake import queue and source bucket: object versions by key, job states by study ID.
  const versions = new Map<string, string>([['test-bucket/studies/a.zip', '"etag-1"'], ['radagent-scans/imaging/a.zip', '"etag-r2"']]);
  const jobs = new Map<string, string>([[studyId, 'completed']]);
  // The tenant each import belongs to; the fixture study is DecXpert's.
  const owners = new Map<string, string>([[studyId, 'default']]);
  const enqueued: string[] = [];
  const records = new Map<string, SessionRecord>();
  const events = new EventEmitter();
  const statuses = new Map<string, string>();
  const sessions: Sessions = {
    async create(tenantId, studyId, state, ttl) {
      const token = randomUUID();
      const session = { id: randomUUID(), tenantId, studyId, state, revision: 0, tokenHash: digest(token), expiresAt: Date.now() + ttl * 1000 };
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
    config, tenants, sessions, manifest: async () => manifest,
    sign: async (tenant: Tenant, key) => `https://${tenant.derived.bucket}.store.example/${key}`,
    sourceVersion: async (_tenant, bucket, key) => versions.get(`${bucket}/${key}`),
    enqueue: async (tenant, id) => { enqueued.push(id); jobs.set(id, 'waiting'); owners.set(id, tenant.id); },
    job: async (tenant, id) => jobs.has(id) && owners.get(id) === tenant.id ? { status: jobs.get(id)!, progress: 0 } : undefined,
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
  return { request, create, versions, jobs, enqueued, owners };
}
describe('viewer API', () => {
  it('uses a new import ID when the derived-frame format changes', () => {
    const bucket = 'test-bucket';
    const key = 'studies/a.zip';
    const version = '"etag-1"';
    const legacyHash = createHash('sha256').update(`${bucket}\n${key}\n${version}`).digest('hex');
    const legacyId = `${legacyHash.slice(0, 8)}-${legacyHash.slice(8, 12)}-8${legacyHash.slice(13, 16)}-${((parseInt(legacyHash[16], 16) & 0x3) | 0x8).toString(16)}${legacyHash.slice(17, 20)}-${legacyHash.slice(20, 32)}`;
    expect(studyIdFor('default', bucket, key, version)).not.toBe(legacyId);
    // The same bucket and key in two tenants' stores are different studies.
    expect(studyIdFor('default', bucket, key, version)).not.toBe(studyIdFor('radagent', bucket, key, version));
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
    versions.set('test-bucket/studies/a.zip', '"etag-2"');
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
      { id: '1.2.3.4.1', url: 'https://test-bucket.store.example/derived/1.dcm', previewUrl: 'https://test-bucket.store.example/derived/1.bin' },
      { id: '1.2.3.4.2', url: 'https://test-bucket.store.example/derived/2.dcm' }
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
describe('tenants', () => {
  const radagent = tenants[1].apiKey;
  it('imports each tenant\'s ZIPs from its own store and prefix only', async () => {
    const { request, enqueued } = await harness();
    // RadAgent's key reads RadAgent's R2 prefix, not DecXpert's S3 one.
    expect((await request('/api/v1/studies', 'POST', { zipKey: 'studies/a.zip' }, radagent)).status).toBe(400);
    const imported = await request('/api/v1/studies', 'POST', { zipKey: 'imaging/a.zip' }, radagent);
    expect(imported.status).toBe(202);
    const { id } = await imported.json() as { id: string };
    expect(enqueued).toEqual([id]);
    expect((await request(`/api/v1/studies/${id}`, 'GET', undefined, radagent)).status).toBe(200);
    // DecXpert's key can't see RadAgent's study.
    expect((await request(`/api/v1/studies/${id}`)).status).toBe(404);
  });
  it('keeps sessions to the tenant that created them', async () => {
    const { request, create, jobs, owners } = await harness();
    const decxpert = await create();
    expect((await request(`/api/v1/sessions/${decxpert.id}`, 'GET', undefined, radagent)).status).toBe(404);
    expect((await request(`/api/v1/sessions/${decxpert.id}`, 'DELETE', undefined, radagent)).status).toBe(404);
    expect((await request('/api/v1/sessions', 'POST', { studyId }, radagent)).status).toBe(404);
    // RadAgent's own study gets a session whose images are signed against RadAgent's store.
    const radagentStudy = randomUUID();
    jobs.set(radagentStudy, 'completed');
    owners.set(radagentStudy, 'radagent');
    const created = await request('/api/v1/sessions', 'POST', { studyId: radagentStudy }, radagent);
    expect(created.status).toBe(201);
    const session = await created.json() as { id: string; viewerUrl: string };
    const token = new URLSearchParams(new URL(session.viewerUrl).hash.slice(1)).get('token')!;
    const signed = await (await request(`/api/viewer/${session.id}/frames`, 'POST', { instanceIds: ['1.2.3.4.2'] }, token)).json() as { frames: Array<{ url: string }> };
    expect(signed.frames[0].url).toBe('https://radagent-scans.store.example/derived/2.dcm');
  });
  it('lets every tenant\'s portal embed the viewer', async () => {
    const { request } = await harness();
    const policy = (await request('/healthz')).headers.get('content-security-policy');
    expect(policy).toContain('frame-ancestors https://radagent.example.com');
    // Images download straight from each tenant's store.
    expect(policy).toContain("connect-src 'self' https: https://account.r2.cloudflarestorage.com");
  });
});

describe('security headers', () => {
  it('limits scripts to the viewer and, when configured, which sites may frame it', async () => {
    const { request } = await harness();
    const policy = (await request('/healthz')).headers.get('content-security-policy')!;
    expect(policy).toContain("script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'");
    expect(policy).not.toContain("'unsafe-inline' 'unsafe-eval'");
    expect(contentSecurityPolicy('https://portal.example.com')).toContain('frame-ancestors https://portal.example.com');
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
