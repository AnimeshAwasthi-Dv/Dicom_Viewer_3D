import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DecodedFrame, DicomMetadata } from '../../types/dicom';
import type { ImageSource } from '../dicom/ImageSource';
import type { Series } from '../study/Series';
import { FrameLoadScheduler } from '../cache/FrameLoadScheduler';
import type { FrameRequestOptions } from '../cache/FrameRequestQueue';
import { NetworkEstimator } from '../cache/NetworkEstimator';
import { canPreview, encodePreview, expandPreview } from '../dicom/PreviewFormat';
import { RawDecoder } from '../codecs/RawDecoder';

afterEach(() => { vi.useRealTimers(); });

describe('network estimator', () => {
  function measure(estimator: NetworkEstimator, samples: Array<{ bytes: number; ms: number; latencyMs: number }>) {
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    for (const sample of samples) {
      const done = estimator.begin();
      now += sample.ms;
      done({ bytes: sample.bytes, latencyMs: sample.latencyMs });
    }
    vi.restoreAllMocks();
  }

  it('uses the device maximum before anything is measured', () => {
    expect(new NetworkEstimator({ min: 2, max: 6 }, undefined).limits()).toEqual({ total: 6, background: 4 });
  });

  it('runs few downloads on a slow link, where parallel ones only split the bandwidth', () => {
    const estimator = new NetworkEstimator({ min: 2, max: 6 }, undefined);
    // 240 KB slices at 5 Mbps (0.625 bytes/ms) take about 380 ms each; latency is 70 ms.
    measure(estimator, [1, 2, 3].map(() => ({ bytes: 240_000, ms: 384, latencyMs: 70 })));
    expect(estimator.limits().total).toBe(2);
    expect(estimator.frameTransferMs()).toBeGreaterThan(250);
  });

  it('runs more downloads when latency, not bandwidth, is the limit', () => {
    const estimator = new NetworkEstimator({ min: 2, max: 6 }, undefined);
    // 50 KB slices arriving in 60 ms, of which 50 ms is waiting for the first byte.
    measure(estimator, [1, 2, 3, 4, 5].map(() => ({ bytes: 50_000, ms: 60, latencyMs: 50 })));
    expect(estimator.limits().total).toBe(6);
  });

  it('does not count cancelled downloads as a slow link', () => {
    const estimator = new NetworkEstimator({ min: 2, max: 6 }, undefined);
    measure(estimator, [{ bytes: 0, ms: 5000, latencyMs: 0 }, ...[1, 2, 3, 4, 5].map(() => ({ bytes: 50_000, ms: 60, latencyMs: 50 }))]);
    expect(estimator.limits().total).toBe(6);
  });

  it('seeds from the browser estimate until slices are measured', () => {
    const estimator = new NetworkEstimator({ min: 2, max: 6 }, { effectiveType: '2g' });
    expect(estimator.limits().total).toBe(2);
  });
});

describe('previews', () => {
  const metadata = (rows: number, columns: number, extra: Partial<DicomMetadata> = {}): DicomMetadata => ({
    fileName: 'a.dcm', studyInstanceUID: '1', seriesInstanceUID: '1.1', sopInstanceUID: '1.1.1', rows, columns,
    bitsAllocated: 16, bitsStored: 16, pixelRepresentation: 1, photometricInterpretation: 'MONOCHROME2', samplesPerPixel: 1,
    rescaleSlope: 1, rescaleIntercept: -1024, transferSyntaxUID: '1.2.840.10008.1.2.1', ...extra
  });

  it('are only built for large uncompressed greyscale slices', () => {
    expect(canPreview(metadata(512, 512))).toBe(true);
    expect(canPreview(metadata(256, 256))).toBe(false);
    expect(canPreview(metadata(512, 512, { transferSyntaxUID: '1.2.840.10008.1.2.4.80' }))).toBe(false);
    expect(canPreview(metadata(512, 512, { samplesPerPixel: 3 }))).toBe(false);
  });

  it('are a quarter of the size and expand back to the slice geometry with close values', () => {
    const meta = metadata(512, 512);
    const pixels = new Int16Array(512 * 512);
    // A smooth gradient plus a bright square, like soft tissue next to bone.
    for (let y = 0; y < 512; y++) for (let x = 0; x < 512; x++) pixels[y * 512 + x] = x + y + (x > 200 && x < 300 && y > 200 && y < 300 ? 1000 : 0);
    const preview = encodePreview(meta, pixels.buffer)!;
    expect(preview.byteLength).toBe(16 + 256 * 256 * 2);
    const expanded = expandPreview(preview.slice().buffer, meta);
    expect(expanded.metadata.rows).toBe(512);
    const frame = new RawDecoder().decode(expanded.metadata, expanded.pixelData);
    expect(frame.modalityPixels).toHaveLength(512 * 512);
    // Rescale is applied like the full slice's; away from edges the values match closely.
    expect(frame.modalityPixels[100 * 512 + 100]).toBeCloseTo(200 - 1024, -1);
    expect(frame.modalityPixels[250 * 512 + 250]).toBeCloseTo(1500 - 1024, -1);
  });

  it('are rejected when they do not match the slice', () => {
    const preview = encodePreview(metadata(512, 512), new Int16Array(512 * 512).buffer)!;
    expect(() => expandPreview(preview.slice().buffer, metadata(512, 400))).toThrow('does not match');
  });
});

describe('scrubbing', () => {
  function setup() {
    const requests: Array<{ id: string; options?: FrameRequestOptions }> = [];
    const source: ImageSource = {
      mode: 'remote',
      getStudyMetadata: async () => [],
      metrics: () => ({ framesCached: 0, memoryBytes: 0 }),
      getFrame: (id, options) => { requests.push({ id, options }); return new Promise<DecodedFrame>(() => undefined); }
    };
    const series = { instances: Array.from({ length: 100 }, (_, index) => ({ id: `s${index}` })) } as unknown as Series;
    return { requests, source, series, scheduler: new FrameLoadScheduler() };
  }

  it('prefetches only a few slices ahead while scrubbing, cancelling the rest, and the full window once it pauses', () => {
    vi.useFakeTimers();
    const { requests, source, series, scheduler } = setup();
    const noop = () => undefined;
    scheduler.loadPriority(source, series, 50, noop, noop);
    const full = requests.length;
    expect(full).toBeGreaterThan(10);
    requests.length = 0;
    vi.advanceTimersByTime(20);
    scheduler.loadPriority(source, series, 51, noop, noop);
    expect(requests.map(request => request.id)).toEqual(['s51', 's52', 's53', 's54']);
    // The previous window's requests were cancelled.
    const previous = requests[0].options?.signal;
    requests.length = 0;
    vi.advanceTimersByTime(200);
    expect(previous?.aborted).toBe(true);
    expect(requests.length).toBeGreaterThan(10);
    expect(requests[0].id).toBe('s51');
  });

  it('keeps the full window for cine', () => {
    vi.useFakeTimers();
    const { requests, source, series, scheduler } = setup();
    const noop = () => undefined;
    scheduler.loadPriority(source, series, 50, noop, noop, true);
    vi.advanceTimersByTime(20);
    requests.length = 0;
    scheduler.loadPriority(source, series, 51, noop, noop, true);
    expect(requests.length).toBeGreaterThan(10);
  });

  it('asks for a preview only for the slice on screen', () => {
    const { requests, source, series, scheduler } = setup();
    scheduler.loadPriority(source, series, 50, () => undefined, () => undefined);
    expect(requests.filter(request => request.options?.onPreview).map(request => request.id)).toEqual(['s50']);
  });
});
