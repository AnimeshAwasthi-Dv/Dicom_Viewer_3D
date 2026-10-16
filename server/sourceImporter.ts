import { GetObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { Readable } from 'node:stream';
import { allowedSourceKey, sourceLocation, type Config, type Modality } from './config';
import { importSources, type ImportSource, type WriteObject } from './importer';
import { objectVersion, type SourceObject } from './sources';

export interface ImportJob { id: string; objects?: SourceObject[]; zipKey?: string; modality?: Modality }

export async function importS3Study(config: Config, client: Pick<S3Client, 'send'>, job: ImportJob, write: WriteObject,
  progress: (value: { indexed: number; skipped: number }) => Promise<void>) {
  const location = sourceLocation(config, job.modality);
  // Existing queued jobs from before multi-file support can still finish.
  const objects = job.objects ?? (job.zipKey ? [{ key: job.zipKey, version: undefined }] : []);
  if (!objects.length || objects.length > config.MAX_ZIP_ENTRIES) throw new Error('Invalid source file count');
  if (objects.some(object => !allowedSourceKey(object.key, location.prefixes) || object.key.endsWith('/'))) throw new Error('Source outside allowed prefixes');
  async function* sources(): AsyncGenerator<ImportSource> {
    for (const object of objects) {
      const result = await client.send(new GetObjectCommand({ Bucket: location.bucket, Key: object.key }));
      if (!(result.Body instanceof Readable)) throw new Error('Source body is not a stream');
      try {
        // Validate the actual GET response, closing the HEAD/GET race when a source is overwritten.
        if (object.version && objectVersion(result) !== object.version) throw new Error('Source changed after import was requested; request a new import');
        const sizeLimit = object.key.toLowerCase().endsWith('.zip') ? config.MAX_ZIP_BYTES : config.MAX_ENTRY_BYTES;
        if ((result.ContentLength ?? 0) > sizeLimit) throw new Error('Source exceeds configured size limit');
        yield { name: object.key, stream: result.Body };
      } finally { result.Body.destroy(); }
    }
  }
  const manifest = await importSources(sources(), job.id, config.S3_DERIVED_PREFIX, {
    maxEntries: config.MAX_ZIP_ENTRIES, maxEntryBytes: config.MAX_ENTRY_BYTES,
    maxExpandedBytes: config.MAX_EXPANDED_BYTES, maxZipBytes: config.MAX_ZIP_BYTES
  }, write, progress);
  await write(`${config.S3_DERIVED_PREFIX}${job.id}/manifest.json`, Buffer.from(JSON.stringify(manifest)), 'application/json');
  return { instances: manifest.instances.length, skippedFiles: manifest.skippedFiles };
}
