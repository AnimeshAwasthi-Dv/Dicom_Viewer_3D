import type { DecodedFrame, DicomMetadata } from '../../types/dicom';

export interface Decoder {
  canDecode(transferSyntaxUID: string): boolean;
  decode(metadata: DicomMetadata, pixelData: ArrayBuffer): DecodedFrame;
  decodeAsync?(metadata: DicomMetadata, pixelData: ArrayBuffer): Promise<DecodedFrame>;
  /** Load the codec (WebAssembly) ahead of the first decode. */
  preload?(): Promise<void>;
}
