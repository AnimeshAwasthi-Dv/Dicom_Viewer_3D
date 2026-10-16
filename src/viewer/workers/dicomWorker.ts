import { DicomParser } from '../dicom/DicomParser';
import { CodecManager } from '../codecs/CodecManager';
import { expandPreview } from '../dicom/PreviewFormat';
import { decodeRasterImage, parseRasterImage, rasterFormat } from '../dicom/RasterImage';
import type { DecodedFrame, DicomMetadata, ParsedDicomFile } from '../../types/dicom';

export interface DicomWorkerFile {
  name: string;
  buffer: ArrayBuffer;
}

/** Parse a batch of files (local loading). */
export interface DicomWorkerRequest {
  id: string;
  files: DicomWorkerFile[];
  rasterStudyId?: string;
}

/** Decode one image off the main thread: either a whole DICOM file or already-extracted pixel data. */
export interface DicomDecodeRequest {
  id: string;
  kind: 'decode';
  buffer?: ArrayBuffer;
  metadata?: DicomMetadata;
  pixelData?: ArrayBuffer;
  expectedSopInstanceUID?: string;
  /** `buffer` is a low-resolution preview of the slice this metadata describes (see PreviewFormat). */
  previewOf?: DicomMetadata;
}

/** Load codecs ahead of the first decode. */
export interface DicomWarmRequest {
  id: string;
  kind: 'warm';
  transferSyntaxes: string[];
}

export interface DicomWorkerResponse {
  id: string;
  parsed: ReturnType<DicomParser['parse']>[];
}

export interface DicomDecodeResponse {
  id: string;
  frame?: DecodedFrame;
  error?: string;
}

const parser = new DicomParser();
const codecs = new CodecManager();

function failedParse(name: string, error: unknown) {
  return {
    metadata: {
      fileName: name,
      studyInstanceUID: crypto.randomUUID(),
      seriesInstanceUID: crypto.randomUUID(),
      sopInstanceUID: crypto.randomUUID(),
      rows: 0,
      columns: 0,
      bitsAllocated: 16,
      bitsStored: 16,
      pixelRepresentation: 0 as const,
      photometricInterpretation: 'MONOCHROME2',
      samplesPerPixel: 1,
      rescaleSlope: 1,
      rescaleIntercept: 0,
      transferSyntaxUID: 'unknown'
    },
    error: error instanceof Error ? error.message : 'Invalid DICOM file.'
  };
}

async function decode(request: DicomDecodeRequest): Promise<DicomDecodeResponse> {
  try {
    let metadata = request.metadata;
    let pixelData = request.pixelData;
    if (request.buffer && request.previewOf) {
      ({ metadata, pixelData } = expandPreview(request.buffer, request.previewOf));
    } else if (request.buffer) {
      const file = parser.parse(request.buffer, 'remote.dcm');
      if (!file.pixelData || file.error) throw new Error(file.error ?? 'No pixel data returned.');
      metadata = file.metadata;
      pixelData = file.pixelData;
    }
    if (!metadata || !pixelData) throw new Error('No image returned by parser.');
    if (request.expectedSopInstanceUID && metadata.sopInstanceUID !== request.expectedSopInstanceUID) throw new Error('Image identity does not match the requested instance.');
    const frame = metadata.imageFormat
      ? await decodeRasterImage(metadata, pixelData)
      : await codecs.decodeAsync(metadata, pixelData);
    // The preview decodes as uncompressed; report the slice's own metadata, not the stand-in transfer syntax.
    return { id: request.id, frame: { metadata: request.previewOf ?? frame.metadata, modalityPixels: frame.modalityPixels, rgbaPixels: frame.rgbaPixels, min: frame.min, max: frame.max, decodeTimeMs: frame.decodeTimeMs } };
  } catch (error) {
    return { id: request.id, error: error instanceof Error ? error.message : 'Unable to decode image.' };
  }
}

self.onmessage = async (event: MessageEvent<DicomWorkerRequest | DicomDecodeRequest | DicomWarmRequest>) => {
  const data = event.data;
  if ('kind' in data && data.kind === 'warm') {
    await codecs.preload(data.transferSyntaxes).catch(() => undefined);
    return;
  }
  if ('kind' in data && data.kind === 'decode') {
    const response = await decode(data);
    self.postMessage(response, response.frame ? { transfer: [response.frame.modalityPixels.buffer, ...(response.frame.rgbaPixels ? [response.frame.rgbaPixels.buffer] : [])] } : undefined);
    return;
  }
  const { id, files, rasterStudyId = crypto.randomUUID() } = data as DicomWorkerRequest;
  const parsed: ParsedDicomFile[] = [];
  // Read image dimensions sequentially to avoid holding an entire batch of bitmaps in memory.
  for (const file of files) {
    try {
      parsed.push(rasterFormat(file.buffer)
        ? await parseRasterImage(file.buffer, file.name, rasterStudyId)
        : parser.parse(file.buffer, file.name));
    } catch (error) {
      parsed.push(failedParse(file.name, error));
    }
  }
  // Transfer the pixel buffers: copying a batch's pixels back (about 24 MB for 48 CT slices) stalls the main thread.
  const transfer = new Set(parsed.flatMap((file) => ('pixelData' in file && file.pixelData ? [file.pixelData] : [])));
  self.postMessage({ id, parsed }, { transfer: [...transfer] });
};
