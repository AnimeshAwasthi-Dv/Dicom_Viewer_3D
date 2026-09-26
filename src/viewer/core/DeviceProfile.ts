export interface DeviceProfile {
  /** Touch-first phone or tablet with limited memory. */
  constrained: boolean;
  decodeWorkers: number;
  frameCacheBytes: number;
  /** Slices loaded on each side of the current one in remote mode when there is no scroll direction yet. */
  prefetchRadius: number;
  /** Slices loaded ahead of / behind the current one while the user scrolls in one direction. */
  prefetchAhead: number;
  prefetchBehind: number;
  /** Concurrent downloads, and how many of those may be prefetch, so the slice on screen always has bandwidth. */
  remoteRequests: { total: number; background: number };
}

let profile: DeviceProfile | undefined;

// Phones get a smaller frame cache, fewer decode workers and fewer parallel downloads: mobile browsers kill tabs
// that hold too much memory, and prefetch sharing a slow link with the slice on screen delays it.
export function deviceProfile(): DeviceProfile {
  if (profile) return profile;
  const nav = typeof navigator === 'undefined' ? undefined : navigator as Navigator & { deviceMemory?: number };
  const coarse = typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  const memoryGb = nav?.deviceMemory ?? (coarse ? 4 : 8);
  const constrained = coarse || memoryGb <= 4;
  const cores = nav?.hardwareConcurrency || 4;
  const prefetchRadius = constrained ? 10 : 20;
  profile = {
    constrained,
    decodeWorkers: Math.max(1, Math.min(cores - 1, constrained ? 2 : 4)),
    // Sized from device memory like the reference viewer, within fixed bounds.
    frameCacheBytes: (constrained ? Math.min(256, Math.max(128, memoryGb * 48)) : Math.min(1024, Math.max(384, memoryGb * 64))) * 1024 * 1024,
    prefetchRadius,
    prefetchAhead: Math.round(prefetchRadius * 1.5),
    prefetchBehind: Math.round(prefetchRadius / 2),
    remoteRequests: constrained ? { total: 4, background: 2 } : { total: 6, background: 4 }
  };
  return profile;
}
