import type { DecodedFrame, DicomMetadata } from '../../types/dicom';
import type { ImageSource } from '../dicom/ImageSource';
import type { Series } from '../study/Series';

export type MprPlane = 'axial' | 'coronal' | 'sagittal';

export interface DicomVolume {
  width: number;
  height: number;
  depth: number;
  spacing: [number, number, number];
  data: Float32Array;
  min: number;
  max: number;
  windowWidth: number;
  windowCenter: number;
  modality?: string;
  monochromeOne: boolean;
}

export interface PlaneImage {
  width: number;
  height: number;
  imageData: ImageData;
}

function finiteOr(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && value !== undefined ? value : fallback;
}

function deriveSliceSpacing(series: Series, firstFrame: DecodedFrame): number {
  const positions = series.instances.map((instance) => instance.sortPosition).filter(Number.isFinite);
  if (positions.length >= 2) {
    const distances = positions.slice(1).map((position, index) => Math.abs(position - positions[index])).filter((distance) => distance > 0.0001);
    if (distances.length > 0) return distances.reduce((sum, value) => sum + value, 0) / distances.length;
  }
  return finiteOr(firstFrame.metadata.spacingBetweenSlices, finiteOr(firstFrame.metadata.sliceThickness, 1));
}

function initialWindow(metadata: DicomMetadata[], min: number, max: number): { width: number; center: number } {
  const metadataWidth = metadata.find((item) => item.windowWidth && item.windowWidth > 1)?.windowWidth;
  const metadataCenter = metadata.find((item) => item.windowCenter !== undefined)?.windowCenter;
  if (metadataWidth && metadataCenter !== undefined) return { width: metadataWidth, center: metadataCenter };
  const width = Math.max(1, max - min);
  return { width, center: min + width / 2 };
}

export async function buildDicomVolume(
  source: ImageSource,
  series: Series,
  onProgress?: (loaded: number, total: number) => void,
  signal?: AbortSignal
): Promise<DicomVolume> {
  if (series.instances.length < 2) throw new Error('3D MPR requires a series with at least two slices.');
  signal?.throwIfAborted();
  const first = await source.getFrame(series.instances[0].id);
  signal?.throwIfAborted();
  const width = first.metadata.columns;
  const height = first.metadata.rows;
  const depth = series.instances.length;
  const data = new Float32Array(width * height * depth);
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (let start = 0; start < depth; start += 4) {
    signal?.throwIfAborted();
    const batch = await Promise.all(series.instances.slice(start, start + 4).map((instance, offset) => start + offset === 0 ? first : source.getFrame(instance.id)));
    signal?.throwIfAborted();
    batch.forEach((frame, offset) => {
      if (frame.metadata.columns !== width || frame.metadata.rows !== height || frame.metadata.samplesPerPixel !== 1) throw new Error('3D MPR currently supports single-channel series with matching slice dimensions.');
      data.set(frame.modalityPixels, (start + offset) * width * height);
      min = Math.min(min, frame.min);
      max = Math.max(max, frame.max);
    });
    onProgress?.(Math.min(start + 4, depth), depth);
  }

  const [rowSpacing = 1, columnSpacing = 1] = first.metadata.pixelSpacing ?? [1, 1];
  const sliceSpacing = deriveSliceSpacing(series, first);
  const window = initialWindow(series.instances.map(instance => instance.metadata), min, max);
  return {
    width,
    height,
    depth,
    spacing: [columnSpacing, rowSpacing, sliceSpacing],
    data,
    min,
    max,
    windowWidth: window.width,
    windowCenter: window.center,
    modality: first.metadata.modality,
    monochromeOne: first.metadata.photometricInterpretation === 'MONOCHROME1'
  };
}

export function planeDimensions(volume: DicomVolume, plane: MprPlane): { width: number; height: number; maxIndex: number } {
  if (plane === 'axial') return { width: volume.width, height: volume.height, maxIndex: volume.depth - 1 };
  if (plane === 'coronal') return { width: volume.width, height: volume.depth, maxIndex: volume.height - 1 };
  return { width: volume.depth, height: volume.height, maxIndex: volume.width - 1 };
}

export function renderPlane(volume: DicomVolume, plane: MprPlane, index: number, windowWidth: number, windowCenter: number, inverted = false): PlaneImage {
  const dimensions = planeDimensions(volume, plane);
  const clampedIndex = Math.min(dimensions.maxIndex, Math.max(0, Math.round(index)));
  const imageData = new ImageData(dimensions.width, dimensions.height);
  const pixels = imageData.data;
  const low = windowCenter - 0.5 - (windowWidth - 1) / 2;
  const high = windowCenter - 0.5 + (windowWidth - 1) / 2;
  const scale = 255 / Math.max(1, high - low);

  for (let y = 0; y < dimensions.height; y += 1) {
    for (let x = 0; x < dimensions.width; x += 1) {
      let value = 0;
      if (plane === 'axial') {
        value = volume.data[clampedIndex * volume.width * volume.height + y * volume.width + x];
      } else if (plane === 'coronal') {
        const z = dimensions.height - 1 - y;
        value = volume.data[z * volume.width * volume.height + clampedIndex * volume.width + x];
      } else {
        const z = dimensions.width - 1 - x;
        value = volume.data[z * volume.width * volume.height + y * volume.width + clampedIndex];
      }
      let gray = Math.min(255, Math.max(0, Math.round((value - low) * scale)));
      if (volume.monochromeOne) gray = 255 - gray;
      if (inverted) gray = 255 - gray;
      const offset = (y * dimensions.width + x) * 4;
      pixels[offset] = gray;
      pixels[offset + 1] = gray;
      pixels[offset + 2] = gray;
      pixels[offset + 3] = 255;
    }
  }

  return { width: dimensions.width, height: dimensions.height, imageData };
}
