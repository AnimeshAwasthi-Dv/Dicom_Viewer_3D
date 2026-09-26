import type { DecodedFrame } from '../../types/dicom';
import type { ImageSource } from '../dicom/ImageSource';
import type { Series } from '../study/Series';
import { deviceProfile } from '../core/DeviceProfile';
import { isAbortError, RequestPriority } from './FrameRequestQueue';

// Share of the frame cache a local series may fill, leaving room for thumbnails and the other viewports.
const LOCAL_CACHE_SHARE = 0.75;

export class FrameLoadScheduler {
  private controller?: AbortController;
  private lastSeries?: Series;
  private lastIndex = 0;
  private direction = 0;

  /**
   * Requests the slice on screen at interaction priority and a window of neighbours as prefetch, nearest first.
   * While the user scrolls, the window leans in the scroll direction, as Cornerstone's stack prefetch does.
   * The previous window is cancelled: slices it wanted that the new one doesn't are dropped from the download queue.
   */
  loadPriority(
    source: ImageSource,
    series: Series,
    currentIndex: number,
    onFrame: (index: number, frame: DecodedFrame) => void,
    onError: (message: string) => void
  ): void {
    this.cancel();
    const controller = new AbortController();
    this.controller = controller;
    if (series !== this.lastSeries) this.direction = 0;
    else if (currentIndex !== this.lastIndex) this.direction = Math.sign(currentIndex - this.lastIndex);
    this.lastSeries = series;
    this.lastIndex = currentIndex;

    const order = windowOrder(series.instances.length, currentIndex, this.direction, this.span(source, series));
    order.forEach((index, rank) => {
      source.getFrame(series.instances[index].id, { priority: rank === 0 ? RequestPriority.Interaction : RequestPriority.Prefetch + rank, signal: controller.signal })
        .then((frame) => { if (!controller.signal.aborted) onFrame(index, frame); })
        .catch((error: unknown) => {
          // A neighbour that fails is reported if and when the user reaches it.
          if (rank === 0 && !controller.signal.aborted && !isAbortError(error)) onError(error instanceof Error ? error.message : 'Unable to decode frame.');
        });
    });
  }

  cancel(): void {
    this.controller?.abort();
    this.controller = undefined;
  }

  /** How many slices to keep loaded on each side, ahead meaning the scroll direction. */
  private span(source: ImageSource, series: Series): { radius: number; ahead: number; behind: number } {
    const profile = deviceProfile();
    if (source.mode === 'remote') return { radius: profile.prefetchRadius, ahead: profile.prefetchAhead, behind: profile.prefetchBehind };
    // Local files cost only decoding, so keep as much of the series as the cache holds, but no more: decoding past
    // the cache evicts the slices next to the one on screen.
    const first = series.instances[0]?.metadata;
    const frameBytes = Math.max(1, (first?.rows ?? 512) * (first?.columns ?? 512) * Float32Array.BYTES_PER_ELEMENT);
    const frames = Math.max(1, Math.floor((profile.frameCacheBytes * LOCAL_CACHE_SHARE) / frameBytes));
    return { radius: Math.floor(frames / 2), ahead: Math.floor(frames * 0.75), behind: Math.floor(frames * 0.25) };
  }
}

/** Slice indices to load, current first, then outwards; `direction` gives the side that gets `ahead` slices. */
export function windowOrder(length: number, current: number, direction: number, span: { radius: number; ahead: number; behind: number }): number[] {
  if (length <= 0) return [];
  const up = direction > 0 ? span.ahead : direction < 0 ? span.behind : span.radius;
  const down = direction > 0 ? span.behind : direction < 0 ? span.ahead : span.radius;
  // Interleave the two sides in proportion to their size: with no direction they alternate; while scrolling, several
  // slices ahead are queued for each one behind (which the user has usually just seen, so it's often cached).
  // Ties go to the larger side, so scrolling up and down behave the same.
  const order = [current];
  let above = 1;
  let below = 1;
  for (;;) {
    const canUp = above <= up && current + above < length;
    const canDown = below <= down && current - below >= 0;
    if (!canUp && !canDown) break;
    const upFirst = above * down < below * up || (above * down === below * up && up >= down);
    if (canUp && (!canDown || upFirst)) order.push(current + above++);
    else order.push(current - below++);
  }
  return order;
}
