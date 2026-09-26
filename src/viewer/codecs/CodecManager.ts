import type { DecodedFrame, DicomMetadata } from '../../types/dicom';
import { transferSyntaxLabel } from '../dicom/TransferSyntax';
import { CharLsDecoder } from './CharLsDecoder';
import type { Decoder } from './interfaces';
import { OpenJpegDecoder } from './OpenJpegDecoder';
import { RawDecoder } from './RawDecoder';

export class CodecManager {
  private readonly decoders: Decoder[] = [new RawDecoder(), new CharLsDecoder(), new OpenJpegDecoder()];

  register(decoder: Decoder): void {
    this.decoders.unshift(decoder);
  }

  decode(metadata: DicomMetadata, pixelData: ArrayBuffer): DecodedFrame {
    const decoder = this.decoders.find((candidate) => candidate.canDecode(metadata.transferSyntaxUID));
    if (!decoder) {
      throw new Error(`This study uses a compressed DICOM transfer syntax that is not currently enabled in this build.\n\nTransfer Syntax:\n${metadata.transferSyntaxUID} (${transferSyntaxLabel(metadata.transferSyntaxUID)})`);
    }
    return decoder.decode(metadata, pixelData);
  }

  /** Load the codecs for these transfer syntaxes now instead of on first decode. */
  async preload(transferSyntaxes: Iterable<string>): Promise<void> {
    const needed = new Set<Decoder>();
    for (const syntax of transferSyntaxes) {
      const decoder = this.decoders.find((candidate) => candidate.canDecode(syntax));
      if (decoder?.preload) needed.add(decoder);
    }
    await Promise.all([...needed].map((decoder) => decoder.preload!()));
  }

  async decodeAsync(metadata: DicomMetadata, pixelData: ArrayBuffer): Promise<DecodedFrame> {
    const decoder = this.decoders.find((candidate) => candidate.canDecode(metadata.transferSyntaxUID));
    if (!decoder) {
      throw new Error(`This study uses a compressed DICOM transfer syntax that is not currently enabled in this build.\n\nTransfer Syntax:\n${metadata.transferSyntaxUID} (${transferSyntaxLabel(metadata.transferSyntaxUID)})`);
    }
    if (decoder.decodeAsync) return decoder.decodeAsync(metadata, pixelData);
    return decoder.decode(metadata, pixelData);
  }
}
