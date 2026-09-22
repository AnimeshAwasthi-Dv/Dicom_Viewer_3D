import type { DecodedFrame } from '../../types/dicom';
import { LRUCache } from './LRUCache';

export class FrameCache {
  private readonly decoded = new LRUCache<string, DecodedFrame>(512 * 1024 * 1024);

  getDecoded(id: string): DecodedFrame | undefined {
    return this.decoded.get(id);
  }

  setDecoded(id: string, frame: DecodedFrame): void {
    this.decoded.set(id, frame, frame.modalityPixels.byteLength + frame.storedPixels.byteLength);
  }

  metrics(): { framesCached: number; memoryBytes: number } {
    return { framesCached: this.decoded.size, memoryBytes: this.decoded.estimatedSize };
  }
}

