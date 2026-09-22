import type { DecodedFrame, ParsedDicomFile } from '../../types/dicom';
import type { PublicManifest } from '../../types/remote';
import type { ImageSource } from './ImageSource';
import { FrameCache } from '../cache/FrameCache';
import { CodecManager } from '../codecs/CodecManager';
import { buildStudies } from '../study/StudyManager';
import type { DicomWorkerResponse } from '../workers/dicomWorker';
import type { RemoteClient } from '../remote/RemoteClient';
import type { Study } from '../study/Study';

export class RemoteImageSource implements ImageSource {
  readonly mode = 'remote';
  private readonly cache = new FrameCache();
  private readonly codecs = new CodecManager();
  private readonly pending = new Map<string, Promise<DecodedFrame>>();
  private readonly abort = new AbortController();
  private active = 0;
  private waiters: Array<() => void> = [];
  private readonly worker = new Worker(new URL('../workers/dicomWorker.ts', import.meta.url), { type: 'module' });
  private readonly parsing = new Map<string, { resolve: (file: ParsedDicomFile) => void; reject: (reason: Error) => void }>();
  private readonly urls = new Map<string, { url: string; expiresAt: number }>();
  private readonly signing = new Map<string, Promise<void>>();
  private readonly studies: Study[];

  constructor(private readonly client: RemoteClient, private readonly manifest: PublicManifest) {
    this.studies = buildStudies(manifest.instances.map(({ metadata }) => ({ metadata })), true);
    this.worker.onmessage = (event: MessageEvent<DicomWorkerResponse>) => {
      const pending = this.parsing.get(event.data.id);
      this.parsing.delete(event.data.id);
      if (event.data.parsed[0]) pending?.resolve(event.data.parsed[0]);
      else pending?.reject(new Error('No image returned by parser.'));
    };
    this.worker.onerror = () => {
      this.parsing.forEach(pending => pending.reject(new Error('Image parser failed.')));
      this.parsing.clear();
    };
  }
  async getStudyMetadata() { return this.studies; }
  metrics() { return this.cache.metrics(); }
  dispose() {
    this.abort.abort();
    this.worker.terminate();
    this.parsing.forEach(pending => pending.reject(new Error('Study closed.')));
    this.parsing.clear();
  }

  async getFrame(id: string): Promise<DecodedFrame> {
    const cached = this.cache.getDecoded(id);
    if (cached) return cached;
    const pending = this.pending.get(id);
    if (pending) return pending;
    const load = this.load(id).finally(() => this.pending.delete(id));
    this.pending.set(id, load);
    return load;
  }

  private async load(id: string): Promise<DecodedFrame> {
    // Bound thumbnail, MPR and viewport downloads together to avoid flooding the network.
    if (this.active >= 6) await new Promise<void>(resolve => this.waiters.push(resolve));
    else this.active++;
    try {
      this.abort.signal.throwIfAborted();
      const url = await this.frameUrl(id);
      const response = await fetch(url, { signal: this.abort.signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
      if (!response.ok) throw new Error(`Image download failed (${response.status}).`);
      const buffer = await response.arrayBuffer();
      this.abort.signal.throwIfAborted();
      const file = await new Promise<ParsedDicomFile>((resolve, reject) => {
        const requestId = crypto.randomUUID();
        this.parsing.set(requestId, { resolve, reject });
        this.worker.postMessage({ id: requestId, files: [{ name: 'remote.dcm', buffer }] }, [buffer]);
      });
      this.abort.signal.throwIfAborted();
      if (!file?.pixelData || file.error) throw new Error(file?.error ?? 'No pixel data returned.');
      if (file.metadata.sopInstanceUID !== id) throw new Error('Image identity does not match the requested instance.');
      const frame = await this.codecs.decodeAsync(file.metadata, file.pixelData);
      this.cache.setDecoded(id, frame);
      return frame;
    } finally {
      const next = this.waiters.shift();
      if (next) next();
      else this.active--;
    }
  }

  private async frameUrl(id: string): Promise<string> {
    const cached = this.urls.get(id);
    if (cached && cached.expiresAt > Date.now() + 30000) return cached.url;
    const pending = this.signing.get(id);
    if (pending) { await pending; return this.urls.get(id)!.url; }
    const series = this.studies.flatMap(study => study.series).find(series => series.instances.some(instance => instance.id === id));
    if (!series) throw new Error('Instance is not in this study.');
    const index = series.instances.findIndex(instance => instance.id === id);
    const ids = series.instances.slice(Math.max(0, index - 8), index + 9).map(instance => instance.id);
    const request = (async () => {
      const signed = await this.client.request('frames', { method: 'POST', body: JSON.stringify({ instanceIds: ids }), signal: this.abort.signal });
      const { frames, expiresAt } = await signed.json() as { frames: Array<{ id: string; url: string }>; expiresAt: number };
      frames.forEach(frame => this.urls.set(frame.id, { url: frame.url, expiresAt }));
    })();
    ids.forEach(instanceId => this.signing.set(instanceId, request));
    try { await request; return this.urls.get(id)!.url; }
    finally { ids.forEach(instanceId => { if (this.signing.get(instanceId) === request) this.signing.delete(instanceId); }); }
  }
}
