import { Readable, Transform } from 'node:stream';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { gzip } from 'node:zlib';
import unzipper from 'unzipper';
import { imageSize } from 'image-size';
import { DicomParser } from '../src/viewer/dicom/DicomParser';
import { isUncompressedLittleEndian } from '../src/viewer/dicom/TransferSyntax';
import { encodePreview } from '../src/viewer/dicom/PreviewFormat';
import { rasterFormat, rasterMetadata } from '../src/viewer/dicom/RasterImage';
import type { ParsedDicomFile } from '../src/types/dicom';
import type { StudyManifest } from '../src/types/remote';

export interface ImportLimits { maxEntries: number; maxEntryBytes: number; maxExpandedBytes: number; maxZipBytes?: number }
export type WriteObject = (key: string, bytes: Uint8Array, contentType: string, contentEncoding?: string) => Promise<void>;
export interface ImportSource { name: string; stream: Readable }
type Progress = (value: { indexed: number; skipped: number }) => Promise<void>;
export type PublishChunk = (manifest: StudyManifest) => Promise<void>;
const gzipAsync = promisify(gzip);
const PARALLEL_WRITES = 8;

/** Store uncompressed DICOM gzip-encoded; already compressed DICOM and ordinary images stay unchanged. */
export async function encodeForStorage(data: Uint8Array, transferSyntaxUID: string): Promise<{ bytes: Uint8Array; contentEncoding?: string }> {
  if (!isUncompressedLittleEndian(transferSyntaxUID)) return { bytes: data };
  const packed = await gzipAsync(data, { level: 1 });
  return packed.byteLength <= data.byteLength * 0.9 ? { bytes: packed, contentEncoding: 'gzip' } : { bytes: data };
}

/** ZIP entries and direct files share one cumulative extraction budget and one manifest. */
async function* entries(sources: AsyncIterable<ImportSource> | Iterable<ImportSource>, limits: ImportLimits): AsyncGenerator<{ name: string; stream: Readable; directory?: boolean }> {
  for await (const source of sources) {
    if (!source.name.toLowerCase().endsWith('.zip')) {
      try { yield source; } finally { source.stream.destroy(); }
      continue;
    }
    let compressed = 0;
    const limit = new Transform({ transform(chunk: Buffer, _encoding, callback) {
      compressed += chunk.length;
      callback(compressed > (limits.maxZipBytes ?? Infinity) ? new Error('ZIP exceeds configured size limit') : null, chunk);
    } });
    const archive = unzipper.Parse({ forceStream: true });
    const onSourceError = (error: Error) => limit.destroy(error);
    const onLimitError = (error: Error) => archive.destroy(error);
    source.stream.on('error', onSourceError);
    limit.on('error', onLimitError);
    source.stream.pipe(limit).pipe(archive);
    try {
      for await (const value of archive) {
        const entry = value as unzipper.Entry;
        yield { name: `${source.name}/${entry.path}`, stream: entry, directory: entry.type === 'Directory' };
      }
    } finally {
      source.stream.unpipe(limit);
      limit.unpipe(archive);
      source.stream.destroy();
      limit.destroy();
      archive.destroy();
    }
  }
}

export function importZip(source: Readable, id: string, prefix: string, limits: ImportLimits, write: WriteObject, progress: Progress): Promise<StudyManifest> {
  return importSources([{ name: 'archive.zip', stream: source }], id, prefix, limits, write, progress);
}

