import type { DecodedFrame } from '../../types/dicom';
import { LRUCache } from './LRUCache';
import { deviceProfile } from '../core/DeviceProfile';

export class FrameCache {
  private readonly decoded = new LRUCache<string, DecodedFrame>(deviceProfile().frameCacheBytes);

  has(id: string): boolean {
    return this.decoded.has(id);
  }

  getDecoded(id: string): DecodedFrame | undefined {
    return this.decoded.get(id);
  }

  setDecoded(id: string, frame: DecodedFrame): void {
    this.decoded.set(id, frame, frame.modalityPixels.byteLength + (frame.storedPixels?.byteLength ?? 0) + (frame.rgbaPixels?.byteLength ?? 0));
  }

  metrics(): { framesCached: number; memoryBytes: number } {
    return { framesCached: this.decoded.size, memoryBytes: this.decoded.estimatedSize };
  }
}
