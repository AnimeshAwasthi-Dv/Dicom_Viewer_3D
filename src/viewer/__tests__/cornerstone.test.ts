import { describe, expect, it } from 'vitest';
import type { DicomMetadata } from '../../types/dicom';
import { imageToWorld, measurementPoints, planeGeometry, thin, toolPoints, worldToImage } from '../measurements/geometry';
import { dicomJsonTags, dicomJsonToMetadata, type DicomJson } from '../dicom/dicomJson';
import { metadataModule } from '../cornerstone/metadata';
import { dicomWebLaunch } from '../dicom/dicomWebLaunch';

const metadata: DicomMetadata = {
  fileName: 'a.dcm', studyInstanceUID: '1', seriesInstanceUID: '1.2', sopInstanceUID: '1.2.3',
  rows: 512, columns: 256, bitsAllocated: 16, bitsStored: 12, pixelRepresentation: 1,
  photometricInterpretation: 'MONOCHROME2', samplesPerPixel: 1, rescaleSlope: 1, rescaleIntercept: -1024,
  transferSyntaxUID: '1.2.840.10008.1.2.4.70', pixelSpacing: [0.5, 0.8], imagePositionPatient: [-100, -120, 35],
  imageOrientationPatient: [1, 0, 0, 0, 1, 0], windowCenter: 40, windowWidth: 400, modality: 'CT'
};

describe('measurement geometry', () => {
  // PixelSpacing is [row spacing, column spacing]: 0.5 mm down a column, 0.8 mm along a row.
  const geometry = planeGeometry({ imagePositionPatient: [-100, -120, 35], rowCosines: [1, 0, 0], columnCosines: [0, 1, 0], rowPixelSpacing: 0.5, columnPixelSpacing: 0.8 });

  it('puts the first pixel centre at the image position', () => {
    expect(imageToWorld(geometry, { x: 0.5, y: 0.5 })).toEqual([-100, -120, 35]);
  });

  it('steps a column (x) by the column spacing and a row (y) by the row spacing', () => {
    expect(imageToWorld(geometry, { x: 10.5, y: 0.5 })).toEqual([-92, -120, 35]);
    expect(imageToWorld(geometry, { x: 0.5, y: 10.5 })).toEqual([-100, -115, 35]);
  });

  it('round-trips image points through world space on an oblique plane', () => {
    const oblique = planeGeometry({ imagePositionPatient: [5, 6, 7], rowCosines: [0, 1, 0], columnCosines: [0, 0, -1], rowPixelSpacing: 0.7, columnPixelSpacing: 0.9 });
    const point = { x: 123.25, y: 45.75 };
    const back = worldToImage(oblique, imageToWorld(oblique, point));
    expect(back.x).toBeCloseTo(point.x, 9);
    expect(back.y).toBeCloseTo(point.y, 9);
  });

  it('defaults a 2D image without geometry to pixel units at the origin', () => {
    expect(imageToWorld(planeGeometry(undefined), { x: 3.5, y: 4.5 })).toEqual([3, 4, 0]);
  });

  it('converts rectangle and ellipse corners to tool handles and back', () => {
    const corners = [{ x: 10, y: 20 }, { x: 30, y: 60 }];
    expect(toolPoints('rectangleRoi', corners)).toHaveLength(4);
    expect(measurementPoints('rectangleRoi', toolPoints('rectangleRoi', corners))).toEqual(corners);
    expect(toolPoints('ellipseRoi', corners)).toEqual([{ x: 20, y: 60 }, { x: 20, y: 20 }, { x: 10, y: 40 }, { x: 30, y: 40 }]);
    expect(measurementPoints('ellipseRoi', toolPoints('ellipseRoi', corners))).toEqual(corners);
  });

  it('draws an older single-point note as an arrow pointing at it', () => {
    const [head, tail] = toolPoints('annotation', [{ x: 50, y: 50 }]);
    expect(head).toEqual({ x: 50, y: 50 });
    expect(tail.x).toBeGreaterThan(50);
  });

  it('thins long outlines to the API limit', () => {
    const outline = Array.from({ length: 5000 }, (_, index) => ({ x: index, y: 0 }));
    expect(thin(outline)).toHaveLength(1024);
    expect(thin(outline.slice(0, 10))).toHaveLength(10);
  });
});

