import { eventTarget, getRenderingEngines, metaData, StackViewport, type Types } from '@cornerstonejs/core';
import { annotation as annotationApi, Enums as ToolEnums, utilities as toolUtilities, type Types as ToolTypes } from '@cornerstonejs/tools';
import { useMeasurementStore } from '../../store/measurementStore';
import type { ImageSource } from '../dicom/ImageSource';
import type { Measurement, MeasurementPoint, MeasurementType, RoiStats } from '../measurements/Measurement';
import { imageToWorld, measurementPoints, planeGeometry, thin, toolPoints, worldToImage, type PlaneGeometry } from '../measurements/geometry';
import { CORNERSTONE_TOOL, TOOL_FOR_CORNERSTONE } from './tools';

type Annotation = ToolTypes.Annotation;
type Point3 = Types.Point3;

function geometryOf(imageId: string): PlaneGeometry {
  return planeGeometry(metaData.get('imagePlaneModule', imageId) as Parameters<typeof planeGeometry>[0]);
}

const OUTLINE_TYPES = new Set<MeasurementType>(['freehandRoi', 'splineRoi', 'livewire']);
/** Outline measurements from a controller are drawn with the freehand tool; their type is remembered. */
const outlineTypes = new Map<string, MeasurementType>();

// ---------------------------------------------------------------------------------------------------------------
// Cornerstone annotation -> measurement
// ---------------------------------------------------------------------------------------------------------------

const round = (value: number, digits = 1) => Number.isFinite(value) ? value.toFixed(digits) : '--';

