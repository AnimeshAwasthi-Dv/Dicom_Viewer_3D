import type { DecodedFrame, DicomMetadata } from '../../types/dicom';
import { TRANSFER_SYNTAX } from '../dicom/TransferSyntax';
import type { Decoder } from './interfaces';
import { toModalityPixels, type StoredPixels } from './RawDecoder';

interface JpegLSFrameInfo {
  width: number;
  height: number;
  bitsPerSample: number;
  componentCount: number;
}

interface JpegLSDecoderInstance {
  getEncodedBuffer(length: number): Uint8Array;
  decode(): void;
  getFrameInfo(): JpegLSFrameInfo;
  getDecodedBuffer(): Uint8Array | Uint16Array | Int16Array;
  delete(): void;
}

interface CharLsModule {
  JpegLSDecoder: new () => JpegLSDecoderInstance;
}

type CharLsFactory = () => Promise<CharLsModule>;


let modulePromise: Promise<CharLsModule> | undefined;

async function getCharLs(): Promise<CharLsModule> {
  modulePromise ??= import('@cornerstonejs/codec-charls/decode').then((module) => {
    const factory = module.default as CharLsFactory;
    return factory();
  });
  return modulePromise;
}

export class CharLsDecoder implements Decoder {
  canDecode(transferSyntaxUID: string): boolean {
    return transferSyntaxUID === TRANSFER_SYNTAX.jpegLsLossless;
  }

  async preload(): Promise<void> {
    await getCharLs();
  }

  decode(): DecodedFrame {
    throw new Error('JPEG-LS decoding is asynchronous. Use decodeAsync.');
  }

  async decodeAsync(metadata: DicomMetadata, pixelData: ArrayBuffer): Promise<DecodedFrame> {
    const started = performance.now();
    const charls = await getCharLs();
    const decoder = new charls.JpegLSDecoder();
    try {
      const encoded = new Uint8Array(pixelData);
      decoder.getEncodedBuffer(encoded.byteLength).set(encoded);
      decoder.decode();
      const info = decoder.getFrameInfo();
      if (info.width !== metadata.columns || info.height !== metadata.rows) {
        throw new Error(`JPEG-LS frame size ${info.width}x${info.height} does not match DICOM metadata ${metadata.columns}x${metadata.rows}.`);
      }
      const decoded = decoder.getDecodedBuffer();
      const componentCount = info.componentCount || metadata.samplesPerPixel;
      const pixelCount = info.width * info.height * componentCount;
      const bytesPerSample = info.bitsPerSample > 8 ? 2 : 1;
      const expectedBytes = pixelCount * bytesPerSample;
      const decodedBytes = new Uint8Array(decoded.buffer, decoded.byteOffset, decoded.byteLength);
      if (decodedBytes.byteLength < expectedBytes) {
        throw new Error(`JPEG-LS decoded ${decodedBytes.byteLength} bytes, expected ${expectedBytes} bytes for ${info.width}x${info.height}x${componentCount} at ${info.bitsPerSample} bits.`);
      }
      const pixelBytes = decodedBytes.slice(0, expectedBytes);
      const storedPixels: StoredPixels = bytesPerSample === 2
        ? metadata.pixelRepresentation === 1
          ? new Int16Array(pixelBytes.buffer, 0, pixelCount)
          : new Uint16Array(pixelBytes.buffer, 0, pixelCount)
        : metadata.pixelRepresentation === 1
          ? new Int8Array(pixelBytes.buffer, 0, pixelCount)
          : new Uint8Array(pixelBytes.buffer, 0, pixelCount);
      const { modalityPixels, min, max } = toModalityPixels(storedPixels, { ...metadata, samplesPerPixel: componentCount });
      return { metadata, storedPixels, modalityPixels, min, max, decodeTimeMs: performance.now() - started };
    } finally {
      decoder.delete();
    }
  }
}
