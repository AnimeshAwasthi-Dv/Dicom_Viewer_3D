import type { MeasurementPoint, MeasurementType } from './Measurement';

type Vec3 = [number, number, number];

/** Where an image lies in patient space, as the stack viewport places it. */
export interface PlaneGeometry { origin: Vec3; row: Vec3; column: Vec3; xSpacing: number; ySpacing: number }

/**
 * The viewport's geometry for an image from its image plane module. Missing position and orientation default the way
 * Cornerstone's stack viewport defaults them (origin, identity axes), and missing spacing to 1 (pixel units).
 * `columnPixelSpacing` (DICOM PixelSpacing[1]) runs along a row, `rowPixelSpacing` (PixelSpacing[0]) down a column.
 */
export function planeGeometry(plane?: {
  imagePositionPatient?: number[] | null; rowCosines?: number[] | null; columnCosines?: number[] | null;
  rowPixelSpacing?: number | null; columnPixelSpacing?: number | null;
}): PlaneGeometry {
  return {
    origin: (plane?.imagePositionPatient ?? [0, 0, 0]) as Vec3,
    row: (plane?.rowCosines ?? [1, 0, 0]) as Vec3,
    column: (plane?.columnCosines ?? [0, 1, 0]) as Vec3,
    xSpacing: plane?.columnPixelSpacing || 1,
    ySpacing: plane?.rowPixelSpacing || 1
  };
}

// Image coordinates run from the outer corner of the first pixel, whose centre (the DICOM image position) is at
// (0.5, 0.5). This matches Cornerstone's world <-> image conversion and the viewer's remote API. Cornerstone's own
// imageToWorldCoords multiplies the row direction by the row spacing, which disagrees with the viewport for
// non-square pixels, hence this implementation.

export function imageToWorld(geometry: PlaneGeometry, point: MeasurementPoint): Vec3 {
  const { origin, row, column, xSpacing, ySpacing } = geometry;
  const u = (point.x - 0.5) * xSpacing;
  const v = (point.y - 0.5) * ySpacing;
  return [0, 1, 2].map((axis) => origin[axis] + row[axis] * u + column[axis] * v) as Vec3;
}

export function worldToImage(geometry: PlaneGeometry, world: ArrayLike<number>): MeasurementPoint {
  const { origin, row, column, xSpacing, ySpacing } = geometry;
  const delta = [world[0] - origin[0], world[1] - origin[1], world[2] - origin[2]];
  const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return { x: dot(delta, row) / xSpacing + 0.5, y: dot(delta, column) / ySpacing + 0.5 };
}

function boundingCorners(points: MeasurementPoint[]): [MeasurementPoint, MeasurementPoint] {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return [{ x: Math.min(...xs), y: Math.min(...ys) }, { x: Math.max(...xs), y: Math.max(...ys) }];
}

/**
 * The handles a Cornerstone tool draws, from a measurement's points. Rectangles and ellipses are two opposite corners
 * in the remote API; Cornerstone keeps the four corners, or the ends of the ellipse's axes.
 */
export function toolPoints(type: MeasurementType, points: MeasurementPoint[]): MeasurementPoint[] {
  if (type === 'rectangleRoi') {
    const [a, b] = boundingCorners(points);
    return [{ x: a.x, y: a.y }, { x: b.x, y: a.y }, { x: a.x, y: b.y }, { x: b.x, y: b.y }];
  }
  if (type === 'ellipseRoi') {
    const [a, b] = boundingCorners(points);
    const cx = (a.x + b.x) / 2;
    const cy = (a.y + b.y) / 2;
    // Bottom, top, left, right.
    return [{ x: cx, y: b.y }, { x: cx, y: a.y }, { x: a.x, y: cy }, { x: b.x, y: cy }];
  }
  if (type === 'annotation' && points.length === 1) {
    // A pin from an older controller: an arrow pointing at it from up and to the right.
    return [points[0], { x: points[0].x + 20, y: points[0].y - 18 }];
  }
  return points;
}

/** A measurement's points from the handles a tool drew (the inverse of `toolPoints`). */
export function measurementPoints(type: MeasurementType, points: MeasurementPoint[]): MeasurementPoint[] {
  return type === 'rectangleRoi' || type === 'ellipseRoi' ? boundingCorners(points) : points;
}

/** At most `limit` outline points, evenly spaced along the contour. */
export function thin(points: MeasurementPoint[], limit = 1024): MeasurementPoint[] {
  if (points.length <= limit) return points;
  const step = points.length / limit;
  return Array.from({ length: limit }, (_, index) => points[Math.floor(index * step)]);
}
