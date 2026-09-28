import { cache, registerImageLoader } from '@cornerstonejs/core';
import { wadouri } from '@cornerstonejs/dicom-image-loader';
import type { PublicManifest } from '../../types/remote';
import { NetworkEstimator } from '../cache/NetworkEstimator';
import { deviceProfile } from '../core/DeviceProfile';
import { setRequestLimits } from '../cornerstone/init';
import { registerImageMetadata, unregisterImageMetadata } from '../cornerstone/metadata';
import type { RemoteClient } from '../remote/RemoteClient';
import { buildStudies } from '../study/StudyManager';
import type { Series } from '../study/Series';
import type { Study } from '../study/Study';
import { ImageIdIndex, StudyListeners, type ImageSource } from './ImageSource';
import { wadouriTags } from './wadouriTags';

// The frames endpoint signs at most 32 URLs per call.
const SIGN_BATCH = 32;
const SCHEME = 'decxpert';

type SignedUrl = { url: string; expiresAt: number };

/** Fetchers of the open remote studies, by manifest id. Image ids are `decxpert:<manifest>/<sop>[&frame=n]`. */
const fetchers = new Map<string, (sopInstanceUID: string) => Promise<ArrayBuffer>>();
let loaderRegistered = false;

/**
 * Cornerstone loader for our S3 studies. The image id names the instance, not a URL: signed URLs expire and
 * change, and the image id is what Cornerstone caches and what measurements refer to. The file itself is parsed and
 * decoded by Cornerstone's wadouri pipeline, which gives every codec, colour and multi-frame support.
 */
function registerLoader(): void {
  if (loaderRegistered) return;
  loaderRegistered = true;
  const fetchFile = (uri: string) => {
    const slash = uri.indexOf('/');
    const fetcher = fetchers.get(uri.slice(0, slash));
    return fetcher ? fetcher(uri.slice(slash + 1)) : Promise.reject(new Error('Study closed.'));
  };
  registerImageLoader(SCHEME, ((imageId: string, options?: Record<string, unknown>) => {
    const { url, pixelDataFrame } = wadouri.parseImageId(imageId);
    const dataSet = wadouri.dataSetCacheManager.load(url, fetchFile as never, imageId);
    return wadouri.loadImageFromPromise(dataSet, imageId, pixelDataFrame ?? 0, url, options ?? {});
  }) as unknown as Parameters<typeof registerImageLoader>[1]);
}

/** A study imported by the viewer service, read through a viewer session. */
export class RemoteImageSource implements ImageSource {
  readonly mode = 'remote';
  private readonly abort = new AbortController();
  private readonly network = new NetworkEstimator(deviceProfile().remoteRequests);
  private readonly urls = new Map<string, SignedUrl>();
  private readonly signing = new Map<string, Promise<void>>();
  private readonly studies: Study[];
  /** Series and position of each instance, for choosing which URLs to sign together. */
  private readonly positions = new Map<string, { ids: string[]; index: number }>();
  private readonly index: ImageIdIndex;
  private readonly listeners = new StudyListeners();
  private readonly stopNetwork: () => void;

  constructor(private readonly client: RemoteClient, private readonly manifest: PublicManifest) {
    registerLoader();
    fetchers.set(manifest.id, (sop) => this.download(sop));
    this.studies = buildStudies(manifest.instances.map(({ metadata }) => ({ metadata })), true);
    this.studies.forEach((study) => study.series.forEach((series) => {
      const ids = series.instances.map((instance) => instance.id);
      ids.forEach((id, index) => this.positions.set(id, { ids, index }));
    }));
    this.index = new ImageIdIndex(({ instance, frameNumber }) => {
      const imageId = `${SCHEME}:${manifest.id}/${instance.id}${frameNumber ? `&frame=${frameNumber}` : ''}`;
      if (!frameNumber) registerImageMetadata(imageId, instance.metadata);
      return imageId;
    });
    this.studies.forEach((study) => study.series.forEach((series) => this.index.imageIds(series)));
    const applyLimits = () => {
      const { total, background } = this.network.limits();
      setRequestLimits({ interaction: total, prefetch: background });
    };
    applyLimits();
    this.stopNetwork = this.network.onChange(applyLimits);
  }

  async getStudyMetadata(): Promise<Study[]> { return this.studies; }
  async ensureSeries(series: Series): Promise<Series> { return series; }
  imageIds(series: Series): string[] { return this.index.imageIds(series); }
  locate(imageId: string) { return this.index.locate(imageId); }
  imageIdFor(sopInstanceUID: string, frameNumber?: number) { return this.index.imageIdFor(sopInstanceUID, frameNumber); }
  tags(imageId: string) { return wadouriTags(imageId); }
  subscribe(listener: (studies: Study[]) => void) { return this.listeners.subscribe(listener); }

  dispose(): void {
    this.abort.abort();
    this.stopNetwork();
    fetchers.delete(this.manifest.id);
    const ids = this.index.all();
    unregisterImageMetadata(ids);
    ids.forEach((imageId) => wadouri.dataSetCacheManager.unload(wadouri.parseImageId(imageId).url));
    cache.purgeCache();
  }

  private async download(sopInstanceUID: string): Promise<ArrayBuffer> {
    const { url } = await this.signed(sopInstanceUID);
    this.abort.signal.throwIfAborted();
    const started = performance.now();
    const measured = this.network.begin();
    try {
      const response = await fetch(url, { signal: this.abort.signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
      const latencyMs = performance.now() - started;
      if (!response.ok) throw new Error(`Image download failed (${response.status}).`);
      const buffer = await response.arrayBuffer();
      // Content-Length is the size on the wire (gzip-encoded objects inflate to more than that).
      measured({ bytes: Number(response.headers.get('content-length')) || buffer.byteLength, latencyMs });
      return buffer;
    } finally { measured({ bytes: 0 }); }
  }

  private async signed(id: string): Promise<SignedUrl> {
    const cached = this.urls.get(id);
    if (cached && cached.expiresAt > Date.now() + 30000) return cached;
    const pending = this.signing.get(id);
    if (pending) { await pending; return this.urls.get(id)!; }
    const position = this.positions.get(id);
    if (!position) throw new Error('Instance is not in this study.');
    // Sign a run of neighbours in one call, skipping ones that already have a fresh URL or are being signed.
    const fresh = (instanceId: string) => (this.urls.get(instanceId)?.expiresAt ?? 0) > Date.now() + 60000 || this.signing.has(instanceId);
    const start = Math.max(0, position.index - 8);
    const ids = [id, ...position.ids.slice(start, start + SIGN_BATCH).filter((instanceId) => instanceId !== id && !fresh(instanceId))].slice(0, SIGN_BATCH);
    const request = (async () => {
      const signed = await this.client.request('frames', { method: 'POST', body: JSON.stringify({ instanceIds: ids }), signal: this.abort.signal });
      const { frames, expiresAt } = await signed.json() as { frames: Array<{ id: string; url: string }>; expiresAt: number };
      frames.forEach((frame) => this.urls.set(frame.id, { url: frame.url, expiresAt }));
    })();
    ids.forEach((instanceId) => this.signing.set(instanceId, request));
    try { await request; return this.urls.get(id)!; }
    finally { ids.forEach((instanceId) => { if (this.signing.get(instanceId) === request) this.signing.delete(instanceId); }); }
  }
}
