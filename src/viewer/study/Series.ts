import type { Instance } from './Instance';

export interface Series {
  id: string;
  studyInstanceUID: string;
  seriesInstanceUID: string;
  description: string;
  modality: string;
  seriesNumber?: number;
  instances: Instance[];
  thumbnailInstanceId?: string;
  /** Image count reported before the series' instances are loaded (DICOMweb loads them on demand). */
  expectedImageCount?: number;
}

