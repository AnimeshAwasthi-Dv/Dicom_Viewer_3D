import type { DicomMetadata } from '../../types/dicom';
import { isUncompressedLittleEndian, TRANSFER_SYNTAX } from './TransferSyntax';

/**
 * Low-resolution previews of large slices, built at import and shown while the full slice downloads.
 *
 * Layout (little endian): "DXPV", version, bitsAllocated, pixelRepresentation, factor, rows, columns, full rows,
 * full columns (u16 each), then the box-averaged stored values. Stored values, not modality values, so the preview
 * goes through the same rescale as the full slice.
 */
const MAGIC = 0x56505844; // "DXPV"
const VERSION = 1;
const HEADER_BYTES = 16;
/** Previews are at most this many pixels on their longer side. */
const PREVIEW_SIZE = 256;
/** Slices smaller than this on both sides are fast enough to download in full. */
export const PREVIEW_MIN_SIZE = 384;

type Stored = Int16Array | Uint16Array | Uint8Array | Int8Array;

export function canPreview(metadata: DicomMetadata): boolean {
  return isUncompressedLittleEndian(metadata.transferSyntaxUID)
    && metadata.samplesPerPixel === 1
    && (metadata.bitsAllocated === 8 || metadata.bitsAllocated === 16)
    && Math.max(metadata.rows, metadata.columns) >= PREVIEW_MIN_SIZE
    && Math.max(metadata.rows, metadata.columns) <= 0xffff;
}

/** Builds the preview from uncompressed pixel data, or returns undefined when the slice doesn't need one. */
export function encodePreview(metadata: DicomMetadata, pixelData: ArrayBuffer): Uint8Array | undefined {
  if (!canPreview(metadata)) return undefined;
  const { rows, columns } = metadata;
  if (pixelData.byteLength < rows * columns * (metadata.bitsAllocated / 8)) return undefined;
  const source = storedView(metadata.bitsAllocated, metadata.pixelRepresentation, pixelData, rows * columns);
  const factor = Math.max(2, Math.ceil(Math.max(rows, columns) / PREVIEW_SIZE));
  const outRows = Math.ceil(rows / factor);
  const outColumns = Math.ceil(columns / factor);
  const buffer = new ArrayBuffer(HEADER_BYTES + outRows * outColumns * (metadata.bitsAllocated / 8));
  const header = new DataView(buffer, 0, HEADER_BYTES);
  header.setUint32(0, MAGIC, true);
  header.setUint8(4, VERSION);
  header.setUint8(5, metadata.bitsAllocated);
  header.setUint8(6, metadata.pixelRepresentation);
  header.setUint8(7, factor);
  header.setUint16(8, outRows, true);
  header.setUint16(10, outColumns, true);
  header.setUint16(12, rows, true);
  header.setUint16(14, columns, true);
  const out = storedView(metadata.bitsAllocated, metadata.pixelRepresentation, buffer, outRows * outColumns, HEADER_BYTES);
  for (let y = 0; y < outRows; y++) {
    const y0 = y * factor;
    const y1 = Math.min(rows, y0 + factor);
    for (let x = 0; x < outColumns; x++) {
      const x0 = x * factor;
      const x1 = Math.min(columns, x0 + factor);
      let sum = 0;
      for (let sy = y0; sy < y1; sy++) for (let sx = x0; sx < x1; sx++) sum += source[sy * columns + sx];
      out[y * outColumns + x] = Math.round(sum / ((y1 - y0) * (x1 - x0)));
    }
  }
  return new Uint8Array(buffer);
}

/**
 * Scales a preview back up to the full slice size (bilinear), so it renders, measures and hands over to the full slice
 * with the same geometry. Returns metadata and uncompressed pixel data for the ordinary raw decoder.
 */
export function expandPreview(buffer: ArrayBuffer, metadata: DicomMetadata): { metadata: DicomMetadata; pixelData: ArrayBuffer } {
  if (buffer.byteLength < HEADER_BYTES) throw new Error('Preview is truncated.');
  const header = new DataView(buffer, 0, HEADER_BYTES);
  if (header.getUint32(0, true) !== MAGIC || header.getUint8(4) !== VERSION) throw new Error('Unknown preview format.');
  const bitsAllocated = header.getUint8(5);
  const pixelRepresentation = header.getUint8(6);
  const factor = header.getUint8(7);
  const rows = header.getUint16(8, true);
  const columns = header.getUint16(10, true);
  if (header.getUint16(12, true) !== metadata.rows || header.getUint16(14, true) !== metadata.columns
    || bitsAllocated !== metadata.bitsAllocated || pixelRepresentation !== metadata.pixelRepresentation) {
    throw new Error('Preview does not match the slice.');
  }
  if (buffer.byteLength < HEADER_BYTES + rows * columns * (bitsAllocated / 8)) throw new Error('Preview is truncated.');
  const source = storedView(bitsAllocated, pixelRepresentation, buffer, rows * columns, HEADER_BYTES);
  const pixelData = new ArrayBuffer(metadata.rows * metadata.columns * (bitsAllocated / 8));
  const out = storedView(bitsAllocated, pixelRepresentation, pixelData, metadata.rows * metadata.columns);
  for (let y = 0; y < metadata.rows; y++) {
    // Preview pixel centres sit at (i + 0.5) * factor in full-size coordinates.
    const py = clamp((y + 0.5) / factor - 0.5, 0, rows - 1);
    const r0 = Math.floor(py);
    const r1 = Math.min(rows - 1, r0 + 1);
    const fy = py - r0;
    for (let x = 0; x < metadata.columns; x++) {
      const px = clamp((x + 0.5) / factor - 0.5, 0, columns - 1);
      const c0 = Math.floor(px);
      const c1 = Math.min(columns - 1, c0 + 1);
      const fx = px - c0;
      const top = source[r0 * columns + c0] * (1 - fx) + source[r0 * columns + c1] * fx;
      const bottom = source[r1 * columns + c0] * (1 - fx) + source[r1 * columns + c1] * fx;
      out[y * metadata.columns + x] = Math.round(top * (1 - fy) + bottom * fy);
    }
  }
  return { metadata: { ...metadata, transferSyntaxUID: TRANSFER_SYNTAX.explicitLittleEndian }, pixelData };
}

function storedView(bitsAllocated: number, pixelRepresentation: number, buffer: ArrayBuffer, length: number, offset = 0): Stored {
  if (bitsAllocated === 8) return pixelRepresentation === 1 ? new Int8Array(buffer, offset, length) : new Uint8Array(buffer, offset, length);
  return pixelRepresentation === 1 ? new Int16Array(buffer, offset, length) : new Uint16Array(buffer, offset, length);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
