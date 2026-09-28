import type { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { gzip } from 'node:zlib';
import unzipper from 'unzipper';
import { DicomParser } from '../src/viewer/dicom/DicomParser';
import { isUncompressedLittleEndian } from '../src/viewer/dicom/TransferSyntax';
import { canPreview, encodePreview } from '../src/viewer/dicom/PreviewFormat';
import type { StudyManifest } from '../src/types/remote';

export interface ImportLimits { maxEntries: number; maxEntryBytes: number; maxExpandedBytes: number }
export type WriteObject = (key: string, bytes: Uint8Array, contentType: string, contentEncoding?: string) => Promise<void>;

const gzipAsync = promisify(gzip);
// Uploads in flight while the archive keeps unpacking; S3 latency, not CPU, dominates a serial import.
const PARALLEL_WRITES = 8;

/**
 * Uncompressed pixel data is stored gzip-encoded: S3 serves it with Content-Encoding: gzip and the browser inflates it
 * natively, so a raw CT slice downloads at about 45% of its size with nothing to change in the viewer. Level 1 is
 * nearly as small as the default level at a third of the CPU. Compressed transfer syntaxes are stored as they are.
 */
export async function encodeForStorage(data: Uint8Array, transferSyntaxUID: string): Promise<{ bytes: Uint8Array; contentEncoding?: string }> {
  if (!isUncompressedLittleEndian(transferSyntaxUID)) return { bytes: data };
  const packed = await gzipAsync(data, { level: 1 });
  // Not worth an encoding header unless it saves at least a tenth.
  return packed.byteLength <= data.byteLength * 0.9 ? { bytes: packed, contentEncoding: 'gzip' } : { bytes: data };
}

export async function importZip(
  source: Readable,
  id: string,
  prefix: string,
  limits: ImportLimits,
  write: WriteObject,
  progress: (value: { indexed: number; skipped: number }) => Promise<void>
): Promise<StudyManifest> {
  const archive = source.pipe(unzipper.Parse({ forceStream: true }));
  const onError = (error: Error) => archive.destroy(error);
  source.on('error', onError);
  const manifest: StudyManifest = { id, instances: [], skippedFiles: 0 };
  const seen = new Set<string>();
  let expanded = 0;
  let entries = 0;
  const parser = new DicomParser();
  const writes = new Set<Promise<void>>();
  let writeError: unknown;
  const upload = async (key: string, data: Uint8Array, transferSyntaxUID: string, preview?: { key: string; bytes: Uint8Array }) => {
    const { bytes, contentEncoding } = await encodeForStorage(data, transferSyntaxUID);
    await write(key, bytes, 'application/dicom', contentEncoding);
    if (preview) await write(preview.key, await gzipAsync(preview.bytes, { level: 1 }), 'application/octet-stream', 'gzip');
  };
  try {
    for await (const value of archive) {
      const entry = value as unzipper.Entry;
      if (++entries > limits.maxEntries) throw new Error('Archive contains too many entries');
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of entry) {
        const bytes = Buffer.from(chunk as Uint8Array);
        size += bytes.length;
        expanded += bytes.length;
        if (size > limits.maxEntryBytes || expanded > limits.maxExpandedBytes) throw new Error('Archive exceeds extraction size limits');
        chunks.push(bytes);
      }
      if (entry.type === 'Directory' || entry.path.startsWith('__MACOSX/') || size === 0) continue;
      const data = Buffer.concat(chunks);
      let parsed;
      // Headers only: the viewer decodes the file itself (every transfer syntax Cornerstone supports, colour and
      // multi-frame), so the importer needs pixel data only to build a preview of a large uncompressed slice.
      try { parsed = parser.parse(Uint8Array.from(data).buffer, entry.path.split(/[\\/]/).pop(), { pixelData: false }); }
      catch { manifest.skippedFiles++; continue; }
      if (parsed.error) {
        manifest.skippedFiles++;
        continue;
      }
      const sopId = parsed.metadata.sopInstanceUID;
      if (seen.has(sopId)) throw new Error('Duplicate SOP Instance UID in archive');
      seen.add(sopId);
      const name = createHash('sha256').update(sopId).digest('hex');
      const key = `${prefix}${id}/instances/${name}.dcm`;
      // Large uncompressed slices also get a small preview the viewer shows while the full slice downloads.
      const { pixelDataOffset, pixelDataLength } = parsed.metadata;
      const previewBytes = canPreview(parsed.metadata) && pixelDataOffset !== undefined && pixelDataLength !== undefined
        ? encodePreview(parsed.metadata, Uint8Array.from(data.subarray(pixelDataOffset, pixelDataOffset + pixelDataLength)).buffer)
        : undefined;
      const preview = previewBytes ? { key: `${prefix}${id}/previews/${name}.bin`, bytes: previewBytes } : undefined;
      // Keys are generated from UIDs: archive paths never become filesystem/S3 paths.
      const pending = upload(key, data, parsed.metadata.transferSyntaxUID, preview).catch((error: unknown) => { writeError ??= error; });
      writes.add(pending);
      void pending.finally(() => writes.delete(pending));
      if (writes.size >= PARALLEL_WRITES) await Promise.race(writes);
      if (writeError) throw writeError;
      // Detailed tags are fetched with the selected frame, not repeated in the startup index.
      delete parsed.metadata.rawTags;
      manifest.instances.push({ key, ...(preview ? { previewKey: preview.key } : {}), metadata: parsed.metadata });
      if (manifest.instances.length % 20 === 0) await progress({ indexed: manifest.instances.length, skipped: manifest.skippedFiles });
    }
    await Promise.all(writes);
    if (writeError) throw writeError;
    if (!manifest.instances.length) throw new Error('Archive contains no supported DICOM images');
    await progress({ indexed: manifest.instances.length, skipped: manifest.skippedFiles });
    return manifest;
  } finally {
    // Never leave uploads running after a failed import.
    await Promise.allSettled(writes);
    source.off('error', onError);
    source.destroy();
    archive.destroy();
  }
}
