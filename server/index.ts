import { Queue } from 'bullmq';
import { EventEmitter } from 'node:events';
import { createApp } from './app';
import { readConfig, redisConnection } from './config';
import { createSessions } from './sessions';
import { createStorage } from './storage';
import type { StudyManifest } from '../src/types/remote';

const config = readConfig();
const redis = redisConnection(config);
const subscriber = redisConnection(config);
await Promise.all([redis.connect(), subscriber.connect()]);
const notifications = new EventEmitter();
notifications.setMaxListeners(0);
subscriber.on('message', (_channel: string, id: string) => notifications.emit(id));
await subscriber.subscribe('viewer:updates');
const queueConnection = redisConnection(config);
const queue = new Queue('viewer-import', { connection: queueConnection, prefix: '{viewer-import}' });
const storage = createStorage(config);
async function manifest(id: string): Promise<StudyManifest> {
  const key = `viewer:manifest:${id}`;
  const cached = await redis.get(key);
  if (cached) return JSON.parse(cached) as StudyManifest;
  const loaded = await storage.manifest(id);
  await redis.set(key, JSON.stringify(loaded), 'EX', 300);
  return loaded;
}
const app = createApp({
  config, sessions: createSessions(redis), sign: storage.sign, sourceVersion: storage.sourceVersion, manifest,
  async enqueue(id, zipKey, modality) {
    // A failed import keeps its job record under this ID; clear it so the import can run again.
    const previous = await queue.getJob(id);
    if (previous && await previous.isFailed()) await previous.remove();
    await queue.add('import', { id, zipKey, modality }, { jobId: id, attempts: 3, backoff: { type: 'exponential', delay: 5000 } });
  },
  async job(id) {
    const job = await queue.getJob(id);
    if (job) return { status: await job.getState(), progress: job.progress };
    // Job records can be trimmed from Redis; the extracted study in S3 is what counts.
    try { await manifest(id); return { status: 'completed', progress: 100 }; }
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
