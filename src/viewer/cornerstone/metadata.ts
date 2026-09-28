import { wadouri } from '@cornerstonejs/dicom-image-loader';
import type { DicomMetadata } from '../../types/dicom';

/**
 * Metadata for images Cornerstone reads through the wadouri pipeline (local files and our S3 studies), taken from the
 * study index before their files arrive. Stacks and volumes need every slice's geometry up front, and the index
 * already has it. Once a file is loaded Cornerstone's own wadouri provider reads the complete header (palette
 * LUTs, per-frame geometry of multi-frame objects), so this provider steps aside for that image.
 */
const registry = new Map<string, DicomMetadata>();

export function registerImageMetadata(imageId: string, metadata: DicomMetadata): void {
  registry.set(imageId, metadata);
}

export function unregisterImageMetadata(imageIds: Iterable<string>): void {
  for (const imageId of imageIds) registry.delete(imageId);
}

export function imageMetadata(imageId: string): DicomMetadata | undefined {
  return registry.get(imageId);
}

function fileLoaded(imageId: string): boolean {
  return wadouri.dataSetCacheManager.isLoaded(wadouri.parseImageId(imageId).url);
}

const IDENTITY_ORIENTATION = [1, 0, 0, 0, 1, 0];

/** Cornerstone's module shapes, from the fields the index keeps. */
export function metadataModule(type: string, metadata: DicomMetadata): unknown {
  switch (type) {
    case 'imagePlaneModule': {
      const orientation = metadata.imageOrientationPatient ?? IDENTITY_ORIENTATION;
      const [rowSpacing, columnSpacing] = metadata.pixelSpacing ?? [];
      return {
        frameOfReferenceUID: metadata.frameOfReferenceUID,
        rows: metadata.rows,
        columns: metadata.columns,
        imageOrientationPatient: orientation,
        rowCosines: orientation.slice(0, 3),
        columnCosines: orientation.slice(3, 6),
        imagePositionPatient: metadata.imagePositionPatient ?? [0, 0, 0],
        sliceThickness: metadata.sliceThickness,
        spacingBetweenSlices: metadata.spacingBetweenSlices,
        pixelSpacing: metadata.pixelSpacing,
        rowPixelSpacing: rowSpacing,
        columnPixelSpacing: columnSpacing,
        usingDefaultValues: !metadata.imageOrientationPatient || !metadata.imagePositionPatient
      };
    }
    case 'imagePixelModule':
      return {
        samplesPerPixel: metadata.samplesPerPixel,
        photometricInterpretation: metadata.photometricInterpretation,
        planarConfiguration: metadata.planarConfiguration,
        rows: metadata.rows,
        columns: metadata.columns,
        bitsAllocated: metadata.bitsAllocated,
        bitsStored: metadata.bitsStored,
        highBit: metadata.bitsStored - 1,
        pixelRepresentation: metadata.pixelRepresentation
      };
    case 'voiLutModule': {
      const presets = metadata.voiPresets ?? (metadata.windowWidth && metadata.windowCenter !== undefined ? [{ center: metadata.windowCenter, width: metadata.windowWidth }] : []);
      return presets.length ? { windowCenter: presets.map((preset) => preset.center), windowWidth: presets.map((preset) => preset.width) } : {};
    }
    case 'modalityLutModule':
      return { rescaleSlope: metadata.rescaleSlope, rescaleIntercept: metadata.rescaleIntercept };
    case 'generalSeriesModule':
      return {
        modality: metadata.modality,
        seriesInstanceUID: metadata.seriesInstanceUID,
        seriesNumber: metadata.seriesNumber,
        seriesDescription: metadata.seriesDescription,
        studyInstanceUID: metadata.studyInstanceUID
      };
    case 'generalStudyModule':
      return { studyInstanceUID: metadata.studyInstanceUID, studyDate: metadata.studyDate, studyDescription: metadata.studyDescription };
    case 'patientModule':
      return { patientName: metadata.patientName, patientId: metadata.patientId };
    case 'generalImageModule':
      return { sopInstanceUID: metadata.sopInstanceUID, instanceNumber: metadata.instanceNumber };
    case 'sopCommonModule':
      return { sopInstanceUID: metadata.sopInstanceUID };
    case 'transferSyntax':
      return { transferSyntaxUID: metadata.transferSyntaxUID };
    default:
      return undefined;
  }
}

export function indexMetadataProvider(type: string, imageId: string): unknown {
  if (typeof imageId !== 'string') return undefined;
  const metadata = registry.get(imageId);
  if (!metadata || fileLoaded(imageId)) return undefined;
  return metadataModule(type, metadata);
}
