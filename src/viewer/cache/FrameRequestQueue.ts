import type { DecodedFrame } from '../../types/dicom';

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
  /** Remote sources may call this with a low-resolution stand-in before the frame itself resolves. */
  onPreview?: (frame: DecodedFrame) => void;
}

interface Entry<T> {
  id: string;
  /** The most urgent priority any caller still waiting has asked for. */
  priority: number;
  /** Priority per caller still waiting; unsignalled callers hold a permanent reference. */
  refs: Map<symbol, number>;
  running: boolean;
  /** Whether the running load counts against the background limit (fixed when it starts or is re-prioritised). */
  countedBackground: boolean;
  /** Bumped when a running load is preempted, so the result of the abandoned attempt is ignored. */
  attempt: number;
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
    private limits: QueueLimits
  ) {}

  /** Change how many loads may run, e.g. as the network estimate changes. Running loads over a new limit finish. */
  setLimits(limits: QueueLimits): void {
    if (limits.total === this.limits.total && limits.background === this.limits.background) return;
    this.limits = limits;
    this.pump();
  }

  request(id: string, { priority = RequestPriority.Interaction, signal }: FrameRequestOptions = {}): Promise<T> {
    if (signal?.aborted) return Promise.reject(abortError());
    let entry = this.entries.get(id);
    if (!entry) {
      let resolve!: (value: T) => void;
      let reject!: (reason: unknown) => void;
      const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
      // Callers that stop caring never observe the rejection; keep it from surfacing as unhandled.
      promise.catch(() => undefined);
      entry = { id, priority, refs: new Map(), running: false, countedBackground: false, attempt: 0, controller: new AbortController(), promise, resolve, reject };
      this.entries.set(id, entry);
    }
    const ref = Symbol(id);
    entry.refs.set(ref, priority);
    this.reprioritise(entry);
    if (signal) {
      const current = entry;
      signal.addEventListener('abort', () => this.release(current, ref), { once: true });
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

  private release(entry: Entry<T>, ref: symbol): void {
    entry.refs.delete(ref);
    // A slice that was on screen and is now only wanted as prefetch drops back to prefetch, so while the user
    // scrubs, the slices they pass stop holding interaction slots.
    if (entry.refs.size > 0) { this.reprioritise(entry); this.pump(); return; }
    // A new request for the same slice usually follows at once (the next scroll position overlaps the last one),
    // so wait a tick before cancelling a load someone may be about to ask for again.
    setTimeout(() => {
      if (entry.refs.size > 0 || this.entries.get(entry.id) !== entry) return;
      this.entries.delete(entry.id);
      if (entry.running) {
        this.finish(entry);
        entry.controller.abort();
      }
      entry.reject(abortError());
      this.pump();
    }, 0);
  }

  private reprioritise(entry: Entry<T>): void {
    entry.priority = Math.min(...entry.refs.values());
    if (!entry.running || entry.countedBackground === isBackground(entry.priority)) return;
    entry.countedBackground = isBackground(entry.priority);
    this.runningBackground += entry.countedBackground ? 1 : -1;
  }

  private pump(): void {
    for (;;) {
      if (this.running >= this.limits.total && !this.preempt()) return;
      const next = this.pickNext();
      if (!next) return;
      this.start(next);
    }
  }

  /**
   * When the slice on screen is waiting and every slot is busy, stop the least urgent background download and put it
   * back in the queue. Fast scrubbing on a slow link otherwise leaves the new slice queued behind prefetch that
   * started a moment earlier.
   */
  private preempt(): boolean {
    let waiting = false;
    let victim: Entry<T> | undefined;
    for (const entry of this.entries.values()) {
      if (!entry.running) { if (!isBackground(entry.priority)) waiting = true; }
      else if (entry.countedBackground && (!victim || entry.priority > victim.priority)) victim = entry;
    }
    if (!waiting || !victim) return false;
    this.finish(victim);
    victim.attempt++;
    victim.controller.abort();
    victim.controller = new AbortController();
    return true;
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
    entry.countedBackground = isBackground(entry.priority);
    this.running++;
    if (entry.countedBackground) this.runningBackground++;
    const attempt = entry.attempt;
    this.load(entry.id, entry.controller.signal).then(
      value => { if (this.settle(entry, attempt)) entry.resolve(value); },
      error => { if (this.settle(entry, attempt)) entry.reject(error); }
    );
  }

  /** Returns false when the entry was already cancelled, cleared or preempted. */
  private settle(entry: Entry<T>, attempt: number): boolean {
    if (this.entries.get(entry.id) !== entry || entry.attempt !== attempt) return false;
    this.entries.delete(entry.id);
    this.finish(entry);
    this.pump();
    return true;
  }

  private finish(entry: Entry<T>): void {
    if (!entry.running) return;
    entry.running = false;
    this.running--;
    if (entry.countedBackground) this.runningBackground--;
    entry.countedBackground = false;
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
