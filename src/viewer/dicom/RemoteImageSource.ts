import type { DecodedFrame } from '../../types/dicom';
import type { PublicManifest } from '../../types/remote';
import type { ImageSource } from './ImageSource';
import { FrameCache } from '../cache/FrameCache';
import { FrameRequestQueue, RequestPriority, type FrameRequestOptions } from '../cache/FrameRequestQueue';
import { NetworkEstimator } from '../cache/NetworkEstimator';
import { deviceProfile } from '../core/DeviceProfile';
import { buildStudies } from '../study/StudyManager';
import { DecodePool } from '../workers/DecodePool';
import type { RemoteClient } from '../remote/RemoteClient';
import type { Study } from '../study/Study';

// The frames endpoint signs at most 32 URLs per call.
const SIGN_BATCH = 32;
// Show a preview first when the full slice is expected to take longer than this to arrive.
const PREVIEW_WORTH_MS = 250;
// Before the network has been measured, only series at least this long start with previews.
const LARGE_SERIES = 200;

type SignedUrls = { url: string; previewUrl?: string; expiresAt: number };

export class RemoteImageSource implements ImageSource {
  readonly mode = 'remote';
  private readonly cache = new FrameCache();
  private readonly decoder = new DecodePool();
  private readonly abort = new AbortController();
  private readonly queue: FrameRequestQueue<DecodedFrame>;
  private readonly network = new NetworkEstimator(deviceProfile().remoteRequests);
  private readonly urls = new Map<string, SignedUrls>();
  /** Manifest metadata of instances that have a preview, keyed by instance. */
  private readonly previews = new Map<string, PublicManifest['instances'][number]['metadata']>();
  private readonly signing = new Map<string, Promise<void>>();
  private readonly studies: Study[];
  /** Series and position of each instance, for choosing which URLs to sign together. */
  private readonly positions = new Map<string, { ids: string[]; index: number }>();

  constructor(private readonly client: RemoteClient, private readonly manifest: PublicManifest) {
    this.studies = buildStudies(manifest.instances.map(({ metadata }) => ({ metadata })), true);
    this.studies.forEach(study => study.series.forEach(series => {
      const ids = series.instances.map(instance => instance.id);
      ids.forEach((id, index) => this.positions.set(id, { ids, index }));
    }));
    manifest.instances.forEach(({ metadata, preview }) => { if (preview) this.previews.set(metadata.sopInstanceUID, metadata); });
    this.queue = new FrameRequestQueue((id, signal) => this.load(id, signal), this.network.limits());
    this.network.onChange(() => this.queue.setLimits(this.network.limits()));
    // Start decoders and their codec while the first image downloads, instead of after it arrives.
    this.decoder.warm(new Set(manifest.instances.map(({ metadata }) => metadata.transferSyntaxUID)));
  }
  async getStudyMetadata() { return this.studies; }
  metrics() { return this.cache.metrics(); }
  hasFrame(id: string) { return this.cache.has(id); }
  dispose() {
    this.abort.abort();
    this.queue.clear(new Error('Study closed.'));
    this.decoder.dispose();
  }

  async getFrame(id: string, options?: FrameRequestOptions): Promise<DecodedFrame> {
    const cached = this.cache.getDecoded(id);
    if (cached) return cached;
    const frame = this.queue.request(id, options);
    if (options?.onPreview && (options.priority ?? RequestPriority.Interaction) === RequestPriority.Interaction && this.wantsPreview(id)) {
      void this.preview(id, frame, options.onPreview, options.signal);
    }
    return frame;
  }

  /** Previews only pay off when the full slice is slow to arrive: a slow link, or a big series before it's measured. */
  private wantsPreview(id: string): boolean {
    if (!this.previews.has(id)) return false;
    const expected = this.network.frameTransferMs();
    return expected === undefined ? (this.positions.get(id)?.ids.length ?? 0) >= LARGE_SERIES : expected > PREVIEW_WORTH_MS;
  }

