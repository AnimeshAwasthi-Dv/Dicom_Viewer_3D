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
const app = createApp({
  config, sessions: createSessions(redis), sign: storage.sign,
  async manifest(id) {
    const key = `viewer:manifest:${id}`;
    const cached = await redis.get(key);
    if (cached) return JSON.parse(cached) as StudyManifest;
    const manifest = await storage.manifest(id);
    await redis.set(key, JSON.stringify(manifest), 'EX', 300);
    return manifest;
  },
  async enqueue(id, zipKey, modality) {
    await queue.add('import', { id, zipKey, modality }, { jobId: id, attempts: 3, backoff: { type: 'exponential', delay: 5000 } });
  },
  async job(id) {
    const job = await queue.getJob(id);
    return job ? { status: await job.getState(), progress: job.progress } : undefined;
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
