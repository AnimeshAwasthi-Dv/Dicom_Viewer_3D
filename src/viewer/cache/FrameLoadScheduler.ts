import type { DecodedFrame } from '../../types/dicom';
import type { ImageSource } from '../dicom/ImageSource';
import type { Series } from '../study/Series';

export class FrameLoadScheduler {
  private token = 0;

  async loadPriority(
    source: ImageSource,
    series: Series,
    currentIndex: number,
    onFrame: (index: number, frame: DecodedFrame) => void,
    onError: (message: string) => void
  ): Promise<void> {
    const token = ++this.token;
    const order = this.priorityOrder(series.instances.length, currentIndex).slice(0, source.mode === 'remote' ? 17 : undefined);
    for (const index of order) {
      if (token !== this.token) return;
      try {
        const frame = await source.getFrame(series.instances[index].id);
        if (token !== this.token) return;
        onFrame(index, frame);
      } catch (error) {
        if (token !== this.token) return;
        onError(error instanceof Error ? error.message : 'Unable to decode frame.');
      }
      await new Promise((resolve) => window.setTimeout(resolve, index === currentIndex ? 0 : 4));
    }
  }

  cancel(): void {
    this.token += 1;
  }

  private priorityOrder(length: number, current: number): number[] {
    const result = [current];
    for (let distance = 1; distance < length; distance += 1) {
      const next = current + distance;
      const previous = current - distance;
      if (next < length) result.push(next);
      if (previous >= 0) result.push(previous);
    }
    return result;
  }
}
