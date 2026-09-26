import type { DecodedFrame } from '../../types/dicom';
import { modalityUnit } from '../codecs/RawDecoder';
import type { Measurement, RoiStats } from './Measurement';
import { pixelDistanceMm, type Point } from './CoordinateTransforms';

export function computeAngle(a: Point, vertex: Point, c: Point): number {
  const ab = { x: a.x - vertex.x, y: a.y - vertex.y };
  const cb = { x: c.x - vertex.x, y: c.y - vertex.y };
  const dot = ab.x * cb.x + ab.y * cb.y;
  const denom = Math.hypot(ab.x, ab.y) * Math.hypot(cb.x, cb.y);
  return denom === 0 ? 0 : (Math.acos(Math.min(1, Math.max(-1, dot / denom))) * 180) / Math.PI;
}

export function computeRoiStats(frame: DecodedFrame, a: Point, b: Point, ellipse = false): RoiStats {
  const minX = Math.max(0, Math.floor(Math.min(a.x, b.x)));
  const maxX = Math.min(frame.metadata.columns - 1, Math.ceil(Math.max(a.x, b.x)));
  const minY = Math.max(0, Math.floor(Math.min(a.y, b.y)));
  const maxY = Math.min(frame.metadata.rows - 1, Math.ceil(Math.max(a.y, b.y)));
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const rx = Math.max(1, (maxX - minX) / 2);
  const ry = Math.max(1, (maxY - minY) / 2);
  const values: number[] = [];

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      if (ellipse && ((x - cx) ** 2) / (rx ** 2) + ((y - cy) ** 2) / (ry ** 2) > 1) continue;
      values.push(frame.modalityPixels[y * frame.metadata.columns + x]);
    }
  }

  if (values.length === 0) return { area: 0, mean: 0, min: 0, max: 0, stdDev: 0, unit: modalityUnit(frame.metadata.modality) };
  const sum = values.reduce((acc, value) => acc + value, 0);
  const mean = sum / values.length;
  const variance = values.reduce((acc, value) => acc + (value - mean) ** 2, 0) / values.length;
  const spacing = frame.metadata.pixelSpacing;
  const area = spacing ? values.length * spacing[0] * spacing[1] : values.length;
  return {
    area,
    mean,
    // A loop, not Math.min(...values): spreading a large ROI's pixels overflows the call stack.
    min: values.reduce((low, value) => (value < low ? value : low), Infinity),
    max: values.reduce((high, value) => (value > high ? value : high), -Infinity),
    stdDev: Math.sqrt(variance),
    unit: modalityUnit(frame.metadata.modality)
  };
}

export class MeasurementManager {
  createLength(frame: DecodedFrame, points: [Point, Point]): Measurement {
    const distance = pixelDistanceMm(points[0], points[1], frame.metadata.pixelSpacing);
    return this.base(frame, 'length', points, distance.value, distance.unit);
  }

  private base(frame: DecodedFrame, type: Measurement['type'], points: Point[], value?: number, unit?: string): Measurement {
    return {
      id: crypto.randomUUID(),
      type,
      studyInstanceUID: frame.metadata.studyInstanceUID,
      seriesInstanceUID: frame.metadata.seriesInstanceUID,
      sopInstanceUID: frame.metadata.sopInstanceUID,
      frameOfReferenceUID: frame.metadata.frameOfReferenceUID,
      points,
      value,
      unit,
      createdAt: new Date().toISOString()
    };
  }
}
