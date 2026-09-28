import type { MeasurementType } from '../tools/toolIds';

export type { MeasurementType };

/** A point in image pixel coordinates (column, row) of the referenced image. */
export interface MeasurementPoint {
  x: number;
  y: number;
  z?: number;
}

export interface RoiStats {
  area: number;
  mean: number;
  min: number;
  max: number;
  stdDev: number;
  unit: string;
}

/**
 * A measurement or annotation on one image, in the shape remote-control state carries. Points are image pixel
 * coordinates: length 2, angle 3, cobb angle 4, bidirectional 4 (long axis, then short axis), probe 1, annotation 1
 * or 2 (arrow head, then tail), rectangle / ellipse 2 opposite corners of the bounding box, circle 2 (centre, then a
 * point on the edge), freehand / spline / livewire the outline.
 */
export interface Measurement {
  id: string;
  type: MeasurementType;
  studyInstanceUID: string;
  seriesInstanceUID: string;
  sopInstanceUID: string;
  /** 1-based frame of a multi-frame instance. */
  frameNumber?: number;
  frameOfReferenceUID?: string;
  points: MeasurementPoint[];
  value?: number;
  unit?: string;
  /** Bidirectional: the short axis (`value` is the long axis). */
  secondaryValue?: number;
  stats?: RoiStats;
  label?: string;
  createdAt: string;
}
