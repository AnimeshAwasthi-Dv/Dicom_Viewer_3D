// Thumbnails share the network and decoders with the diagnostic image. Like the reference viewer, they wait until
// the first image is on screen, run one at a time, and pause while the user is scrolling or dragging.

const QUIET_MS = 1200;
const POLL_MS = 400;

let lastInteraction = 0;
let firstImageShown = false;
const firstImageWaiters: Array<() => void> = [];
const jobs: Array<() => Promise<void>> = [];
let running = false;

/** Call on wheel, pointer and key input in the viewport. */
export function markInteraction(): void {
  lastInteraction = performance.now();
}

/** Call when a viewport first shows an image. */
export function markFirstImage(): void {
  if (firstImageShown) return;
  firstImageShown = true;
  firstImageWaiters.splice(0).forEach(resolve => resolve());
}

/** Call when a new study opens, so its thumbnails wait for its first image again. */
export function resetBackgroundWork(): void {
  firstImageShown = false;
}

/** Run `task` once the viewer is idle, after earlier background tasks. Rejects without running if `signal` aborts. */
export function whenIdle<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    jobs.push(async () => {
      try {
        await waitForIdle(signal);
        resolve(await task());
      } catch (error) {
        reject(error);
      }
    });
    void drain();
  });
}

async function drain(): Promise<void> {
  if (running) return;
  running = true;
  try {
    for (let job = jobs.shift(); job; job = jobs.shift()) await job();
  } finally {
    running = false;
  }
}

async function waitForIdle(signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  if (!firstImageShown) await new Promise<void>(resolve => firstImageWaiters.push(resolve));
  for (;;) {
    signal?.throwIfAborted();
    const quietFor = performance.now() - lastInteraction;
    if (quietFor >= QUIET_MS) return;
    await new Promise(resolve => setTimeout(resolve, Math.min(POLL_MS, QUIET_MS - quietFor)));
  }
}
