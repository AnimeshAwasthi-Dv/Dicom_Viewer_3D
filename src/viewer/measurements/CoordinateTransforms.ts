import type { CameraState } from '../core/Camera';

export interface Point {
  x: number;
  y: number;
}

/**
 * Where the image sits in the viewport. The renderer, the measurement overlay and pointer input all use this, so a
 * point drawn on screen lands on the pixel under it. Order: flip in image space, rotate clockwise about the image
 * centre, scale (fit to viewport × zoom), then move to the viewport centre plus pan. Units are CSS pixels.
 */
export interface ImagePlacement {
  /** Screen pixels per image pixel. */
  scale: number;
  cos: number;
  sin: number;
  flipX: 1 | -1;
  flipY: 1 | -1;
  centerX: number;
  centerY: number;
}

export function imagePlacement(camera: CameraState, viewportWidth: number, viewportHeight: number, imageWidth: number, imageHeight: number): ImagePlacement {
  const sideways = camera.rotation === 90 || camera.rotation === 270;
  // Fit the image as it appears after rotation.
  const fitWidth = sideways ? imageHeight : imageWidth;
  const fitHeight = sideways ? imageWidth : imageHeight;
  const fit = Math.min(viewportWidth / Math.max(1, fitWidth), viewportHeight / Math.max(1, fitHeight));
  const radians = (camera.rotation * Math.PI) / 180;
  return {
    scale: fit * camera.zoom,
    // Exact values for right angles avoid 6e-17 drift in the overlay.
    cos: Math.round(Math.cos(radians)),
    sin: Math.round(Math.sin(radians)),
    flipX: camera.flipH ? -1 : 1,
    flipY: camera.flipV ? -1 : 1,
    centerX: viewportWidth / 2 + camera.pan.x,
    centerY: viewportHeight / 2 + camera.pan.y
  };
}

export function screenToViewport(point: Point, rect: DOMRect): Point {
  return { x: point.x - rect.left, y: point.y - rect.top };
}

export function viewportToImage(point: Point, camera: CameraState, viewportWidth: number, viewportHeight: number, imageWidth: number, imageHeight: number): Point {
  const place = imagePlacement(camera, viewportWidth, viewportHeight, imageWidth, imageHeight);
  const x = (point.x - place.centerX) / place.scale;
  const y = (point.y - place.centerY) / place.scale;
  // Inverse (counter-clockwise) rotation.
  const unrotatedX = x * place.cos + y * place.sin;
  const unrotatedY = -x * place.sin + y * place.cos;
  return {
    x: imageWidth / 2 + unrotatedX * place.flipX,
    y: imageHeight / 2 + unrotatedY * place.flipY
  };
}

export function imageToViewport(point: Point, camera: CameraState, viewportWidth: number, viewportHeight: number, imageWidth: number, imageHeight: number): Point {
  const place = imagePlacement(camera, viewportWidth, viewportHeight, imageWidth, imageHeight);
  const x = (point.x - imageWidth / 2) * place.flipX;
  const y = (point.y - imageHeight / 2) * place.flipY;
  // Clockwise on screen (y points down).
  return {
    x: place.centerX + (x * place.cos - y * place.sin) * place.scale,
    y: place.centerY + (x * place.sin + y * place.cos) * place.scale
  };
}

export function pixelDistanceMm(a: Point, b: Point, pixelSpacing?: [number, number]): { value: number; unit: 'mm' | 'px' } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (!pixelSpacing) return { value: Math.hypot(dx, dy), unit: 'px' };
  return { value: Math.hypot(dx * pixelSpacing[1], dy * pixelSpacing[0]), unit: 'mm' };
}

export function imageToPatient(point: Point, imagePosition?: [number, number, number], orientation?: [number, number, number, number, number, number], spacing?: [number, number]): [number, number, number] | undefined {
  if (!imagePosition || !orientation || !spacing) return undefined;
  const [rx, ry, rz, cx, cy, cz] = orientation;
  return [
    imagePosition[0] + point.x * spacing[1] * rx + point.y * spacing[0] * cx,
    imagePosition[1] + point.x * spacing[1] * ry + point.y * spacing[0] * cy,
    imagePosition[2] + point.x * spacing[1] * rz + point.y * spacing[0] * cz
  ];
}

type Vector = [number, number, number];

// Patient axes are LPS: +x is the patient's left, +y posterior, +z head.
function directionLabel(vector: Vector): string {
  const letters: Array<[string, string]> = [['L', 'R'], ['P', 'A'], ['H', 'F']];
  return vector
    .map((component, axis) => ({ component, axis }))
    .filter(({ component }) => Math.abs(component) > 0.25)
    .sort((a, b) => Math.abs(b.component) - Math.abs(a.component))
    .slice(0, 2)
    .map(({ component, axis }) => letters[axis][component > 0 ? 0 : 1])
    .join('');
}

/**
 * Patient direction at each viewport edge (e.g. A at the top of an axial slice), following flips and rotation.
 * Undefined when the image has no ImageOrientationPatient, in which case no markers should be shown.
 */
export function orientationMarkers(orientation: [number, number, number, number, number, number] | undefined, camera: CameraState): { top: string; bottom: string; left: string; right: string } | undefined {
  if (!orientation) return undefined;
  const row: Vector = [orientation[0], orientation[1], orientation[2]];
  const column: Vector = [orientation[3], orientation[4], orientation[5]];
  const scale = (vector: Vector, factor: number): Vector => [vector[0] * factor, vector[1] * factor, vector[2] * factor];
  // Patient directions of screen right and screen down.
  let right = scale(row, camera.flipH ? -1 : 1);
  let down = scale(column, camera.flipV ? -1 : 1);
  // Each clockwise quarter turn: what was on the left comes to the top, so screen right now shows the old "up".
  for (let turn = 0; turn < camera.rotation / 90; turn += 1) [right, down] = [scale(down, -1), right];
  return { top: directionLabel(scale(down, -1)), bottom: directionLabel(down), left: directionLabel(scale(right, -1)), right: directionLabel(right) };
}
