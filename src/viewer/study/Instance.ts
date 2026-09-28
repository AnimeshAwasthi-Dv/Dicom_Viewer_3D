import type { DicomMetadata } from '../../types/dicom';

export interface Instance {
  id: string;
  fileName: string;
  metadata: DicomMetadata;
  sortPosition: number;
  errors: string[];
}

