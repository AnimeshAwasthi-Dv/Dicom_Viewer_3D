import { EventEmitter } from 'node:events';
import { createApp } from './app';
import { readConfig } from './config';
import { openDatabase } from './database';
import { createJobs } from './jobs';
import { createSessions } from './sessions';
import { createStorage } from './storage';
import type { StudyManifest } from '../src/types/remote';

const config = readConfig();
const db = openDatabase(config.VIEWER_DATA_DIR);
const jobs = createJobs(db);
const notifications = new EventEmitter();
notifications.setMaxListeners(0);
const storage = createStorage(config);
async function manifest(id: string): Promise<StudyManifest> {
  const indexed = jobs.manifest(id);
  if (indexed) return indexed;
  const loaded = await storage.manifest(id);
  jobs.saveManifest(loaded);
  return loaded;
}
const app = createApp({
  config, sessions: createSessions(db), sign: storage.sign, sourceVersion: storage.sourceVersion, listSource: storage.listSource, manifest,
  async enqueue(id, objects, modality) {
    jobs.enqueue({ id, objects, modality });
  },
  async job(id) {
    const job = jobs.get(id);
    if (job) return job;
    // A prior deployment may have indexed this study already; recover its manifest from S3.
    try { await manifest(id); return { status: 'completed', progress: 100 }; }
    catch { return undefined; }
  },
  async publish(id) { notifications.emit(id); },
  subscribe(id, notify) { notifications.on(id, notify); return () => { notifications.off(id, notify); }; },
  healthy: () => { try { db.prepare('SELECT 1').get(); return true; } catch { return false; } }
});
const prune = () => db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
prune();
const cleanup = setInterval(() => { try { prune(); } catch { console.error('Expired session cleanup failed'); } }, 60000);
cleanup.unref();
const server = app.listen(config.PORT, config.HOST, () => console.log(`Viewer API listening on ${config.HOST}:${config.PORT}`));
async function shutdown() {
  clearInterval(cleanup);
  const closed = new Promise<void>(resolve => server.close(() => resolve()));
  server.closeAllConnections();
  await closed;
  storage.client.destroy();
  db.close();
}
process.once('SIGTERM', () => void shutdown());
process.once('SIGINT', () => void shutdown());
