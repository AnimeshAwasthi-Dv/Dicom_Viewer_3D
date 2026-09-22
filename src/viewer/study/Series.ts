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
}

