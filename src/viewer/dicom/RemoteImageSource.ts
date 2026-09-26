import type { DecodedFrame } from '../../types/dicom';
import type { PublicManifest } from '../../types/remote';
import type { ImageSource } from './ImageSource';
import { FrameCache } from '../cache/FrameCache';
import { FrameRequestQueue, type FrameRequestOptions } from '../cache/FrameRequestQueue';
import { deviceProfile } from '../core/DeviceProfile';
import { buildStudies } from '../study/StudyManager';
import { DecodePool } from '../workers/DecodePool';
import type { RemoteClient } from '../remote/RemoteClient';
import type { Study } from '../study/Study';

// The frames endpoint signs at most 32 URLs per call.
const SIGN_BATCH = 32;

export class RemoteImageSource implements ImageSource {
  readonly mode = 'remote';
  private readonly cache = new FrameCache();
  private readonly decoder = new DecodePool();
  private readonly abort = new AbortController();
  private readonly queue: FrameRequestQueue<DecodedFrame>;
  private readonly urls = new Map<string, { url: string; expiresAt: number }>();
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
    this.queue = new FrameRequestQueue((id, signal) => this.load(id, signal), deviceProfile().remoteRequests);
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
    return this.queue.request(id, options);
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
    const url = await this.frameUrl(id);
    combined.throwIfAborted();
    const response = await fetch(url, { signal: combined, credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!response.ok) throw new Error(`Image download failed (${response.status}).`);
    const buffer = await response.arrayBuffer();
    combined.throwIfAborted();
    // Parsing, decoding and rescaling happen in the worker pool; the main thread only uploads the result.
    const frame = await this.decoder.decodeFile(buffer, id);
    this.cache.setDecoded(id, frame);
    return frame;
  }

  private async frameUrl(id: string): Promise<string> {
    const cached = this.urls.get(id);
    if (cached && cached.expiresAt > Date.now() + 30000) return cached.url;
    const pending = this.signing.get(id);
    if (pending) { await pending; return this.urls.get(id)!.url; }
    const position = this.positions.get(id);
    if (!position) throw new Error('Instance is not in this study.');
    // Sign a run of neighbours in one call, skipping ones that already have a fresh URL or are being signed.
    const fresh = (instanceId: string) => (this.urls.get(instanceId)?.expiresAt ?? 0) > Date.now() + 60000 || this.signing.has(instanceId);
    const start = Math.max(0, position.index - 8);
    const ids = [id, ...position.ids.slice(start, start + SIGN_BATCH).filter(instanceId => instanceId !== id && !fresh(instanceId))].slice(0, SIGN_BATCH);
    const request = (async () => {
      // Signing is shared by every slice in the batch, so it isn't tied to one request's cancellation.
      const signed = await this.client.request('frames', { method: 'POST', body: JSON.stringify({ instanceIds: ids }), signal: this.abort.signal });
      const { frames, expiresAt } = await signed.json() as { frames: Array<{ id: string; url: string }>; expiresAt: number };
      frames.forEach(frame => this.urls.set(frame.id, { url: frame.url, expiresAt }));
    })();
    ids.forEach(instanceId => this.signing.set(instanceId, request));
    try { await request; return this.urls.get(id)!.url; }
    finally { ids.forEach(instanceId => { if (this.signing.get(instanceId) === request) this.signing.delete(instanceId); }); }
  }
}
