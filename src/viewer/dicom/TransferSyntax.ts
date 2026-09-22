export const TRANSFER_SYNTAX = {
  implicitLittleEndian: '1.2.840.10008.1.2',
  explicitLittleEndian: '1.2.840.10008.1.2.1',
  explicitBigEndian: '1.2.840.10008.1.2.2',
  jpegBaseline: '1.2.840.10008.1.2.4.50',
  jpegLossless: '1.2.840.10008.1.2.4.70',
  jpegLsLossless: '1.2.840.10008.1.2.4.80',
  jpegLsLossy: '1.2.840.10008.1.2.4.81',
  jpeg2000Lossless: '1.2.840.10008.1.2.4.90',
  jpeg2000: '1.2.840.10008.1.2.4.91',
  rle: '1.2.840.10008.1.2.5'
} as const;

export function isSupportedTransferSyntax(uid: string): boolean {
  return (
    uid === TRANSFER_SYNTAX.implicitLittleEndian ||
    uid === TRANSFER_SYNTAX.explicitLittleEndian ||
    uid === TRANSFER_SYNTAX.jpegLsLossless ||
    uid === TRANSFER_SYNTAX.jpeg2000Lossless ||
    uid === TRANSFER_SYNTAX.jpeg2000
  );
}

export function isUncompressedLittleEndian(uid: string): boolean {
  return uid === TRANSFER_SYNTAX.implicitLittleEndian || uid === TRANSFER_SYNTAX.explicitLittleEndian;
}

export function transferSyntaxLabel(uid: string): string {
  const labels: Record<string, string> = {
    [TRANSFER_SYNTAX.implicitLittleEndian]: 'Implicit VR Little Endian',
    [TRANSFER_SYNTAX.explicitLittleEndian]: 'Explicit VR Little Endian',
    [TRANSFER_SYNTAX.explicitBigEndian]: 'Explicit VR Big Endian',
    [TRANSFER_SYNTAX.jpegBaseline]: 'JPEG Baseline',
    [TRANSFER_SYNTAX.jpegLossless]: 'JPEG Lossless',
    [TRANSFER_SYNTAX.jpegLsLossless]: 'JPEG-LS Lossless',
    [TRANSFER_SYNTAX.jpegLsLossy]: 'JPEG-LS Near-Lossless',
    [TRANSFER_SYNTAX.jpeg2000Lossless]: 'JPEG 2000 Lossless',
    [TRANSFER_SYNTAX.jpeg2000]: 'JPEG 2000',
    [TRANSFER_SYNTAX.rle]: 'RLE Lossless'
  };
  return labels[uid] ?? 'Unsupported transfer syntax';
}
