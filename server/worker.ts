import { Worker } from 'bullmq';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { Readable, Transform } from 'node:stream';
import { readConfig, redisConnection, sourceLocation, type Modality } from './config';
import { createStorage } from './storage';
import { importZip } from './importer';

const config = readConfig();
const storage = createStorage(config);
const connection = redisConnection(config, true);
const worker = new Worker('viewer-import', async job => {
  const { id, zipKey, modality } = job.data as { id: string; zipKey: string; modality?: Modality };
  const location = sourceLocation(config, modality);
  if (!zipKey.startsWith(location.prefix)) throw new Error('Source outside allowed prefix');
  const result = await storage.client.send(new GetObjectCommand({ Bucket: location.bucket, Key: zipKey }));
  if (!(result.Body instanceof Readable)) throw new Error('Archive body is not a stream');
  if ((result.ContentLength ?? 0) > config.MAX_ZIP_BYTES) { result.Body.destroy(); throw new Error('ZIP exceeds configured size limit'); }
  let bytes = 0;
  const limit = new Transform({ transform(chunk: Buffer, _encoding, callback) {
    bytes += chunk.length;
    callback(bytes > config.MAX_ZIP_BYTES ? new Error('ZIP exceeds configured size limit') : null, chunk);
  } });
  const body = result.Body;
  body.on('error', error => limit.destroy(error));
  try {
    const manifest = await importZip(body.pipe(limit), id, config.S3_DERIVED_PREFIX, {
      maxEntries: config.MAX_ZIP_ENTRIES, maxEntryBytes: config.MAX_ENTRY_BYTES, maxExpandedBytes: config.MAX_EXPANDED_BYTES
    }, storage.put, value => job.updateProgress(value));
    await storage.put(`${config.S3_DERIVED_PREFIX}${id}/manifest.json`, JSON.stringify(manifest), 'application/json');
    return { instances: manifest.instances.length, skippedFiles: manifest.skippedFiles };
  } finally { body.destroy(); }
}, { connection, prefix: '{viewer-import}', concurrency: 1 });
worker.on('failed', (job, error) => console.error(`Import ${job?.id ?? 'unknown'} failed: ${error.name}`));
worker.on('error', error => console.error(`Import worker error: ${error.name}`));
console.log('ZIP import worker ready');
async function shutdown() { await worker.close(); await connection.quit(); }
process.once('SIGTERM', () => void shutdown());
process.once('SIGINT', () => void shutdown());
