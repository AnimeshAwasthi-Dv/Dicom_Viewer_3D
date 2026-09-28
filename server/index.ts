import { Queue } from 'bullmq';
import { EventEmitter } from 'node:events';
import { createApp } from './app';
import { readConfig, readTenants, redisConnection } from './config';
import { createSessions } from './sessions';
import { createStorages } from './storage';
import type { Tenant } from './tenants';
import type { StudyManifest } from '../src/types/remote';

const config = readConfig();
const tenants = readTenants(config);
const redis = redisConnection(config);
const subscriber = redisConnection(config);
await Promise.all([redis.connect(), subscriber.connect()]);
const notifications = new EventEmitter();
notifications.setMaxListeners(0);
subscriber.on('message', (_channel: string, id: string) => notifications.emit(id));
await subscriber.subscribe('viewer:updates');
const queueConnection = redisConnection(config);
const queue = new Queue('viewer-import', { connection: queueConnection, prefix: '{viewer-import}' });
const storages = createStorages(tenants);
const storageOf = (tenant: Tenant) => storages.get(tenant.id)!;
async function manifest(tenant: Tenant, id: string): Promise<StudyManifest> {
  const key = `viewer:manifest:${tenant.id}:${id}`;
  const cached = await redis.get(key);
  if (cached) return JSON.parse(cached) as StudyManifest;
  const loaded = await storageOf(tenant).manifest(id);
  await redis.set(key, JSON.stringify(loaded), 'EX', 300);
  return loaded;
}
const app = createApp({
  config, tenants, sessions: createSessions(redis), manifest,
  sign: (tenant, key) => storageOf(tenant).sign(key),
  sourceVersion: (tenant, bucket, key) => storageOf(tenant).sourceVersion(bucket, key),
  async enqueue(tenant, id, zipKey, modality) {
    // A failed import keeps its job record under this ID; clear it so the import can run again.
    const previous = await queue.getJob(id);
    if (previous && await previous.isFailed()) await previous.remove();
    await queue.add('import', { tenant: tenant.id, id, zipKey, modality }, { jobId: id, attempts: 3, backoff: { type: 'exponential', delay: 5000 } });
  },
  async job(tenant, id) {
    const job = await queue.getJob(id);
    // Jobs queued before tenants existed belong to the "default" tenant.
    if (job) return (job.data.tenant ?? 'default') === tenant.id ? { status: await job.getState(), progress: job.progress } : undefined;
    // Job records can be trimmed from Redis; the extracted study in the tenant's store is what counts.
    try { await manifest(tenant, id); return { status: 'completed', progress: 100 }; }
    catch { return undefined; }
  },
  async publish(id) { await redis.publish('viewer:updates', id); },
  subscribe(id, notify) { notifications.on(id, notify); return () => { notifications.off(id, notify); }; },
  healthy: () => redis.status === 'ready' && subscriber.status === 'ready'
});
const server = app.listen(config.PORT, config.HOST, () => console.log(`Viewer API listening on ${config.HOST}:${config.PORT}`));
async function shutdown() {
  server.close();
  server.closeAllConnections();
  await Promise.all([queue.close(), subscriber.quit(), redis.quit()]);
  await queueConnection.quit();
}
process.once('SIGTERM', () => void shutdown());
process.once('SIGINT', () => void shutdown());