describe('DICOM JSON', () => {
  const json: DicomJson = {
    '00100010': { vr: 'PN', Value: [{ Alphabetic: 'DOE^JANE' }] },
    '0020000D': { vr: 'UI', Value: ['1'] },
    '0020000E': { vr: 'UI', Value: ['1.2'] },
    '00080018': { vr: 'UI', Value: ['1.2.3'] },
    '00080060': { vr: 'CS', Value: ['US'] },
    '00280010': { vr: 'US', Value: [480] },
    '00280011': { vr: 'US', Value: [640] },
    '00280002': { vr: 'US', Value: [3] },
    '00280004': { vr: 'CS', Value: ['YBR_FULL_422'] },
    '00280008': { vr: 'IS', Value: [45] },
    '00281050': { vr: 'DS', Value: [40, 300] },
    '00281051': { vr: 'DS', Value: [400, 1500] },
    '00281055': { vr: 'LO', Value: ['SOFT', 'BONE'] },
    '7FE00010': { vr: 'OB', BulkDataURI: 'http://pacs/bulk' },
    '00540016': { vr: 'SQ', Value: [{}] }
  };

  it('converts WADO-RS metadata to the viewer index', () => {
    const meta = dicomJsonToMetadata(json);
    expect(meta.patientName).toBe('DOE JANE');
    expect([meta.rows, meta.columns, meta.samplesPerPixel]).toEqual([480, 640, 3]);
    expect(meta.numberOfFrames).toBe(45);
    expect(meta.voiPresets).toEqual([{ center: 40, width: 400, explanation: 'SOFT' }, { center: 300, width: 1500, explanation: 'BONE' }]);
    expect(meta.modality).toBe('US');
  });

  it('lists tags without pixel data', () => {
    const tags = dicomJsonTags(json);
    expect(tags.find((tag) => tag.tag === '(0010,0010)')?.value).toBe('DOE^JANE');
    expect(tags.find((tag) => tag.tag === '(0054,0016)')?.value).toContain('Sequence');
    expect(tags.some((tag) => tag.tag === '(7FE0,0010)')).toBe(false);
  });
});

describe('index metadata for Cornerstone', () => {
  it('describes the image plane as Cornerstone expects', () => {
    const plane = metadataModule('imagePlaneModule', metadata) as Record<string, unknown>;
    expect(plane.rowCosines).toEqual([1, 0, 0]);
    expect(plane.columnCosines).toEqual([0, 1, 0]);
    expect(plane.rowPixelSpacing).toBe(0.5);
    expect(plane.columnPixelSpacing).toBe(0.8);
    expect(plane.usingDefaultValues).toBe(false);
  });

  it('describes pixels, rescale and window', () => {
    expect(metadataModule('imagePixelModule', metadata)).toMatchObject({ rows: 512, columns: 256, bitsStored: 12, highBit: 11, pixelRepresentation: 1 });
    expect(metadataModule('modalityLutModule', metadata)).toEqual({ rescaleSlope: 1, rescaleIntercept: -1024 });
    expect(metadataModule('voiLutModule', metadata)).toEqual({ windowCenter: [40], windowWidth: [400] });
    expect(metadataModule('generalSeriesModule', metadata)).toMatchObject({ modality: 'CT' });
  });

  it('leaves modules it does not know to the file', () => {
    expect(metadataModule('overlayPlaneModule', metadata)).toBeUndefined();
  });
});

describe('DICOMweb launch links', () => {
  it('reads the study from the gateway redirect and OHIF-style links', () => {
    expect(dicomWebLaunch('?study=1.2.3')).toEqual({ studyInstanceUID: '1.2.3', root: '/dicom-web' });
    expect(dicomWebLaunch('?StudyInstanceUIDs=4.5.6,7.8')?.studyInstanceUID).toBe('4.5.6');
    expect(dicomWebLaunch('?session=abc')).toBeUndefined();
  });

  it('only uses a same-origin DICOMweb root, so the session cookie never leaves the gateway', () => {
    expect(dicomWebLaunch('?study=1&dicomweb=/pacs/dicom-web')?.root).toBe('/pacs/dicom-web');
    expect(dicomWebLaunch('?study=1&dicomweb=https://evil.example/dicom-web')?.root).toBe('/dicom-web');
  });
});
