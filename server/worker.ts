import { Worker } from 'bullmq';
import { Readable, Transform } from 'node:stream';
import { readConfig, readTenants, redisConnection } from './config';
import { createStorages } from './storage';
import { sourceLocation, type Modality } from './tenants';
import { importZip } from './importer';

const config = readConfig();
const tenants = readTenants(config);
const storages = createStorages(tenants);
const connection = redisConnection(config, true);
const worker = new Worker('viewer-import', async job => {
  // Jobs queued before tenants existed belong to the "default" tenant.
  const { tenant: tenantId = 'default', id, zipKey, modality } = job.data as { tenant?: string; id: string; zipKey: string; modality?: Modality };
  const tenant = tenants.find(item => item.id === tenantId);
  const storage = storages.get(tenantId);
  if (!tenant || !storage) throw new Error(`Unknown tenant ${tenantId}`);
  const location = sourceLocation(tenant, modality);
  if (!zipKey.startsWith(location.prefix)) throw new Error('Source outside allowed prefix');
  const result = await storage.source(location.bucket, zipKey);
  if (!(result.body instanceof Readable)) throw new Error('Archive body is not a stream');
  if ((result.size ?? 0) > config.MAX_ZIP_BYTES) { result.body.destroy(); throw new Error('ZIP exceeds configured size limit'); }
  let bytes = 0;
  const limit = new Transform({ transform(chunk: Buffer, _encoding, callback) {
    bytes += chunk.length;
    callback(bytes > config.MAX_ZIP_BYTES ? new Error('ZIP exceeds configured size limit') : null, chunk);
  } });
  const body = result.body;
  body.on('error', error => limit.destroy(error));
  try {
    const manifest = await importZip(body.pipe(limit), id, tenant.derived.prefix, {
      maxEntries: config.MAX_ZIP_ENTRIES, maxEntryBytes: config.MAX_ENTRY_BYTES, maxExpandedBytes: config.MAX_EXPANDED_BYTES
    }, storage.put, value => job.updateProgress(value));
    await storage.put(`${storage.studyPrefix(id)}manifest.json`, JSON.stringify(manifest), 'application/json');
    return { instances: manifest.instances.length, skippedFiles: manifest.skippedFiles };
  } finally { body.destroy(); }
}, { connection, prefix: '{viewer-import}', concurrency: 1 });
worker.on('failed', (job, error) => console.error(`Import ${job?.id ?? 'unknown'} failed: ${error.name}`));
worker.on('error', error => console.error(`Import worker error: ${error.name}`));
console.log('ZIP import worker ready');
async function shutdown() { await worker.close(); await connection.quit(); }
process.once('SIGTERM', () => void shutdown());
process.once('SIGINT', () => void shutdown());
