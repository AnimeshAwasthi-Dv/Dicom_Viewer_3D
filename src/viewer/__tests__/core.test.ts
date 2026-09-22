import { describe, expect, it } from 'vitest';
import type { DecodedFrame, DicomMetadata, ParsedDicomFile } from '../../types/dicom';
import { LRUCache } from '../cache/LRUCache';
import { OpenJpegDecoder } from '../codecs/OpenJpegDecoder';
import { applyRescale, RawDecoder } from '../codecs/RawDecoder';
import { isSupportedTransferSyntax, TRANSFER_SYNTAX } from '../dicom/TransferSyntax';
import { extractMetadata } from '../dicom/MetadataExtractor';
import { pixelDistanceMm } from '../measurements/CoordinateTransforms';
import { computeRoiStats } from '../measurements/MeasurementManager';
import { buildStudies, sortSeriesInstances } from '../study/StudyManager';

function metadata(partial: Partial<DicomMetadata> = {}): DicomMetadata {
  return {
    fileName: 'a.dcm',
    studyInstanceUID: 'study',
    seriesInstanceUID: 'series',
    sopInstanceUID: crypto.randomUUID(),
    rows: 2,
    columns: 2,
    bitsAllocated: 16,
    bitsStored: 16,
    pixelRepresentation: 1,
    photometricInterpretation: 'MONOCHROME2',
    samplesPerPixel: 1,
    rescaleSlope: 1,
    rescaleIntercept: 0,
    transferSyntaxUID: TRANSFER_SYNTAX.explicitLittleEndian,
    ...partial
  };
}

describe('viewer core', () => {
  it('sorts instances geometrically when position and orientation are present', () => {
    const files: ParsedDicomFile[] = [4, 1, 3].map((z) => ({
      metadata: metadata({
        sopInstanceUID: `sop-${z}`,
        imageOrientationPatient: [1, 0, 0, 0, 1, 0],
        imagePositionPatient: [0, 0, z],
        instanceNumber: 99
      }),
      pixelData: new ArrayBuffer(8)
    }));
    const studies = buildStudies(files);
    expect(studies[0].series[0].instances.map((instance) => instance.id)).toEqual(['sop-1', 'sop-3', 'sop-4']);
  });

  it('keeps geometric sorting but matches ascending instance-number direction', () => {
    const instances = [1, 2, 3].map((instanceNumber, index) => ({
      id: `sop-${instanceNumber}`,
      fileName: 'a.dcm',
      metadata: metadata({
        sopInstanceUID: `sop-${instanceNumber}`,
        imageOrientationPatient: [1, 0, 0, 0, 1, 0],
        imagePositionPatient: [0, 0, 30 - index * 10],
        instanceNumber
      }),
      pixelData: new ArrayBuffer(8),
      sortPosition: 30 - index * 10,
      errors: []
    }));
    expect(sortSeriesInstances(instances).map((instance) => instance.id)).toEqual(['sop-1', 'sop-2', 'sop-3']);
  });

  it('applies rescale slope and intercept', () => {
    expect(applyRescale(100, 2, -1024)).toBe(-824);
  });

  it('converts RGB samples into one display plane', () => {
    const pixels = new Uint8Array([
      255, 0, 0,
      0, 255, 0,
      0, 0, 255,
      255, 255, 255
    ]);
    const frame = new RawDecoder().decode(metadata({
      bitsAllocated: 8,
      bitsStored: 8,
      pixelRepresentation: 0,
      photometricInterpretation: 'RGB',
      samplesPerPixel: 3
    }), pixels.buffer);
    expect(frame.modalityPixels).toHaveLength(4);
    expect(Array.from(frame.modalityPixels)).toEqual([
      expect.closeTo(76.245, 3),
      expect.closeTo(149.685, 3),
      expect.closeTo(29.07, 3),
      255
    ]);
  });

  it('computes pixel distance in millimeters when spacing exists', () => {
    expect(pixelDistanceMm({ x: 0, y: 0 }, { x: 3, y: 4 }, [2, 1]).value).toBeCloseTo(Math.hypot(3, 8));
  });

  it('falls back to pixels when spacing is unavailable', () => {
    expect(pixelDistanceMm({ x: 0, y: 0 }, { x: 3, y: 4 }).unit).toBe('px');
  });

  it('computes ROI statistics over modality pixels', () => {
    const frame: DecodedFrame = {
      metadata: metadata({ modality: 'CT' }),
      storedPixels: new Int16Array([1, 2, 3, 4]),
      modalityPixels: new Float32Array([1, 2, 3, 4]),
      min: 1,
      max: 4,
      decodeTimeMs: 0
    };
    const stats = computeRoiStats(frame, { x: 0, y: 0 }, { x: 1, y: 1 });
    expect(stats.mean).toBe(2.5);
    expect(stats.min).toBe(1);
    expect(stats.max).toBe(4);
    expect(stats.unit).toBe('HU');
  });

  it('evicts least recently used cache entries by size', () => {
    const cache = new LRUCache<string, number>(3);
    cache.set('a', 1, 1);
    cache.set('b', 2, 1);
    cache.get('a');
    cache.set('c', 3, 2);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBe(1);
  });

  it('extracts required metadata with defaults', () => {
    const elements = new Map<string, string | number | number[]>([
      ['00100010', 'DOE^JANE'],
      ['00280010', 512],
      ['00280011', 256],
      ['00280030', '0.7\\0.8']
    ]);
    const meta = extractMetadata(elements, 'test.dcm', TRANSFER_SYNTAX.implicitLittleEndian);
    expect(meta.patientName).toBe('DOE JANE');
    expect(meta.rows).toBe(512);
    expect(meta.columns).toBe(256);
    expect(meta.pixelSpacing).toEqual([0.7, 0.8]);
  });

  it('detects unsupported transfer syntax', () => {
    expect(isSupportedTransferSyntax('1.2.840.10008.1.2.4.50')).toBe(false);
  });

  it('enables JPEG-LS lossless transfer syntax', () => {
    expect(isSupportedTransferSyntax('1.2.840.10008.1.2.4.80')).toBe(true);
  });

  it('enables JPEG 2000 transfer syntaxes', () => {
    expect(isSupportedTransferSyntax(TRANSFER_SYNTAX.jpeg2000Lossless)).toBe(true);
    expect(isSupportedTransferSyntax(TRANSFER_SYNTAX.jpeg2000)).toBe(true);
  });

  it('does not route JPEG-LS through the raw decoder', () => {
    expect(new RawDecoder().canDecode('1.2.840.10008.1.2.4.80')).toBe(false);
  });

  it('routes JPEG 2000 through the OpenJPEG decoder', () => {
    const decoder = new OpenJpegDecoder();
    expect(decoder.canDecode(TRANSFER_SYNTAX.jpeg2000Lossless)).toBe(true);
    expect(decoder.canDecode(TRANSFER_SYNTAX.jpeg2000)).toBe(true);
  });
});
