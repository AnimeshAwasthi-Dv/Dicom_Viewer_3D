import type { DecodedFrame, ParsedDicomFile } from '../../types/dicom';
import type { FrameRequestOptions } from '../cache/FrameRequestQueue';
import type { Study } from '../study/Study';

export interface ImageSource {
  readonly mode?: 'local' | 'remote';
  getStudyMetadata(): Promise<Study[]>;
  /** Resolves from cache at once; otherwise queues the load at the given priority. */
  getFrame(instanceId: string, options?: FrameRequestOptions): Promise<DecodedFrame>;
  /** True when the frame can be shown without loading. */
  hasFrame?(instanceId: string): boolean;
  metrics(): { framesCached: number; memoryBytes: number };
  dispose?(): void;
}

export interface ParsedImageSource extends ImageSource {
  parsedFiles: ParsedDicomFile[];
}
