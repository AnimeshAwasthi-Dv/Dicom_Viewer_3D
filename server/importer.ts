import type { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import unzipper from 'unzipper';
import { DicomParser } from '../src/viewer/dicom/DicomParser';
import type { StudyManifest } from '../src/types/remote';

export interface ImportLimits { maxEntries: number; maxEntryBytes: number; maxExpandedBytes: number }

export async function importZip(
  source: Readable,
  id: string,
  prefix: string,
  limits: ImportLimits,
  write: (key: string, bytes: Uint8Array, contentType: string) => Promise<void>,
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
      try { parsed = parser.parse(Uint8Array.from(data).buffer, entry.path.split(/[\\/]/).pop()); }
      catch { manifest.skippedFiles++; continue; }
      if (!parsed.pixelData || parsed.error || parsed.metadata.rawTags?.some(tag => tag.tag === '(0028,0008)' && Number(tag.value) > 1)) {
        manifest.skippedFiles++;
        continue;
      }
      const sopId = parsed.metadata.sopInstanceUID;
      if (seen.has(sopId)) throw new Error('Duplicate SOP Instance UID in archive');
      seen.add(sopId);
      const name = createHash('sha256').update(sopId).digest('hex');
      const key = `${prefix}${id}/instances/${name}.dcm`;
      // Keys are generated from UIDs: archive paths never become filesystem/S3 paths.
      await write(key, data, 'application/dicom');
      // Detailed tags are fetched with the selected frame, not repeated in the startup index.
      delete parsed.metadata.rawTags;
      manifest.instances.push({ key, metadata: parsed.metadata });
      if (manifest.instances.length % 20 === 0) await progress({ indexed: manifest.instances.length, skipped: manifest.skippedFiles });
    }
    if (!manifest.instances.length) throw new Error('Archive contains no supported single-frame DICOM images');
    await progress({ indexed: manifest.instances.length, skipped: manifest.skippedFiles });
    return manifest;
  } finally {
    source.off('error', onError);
    source.destroy();
    archive.destroy();
  }
}
