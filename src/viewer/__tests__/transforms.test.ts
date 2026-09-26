import { describe, expect, it } from 'vitest';
import type { DecodedFrame } from '../../types/dicom';
import { defaultCamera, type CameraState } from '../core/Camera';
import { imagePlacement, imageToViewport, orientationMarkers, viewportToImage } from '../measurements/CoordinateTransforms';
import { computeRoiStats } from '../measurements/MeasurementManager';

const camera = (patch: Partial<CameraState> = {}): CameraState => ({ ...defaultCamera, pan: { x: 0, y: 0 }, ...patch });
const axial: [number, number, number, number, number, number] = [1, 0, 0, 0, 1, 0];

describe('image placement', () => {
  it('fits the image to the viewport, so screen distance maps back to image pixels', () => {
    // A 512 image in a 920x682 viewport is drawn 682 px tall.
    const topLeft = viewportToImage({ x: 119, y: 0 }, camera(), 920, 682, 512, 512);
    const bottomRight = viewportToImage({ x: 801, y: 682 }, camera(), 920, 682, 512, 512);
    expect(topLeft.x).toBeCloseTo(0);
    expect(topLeft.y).toBeCloseTo(0);
    expect(bottomRight.x).toBeCloseTo(512);
    expect(bottomRight.y).toBeCloseTo(512);
  });

  it('rotates clockwise and refits the rotated image', () => {
    // A wide 400x200 image turned a quarter is 200 wide and 400 tall; in a 400x400 viewport it fits at scale 1.
    expect(imagePlacement(camera({ rotation: 90 }), 400, 400, 400, 200).scale).toBeCloseTo(1);
    // The image's right edge moves to the bottom of the screen.
    const rightEdge = imageToViewport({ x: 400, y: 100 }, camera({ rotation: 90 }), 400, 400, 400, 200);
    expect(rightEdge.x).toBeCloseTo(200);
    expect(rightEdge.y).toBeCloseTo(400);
  });

  it('round-trips points through every rotation, flip, zoom and pan', () => {
    for (const rotation of [0, 90, 180, 270] as const) {
      for (const flipH of [false, true]) {
        const view = camera({ rotation, flipH, flipV: !flipH, zoom: 1.7, pan: { x: 13, y: -8 } });
        const screen = imageToViewport({ x: 37.5, y: 201.25 }, view, 640, 480, 512, 384);
        const back = viewportToImage(screen, view, 640, 480, 512, 384);
        expect(back.x).toBeCloseTo(37.5);
        expect(back.y).toBeCloseTo(201.25);
      }
    }
  });
});

describe('orientation markers', () => {
  it('labels an axial slice', () => {
    expect(orientationMarkers(axial, camera())).toEqual({ top: 'A', bottom: 'P', left: 'R', right: 'L' });
  });
  it('labels a sagittal and a coronal slice', () => {
    expect(orientationMarkers([0, 1, 0, 0, 0, -1], camera())).toEqual({ top: 'H', bottom: 'F', left: 'A', right: 'P' });
    expect(orientationMarkers([1, 0, 0, 0, 0, -1], camera())).toEqual({ top: 'H', bottom: 'F', left: 'R', right: 'L' });
  });
  it('follows flips and clockwise rotation', () => {
    expect(orientationMarkers(axial, camera({ flipH: true }))).toEqual({ top: 'A', bottom: 'P', left: 'L', right: 'R' });
    // Turning clockwise brings the patient's right (screen left) to the top.
    expect(orientationMarkers(axial, camera({ rotation: 90 }))).toEqual({ top: 'R', bottom: 'L', left: 'P', right: 'A' });
  });
  it('shows no markers without ImageOrientationPatient', () => {
    expect(orientationMarkers(undefined, camera())).toBeUndefined();
  });
});

describe('ROI statistics', () => {
  it('handles an ROI larger than the call-stack argument limit', () => {
    const size = 600;
    const modalityPixels = new Float32Array(size * size).map((_, index) => index % 1000 - 500);
    const frame = { metadata: { rows: size, columns: size, modality: 'CT' }, modalityPixels, min: -500, max: 499, decodeTimeMs: 0 } as unknown as DecodedFrame;
    const stats = computeRoiStats(frame, { x: 0, y: 0 }, { x: size, y: size });
    expect(stats.min).toBe(-500);
    expect(stats.max).toBe(499);
  });
});
