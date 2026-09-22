import type { Series } from './Series';

export interface Study {
  id: string;
  studyInstanceUID: string;
  patientName?: string;
  patientId?: string;
  patientSex?: string;
  patientBirthDate?: string;
  patientAge?: string;
  bodyPartExamined?: string;
  studyDescription?: string;
  studyDate?: string;
  modality?: string;
  series: Series[];
  errors: string[];
}
