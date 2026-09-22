export type MeasurementType = 'length' | 'angle' | 'rectangleRoi' | 'ellipseRoi' | 'probe' | 'annotation';

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

export interface Measurement {
  id: string;
  type: MeasurementType;
  studyInstanceUID: string;
  seriesInstanceUID: string;
  sopInstanceUID: string;
  frameOfReferenceUID?: string;
  points: MeasurementPoint[];
  value?: number;
  unit?: string;
  stats?: RoiStats;
  label?: string;
  createdAt: string;
}
