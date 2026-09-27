export type TransferSyntaxUID =
  | '1.2.840.10008.1.2'
  | '1.2.840.10008.1.2.1'
  | string;

export interface DicomMetadata {
  fileName: string;
  patientName?: string;
  patientId?: string;
  patientSex?: string;
  patientBirthDate?: string;
  patientAge?: string;
  bodyPartExamined?: string;
  studyDescription?: string;
  studyDate?: string;
  studyInstanceUID: string;
  seriesInstanceUID: string;
  sopInstanceUID: string;
  seriesDescription?: string;
  seriesNumber?: number;
  instanceNumber?: number;
  modality?: string;
  rows: number;
  columns: number;
  bitsAllocated: number;
  bitsStored: number;
  pixelRepresentation: 0 | 1;
  photometricInterpretation: 'MONOCHROME1' | 'MONOCHROME2' | string;
  samplesPerPixel: number;
  planarConfiguration?: number;
  pixelSpacing?: [number, number];
  sliceThickness?: number;
  spacingBetweenSlices?: number;
  imagePositionPatient?: [number, number, number];
  imageOrientationPatient?: [number, number, number, number, number, number];
  frameOfReferenceUID?: string;
  windowCenter?: number;
  windowWidth?: number;
  rescaleSlope: number;
  rescaleIntercept: number;
  transferSyntaxUID: TransferSyntaxUID;
  pixelDataOffset?: number;
  pixelDataLength?: number;
  rawTags?: DicomTag[];
}

export interface DicomTag {
  tag: string;
  name: string;
  vr?: string;
  length: number;
  value: string;
}

export interface ParsedDicomFile {
  metadata: DicomMetadata;
  pixelData?: ArrayBuffer;
  error?: string;
}

export interface DecodedFrame {
  metadata: DicomMetadata;
  // Decoders fill this, but frames decoded in the worker pool drop it: nothing reads it and it would double the cache size.
  storedPixels?: Int16Array | Uint16Array | Uint8Array | Int8Array;
  modalityPixels: Float32Array;
  min: number;
  max: number;
  decodeTimeMs: number;
  /** A low-resolution stand-in shown until the full slice arrives; never cached. */
  preview?: boolean;
}
