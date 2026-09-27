import { describe, expect, it } from 'vitest';
import { FrameRequestQueue, isAbortError, RequestPriority } from '../cache/FrameRequestQueue';
import { windowOrder } from '../cache/FrameLoadScheduler';

type Deferred = { id: string; signal: AbortSignal; resolve(value: string): void };

function harness(limits = { total: 2, background: 1 }) {
  const started: Deferred[] = [];
  const queue = new FrameRequestQueue<string>((id, signal) => new Promise<string>((resolve, reject) => {
    started.push({ id, signal, resolve });
    signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
  }), limits);
  return { queue, started };
}
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

describe('frame request queue', () => {
  it('runs the slice on screen before prefetch and keeps a slot free for it', async () => {
    const { queue, started } = harness();
    void queue.request('near', { priority: RequestPriority.Prefetch + 1 });
    void queue.request('far', { priority: RequestPriority.Prefetch + 2 });
    // Only one background load may run, so the second prefetch waits.
    expect(started.map(load => load.id)).toEqual(['near']);
    void queue.request('current');
    expect(started.map(load => load.id)).toEqual(['near', 'current']);
  });

  it('holds prefetch while the slice on screen loads', async () => {
    const { queue, started } = harness({ total: 6, background: 4 });
    void queue.request('current');
    void queue.request('next', { priority: RequestPriority.Prefetch + 1 });
    expect(started.map(load => load.id)).toEqual(['current']);
    started[0].resolve('shown');
    await tick();
    expect(started.map(load => load.id)).toEqual(['current', 'next']);
  });

  it('shares one load between callers and upgrades its priority', async () => {
    const { queue, started } = harness({ total: 2, background: 1 });
    void queue.request('a', { priority: RequestPriority.Prefetch + 5 });
    const first = queue.request('b', { priority: RequestPriority.Prefetch + 9 });
    expect(started.map(load => load.id)).toEqual(['a']);
    const second = queue.request('b');
    // Now wanted on screen, so it no longer waits for the background slot.
    expect(started.map(load => load.id)).toEqual(['a', 'b']);
    started[1].resolve('B');
    expect(await first).toBe('B');
    expect(await second).toBe('B');
  });

  it('stops a background download when the slice on screen has no free slot, then retries it', async () => {
    const { queue, started } = harness({ total: 1, background: 1 });
    const prefetch = queue.request('near', { priority: RequestPriority.Prefetch + 1 });
    const current = queue.request('current');
    expect(started.map(load => load.id)).toEqual(['near', 'current']);
    expect(started[0].signal.aborted).toBe(true);
    started[1].resolve('shown');
    expect(await current).toBe('shown');
    await tick();
    // The preempted prefetch runs again, and its caller only sees the retried result.
    expect(started.map(load => load.id)).toEqual(['near', 'current', 'near']);
    started[2].resolve('N');
    expect(await prefetch).toBe('N');
  });

  it('drops a slice back to prefetch once only prefetch wants it', async () => {
    const { queue, started } = harness({ total: 2, background: 1 });
    const onScreen = new AbortController();
    void queue.request('old', { signal: onScreen.signal });
    void queue.request('old', { priority: RequestPriority.Prefetch + 1 });
    onScreen.abort();
    // 'old' is now background work, so the new slice on screen may take its slot.
    void queue.request('new');
    void queue.request('newer');
    expect(started.map(load => load.id)).toEqual(['old', 'new', 'newer']);
    expect(started[0].signal.aborted).toBe(true);
  });

  it('applies new limits at once', () => {
    const { queue, started } = harness({ total: 1, background: 1 });
    void queue.request('a');
    void queue.request('b');
    expect(started).toHaveLength(1);
    queue.setLimits({ total: 2, background: 1 });
    expect(started.map(load => load.id)).toEqual(['a', 'b']);
  });

  it('cancels a load, even in flight, once no caller wants it', async () => {
    const { queue, started } = harness();
    const controller = new AbortController();
    const request = queue.request('skipped', { priority: RequestPriority.Prefetch + 1, signal: controller.signal });
    controller.abort();
    await tick();
    expect(started[0].signal.aborted).toBe(true);
    await expect(request).rejects.toSatisfy(isAbortError);
    expect(queue.size).toBe(0);
  });

  it('keeps a load another caller asks for again straight after the first lets go', async () => {
    const { queue, started } = harness();
    const oldWindow = new AbortController();
    void queue.request('overlap', { priority: RequestPriority.Prefetch + 3, signal: oldWindow.signal });
    oldWindow.abort();
    const again = queue.request('overlap', { priority: RequestPriority.Prefetch + 1, signal: new AbortController().signal });
    await tick();
    expect(started).toHaveLength(1);
    expect(started[0].signal.aborted).toBe(false);
    started[0].resolve('kept');
    expect(await again).toBe('kept');
  });
});

describe('prefetch window', () => {
  const span = { radius: 2, ahead: 3, behind: 1 };
  it('loads both sides evenly with no scroll direction', () => {
    expect(windowOrder(10, 5, 0, span)).toEqual([5, 6, 4, 7, 3]);
  });
  it('leans ahead in the scroll direction', () => {
    expect(windowOrder(10, 5, 1, span)).toEqual([5, 6, 7, 8, 4]);
    expect(windowOrder(10, 5, -1, span)).toEqual([5, 4, 3, 2, 6]);
  });
  it('stays within the series', () => {
    expect(windowOrder(3, 0, 1, span)).toEqual([0, 1, 2]);
    expect(windowOrder(0, 0, 0, span)).toEqual([]);
  });
});
