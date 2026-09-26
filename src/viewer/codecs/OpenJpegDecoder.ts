import type { DecodedFrame, DicomMetadata } from '../../types/dicom';
import { TRANSFER_SYNTAX } from '../dicom/TransferSyntax';
import type { Decoder } from './interfaces';
import { toModalityPixels, type StoredPixels } from './RawDecoder';

interface J2KFrameInfo {
  width: number;
  height: number;
  bitsPerSample: number;
  componentCount: number;
  isSigned?: boolean;
}

interface J2KDecoderInstance {
  getEncodedBuffer(length: number): Uint8Array;
  decode(): void;
  getFrameInfo(): J2KFrameInfo;
  getDecodedBuffer(): ArrayBuffer | Uint8Array | Uint16Array | Int16Array;
  delete?(): void;
}

interface OpenJpegModule {
  J2KDecoder: new () => J2KDecoderInstance;
}

type OpenJpegFactory = () => Promise<OpenJpegModule>;


let modulePromise: Promise<OpenJpegModule> | undefined;

async function getOpenJpeg(): Promise<OpenJpegModule> {
  modulePromise ??= import('@cornerstonejs/codec-openjpeg/decode').then((module) => {
    const factory = module.default as OpenJpegFactory;
    return factory();
  });
  return modulePromise;
}

function bytesFromDecodedBuffer(decoded: ArrayBuffer | Uint8Array | Uint16Array | Int16Array): Uint8Array {
  if (decoded instanceof ArrayBuffer) return new Uint8Array(decoded);
  return new Uint8Array(decoded.buffer, decoded.byteOffset, decoded.byteLength);
}

export class OpenJpegDecoder implements Decoder {
  canDecode(transferSyntaxUID: string): boolean {
    return transferSyntaxUID === TRANSFER_SYNTAX.jpeg2000Lossless || transferSyntaxUID === TRANSFER_SYNTAX.jpeg2000;
  }

  async preload(): Promise<void> {
    await getOpenJpeg();
  }

  decode(): DecodedFrame {
    throw new Error('JPEG 2000 decoding is asynchronous. Use decodeAsync.');
  }

  async decodeAsync(metadata: DicomMetadata, pixelData: ArrayBuffer): Promise<DecodedFrame> {
    const started = performance.now();
    const openjpeg = await getOpenJpeg();
    const decoder = new openjpeg.J2KDecoder();

    try {
      const encoded = new Uint8Array(pixelData);
      decoder.getEncodedBuffer(encoded.byteLength).set(encoded);
      decoder.decode();

      const info = decoder.getFrameInfo();
      if (info.width !== metadata.columns || info.height !== metadata.rows) {
        throw new Error(`JPEG 2000 frame size ${info.width}x${info.height} does not match DICOM metadata ${metadata.columns}x${metadata.rows}.`);
      }

      const componentCount = info.componentCount || metadata.samplesPerPixel || 1;
      const pixelCount = info.width * info.height * componentCount;
      const bitsPerSample = info.bitsPerSample || metadata.bitsStored || metadata.bitsAllocated;
      const bytesPerSample = bitsPerSample > 8 ? 2 : 1;
      const expectedBytes = pixelCount * bytesPerSample;
      const decodedBytes = bytesFromDecodedBuffer(decoder.getDecodedBuffer());

      if (decodedBytes.byteLength < expectedBytes) {
        throw new Error(`JPEG 2000 decoded ${decodedBytes.byteLength} bytes, expected ${expectedBytes} bytes for ${info.width}x${info.height}x${componentCount} at ${bitsPerSample} bits.`);
      }

      const pixelBytes = decodedBytes.slice(0, expectedBytes);
      const isSigned = info.isSigned ?? metadata.pixelRepresentation === 1;
      const storedPixels: StoredPixels = bytesPerSample === 2
        ? isSigned
          ? new Int16Array(pixelBytes.buffer, 0, pixelCount)
          : new Uint16Array(pixelBytes.buffer, 0, pixelCount)
        : isSigned
          ? new Int8Array(pixelBytes.buffer, 0, pixelCount)
          : new Uint8Array(pixelBytes.buffer, 0, pixelCount);

      const adjustedMetadata: DicomMetadata = {
        ...metadata,
        bitsAllocated: bytesPerSample * 8,
        bitsStored: bitsPerSample,
        pixelRepresentation: isSigned ? 1 : 0,
        samplesPerPixel: componentCount
      };
      const { modalityPixels, min, max } = toModalityPixels(storedPixels, adjustedMetadata);

      return {
        metadata: adjustedMetadata,
        storedPixels,
        modalityPixels,
        min,
        max,
        decodeTimeMs: performance.now() - started
      };
    } finally {
      decoder.delete?.();
    }
  }
}
