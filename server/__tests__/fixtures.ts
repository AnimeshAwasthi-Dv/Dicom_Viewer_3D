import type { Config } from '../config';
import type { StudyManifest } from '../../src/types/remote';

export const studyId = '11111111-1111-4111-8111-111111111111';
export const manifest: StudyManifest = {
  id: studyId, skippedFiles: 0,
  instances: [1, 2].map(index => ({ key: `derived/${index}.dcm`, metadata: {
    fileName: `${index}.dcm`, studyInstanceUID: '1.2.3', seriesInstanceUID: '1.2.3.4', sopInstanceUID: `1.2.3.4.${index}`,
    rows: 2, columns: 2, bitsAllocated: 16, bitsStored: 16, pixelRepresentation: 0,
    photometricInterpretation: 'MONOCHROME2', samplesPerPixel: 1, rescaleSlope: 1, rescaleIntercept: 0,
    transferSyntaxUID: '1.2.840.10008.1.2.1', instanceNumber: index, modality: 'CT'
  } }))
};
export const config: Config = {
  HOST: '127.0.0.1', PORT: 3000, PUBLIC_URL: 'https://viewer.example.com', SERVICE_API_KEY: 'test-only-service-secret-with-32-characters',
  REDIS_URL: 'redis://localhost:6379', REDIS_CLUSTER_MODE: false, AWS_REGION: 'ap-south-1', S3_BUCKET: 'test-bucket',
  S3_SOURCE_PREFIX: 'studies/', S3_DERIVED_PREFIX: 'derived/', SESSION_TTL_SECONDS: 3600,
  MAX_ZIP_BYTES: 100000, MAX_ENTRY_BYTES: 100000, MAX_EXPANDED_BYTES: 200000, MAX_ZIP_ENTRIES: 10
};

export function dicomFile(sopId = '1.2.3.4.1', numbers?: { series: string; instance: string }): Buffer {
  function element(group: number, tag: number, vr: string, value: string | number | Buffer) {
    let data: Buffer;
    if (typeof value === 'number') { data = Buffer.alloc(2); data.writeUInt16LE(value); }
    else if (typeof value === 'string') { data = Buffer.from(value.length % 2 ? value + (vr === 'UI' ? '\0' : ' ') : value); }
    else data = value;
    const long = vr === 'OW';
    const header = Buffer.alloc(long ? 12 : 8);
    header.writeUInt16LE(group, 0); header.writeUInt16LE(tag, 2); header.write(vr, 4);
    if (long) header.writeUInt32LE(data.length, 8); else header.writeUInt16LE(data.length, 6);
    return Buffer.concat([header, data]);
  }
  return Buffer.concat([
    Buffer.alloc(128), Buffer.from('DICM'),
    element(2, 0x10, 'UI', '1.2.840.10008.1.2.1'),
    element(8, 0x18, 'UI', sopId), element(8, 0x60, 'CS', 'CT'),
    element(0x20, 0x0d, 'UI', '1.2.3'), element(0x20, 0x0e, 'UI', '1.2.3.4'),
    ...(numbers ? [element(0x20, 0x11, 'IS', numbers.series), element(0x20, 0x13, 'IS', numbers.instance)] : []),
    element(0x28, 2, 'US', 1), element(0x28, 4, 'CS', 'MONOCHROME2'),
    element(0x28, 0x10, 'US', 2), element(0x28, 0x11, 'US', 2),
    element(0x28, 0x100, 'US', 16), element(0x28, 0x101, 'US', 16), element(0x28, 0x103, 'US', 0),
    element(0x7fe0, 0x10, 'OW', Buffer.from([1, 0, 2, 0, 3, 0, 4, 0]))
  ]);
}
