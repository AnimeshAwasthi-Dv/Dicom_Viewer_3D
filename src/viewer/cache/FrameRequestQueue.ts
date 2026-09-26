/** Lower runs first. The slice on screen is `Interaction`; prefetch adds its distance from the current slice. */
export const RequestPriority = {
  Interaction: 0,
  Prefetch: 1,
  Thumbnail: 10000
} as const;

export interface FrameRequestOptions {
  priority?: number;
  /** Aborting tells the queue this caller no longer needs the frame; it is dropped once nobody does. */
  signal?: AbortSignal;
}

interface Entry<T> {
  id: string;
  priority: number;
  /** Callers still waiting; unsignalled callers hold a permanent reference. */
  refs: number;
  running: boolean;
  controller: AbortController;
  promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
}

export interface QueueLimits {
  /** Loads running at once. */
  total: number;
  /** Of those, how many may be prefetch or thumbnail work, so the slice on screen always has room and bandwidth. */
  background: number;
}

/**
 * Runs frame loads by priority with bounded concurrency, the way Cornerstone's request pools separate interaction
 * from prefetch. The same frame requested twice shares one load, and a load nobody wants any more is cancelled,
 * including an in-flight download, so fast scrolling on a slow network doesn't spend bandwidth on skipped slices.
 */
export class FrameRequestQueue<T> {
  private readonly entries = new Map<string, Entry<T>>();
  private running = 0;
  private runningBackground = 0;

  constructor(
    private readonly load: (id: string, signal: AbortSignal) => Promise<T>,
    private readonly limits: QueueLimits
  ) {}

  request(id: string, { priority = RequestPriority.Interaction, signal }: FrameRequestOptions = {}): Promise<T> {
    if (signal?.aborted) return Promise.reject(abortError());
    let entry = this.entries.get(id);
    if (!entry) {
      let resolve!: (value: T) => void;
      let reject!: (reason: unknown) => void;
      const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
      // Callers that stop caring never observe the rejection; keep it from surfacing as unhandled.
      promise.catch(() => undefined);
      entry = { id, priority, refs: 0, running: false, controller: new AbortController(), promise, resolve, reject };
      this.entries.set(id, entry);
    } else if (priority < entry.priority) {
      // Requeue at the higher priority; a running background load now counts as interaction work.
      if (entry.running && isBackground(entry.priority) && !isBackground(priority)) this.runningBackground--;
      entry.priority = priority;
    }
    entry.refs++;
    if (signal) {
      const current = entry;
      signal.addEventListener('abort', () => this.release(current), { once: true });
    }
    this.pump();
    return entry.promise;
  }

  /** Cancel everything, e.g. when the study closes. */
  clear(reason: unknown = abortError()): void {
    this.entries.forEach(entry => { entry.controller.abort(); entry.reject(reason); });
    this.entries.clear();
    this.running = 0;
    this.runningBackground = 0;
  }

  get size(): number {
    return this.entries.size;
  }

  private release(entry: Entry<T>): void {
    entry.refs--;
    if (entry.refs > 0) return;
    // A new request for the same slice usually follows at once (the next scroll position overlaps the last one),
    // so wait a tick before cancelling a load someone may be about to ask for again.
    setTimeout(() => {
      if (entry.refs > 0 || this.entries.get(entry.id) !== entry) return;
      this.entries.delete(entry.id);
      if (entry.running) {
        this.finish(entry);
        entry.controller.abort();
      }
      entry.reject(abortError());
      this.pump();
    }, 0);
  }

  private pump(): void {
    while (this.running < this.limits.total) {
      const next = this.pickNext();
      if (!next) return;
      this.start(next);
    }
  }

  private pickNext(): Entry<T> | undefined {
    let best: Entry<T> | undefined;
    for (const entry of this.entries.values()) {
      if (entry.running) continue;
      if (!best || entry.priority < best.priority) best = entry;
    }
    if (best && isBackground(best.priority)) {
      if (this.runningBackground >= this.limits.background) return undefined;
      // Prefetch waits while a slice on screen is loading, so that slice gets the whole link and a free decoder.
      if (this.running > this.runningBackground) return undefined;
    }
    return best;
  }

  private start(entry: Entry<T>): void {
    entry.running = true;
    this.running++;
    if (isBackground(entry.priority)) this.runningBackground++;
    this.load(entry.id, entry.controller.signal).then(
      value => { if (this.settle(entry)) entry.resolve(value); },
      error => { if (this.settle(entry)) entry.reject(error); }
    );
  }

  /** Returns false when the entry was already cancelled or cleared. */
  private settle(entry: Entry<T>): boolean {
    if (this.entries.get(entry.id) !== entry) return false;
    this.entries.delete(entry.id);
    this.finish(entry);
    this.pump();
    return true;
  }

  private finish(entry: Entry<T>): void {
    if (!entry.running) return;
    entry.running = false;
    this.running--;
    if (isBackground(entry.priority)) this.runningBackground--;
  }
}

function isBackground(priority: number): boolean {
  return priority > RequestPriority.Interaction;
}

export function abortError(): DOMException {
  return new DOMException('Frame request cancelled.', 'AbortError');
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}
