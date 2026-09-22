import type { DecodedFrame, ParsedDicomFile } from '../../types/dicom';
import type { Study } from '../study/Study';

export interface ImageSource {
  readonly mode?: 'local' | 'remote';
  getStudyMetadata(): Promise<Study[]>;
  getFrame(instanceId: string): Promise<DecodedFrame>;
  metrics(): { framesCached: number; memoryBytes: number };
  dispose?(): void;
}

export interface ParsedImageSource extends ImageSource {
  parsedFiles: ParsedDicomFile[];
}
