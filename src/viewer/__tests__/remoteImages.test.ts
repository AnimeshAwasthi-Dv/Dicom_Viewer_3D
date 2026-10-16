import { afterEach, describe, expect, it, vi } from 'vitest';
import { RemoteImageSource } from '../dicom/RemoteImageSource';
import { rasterMetadata } from '../dicom/RasterImage';
import type { RemoteClient } from '../remote/RemoteClient';
import { refreshRemoteStudy, importMessage } from '../remote/progressiveStudy';
import { useStudyStore } from '../../store/studyStore';
import { useViewerStore } from '../../store/viewerStore';
import { useUiStore } from '../../store/uiStore';
import { useMeasurementStore } from '../../store/measurementStore';

const decoder = vi.hoisted(() => ({ warm: vi.fn(), decodePixels: vi.fn(), decodeFile: vi.fn(), dispose: vi.fn() }));
vi.mock('../workers/DecodePool', () => ({ DecodePool: class {
  warm = decoder.warm;
  decodePixels = decoder.decodePixels;
  decodeFile = decoder.decodeFile;
  dispose = decoder.dispose;
} }));
afterEach(() => {
  vi.unstubAllGlobals(); vi.clearAllMocks();
  useStudyStore.getState().reset(); useViewerStore.getState().setLayout('1x1');
  useUiStore.setState({ mprOpen: false }); useMeasurementStore.getState().clear();
});

describe('remote ordinary images', () => {
  it('adds chunks without losing cached pixels, selected image, camera or annotations', async () => {
    const second = { ...rasterMetadata('png', 'second.png', 'study', 'second', 1, 1), seriesInstanceUID: 'series', instanceNumber: 2 };
    const first = { ...second, sopInstanceUID: 'first', fileName: 'first.png', instanceNumber: 1 };
    const request = vi.fn(async () => new Response(JSON.stringify({ frames: [{ id: 'second', url: 'https://storage.example/second.png' }, { id: 'first', url: 'https://storage.example/first.png' }], expiresAt: Date.now() + 300000 })));
    const fetcher = vi.fn(async () => new Response(new Uint8Array([1])));
    vi.stubGlobal('fetch', fetcher);
    decoder.decodePixels.mockImplementation(async metadata => ({ metadata, modalityPixels: new Float32Array([1]), min: 1, max: 1, decodeTimeMs: 0 }));
    const partial = { id: 'import', importStatus: 'loading' as const, skippedFiles: 0, instances: [{ metadata: second }] };
    const source = new RemoteImageSource({ request } as unknown as RemoteClient, partial);
    useStudyStore.getState().setSource(source, await source.getStudyMetadata());
    const vp = useViewerStore.getState().viewports[0];
    useViewerStore.getState().assignSeries(vp.id, 'study:series');
    useViewerStore.getState().updateCamera(vp.id, { zoom: 3 });
    useViewerStore.getState().setWindow(vp.id, 200, 100);
    useMeasurementStore.setState({ measurements: [{ id: 'note', type: 'annotation', studyInstanceUID: 'study', seriesInstanceUID: 'series', sopInstanceUID: 'second', points: [{ x: 0, y: 0 }], label: 'Keep', createdAt: '2026-10-16' }] });
    const frame = await source.getFrame('second');
    useUiStore.setState({ mprOpen: true });
    refreshRemoteStudy(source, { ...partial, instances: [{ metadata: second }, { metadata: first }] });
    expect(useViewerStore.getState().viewports[0]).toMatchObject({ instanceIndex: 1, camera: { zoom: 3 }, windowWidth: 200, windowCenter: 100 });
    expect(useStudyStore.getState().selectedSeriesId).toBe('study:series');
    expect(useMeasurementStore.getState().measurements[0].label).toBe('Keep');
    expect(useUiStore.getState().mprOpen).toBe(false);
    expect(await source.getFrame('second')).toBe(frame);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect((await source.getFrame('first')).metadata.sopInstanceUID).toBe('first');
    expect(decoder.dispose).not.toHaveBeenCalled();
    refreshRemoteStudy(source, { ...partial, importStatus: 'completed', instances: [{ metadata: second }, { metadata: first }] });
    expect(useStudyStore.getState().remoteImportStatus).toBe('completed');
    expect(importMessage(partial)).toBe('Partial study');
    expect(importMessage({ ...partial, importStatus: 'failed' })).toContain('incomplete');
    expect(importMessage({ ...partial, importStatus: 'completed', skippedFiles: 1 })).toContain('skipped');
    source.dispose();
  });
  it('decodes signed JPEG/PNG downloads with manifest metadata and caches their colors', async () => {
    const png = rasterMetadata('png', 'a.png', 'study', 'a', 1, 1);
    const jpeg = rasterMetadata('jpeg', 'b.jpg', 'study', 'b', 1, 1);
    const request = vi.fn(async () => new Response(JSON.stringify({
      frames: [{ id: 'a', url: 'https://storage.example/a.png' }, { id: 'b', url: 'https://storage.example/b.jpg' }], expiresAt: Date.now() + 300000
    })));
    const fetcher = vi.fn(async () => new Response(new Uint8Array([1, 2, 3])));
    vi.stubGlobal('fetch', fetcher);
    decoder.decodePixels.mockImplementation(async metadata => ({
      metadata, modalityPixels: new Float32Array([76]), rgbaPixels: new Uint8Array([255, 0, 0, 255]), min: 76, max: 76, decodeTimeMs: 1
    }));
    const source = new RemoteImageSource({ request } as unknown as RemoteClient, {
      id: 'import', skippedFiles: 0, instances: [{ metadata: png }, { metadata: jpeg }]
    });
    const a = await source.getFrame('a');
    const b = await source.getFrame('b');
    expect(a.rgbaPixels).toEqual(new Uint8Array([255, 0, 0, 255]));
    expect(b.metadata).toBe(jpeg);
    expect(decoder.decodePixels).toHaveBeenCalledWith(png, expect.any(ArrayBuffer));
    expect(decoder.decodePixels).toHaveBeenCalledWith(jpeg, expect.any(ArrayBuffer));
    expect(decoder.decodeFile).not.toHaveBeenCalled();
    expect(await source.getFrame('a')).toBe(a);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(source.metrics()).toEqual({ framesCached: 2, memoryBytes: 16 });
    source.dispose();
  });
});
