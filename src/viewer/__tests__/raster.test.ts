import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeRasterImage, parseRasterImage, rasterFormat } from '../dicom/RasterImage';
import { buildStudies } from '../study/StudyManager';
import { FrameCache } from '../cache/FrameCache';
import { MeasurementManager } from '../measurements/MeasurementManager';

const png = () => new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]).buffer;
const jpeg = () => new Uint8Array([255, 216, 255, 224]).buffer;

afterEach(() => vi.unstubAllGlobals());

function mockBitmap(width = 2, height = 1) {
  const bitmap = { width, height, close: vi.fn() };
  vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(bitmap));
  return bitmap;
}

describe('ordinary image loading', () => {
  it('recognizes PNG and JPEG by content without treating DICOM or truncated headers as images', () => {
    expect(rasterFormat(png())).toBe('png');
    expect(rasterFormat(jpeg())).toBe('jpeg');
    expect(rasterFormat(new ArrayBuffer(132))).toBeUndefined();
    expect(rasterFormat(png().slice(0, 7))).toBeUndefined();
    expect(rasterFormat(jpeg().slice(0, 2))).toBeUndefined();
  });

  it('groups files into a shared image study with independently selectable images and no invented patient geometry', async () => {
    const bitmap = mockBitmap(30, 60);
    const files = await Promise.all([
      parseRasterImage(png(), 'folder/a.PNG', 'import-1'),
      parseRasterImage(jpeg(), 'folder/b.JPG', 'import-1'),
      parseRasterImage(jpeg(), 'folder/c.jpeg', 'import-1')
    ]);
    const studies = buildStudies(files);
    expect(studies).toHaveLength(1);
    expect(studies[0].series).toHaveLength(3);
    expect(new Set(files.map(file => file.metadata.sopInstanceUID)).size).toBe(3);
    expect(files[0].metadata).toMatchObject({ columns: 30, rows: 60, imageFormat: 'png', seriesDescription: 'folder/a.PNG' });
    expect(files[0].metadata.pixelSpacing).toBeUndefined();
    expect(files[0].metadata.imageOrientationPatient).toBeUndefined();
    expect(files[0].metadata.patientName).toBeUndefined();
    expect(files[0].pixelData).toEqual(png());
    expect(bitmap.close).toHaveBeenCalledTimes(3);
  });

  it('reports malformed images rather than returning a usable frame', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error('Invalid image')));
    await expect(parseRasterImage(png(), 'broken.png', 'study')).rejects.toThrow('Invalid image');
    await expect(parseRasterImage(new ArrayBuffer(4), 'fake.jpg', 'study')).rejects.toThrow('Not a JPEG or PNG');
  });

  it('keeps color pixels, computes luminance for measurements and accounts for both buffers in the cache', async () => {
    const bitmap = mockBitmap();
    const file = await parseRasterImage(png(), 'colors.png', 'study');
    const context = {
      fillStyle: '', fillRect: vi.fn(), drawImage: vi.fn(),
      getImageData: vi.fn(() => ({ data: new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255]) }))
    };
    vi.stubGlobal('OffscreenCanvas', class { getContext() { return context; } });
    const frame = await decodeRasterImage(file.metadata, file.pixelData!);
    expect(context.fillStyle).toBe('#000');
    expect(context.fillRect).toHaveBeenCalledWith(0, 0, 2, 1);
    expect(frame.rgbaPixels).toEqual(new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255]));
    expect(frame.modalityPixels[0]).toBeCloseTo(76.245, 3);
    expect(frame.modalityPixels[1]).toBeCloseTo(149.685, 3);
    expect(new MeasurementManager().createLength(frame, [{ x: 0, y: 0 }, { x: 3, y: 4 }])).toMatchObject({ value: 5, unit: 'px' });
    const cache = new FrameCache();
    cache.setDecoded(file.metadata.sopInstanceUID, frame);
    expect(cache.metrics()).toEqual({ framesCached: 1, memoryBytes: 16 });
    expect(bitmap.close).toHaveBeenCalledTimes(2);
  });

  it('releases the decoded bitmap when drawing fails', async () => {
    const bitmap = mockBitmap();
    const file = await parseRasterImage(png(), 'a.png', 'study');
    vi.stubGlobal('OffscreenCanvas', class { getContext() { return null; } });
    await expect(decodeRasterImage(file.metadata, file.pixelData!)).rejects.toThrow('decoder canvas');
    expect(bitmap.close).toHaveBeenCalledTimes(2);
    await expect(decodeRasterImage(file.metadata, jpeg())).rejects.toThrow('format does not match');
  });
});
