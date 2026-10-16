// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { Readable } from 'node:stream';
import JSZip from 'jszip';
import { gunzipSync } from 'node:zlib';
import { encodeForStorage, importSources, importZip } from '../importer';
import { dicomFile } from './fixtures';

const limits = { maxEntries: 20, maxEntryBytes: 10000, maxExpandedBytes: 20000 };
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');
async function archive(files: Record<string, Buffer | string>) {
  const zip = new JSZip();
  for (const [key, data] of Object.entries(files)) zip.file(key, data);
  return Readable.from([await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })]);
}
describe('ZIP import', () => {
  it('imports mixed ZIP and direct images while preserving the original PNG bytes', async () => {
    const saved: Array<{ key: string; bytes: Uint8Array; type: string }> = [];
    const result = await importSources([
      { name: 'scan.zip', stream: await archive({ 'scan.dcm': dicomFile(), 'nested/image.PNG': png }) },
      { name: 'direct.png', stream: Readable.from([png]) },
      { name: 'broken.png', stream: Readable.from([png.subarray(0, 8)]) },
      { name: 'note.txt', stream: Readable.from(['not an image']) }
    ], 'mixed', 'derived/', limits, async (key, bytes, type) => { saved.push({ key, bytes, type }); }, async () => undefined);
    expect(result.instances).toHaveLength(3);
    expect(result.skippedFiles).toBe(2);
    const images = result.instances.filter(instance => instance.metadata.imageFormat);
    expect(images.map(instance => instance.metadata)).toEqual(expect.arrayContaining([
      expect.objectContaining({ imageFormat: 'png', rows: 1, columns: 1, fileName: 'image.PNG' }),
      expect.objectContaining({ imageFormat: 'png', rows: 1, columns: 1, fileName: 'direct.png' })
    ]));
    expect(new Set(images.map(instance => instance.metadata.sopInstanceUID)).size).toBe(2);
    expect(images.every(instance => !instance.previewKey && !instance.metadata.pixelSpacing)).toBe(true);
    for (const stored of saved.filter(object => object.type === 'image/png')) expect(Buffer.from(stored.bytes)).toEqual(png);
  });

  it('enforces aggregate limits across multiple source files and ZIPs', async () => {
    await expect(importSources([
      { name: 'a.png', stream: Readable.from([png]) }, { name: 'b.zip', stream: await archive({ 'b.png': png }) }
    ], 'id', 'derived/', { ...limits, maxExpandedBytes: png.length * 2 - 1 }, async () => undefined, async () => undefined)).rejects.toThrow('size limits');
    await expect(importZip(await archive({ 'a.png': png }), 'id', 'derived/', { ...limits, maxZipBytes: 20 }, async () => undefined, async () => undefined)).rejects.toThrow('ZIP exceeds');
  });

  it('propagates stream failures and rejects duplicates across direct files and ZIPs', async () => {
    const broken = new Readable({ read() { this.destroy(new Error('download interrupted')); } });
    await expect(importZip(broken, 'id', 'derived/', limits, async () => undefined, async () => undefined)).rejects.toThrow('download interrupted');
    await expect(importSources([
      { name: 'a.dcm', stream: Readable.from([dicomFile()]) }, { name: 'b.zip', stream: await archive({ 'a.dcm': dicomFile() }) }
    ], 'id', 'derived/', limits, async () => undefined, async () => undefined)).rejects.toThrow('Duplicate');
  });
  it('indexes actual DICOM files, ignores non-images and never uses archive paths as destination keys', async () => {
    const write = vi.fn(async () => undefined);
    const result = await importZip(await archive({ '../../escape.dcm': dicomFile(), 'folder/2.dcm': dicomFile('1.2.3.4.2'), 'readme.txt': 'not dicom' }), 'study-id', 'derived/', limits, write, async () => undefined);
    expect(result.instances).toHaveLength(2);
    expect(result.skippedFiles).toBe(1);
    expect(result.instances[0].metadata.rows).toBe(2);
    for (const instance of result.instances) expect(instance.key).toMatch(/^derived\/study-id\/instances\/[a-f0-9]{64}\.dcm$/);
    expect(write).toHaveBeenCalledTimes(2);
  });
  it('reads SeriesNumber and InstanceNumber as text, not binary', async () => {
    const result = await importZip(await archive({ 'a.dcm': dicomFile('1.2.3.4.1', { series: '12', instance: '20' }), 'b.dcm': dicomFile('1.2.3.4.2', { series: '1', instance: '3' }) }), 'id', 'derived/', limits, async () => undefined, async () => undefined);
    expect(result.instances.map(instance => [instance.metadata.seriesNumber, instance.metadata.instanceNumber])).toEqual([[12, 20], [1, 3]]);
  });
  it('stores uncompressed DICOM gzip-encoded, and it inflates back to the original file', async () => {
    const original = dicomFile('1.2.3.4.9');
    const { bytes, contentEncoding } = await encodeForStorage(new Uint8Array(4096), '1.2.840.10008.1.2.1');
    expect(contentEncoding).toBe('gzip');
    expect(gunzipSync(bytes)).toEqual(Buffer.alloc(4096));
    // Already-compressed pixel data is stored untouched.
    expect(await encodeForStorage(original, '1.2.840.10008.1.2.4.80')).toEqual({ bytes: original });
  });
  it('writes each instance once, uploading in parallel', async () => {
    let inFlight = 0;
    let peak = 0;
    const write = vi.fn(async () => {
      peak = Math.max(peak, ++inFlight);
      await new Promise(resolve => setTimeout(resolve, 5));
      inFlight--;
    });
    const files = Object.fromEntries(Array.from({ length: 12 }, (_, index) => [`${index}.dcm`, dicomFile(`1.2.3.4.${index + 1}`)]));
    const result = await importZip(await archive(files), 'id', 'derived/', { ...limits, maxEntries: 20 }, write, async () => undefined);
    expect(result.instances).toHaveLength(12);
    expect(write).toHaveBeenCalledTimes(12);
    expect(peak).toBeGreaterThan(1);
    expect(inFlight).toBe(0);
  });
  it('fails the import when an upload fails', async () => {
    await expect(importZip(await archive({ 'a.dcm': dicomFile() }), 'id', 'derived/', limits, async () => { throw new Error('S3 down'); }, async () => undefined)).rejects.toThrow('S3 down');
  });
  it('rejects expanded entries over the configured limit', async () => {
    await expect(importZip(await archive({ 'large.dcm': Buffer.alloc(1000) }), 'id', 'derived/', { ...limits, maxEntryBytes: 100 }, async () => undefined, async () => undefined)).rejects.toThrow('size limits');
  });
  it('rejects ambiguous duplicate instance UIDs', async () => {
    await expect(importZip(await archive({ 'a.dcm': dicomFile(), 'b.dcm': dicomFile() }), 'id', 'derived/', limits, async () => undefined, async () => undefined)).rejects.toThrow('Duplicate');
  });
  it('fails if there are no supported images', async () => {
    await expect(importZip(await archive({ 'note.txt': 'hello' }), 'id', 'derived/', limits, async () => undefined, async () => undefined)).rejects.toThrow('no supported');
  });
  it('indexes a 2,000-instance synthetic CT archive without loading pixels into the manifest', async () => {
    const files = Object.fromEntries(Array.from({ length: 2000 }, (_, index) => [`${index}.dcm`, dicomFile(`1.2.3.4.${index + 1}`)]));
    const result = await importZip(await archive(files), 'large-study', 'derived/', { maxEntries: 3000, maxEntryBytes: 10000, maxExpandedBytes: 10000000 }, async () => undefined, async () => undefined);
    expect(result.instances).toHaveLength(2000);
    expect(result.instances.every(instance => instance.metadata.rawTags === undefined)).toBe(true);
  }, 30000);
});
