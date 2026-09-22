import type { DicomMetadata } from '../../types/dicom';

export interface Instance {
  id: string;
  fileName: string;
  metadata: DicomMetadata;
  pixelData?: ArrayBuffer;
  sortPosition: number;
  errors: string[];
}

