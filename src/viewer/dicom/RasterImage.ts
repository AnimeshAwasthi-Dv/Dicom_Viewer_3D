import type { DecodedFrame, DicomMetadata, ParsedDicomFile } from '../../types/dicom';
import { toModalityPixels } from '../codecs/RawDecoder';

/** Detect content, including files with no extension or an uppercase extension. */
export function rasterFormat(buffer: ArrayBuffer): 'jpeg' | 'png' | undefined {
  const bytes = new Uint8Array(buffer);
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) return 'png';
  return undefined;
}

export function rasterMetadata(format: 'jpeg' | 'png', fileName: string, studyId: string, id: string, width: number, height: number): DicomMetadata {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width * height > 64 * 1024 * 1024) {
    throw new Error('Image dimensions exceed the supported 64 megapixel limit.');
  }
  return {
    imageFormat: format, fileName, studyInstanceUID: studyId, seriesInstanceUID: id, sopInstanceUID: id,
    studyDescription: 'Images', seriesDescription: fileName, modality: format.toUpperCase(),
    rows: height, columns: width, bitsAllocated: 8, bitsStored: 8, pixelRepresentation: 0,
    photometricInterpretation: 'RGB', samplesPerPixel: 3, planarConfiguration: 0,
    windowCenter: 128, windowWidth: 256, rescaleSlope: 1, rescaleIntercept: 0,
    // An explicit non-DICOM encoding; never advertise these bytes as a DICOM transfer syntax.
    transferSyntaxUID: `image/${format}`
  };
}

export async function parseRasterImage(buffer: ArrayBuffer, fileName: string, studyId: string): Promise<ParsedDicomFile> {
  const format = rasterFormat(buffer);
  if (!format) throw new Error('Not a JPEG or PNG image.');
  const bitmap = await createImageBitmap(new Blob([buffer], { type: `image/${format}` }));
  try {
    const id = crypto.randomUUID();
    return {
      metadata: rasterMetadata(format, fileName, studyId, id, bitmap.width, bitmap.height),
      // Keep compressed bytes so opening a folder doesn't retain every full-resolution bitmap.
      pixelData: buffer
    };
  } finally {
    bitmap.close();
  }
}

/** Runs in the decode worker; browser decoding also applies JPEG EXIF orientation. */
export async function decodeRasterImage(metadata: DicomMetadata, buffer: ArrayBuffer): Promise<DecodedFrame> {
  const started = performance.now();
  if (rasterFormat(buffer) !== metadata.imageFormat) throw new Error('Image format does not match its metadata.');
  const bitmap = await createImageBitmap(new Blob([buffer], { type: `image/${metadata.imageFormat}` }));
  try {
    if (bitmap.width !== metadata.columns || bitmap.height !== metadata.rows) throw new Error('Image dimensions do not match its metadata.');
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Unable to create image decoder canvas.');
    // Match the viewer's black background, including partially transparent PNG pixels.
    context.fillStyle = '#000';
    context.fillRect(0, 0, bitmap.width, bitmap.height);
    context.drawImage(bitmap, 0, 0);
    const rgbaPixels = new Uint8Array(context.getImageData(0, 0, bitmap.width, bitmap.height).data.buffer);
    // Measurements use luminance, while the renderer and thumbnails retain the original colors.
    const { modalityPixels, min, max } = toModalityPixels(rgbaPixels, { ...metadata, samplesPerPixel: 4 });
    return { metadata, rgbaPixels, modalityPixels, min, max, decodeTimeMs: performance.now() - started };
  } finally {
    bitmap.close();
  }
}
