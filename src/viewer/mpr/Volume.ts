import type { DecodedFrame, DicomMetadata } from '../../types/dicom';
import type { ImageSource } from '../dicom/ImageSource';
import type { Series } from '../study/Series';
import { deviceProfile } from '../core/DeviceProfile';

export type MprPlane = 'axial' | 'coronal' | 'sagittal';

export interface DicomVolume {
  width: number;
  height: number;
  depth: number;
  spacing: [number, number, number];
  /** Int16 when every slice holds whole numbers in range (CT HU, most MR): half the memory of Float32. */
  data: Float32Array | Int16Array;
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
  const first = await source.getFrame(series.instances[0].id, { signal });
  signal?.throwIfAborted();
  const width = first.metadata.columns;
  const height = first.metadata.rows;
  const depth = series.instances.length;
  const integral = (frame: DecodedFrame) => Number.isInteger(frame.metadata.rescaleSlope) && Number.isInteger(frame.metadata.rescaleIntercept) && frame.metadata.samplesPerPixel === 1 && frame.min >= -32768 && frame.max <= 32767;
  let data: Float32Array | Int16Array = integral(first) ? new Int16Array(width * height * depth) : new Float32Array(width * height * depth);
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  // A pool of loaders, each taking the next slice as it finishes, keeps the download queue full: fixed batches wait
  // for their slowest slice. Slices are copied in as they arrive, so at most `parallel` decoded frames are held here.
  const parallel = source.mode === 'remote' ? deviceProfile().remoteRequests.max : deviceProfile().decodeWorkers + 1;
  let next = 1;
  let loaded = 1;
  const place = (frame: DecodedFrame, index: number) => {
    if (frame.metadata.columns !== width || frame.metadata.rows !== height || frame.metadata.samplesPerPixel !== 1) throw new Error('3D MPR currently supports single-channel series with matching slice dimensions.');
    // A slice that doesn't fit Int16 switches the whole volume to Float32.
    if (data instanceof Int16Array && !integral(frame)) data = Float32Array.from(data);
    data.set(frame.modalityPixels, index * width * height);
    min = Math.min(min, frame.min);
    max = Math.max(max, frame.max);
  };
  place(first, 0);
  onProgress?.(1, depth);
  let failed = false;
  const loader = async () => {
    while (next < depth && !failed) {
      signal?.throwIfAborted();
      const index = next++;
      const frame = await source.getFrame(series.instances[index].id, { signal });
      signal?.throwIfAborted();
      place(frame, index);
      loaded++;
      // Every few slices is enough for a progress bar and spares the MPR panel hundreds of re-renders.
      if (loaded % 4 === 0 || loaded === depth) onProgress?.(loaded, depth);
    }
  };
  await Promise.all(Array.from({ length: Math.min(parallel, depth - 1) }, () => loader().catch((error: unknown) => { failed = true; throw error; })));

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
