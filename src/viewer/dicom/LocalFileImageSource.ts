import type { DecodedFrame, ParsedDicomFile } from '../../types/dicom';
import { FrameCache } from '../cache/FrameCache';
import { FrameRequestQueue, type FrameRequestOptions } from '../cache/FrameRequestQueue';
import { deviceProfile } from '../core/DeviceProfile';
import { buildStudies } from '../study/StudyManager';
import type { Study } from '../study/Study';
import type { ImageSource } from './ImageSource';
import { DecodePool } from '../workers/DecodePool';

export class LocalFileImageSource implements ImageSource {
  readonly mode = 'local';
  private readonly decoder = new DecodePool();
  private readonly frameCache = new FrameCache();
  private readonly instanceMap = new Map<string, ParsedDicomFile>();
  // One more job than workers keeps every worker busy while the slice on screen can still jump the queue.
  private readonly queue = new FrameRequestQueue<DecodedFrame>((id) => this.decode(id), {
    total: deviceProfile().decodeWorkers + 1,
    background: deviceProfile().decodeWorkers
  });

  constructor(public readonly parsedFiles: ParsedDicomFile[]) {
    parsedFiles.forEach((file) => this.instanceMap.set(file.metadata.sopInstanceUID, file));
    this.decoder.warm(new Set(parsedFiles.map((file) => file.metadata.transferSyntaxUID)));
  }

  async getStudyMetadata(): Promise<Study[]> {
    return buildStudies(this.parsedFiles);
  }

  hasFrame(instanceId: string): boolean {
    return this.frameCache.has(instanceId);
  }

  async getFrame(instanceId: string, options?: FrameRequestOptions): Promise<DecodedFrame> {
    const cached = this.frameCache.getDecoded(instanceId);
    if (cached) return cached;
    return this.queue.request(instanceId, options);
  }

  dispose(): void {
    this.queue.clear(new Error('Study closed.'));
    this.decoder.dispose();
  }

  metrics(): { framesCached: number; memoryBytes: number } {
    return this.frameCache.metrics();
  }

  private async decode(instanceId: string): Promise<DecodedFrame> {
    const file = this.instanceMap.get(instanceId);
    if (!file?.pixelData) throw new Error(file?.error ?? `Frame not available: ${instanceId}`);
    // The worker receives a copy: the original pixel data stays here so evicted frames can be decoded again.
    const frame = await this.decoder.decodePixels(file.metadata, file.pixelData.slice(0));
    this.frameCache.setDecoded(instanceId, frame);
    return frame;
  }
}
