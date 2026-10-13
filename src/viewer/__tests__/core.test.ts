import { describe, expect, it } from 'vitest';
import type { DicomMetadata, ParsedDicomFile } from '../../types/dicom';
import { isSupportedTransferSyntax, TRANSFER_SYNTAX } from '../dicom/TransferSyntax';
import { extractMetadata } from '../dicom/MetadataExtractor';
import { buildStudies, choosePrimarySeries, imageCount, seriesFrames, sortSeriesInstances } from '../study/StudyManager';

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
      sortPosition: 30 - index * 10,
      errors: []
    }));
    expect(sortSeriesInstances(instances).map((instance) => instance.id)).toEqual(['sop-1', 'sop-2', 'sop-3']);
  });

  it('preserves acquisition order when diffusion volumes repeat slice positions', () => {
    const instances = [
      { instanceNumber: 1, z: 0 }, { instanceNumber: 2, z: 10 },
      { instanceNumber: 21, z: 0 }, { instanceNumber: 22, z: 10 }
    ].map(({ instanceNumber, z }) => ({
      id: `sop-${instanceNumber}`,
      fileName: 'dwi.dcm',
      metadata: metadata({ sopInstanceUID: `sop-${instanceNumber}`, instanceNumber }),
      sortPosition: z,
      errors: []
    }));
    expect(sortSeriesInstances(instances).map((instance) => instance.id)).toEqual(['sop-1', 'sop-2', 'sop-21', 'sop-22']);
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

  it('reads every VOI window a file stores, with its explanation', () => {
    const elements = new Map<string, string | number | number[]>([
      ['00281050', [40, -600]],
      ['00281051', [400, 1500]],
      ['00281055', 'SOFT\\LUNG']
    ]);
    const meta = extractMetadata(elements, 'test.dcm', TRANSFER_SYNTAX.explicitLittleEndian);
    expect(meta.windowCenter).toBe(40);
    expect(meta.windowWidth).toBe(400);
    expect(meta.voiPresets).toEqual([{ center: 40, width: 400, explanation: 'SOFT' }, { center: -600, width: 1500, explanation: 'LUNG' }]);
  });

  it('reads the frame count of multi-frame images', () => {
    const multi = extractMetadata(new Map([['00280008', 30]]), 'cine.dcm', TRANSFER_SYNTAX.jpegBaseline);
    expect(multi.numberOfFrames).toBe(30);
    expect(extractMetadata(new Map([['00280008', 1]]), 'single.dcm', TRANSFER_SYNTAX.jpegBaseline).numberOfFrames).toBeUndefined();
  });

  it('accepts every transfer syntax Cornerstone decodes, and nothing else', () => {
    for (const uid of Object.values(TRANSFER_SYNTAX)) expect(isSupportedTransferSyntax(uid)).toBe(true);
    expect(isSupportedTransferSyntax('1.2.840.10008.1.2.4.100')).toBe(false);
    expect(isSupportedTransferSyntax('unknown')).toBe(false);
  });

  it('expands multi-frame instances into one image per frame', () => {
    const studies = buildStudies([
      { metadata: metadata({ sopInstanceUID: 'single', instanceNumber: 1 }) },
      { metadata: metadata({ sopInstanceUID: 'cine', instanceNumber: 2, numberOfFrames: 3 }) }
    ], true);
    const series = studies[0].series[0];
    expect(seriesFrames(series).map(({ instance, frameNumber }) => `${instance.id}:${frameNumber ?? '-'}`)).toEqual(['single:-', 'cine:1', 'cine:2', 'cine:3']);
    expect(imageCount(series)).toBe(4);
  });

  it('counts a series by its reported size until its instances load', () => {
    const series = { ...buildStudies([{ metadata: metadata() }], true)[0].series[0], instances: [], expectedImageCount: 240 };
    expect(imageCount(series)).toBe(240);
  });

  it('opens the largest CT or MR series first, counting frames', () => {
    const studies = buildStudies([
      { metadata: metadata({ seriesInstanceUID: 'scout', sopInstanceUID: 'a', modality: 'CT' }) },
      { metadata: metadata({ seriesInstanceUID: 'axial', sopInstanceUID: 'b', modality: 'CT', numberOfFrames: 50 }) },
      { metadata: metadata({ seriesInstanceUID: 'us', sopInstanceUID: 'c', modality: 'US', numberOfFrames: 90 }) }
    ], true);
    expect(choosePrimarySeries(studies)?.seriesInstanceUID).toBe('axial');
  });
});
