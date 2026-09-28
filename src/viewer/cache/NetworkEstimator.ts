export interface QueueLimits {
  /** Downloads running at once. */
  total: number;
  /** Of those, how many may be prefetch work, so the image on screen always has room and bandwidth. */
  background: number;
}

type Connection = { effectiveType?: string; downlink?: number; rtt?: number; addEventListener?(type: 'change', listener: () => void): void };

// Weight of a new sample in the moving averages: responsive to a network change within a few slices.
const SMOOTHING = 0.3;
// Throughput is only measured over stretches this long, so a single tiny response doesn't read as a fast link.
const MIN_WINDOW_MS = 200;

export interface NetworkEstimate {
  /** Bytes per millisecond across all downloads together. */
  throughput?: number;
  /** Time to first byte, which is round trip plus server time. */
  latencyMs?: number;
  /** Typical bytes on the wire per slice (compressed size when the object is gzip-encoded). */
  frameBytes?: number;
}

/**
 * Measures how fast slices actually arrive and derives how many downloads to run at once. On a slow link, parallel
 * downloads only split the bandwidth, so the slice on screen arrives later; on a fast link with high latency, more
 * downloads in flight hide the round trips. Measured aggregate throughput (while any download runs) and time to
 * first byte replace the fixed per-device numbers after the first few slices.
 */
export class NetworkEstimator {
  private readonly estimate: NetworkEstimate = {};
  private active = 0;
  private busySince = 0;
  private windowMs = 0;
  private windowBytes = 0;
  private measured = false;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly bounds: { min: number; max: number }, connection = navigatorConnection()) {
    this.seed(connection);
    connection?.addEventListener?.('change', () => { this.seed(connection); this.notify(); });
  }

  /** Call when a download starts; call the returned function with the bytes received (or 0 on failure). */
  begin(): (sample: { bytes: number; latencyMs?: number }) => void {
    if (this.active++ === 0) this.busySince = performance.now();
    let done = false;
    return ({ bytes, latencyMs }) => {
      if (done) return;
      done = true;
      const now = performance.now();
      if (--this.active === 0) this.windowMs += now - this.busySince;
      if (bytes <= 0) {
        // A cancelled or failed download used the link for an unknown number of bytes: start a fresh window rather
        // than count its time as idle bandwidth. Scrubbing cancels a lot, and would otherwise read as a slow link.
        this.windowBytes = 0;
        this.windowMs = 0;
        this.busySince = now;
        return;
      }
      this.windowBytes += bytes;
      const busyMs = this.windowMs + (this.active > 0 ? now - this.busySince : 0);
      if (!this.measured) {
        // Replace the browser's guess outright rather than averaging real samples into it.
        this.measured = true;
        delete this.estimate.frameBytes;
        delete this.estimate.throughput;
        delete this.estimate.latencyMs;
      }
      this.estimate.frameBytes = smooth(this.estimate.frameBytes, bytes);
      if (latencyMs !== undefined) this.estimate.latencyMs = smooth(this.estimate.latencyMs, latencyMs);
      if (busyMs >= MIN_WINDOW_MS && this.windowBytes > 0) {
        this.estimate.throughput = smooth(this.estimate.throughput, this.windowBytes / busyMs);
        this.windowBytes = 0;
        this.windowMs = 0;
        if (this.active > 0) this.busySince = now;
      }
      this.notify();
    };
  }

  current(): Readonly<NetworkEstimate> {
    return this.estimate;
  }

  /** Expected milliseconds to download one slice, or undefined before anything has been measured. */
  frameTransferMs(): number | undefined {
    const { throughput, frameBytes, latencyMs } = this.estimate;
    if (!throughput || !frameBytes) return undefined;
    // Busy-time throughput already includes waiting for the first byte when downloads run one after another.
    return Math.max(frameBytes / throughput, latencyMs ?? 0);
  }

  /**
   * Enough downloads in flight to keep the link busy through each round trip: 1 + latency / transfer time, within the
   * device's bounds. A slow link gets 2 (the slice on screen and one prefetch); a fast, distant one gets the maximum.
   */
  limits(): QueueLimits {
    const { throughput, frameBytes, latencyMs } = this.estimate;
    let total = this.bounds.max;
    if (throughput && frameBytes) {
      // Measured throughput counts the wait for the first byte as busy time, so take it back out of the transfer.
      const transferMs = Math.max(1, frameBytes / throughput - (latencyMs ?? 0));
      total = Math.ceil(1 + (latencyMs ?? 0) / transferMs);
    }
    total = Math.max(this.bounds.min, Math.min(this.bounds.max, total));
    // At least one slot is always left for the slice on screen.
    return { total, background: Math.max(1, total - Math.ceil(total / 3)) };
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    this.listeners.forEach(listener => listener());
  }

  /** The browser's own estimate (Chromium only) stands in until slices have been measured. */
  private seed(connection?: Connection): void {
    if (!connection || this.measured) return;
    if (connection.downlink) this.estimate.throughput = (connection.downlink * 1e6) / 8 / 1000;
    if (connection.effectiveType === 'slow-2g' || connection.effectiveType === '2g') this.estimate.throughput = Math.min(this.estimate.throughput ?? Infinity, 30);
    if (connection.rtt) this.estimate.latencyMs = connection.rtt;
    // A 512×512 CT slice, gzip-encoded, until a real one arrives.
    if (this.estimate.throughput) this.estimate.frameBytes = 240_000;
  }
}

function smooth(previous: number | undefined, value: number): number {
  return previous === undefined ? value : previous + (value - previous) * SMOOTHING;
}

function navigatorConnection(): Connection | undefined {
  return typeof navigator === 'undefined' ? undefined : (navigator as Navigator & { connection?: Connection }).connection;
}
