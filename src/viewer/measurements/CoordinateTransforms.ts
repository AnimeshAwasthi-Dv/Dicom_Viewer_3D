import type { CameraState } from '../core/Camera';

export interface Point {
  x: number;
  y: number;
}

export function screenToViewport(point: Point, rect: DOMRect): Point {
  return { x: point.x - rect.left, y: point.y - rect.top };
}

export function viewportToImage(point: Point, camera: CameraState, viewportWidth: number, viewportHeight: number, imageWidth: number, imageHeight: number): Point {
  const centerX = viewportWidth / 2 + camera.pan.x;
  const centerY = viewportHeight / 2 + camera.pan.y;
  const cos = Math.cos((-camera.rotation * Math.PI) / 180);
  const sin = Math.sin((-camera.rotation * Math.PI) / 180);
  const x = (point.x - centerX) / camera.zoom;
  const y = (point.y - centerY) / camera.zoom;
  const rotatedX = x * cos - y * sin;
  const rotatedY = x * sin + y * cos;
  return {
    x: imageWidth / 2 + rotatedX * (camera.flipH ? -1 : 1),
    y: imageHeight / 2 + rotatedY * (camera.flipV ? -1 : 1)
  };
}

export function imageToViewport(point: Point, camera: CameraState, viewportWidth: number, viewportHeight: number, imageWidth: number, imageHeight: number): Point {
  const x = (point.x - imageWidth / 2) * (camera.flipH ? -1 : 1);
  const y = (point.y - imageHeight / 2) * (camera.flipV ? -1 : 1);
  const cos = Math.cos((camera.rotation * Math.PI) / 180);
  const sin = Math.sin((camera.rotation * Math.PI) / 180);
  return {
    x: viewportWidth / 2 + camera.pan.x + (x * cos - y * sin) * camera.zoom,
    y: viewportHeight / 2 + camera.pan.y + (x * sin + y * cos) * camera.zoom
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