function statsOf(annotation: Annotation): Record<string, unknown> | undefined {
  const cached = (annotation.data as { cachedStats?: Record<string, Record<string, unknown>> }).cachedStats;
  return cached ? Object.values(cached)[0] : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function roiStats(stats: Record<string, unknown> | undefined): RoiStats | undefined {
  const mean = num(stats?.mean);
  if (!stats || mean === undefined) return undefined;
  return {
    area: num(stats.area) ?? 0,
    mean,
    min: num(stats.min) ?? mean,
    max: num(stats.max) ?? mean,
    stdDev: num(stats.stdDev) ?? 0,
    unit: String(stats.modalityUnit ?? '')
  };
}

function describe(type: MeasurementType, annotation: Annotation): Pick<Measurement, 'value' | 'unit' | 'secondaryValue' | 'stats' | 'label'> {
  const stats = statsOf(annotation);
  const unit = typeof stats?.unit === 'string' ? stats.unit : undefined;
  switch (type) {
    case 'length': {
      const value = num(stats?.length);
      return value === undefined ? {} : { value, unit, label: `${round(value)} ${unit ?? ''}`.trim() };
    }
    case 'angle':
    case 'cobbAngle': {
      const value = num(stats?.angle);
      return value === undefined ? {} : { value, unit: 'deg', label: `${round(value)}°` };
    }
    case 'bidirectional': {
      const value = num(stats?.length);
      const secondaryValue = num(stats?.width);
      return value === undefined ? {} : { value, secondaryValue, unit, label: `${round(value)} × ${round(secondaryValue ?? NaN)} ${unit ?? ''}`.trim() };
    }
    case 'probe': {
      const value = num(stats?.value);
      const modalityUnit = String(stats?.modalityUnit ?? '');
      return value === undefined ? {} : { value, unit: modalityUnit, label: `${round(value)} ${modalityUnit}`.trim() };
    }
    case 'annotation':
      return { label: (annotation.data as { text?: string }).text ?? '' };
    default: {
      const measured = roiStats(stats);
      return measured ? { stats: measured, label: `Mean ${round(measured.mean)} ${measured.unit}`.trim() } : {};
    }
  }
}

function annotationPoints(annotation: Annotation): Point3[] {
  const data = annotation.data as { handles?: { points?: Point3[] }; contour?: { polyline?: Point3[] } };
  return data.contour?.polyline?.length ? data.contour.polyline : data.handles?.points ?? [];
}

function toMeasurement(annotation: Annotation, source: ImageSource, previous?: Measurement): Measurement | undefined {
  const toolType = annotation.metadata && TOOL_FOR_CORNERSTONE[annotation.metadata.toolName];
  const imageId = annotation.metadata?.referencedImageId;
  if (!toolType || toolType === 'scroll' || toolType === 'windowLevel' || toolType === 'pan' || toolType === 'zoom' || !imageId) return undefined;
  const located = source.locate(imageId);
  if (!located) return undefined;
  const id = annotation.annotationUID!;
  const type = outlineTypes.get(id) ?? toolType;
  const world = annotationPoints(annotation);
  if (!world.length) return undefined;
  const { metadata } = located.instance;
  return {
    id,
    type,
    studyInstanceUID: metadata.studyInstanceUID,
    seriesInstanceUID: metadata.seriesInstanceUID,
    sopInstanceUID: metadata.sopInstanceUID,
    ...(located.frameNumber ? { frameNumber: located.frameNumber } : {}),
    ...(metadata.frameOfReferenceUID ? { frameOfReferenceUID: metadata.frameOfReferenceUID } : {}),
    points: thin(measurementPoints(type, world.map((point) => worldToImage(geometryOf(imageId), point)))),
    ...describe(type, annotation),
    createdAt: previous?.createdAt ?? new Date().toISOString()
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Measurement -> Cornerstone annotation
// ---------------------------------------------------------------------------------------------------------------

function stackViewportShowing(imageId: string): { viewport: StackViewport; index: number } | undefined {
  for (const engine of getRenderingEngines() ?? []) {
    for (const viewport of engine.getViewports()) {
      if (!(viewport instanceof StackViewport)) continue;
      const index = viewport.getImageIds().indexOf(imageId);
      if (index >= 0) return { viewport, index };
    }
  }
  return undefined;
}

function toAnnotation(measurement: Measurement, source: ImageSource): Annotation | undefined {
  const imageId = source.imageIdFor(measurement.sopInstanceUID, measurement.frameNumber);
  if (!imageId) return undefined;
  // The annotation needs the view it belongs to; wait until some viewport has this image's series.
  const shown = stackViewportShowing(imageId);
  if (!shown) return undefined;
  const reference = shown.viewport.getViewReference({ sliceIndex: shown.index });
  const outline = OUTLINE_TYPES.has(measurement.type);
  const toolName = CORNERSTONE_TOOL[outline ? 'freehandRoi' : measurement.type];
  if (outline) outlineTypes.set(measurement.id, measurement.type);
  const geometry = geometryOf(imageId);
  const world = toolPoints(measurement.type, measurement.points).map((point) => imageToWorld(geometry, point));
  const data: Record<string, unknown> = {
    handles: { points: outline ? [] : world, activeHandleIndex: null, textBox: { hasMoved: false, worldPosition: [0, 0, 0], worldBoundingBox: { topLeft: [0, 0, 0], topRight: [0, 0, 0], bottomLeft: [0, 0, 0], bottomRight: [0, 0, 0] } } },
    label: '',
    cachedStats: {}
  };
  if (outline) data.contour = { polyline: world, closed: true };
  if (measurement.type === 'annotation') data.text = measurement.label ?? '';
  return {
    annotationUID: measurement.id,
    highlighted: false,
    invalidated: true,
    isLocked: false,
    isVisible: true,
    metadata: { ...reference, toolName, referencedImageId: imageId, FrameOfReferenceUID: reference.FrameOfReferenceUID } as Annotation['metadata'],
    data: data as Annotation['data']
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Keeping the two in step
// ---------------------------------------------------------------------------------------------------------------

function samePoints(a: MeasurementPoint[], b: MeasurementPoint[]): boolean {
  return a.length === b.length && a.every((point, index) => Math.abs(point.x - b[index].x) < 1e-3 && Math.abs(point.y - b[index].y) < 1e-3);
}

/**
 * Keeps Cornerstone's annotations and the measurement store (which remote-control state carries) in step. Only
 * annotations on stack images take part; MPR annotations stay Cornerstone's own.
 */
export class MeasurementSync {
  private applying = false;
  private scheduled = false;
  private readonly stopStore: () => void;
  private readonly events = [ToolEnums.Events.ANNOTATION_COMPLETED, ToolEnums.Events.ANNOTATION_MODIFIED, ToolEnums.Events.ANNOTATION_REMOVED];
  private readonly onAnnotationEvent = () => this.scheduleCapture();

  constructor(private readonly source: ImageSource) {
    this.events.forEach((name) => eventTarget.addEventListener(name, this.onAnnotationEvent));
    this.stopStore = useMeasurementStore.subscribe((state, previous) => {
      if (state.measurements !== previous.measurements) this.apply();
    });
  }

  /** Call when a viewport shows a new stack: measurements waiting for that series can now be drawn. */
  apply(): void {
    if (this.applying) return;
    this.applying = true;
    try {
      const wanted = new Map(useMeasurementStore.getState().measurements.map((measurement) => [measurement.id, measurement]));
      let changed = false;
      for (const existing of this.syncable()) {
        const measurement = wanted.get(existing.annotationUID!);
        const current = measurement && toMeasurement(existing, this.source);
        if (measurement && current && samePoints(current.points, measurement.points) && (measurement.type !== 'annotation' || current.label === measurement.label)) {
          wanted.delete(measurement.id);
          continue;
        }
        // Removed by the controller, or moved: replace it.
        annotationApi.state.removeAnnotation(existing.annotationUID!);
        changed = true;
      }
      for (const measurement of wanted.values()) {
        const created = toAnnotation(measurement, this.source);
        if (!created) continue;
        // Images without a frame of reference (most 2D X-ray) group under an undefined key, as the viewport does.
        annotationApi.state.addAnnotation(created, created.metadata?.FrameOfReferenceUID as string);
        changed = true;
      }
      if (changed) this.render();
    } finally {
      this.applying = false;
    }
  }

  dispose(): void {
    this.events.forEach((name) => eventTarget.removeEventListener(name, this.onAnnotationEvent));
    this.stopStore();
  }

  private syncable(): Annotation[] {
    return (annotationApi.state.getAllAnnotations() as Annotation[]).filter((annotation) => {
      const imageId = annotation.metadata?.referencedImageId;
      return Boolean(imageId && this.source.locate(imageId) && TOOL_FOR_CORNERSTONE[annotation.metadata!.toolName]);
    });
  }

  private scheduleCapture(): void {
    if (this.applying || this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      this.capture();
    });
  }

  /** Rebuilds the store from Cornerstone after the user draws, edits or deletes a measurement. */
  private capture(): void {
    const previous = useMeasurementStore.getState().measurements;
    const byId = new Map(previous.map((measurement) => [measurement.id, measurement]));
    const captured = new Map<string, Measurement>();
    for (const annotation of this.syncable()) {
      const measurement = toMeasurement(annotation, this.source, byId.get(annotation.annotationUID!));
      if (measurement) captured.set(measurement.id, measurement);
    }
    // Keep the order measurements were made in, so undo removes the latest; measurements not drawn yet (their
    // series isn't on screen) are kept as they are.
    const next = previous.flatMap((measurement) => {
      const updated = captured.get(measurement.id);
      captured.delete(measurement.id);
      if (updated) return [updated];
      return this.source.imageIdFor(measurement.sopInstanceUID, measurement.frameNumber) && this.isDrawable(measurement) ? [] : [measurement];
    });
    next.push(...captured.values());
    this.applying = true;
    try { useMeasurementStore.setState({ measurements: next }); }
    finally { this.applying = false; }
  }

  private isDrawable(measurement: Measurement): boolean {
    const imageId = this.source.imageIdFor(measurement.sopInstanceUID, measurement.frameNumber);
    return Boolean(imageId && stackViewportShowing(imageId));
  }

  private render(): void {
    for (const engine of getRenderingEngines() ?? []) {
      toolUtilities.triggerAnnotationRenderForViewportIds(engine.getViewports().map((viewport) => viewport.id));
    }
  }
}

let active: MeasurementSync | undefined;

/** Starts syncing measurements for the open study (stopping the previous one), or stops when there is none. */
export function startMeasurementSync(source?: ImageSource): void {
  active?.dispose();
  active = source ? new MeasurementSync(source) : undefined;
}

/** Draws measurements that were waiting for their image's series to be shown. */
export function applyPendingMeasurements(): void {
  active?.apply();
}
