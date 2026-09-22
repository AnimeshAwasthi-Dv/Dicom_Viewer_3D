import type { DecodedFrame, ParsedDicomFile } from '../../types/dicom';
import { FrameCache } from '../cache/FrameCache';
import { CodecManager } from '../codecs/CodecManager';
import { buildStudies } from '../study/StudyManager';
import type { Study } from '../study/Study';
import type { ImageSource } from './ImageSource';

export class LocalFileImageSource implements ImageSource {
  private readonly codecManager = new CodecManager();
  private readonly frameCache = new FrameCache();
  private readonly instanceMap = new Map<string, ParsedDicomFile>();

  constructor(public readonly parsedFiles: ParsedDicomFile[]) {
    parsedFiles.forEach((file) => this.instanceMap.set(file.metadata.sopInstanceUID, file));
  }

  async getStudyMetadata(): Promise<Study[]> {
    return buildStudies(this.parsedFiles);
  }

  async getFrame(instanceId: string): Promise<DecodedFrame> {
    const cached = this.frameCache.getDecoded(instanceId);
    if (cached) return cached;
    const file = this.instanceMap.get(instanceId);
    if (!file?.pixelData) throw new Error(file?.error ?? `Frame not available: ${instanceId}`);
    const frame = await this.codecManager.decodeAsync(file.metadata, file.pixelData);
    this.frameCache.setDecoded(instanceId, frame);
    return frame;
  }

  metrics(): { framesCached: number; memoryBytes: number } {
    return this.frameCache.metrics();
  }
}
