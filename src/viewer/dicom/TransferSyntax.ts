export const TRANSFER_SYNTAX = {
  implicitLittleEndian: '1.2.840.10008.1.2',
  explicitLittleEndian: '1.2.840.10008.1.2.1',
  deflatedExplicitLittleEndian: '1.2.840.10008.1.2.1.99',
  explicitBigEndian: '1.2.840.10008.1.2.2',
  jpegBaseline: '1.2.840.10008.1.2.4.50',
  jpegExtended: '1.2.840.10008.1.2.4.51',
  jpegLosslessNonHierarchical: '1.2.840.10008.1.2.4.57',
  jpegLossless: '1.2.840.10008.1.2.4.70',
  jpegLsLossless: '1.2.840.10008.1.2.4.80',
  jpegLsLossy: '1.2.840.10008.1.2.4.81',
  jpeg2000Lossless: '1.2.840.10008.1.2.4.90',
  jpeg2000: '1.2.840.10008.1.2.4.91',
  htj2kLossless: '1.2.840.10008.1.2.4.201',
  htj2kLosslessRpcl: '1.2.840.10008.1.2.4.202',
  htj2k: '1.2.840.10008.1.2.4.203',
  rle: '1.2.840.10008.1.2.5'
} as const;

const labels: Record<string, string> = {
  [TRANSFER_SYNTAX.implicitLittleEndian]: 'Implicit VR Little Endian',
  [TRANSFER_SYNTAX.explicitLittleEndian]: 'Explicit VR Little Endian',
  [TRANSFER_SYNTAX.deflatedExplicitLittleEndian]: 'Deflated Explicit VR Little Endian',
  [TRANSFER_SYNTAX.explicitBigEndian]: 'Explicit VR Big Endian',
  [TRANSFER_SYNTAX.jpegBaseline]: 'JPEG Baseline',
  [TRANSFER_SYNTAX.jpegExtended]: 'JPEG Extended',
  [TRANSFER_SYNTAX.jpegLosslessNonHierarchical]: 'JPEG Lossless, Non-Hierarchical',
  [TRANSFER_SYNTAX.jpegLossless]: 'JPEG Lossless',
  [TRANSFER_SYNTAX.jpegLsLossless]: 'JPEG-LS Lossless',
  [TRANSFER_SYNTAX.jpegLsLossy]: 'JPEG-LS Near-Lossless',
  [TRANSFER_SYNTAX.jpeg2000Lossless]: 'JPEG 2000 Lossless',
  [TRANSFER_SYNTAX.jpeg2000]: 'JPEG 2000',
  [TRANSFER_SYNTAX.htj2kLossless]: 'HTJ2K Lossless',
  [TRANSFER_SYNTAX.htj2kLosslessRpcl]: 'HTJ2K Lossless RPCL',
  [TRANSFER_SYNTAX.htj2k]: 'HTJ2K',
  [TRANSFER_SYNTAX.rle]: 'RLE Lossless'
};

/** Transfer syntaxes the viewer can decode: every one Cornerstone's DICOM image loader ships a codec for. */
export function isSupportedTransferSyntax(uid: string): boolean {
  return uid in labels;
}

export function isUncompressedLittleEndian(uid: string): boolean {
  return uid === TRANSFER_SYNTAX.implicitLittleEndian || uid === TRANSFER_SYNTAX.explicitLittleEndian;
}

export function transferSyntaxLabel(uid: string): string {
  return labels[uid] ?? 'Unknown transfer syntax';
}