export async function importSources(
  sources: AsyncIterable<ImportSource> | Iterable<ImportSource>, id: string, prefix: string,
  limits: ImportLimits, write: WriteObject, progress: Progress, publishChunk?: PublishChunk
): Promise<StudyManifest> {
  const manifest: StudyManifest = { id, instances: [], skippedFiles: 0 };
  const seen = new Set<string>();
  let expanded = 0;
  let entryCount = 0;
  const parser = new DicomParser();
  const writes = new Set<Promise<void>>();
  let writeError: unknown;
  let published = 0;
  let lastPublishedAt = 0;
  const publish = async () => {
    // A chunk never advertises an object until its full image and preview are uploaded.
    await Promise.all(writes);
    if (writeError) throw writeError;
    await publishChunk?.({ ...manifest, instances: [...manifest.instances], importStatus: 'loading' });
    published = manifest.instances.length;
    lastPublishedAt = Date.now();
  };
  const upload = async (key: string, data: Uint8Array, parsed: ParsedDicomFile, preview?: { key: string; bytes: Uint8Array }) => {
    const { bytes, contentEncoding } = await encodeForStorage(data, parsed.metadata.transferSyntaxUID);
    await write(key, bytes, parsed.metadata.imageFormat ? `image/${parsed.metadata.imageFormat}` : 'application/dicom', contentEncoding);
    if (preview) await write(preview.key, await gzipAsync(preview.bytes, { level: 1 }), 'application/octet-stream', 'gzip');
  };
  try {
    for await (const entry of entries(sources, limits)) {
      if (++entryCount > limits.maxEntries) throw new Error('Import contains too many entries');
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of entry.stream) {
        const bytes = Buffer.from(chunk as Uint8Array);
        size += bytes.length;
        expanded += bytes.length;
        if (size > limits.maxEntryBytes || expanded > limits.maxExpandedBytes) throw new Error('Import exceeds extraction size limits');
        chunks.push(bytes);
      }
      const parts = entry.name.split(/[\\/]/);
      if (entry.directory || parts.some(part => part === '__MACOSX' || (part.startsWith('.') && part !== '..' && part !== '.')) || size === 0) continue;
      const data = Buffer.concat(chunks);
      const buffer = Uint8Array.from(data).buffer;
      let parsed: ParsedDicomFile;
      try {
        const format = rasterFormat(buffer);
        if (format) {
          const dimensions = imageSize(data);
          const rotated = (dimensions.orientation ?? 1) >= 5;
          const imageId = createHash('sha256').update(`${id}\n${entry.name}`).digest('hex');
          parsed = {
            metadata: rasterMetadata(format, parts.at(-1)!, `images-${id}`, imageId,
              rotated ? dimensions.height : dimensions.width, rotated ? dimensions.width : dimensions.height),
            pixelData: buffer
          };
        } else parsed = parser.parse(buffer, parts.at(-1));
      } catch { manifest.skippedFiles++; continue; }
      if (!parsed.pixelData || parsed.error || parsed.metadata.rawTags?.some(tag => tag.tag === '(0028,0008)' && Number(tag.value) > 1)) {
        manifest.skippedFiles++;
        continue;
      }
      const sopId = parsed.metadata.sopInstanceUID;
      if (seen.has(sopId)) throw new Error('Duplicate SOP Instance UID in import');
      seen.add(sopId);
      const name = createHash('sha256').update(sopId).digest('hex');
      const key = `${prefix}${id}/instances/${name}.${parsed.metadata.imageFormat ?? 'dcm'}`;
      const previewBytes = parsed.metadata.imageFormat ? undefined : encodePreview(parsed.metadata, parsed.pixelData);
      const preview = previewBytes ? { key: `${prefix}${id}/previews/${name}.bin`, bytes: previewBytes } : undefined;
      const pending = upload(key, data, parsed, preview).catch((error: unknown) => { writeError ??= error; });
      writes.add(pending);
      void pending.finally(() => writes.delete(pending));
      if (writes.size >= PARALLEL_WRITES) await Promise.race(writes);
      if (writeError) throw writeError;
      delete parsed.metadata.rawTags;
      manifest.instances.push({ key, ...(preview ? { previewKey: preview.key } : {}), metadata: parsed.metadata });
      if (publishChunk && (published === 0 || manifest.instances.length - published >= 20 || Date.now() - lastPublishedAt >= 1000)) await publish();
      if (manifest.instances.length % 20 === 0) await progress({ indexed: manifest.instances.length, skipped: manifest.skippedFiles });
    }
    await Promise.all(writes);
    if (writeError) throw writeError;
    if (!manifest.instances.length) throw new Error('Import contains no supported DICOM, JPEG, or PNG images');
    if (publishChunk && published < manifest.instances.length) await publish();
    await progress({ indexed: manifest.instances.length, skipped: manifest.skippedFiles });
    return manifest;
  } finally {
    await Promise.allSettled(writes);
  }
}