  /**
   * Downloads the preview beside the full slice (outside the queue: it is a fraction of the size) and hands it over
   * only if the full slice hasn't arrived first. Failures are ignored; the full slice still comes.
   */
  private async preview(id: string, full: Promise<DecodedFrame>, onPreview: (frame: DecodedFrame) => void, signal?: AbortSignal): Promise<void> {
    let settled = false;
    full.then(() => { settled = true; }, () => { settled = true; });
    const controller = new AbortController();
    const cancel = () => controller.abort();
    signal?.addEventListener('abort', cancel, { once: true });
    this.abort.signal.addEventListener('abort', cancel, { once: true });
    try {
      const { previewUrl } = await this.signed(id);
      if (!previewUrl || settled || controller.signal.aborted) return;
      const response = await fetch(previewUrl, { signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
      if (!response.ok || settled) return;
      const buffer = await response.arrayBuffer();
      if (settled || controller.signal.aborted) return;
      const frame = await this.decoder.decodePreview(buffer, this.previews.get(id)!);
      if (!settled && !controller.signal.aborted) onPreview(frame);
    } catch { /* The full slice is on its way regardless. */ }
    finally {
      signal?.removeEventListener('abort', cancel);
      this.abort.signal.removeEventListener('abort', cancel);
    }
  }

  private async load(id: string, signal: AbortSignal): Promise<DecodedFrame> {
    // AbortSignal.any isn't in iOS Safari before 17.4.
    const controller = new AbortController();
    const cancel = () => controller.abort();
    signal.addEventListener('abort', cancel, { once: true });
    this.abort.signal.addEventListener('abort', cancel, { once: true });
    try { return await this.download(id, controller.signal); }
    finally {
      signal.removeEventListener('abort', cancel);
      this.abort.signal.removeEventListener('abort', cancel);
    }
  }

  private async download(id: string, combined: AbortSignal): Promise<DecodedFrame> {
    const { url } = await this.signed(id);
    combined.throwIfAborted();
    const started = performance.now();
    const measured = this.network.begin();
    let buffer: ArrayBuffer;
    try {
      const response = await fetch(url, { signal: combined, credentials: 'omit', referrerPolicy: 'no-referrer' });
      const latencyMs = performance.now() - started;
      if (!response.ok) throw new Error(`Image download failed (${response.status}).`);
      buffer = await response.arrayBuffer();
      // Content-Length is the size on the wire (gzip-encoded objects inflate to more than that).
      measured({ bytes: Number(response.headers.get('content-length')) || buffer.byteLength, latencyMs });
    } finally { measured({ bytes: 0 }); }
    combined.throwIfAborted();
    // Parsing, decoding and rescaling happen in the worker pool; the main thread only uploads the result.
    const frame = await this.decoder.decodeFile(buffer, id);
    this.cache.setDecoded(id, frame);
    return frame;
  }

  private async signed(id: string): Promise<SignedUrls> {
    const cached = this.urls.get(id);
    if (cached && cached.expiresAt > Date.now() + 30000) return cached;
    const pending = this.signing.get(id);
    if (pending) { await pending; return this.urls.get(id)!; }
    const position = this.positions.get(id);
    if (!position) throw new Error('Instance is not in this study.');
    // Sign a run of neighbours in one call, skipping ones that already have a fresh URL or are being signed.
    const fresh = (instanceId: string) => (this.urls.get(instanceId)?.expiresAt ?? 0) > Date.now() + 60000 || this.signing.has(instanceId);
    const start = Math.max(0, position.index - 8);
    const ids = [id, ...position.ids.slice(start, start + SIGN_BATCH).filter(instanceId => instanceId !== id && !fresh(instanceId))].slice(0, SIGN_BATCH);
    const request = (async () => {
      // Signing is shared by every slice in the batch, so it isn't tied to one request's cancellation.
      const signed = await this.client.request('frames', { method: 'POST', body: JSON.stringify({ instanceIds: ids }), signal: this.abort.signal });
      const { frames, expiresAt } = await signed.json() as { frames: Array<{ id: string; url: string; previewUrl?: string }>; expiresAt: number };
      frames.forEach(frame => this.urls.set(frame.id, { url: frame.url, previewUrl: frame.previewUrl, expiresAt }));
    })();
    ids.forEach(instanceId => this.signing.set(instanceId, request));
    try { await request; return this.urls.get(id)!; }
    finally { ids.forEach(instanceId => { if (this.signing.get(instanceId) === request) this.signing.delete(instanceId); }); }
  }
}
