import { afterEach, describe, expect, it, vi } from 'vitest';
import { RemoteImageSource } from '../dicom/RemoteImageSource';
import { rasterMetadata } from '../dicom/RasterImage';
import type { RemoteClient } from '../remote/RemoteClient';

const decoder = vi.hoisted(() => ({ warm: vi.fn(), decodePixels: vi.fn(), decodeFile: vi.fn(), dispose: vi.fn() }));
vi.mock('../workers/DecodePool', () => ({ DecodePool: class {
  warm = decoder.warm;
  decodePixels = decoder.decodePixels;
  decodeFile = decoder.decodeFile;
  dispose = decoder.dispose;
} }));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('remote ordinary images', () => {
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
