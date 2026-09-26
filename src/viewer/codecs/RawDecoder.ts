import type { DecodedFrame, DicomMetadata } from '../../types/dicom';
import type { Decoder } from './interfaces';
import { isUncompressedLittleEndian } from '../dicom/TransferSyntax';

export type StoredPixels = NonNullable<DecodedFrame['storedPixels']>;

export function applyRescale(storedValue: number, slope: number, intercept: number): number {
  return storedValue * slope + intercept;
}

export function modalityUnit(modality?: string): string {
  if (modality === 'CT') return 'HU';
  if (modality === 'PT' || modality === 'PET') return 'SUV';
  return 'value';
}

function sampleAt(pixels: StoredPixels, pixelIndex: number, sampleIndex: number, pixelCount: number, metadata: DicomMetadata): number {
  if (metadata.samplesPerPixel <= 1) return pixels[pixelIndex];
  if (metadata.planarConfiguration === 1) return pixels[pixelIndex + sampleIndex * pixelCount];
  return pixels[pixelIndex * metadata.samplesPerPixel + sampleIndex];
}

export function toModalityPixels(storedPixels: StoredPixels, metadata: DicomMetadata): { modalityPixels: Float32Array; min: number; max: number } {
  const displayPixelCount = metadata.rows * metadata.columns;
  const modalityPixels = new Float32Array(displayPixelCount);
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  const isColor = metadata.samplesPerPixel > 1;

  for (let i = 0; i < displayPixelCount; i += 1) {
    const storedValue = isColor
      ? 0.299 * sampleAt(storedPixels, i, 0, displayPixelCount, metadata) +
        0.587 * sampleAt(storedPixels, i, 1, displayPixelCount, metadata) +
        0.114 * sampleAt(storedPixels, i, 2, displayPixelCount, metadata)
      : storedPixels[i];
    const value = isColor ? storedValue : applyRescale(storedValue, metadata.rescaleSlope, metadata.rescaleIntercept);
    modalityPixels[i] = value;
    if (value < min) min = value;
    if (value > max) max = value;
  }

  if (!Number.isFinite(min) || !Number.isFinite(max)) return { modalityPixels, min: 0, max: 255 };
  return { modalityPixels, min, max };
}

export class RawDecoder implements Decoder {
  canDecode(transferSyntaxUID: string): boolean {
    return isUncompressedLittleEndian(transferSyntaxUID);
  }

  decode(metadata: DicomMetadata, pixelData: ArrayBuffer): DecodedFrame {
    const started = performance.now();
    const storedSampleCount = metadata.rows * metadata.columns * metadata.samplesPerPixel;
    const expectedBytes = storedSampleCount * (metadata.bitsAllocated / 8);
    if (pixelData.byteLength < expectedBytes) {
      throw new Error(`PixelData is too small for uncompressed decoding: ${pixelData.byteLength} bytes available, ${expectedBytes} expected.`);
    }
    let storedPixels: StoredPixels;

    if (metadata.bitsAllocated === 8) {
      storedPixels = metadata.pixelRepresentation === 1 ? new Int8Array(pixelData, 0, storedSampleCount) : new Uint8Array(pixelData, 0, storedSampleCount);
    } else if (metadata.bitsAllocated === 16) {
      storedPixels = metadata.pixelRepresentation === 1 ? new Int16Array(pixelData, 0, storedSampleCount) : new Uint16Array(pixelData, 0, storedSampleCount);
    } else {
      throw new Error(`Unsupported BitsAllocated: ${metadata.bitsAllocated}`);
    }

    const { modalityPixels, min, max } = toModalityPixels(storedPixels, metadata);

    return {
      metadata,
      storedPixels,
      modalityPixels,
      min,
      max,
      decodeTimeMs: performance.now() - started
    };
  }
}
