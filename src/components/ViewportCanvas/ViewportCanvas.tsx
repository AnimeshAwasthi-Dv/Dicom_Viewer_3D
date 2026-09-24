import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DecodedFrame } from '../../types/dicom';
import { useMeasurementStore } from '../../store/measurementStore';
import { selectCurrentSeries, useStudyStore } from '../../store/studyStore';
import { useUiStore } from '../../store/uiStore';
import { useViewerStore } from '../../store/viewerStore';
import { FrameLoadScheduler } from '../../viewer/cache/FrameLoadScheduler';
import type { ViewportState } from '../../viewer/core/Viewport';
import { screenToViewport, viewportToImage, imageToViewport, pixelDistanceMm, type Point } from '../../viewer/measurements/CoordinateTransforms';
import { computeAngle, computeRoiStats } from '../../viewer/measurements/MeasurementManager';
import type { Measurement, MeasurementType } from '../../viewer/measurements/Measurement';
import { WebGLRenderer } from '../../viewer/rendering/WebGLRenderer';
import { modalityUnit } from '../../viewer/codecs/RawDecoder';
import type { Series } from '../../viewer/study/Series';
import { WindowPresets } from '../WindowPresets/WindowPresets';

type Draft = { type: MeasurementType; points: Point[] };
type PendingAnnotation = { point: Point; viewportPoint: Point; text: string };

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function formatNumber(value: number, digits = 1): string {
  return Number.isFinite(value) ? value.toFixed(digits) : '--';
}

function initialWindow(frame: DecodedFrame): { width: number; center: number } {
  const metadataWidth = frame.metadata.windowWidth;
  const metadataCenter = frame.metadata.windowCenter;
  if (metadataWidth && metadataWidth > 1 && metadataCenter !== undefined) {
    return { width: metadataWidth, center: metadataCenter };
  }
  const min = Number.isFinite(frame.min) ? frame.min : 0;
  const max = Number.isFinite(frame.max) ? frame.max : 255;
  const width = Math.max(1, max - min);
  return { width, center: min + width / 2 };
}

export function ViewportCanvas({ viewport, series }: { viewport: ViewportState; series?: Series }): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<WebGLRenderer>();
  const scheduler = useMemo(() => new FrameLoadScheduler(), []);
  const [currentFrame, setCurrentFrame] = useState<DecodedFrame>();
  const [draft, setDraft] = useState<Draft>();
  const [pendingAnnotation, setPendingAnnotation] = useState<PendingAnnotation>();
  const dragRef = useRef<{ tool: string; start: Point; last: Point; windowWidth: number; windowCenter: number }>();
  const activePointers = useRef(new Map<number, Point>());
  const pinchRef = useRef<{ distance: number; midpoint: Point; zoom: number; pan: Point }>();
  const zScrollZoomRef = useRef(false);
  const { imageSource, studies, selectedSeriesId, addError } = useStudyStore();
  const currentSeries = series ?? selectCurrentSeries(studies, selectedSeriesId);
  const { setFrame, setRenderTime, setInstanceIndex, setWindow, updateCamera, cinePlaying, cineFps } = useViewerStore();
  const activeTool = useUiStore((state) => state.activeTool);
  const addMeasurement = useMeasurementStore((state) => state.addMeasurement);
  const measurements = useMeasurementStore((state) => state.measurements);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      rendererRef.current = new WebGLRenderer(canvas);
    } catch (error) {
      addError(error instanceof Error ? error.message : 'WebGL2 renderer failed.');
    }
    return () => rendererRef.current?.dispose();
  }, [addError]);

  useEffect(() => {
    if (!imageSource || !currentSeries) return;
    setCurrentFrame(undefined);
    scheduler.loadPriority(imageSource, currentSeries, viewport.instanceIndex, (index, frame) => {
      if (index === viewport.instanceIndex) {
        setFrame(index, frame);
        setCurrentFrame(frame);
        if (!viewport.windowInitialized) {
          const window = initialWindow(frame);
          setWindow(viewport.id, window.width, window.center);
        }
      }
    }, addError);
    return () => scheduler.cancel();
  }, [addError, currentSeries, imageSource, scheduler, setFrame, setWindow, viewport.id, viewport.instanceIndex, viewport.windowInitialized]);

  useEffect(() => {
    if (!cinePlaying || !currentSeries) return;
    const interval = window.setInterval(() => {
      setInstanceIndex(viewport.id, (viewport.instanceIndex + 1) % currentSeries.instances.length);
    }, 1000 / cineFps);
    return () => window.clearInterval(interval);
  }, [cineFps, cinePlaying, currentSeries, setInstanceIndex, viewport.id, viewport.instanceIndex]);

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    const renderer = rendererRef.current;
    if (!canvas || !renderer || !currentFrame) return;
    const rect = canvas.getBoundingClientRect();
    renderer.resize(rect.width, rect.height);
    setRenderTime(renderer.render(currentFrame, { windowWidth: viewport.windowWidth, windowCenter: viewport.windowCenter, camera: viewport.camera }));
  }, [currentFrame, setRenderTime, viewport.camera, viewport.windowCenter, viewport.windowWidth]);

  useEffect(() => {
    render();
    const observer = new ResizeObserver(render);
    if (canvasRef.current) observer.observe(canvasRef.current);
    return () => observer.disconnect();
  }, [render]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !currentSeries) return;
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      if (zScrollZoomRef.current) {
        const zoomFactor = Math.exp(-event.deltaY * 0.0015);
        updateCamera(viewport.id, { zoom: clamp(viewport.camera.zoom * zoomFactor, 0.1, 20) });
        return;
      }
      setInstanceIndex(viewport.id, clamp(viewport.instanceIndex + (event.deltaY > 0 ? 1 : -1), 0, currentSeries.instances.length - 1));
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [currentSeries, setInstanceIndex, updateCamera, viewport.camera.zoom, viewport.id, viewport.instanceIndex]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key.toLowerCase() === 'z' && !event.ctrlKey && !event.metaKey && !event.altKey) zScrollZoomRef.current = true;
    };
    const onKeyUp = (event: KeyboardEvent): void => {
      if (event.key.toLowerCase() === 'z') zScrollZoomRef.current = false;
    };
    const onBlur = (): void => {
      zScrollZoomRef.current = false;
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  useEffect(() => {
    const cancel = () => setDraft(undefined);
    const exportScreenshot = () => {
      const canvas = canvasRef.current;
      if (!canvas || !currentFrame) return;
      const link = document.createElement('a');
      link.href = canvas.toDataURL('image/png');
      link.download = `${currentFrame.metadata.patientId ?? 'dicom'}-${currentFrame.metadata.sopInstanceUID}.png`;
      link.click();
    };
    window.addEventListener('viewer:cancel-measurement', cancel);
    window.addEventListener('viewer:export-screenshot', exportScreenshot);
    return () => {
      window.removeEventListener('viewer:cancel-measurement', cancel);
      window.removeEventListener('viewer:export-screenshot', exportScreenshot);
    };
  }, [currentFrame]);

  const imagePointFromEvent = (event: React.PointerEvent | React.MouseEvent): Point | undefined => {
    const canvas = canvasRef.current;
    if (!canvas || !currentFrame) return undefined;
    const rect = canvas.getBoundingClientRect();
    const vp = screenToViewport({ x: event.clientX, y: event.clientY }, rect);
    return viewportToImage(vp, viewport.camera, rect.width, rect.height, currentFrame.metadata.columns, currentFrame.metadata.rows);
  };

  const viewportPointFromEvent = (event: React.PointerEvent | React.MouseEvent): Point | undefined => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    return screenToViewport({ x: event.clientX, y: event.clientY }, canvas.getBoundingClientRect());
  };

  const startPinchIfNeeded = (): boolean => {
    const points = Array.from(activePointers.current.values());
    if (points.length < 2) return false;
    const [a, b] = points;
    pinchRef.current = {
      distance: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)),
      midpoint: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      zoom: viewport.camera.zoom,
      pan: { ...viewport.camera.pan }
    };
    setDraft(undefined);
    setPendingAnnotation(undefined);
    return true;
  };

  const createMeasurement = (type: MeasurementType, points: Point[]): Measurement | undefined => {
    if (!currentFrame) return undefined;
    const base = {
      id: crypto.randomUUID(),
      type,
      studyInstanceUID: currentFrame.metadata.studyInstanceUID,
      seriesInstanceUID: currentFrame.metadata.seriesInstanceUID,
      sopInstanceUID: currentFrame.metadata.sopInstanceUID,
      frameOfReferenceUID: currentFrame.metadata.frameOfReferenceUID,
      points,
      createdAt: new Date().toISOString()
    };
    if (type === 'length' && points.length >= 2) {
      const value = pixelDistanceMm(points[0], points[1], currentFrame.metadata.pixelSpacing);
      return { ...base, value: value.value, unit: value.unit, label: `${formatNumber(value.value)} ${value.unit}` };
    }
    if (type === 'angle' && points.length >= 3) {
      const value = computeAngle(points[0], points[1], points[2]);
      return { ...base, value, unit: 'deg', label: `${formatNumber(value)} deg` };
    }
    if ((type === 'rectangleRoi' || type === 'ellipseRoi') && points.length >= 2) {
      const stats = computeRoiStats(currentFrame, points[0], points[1], type === 'ellipseRoi');
      return { ...base, stats, label: `Mean ${formatNumber(stats.mean)} ${stats.unit}` };
    }
    if (type === 'probe' && points.length >= 1) {
      const x = clamp(Math.round(points[0].x), 0, currentFrame.metadata.columns - 1);
      const y = clamp(Math.round(points[0].y), 0, currentFrame.metadata.rows - 1);
      const value = currentFrame.modalityPixels[y * currentFrame.metadata.columns + x];
      const unit = modalityUnit(currentFrame.metadata.modality);
      return { ...base, value, unit, label: `X ${x} Y ${y} ${formatNumber(value)} ${unit}` };
    }
    if (type === 'annotation' && points.length >= 1) {
      return { ...base, label: '' };
    }
    return undefined;
  };

  const onPointerDown = (event: React.PointerEvent): void => {
    if (!currentFrame) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = imagePointFromEvent(event);
    const viewportPoint = viewportPointFromEvent(event);
    if (viewportPoint) {
      activePointers.current.set(event.pointerId, viewportPoint);
      if (event.pointerType === 'touch' && startPinchIfNeeded()) return;
    }
    if (!point) return;
    if (activeTool === 'annotation' && viewportPoint) {
      setPendingAnnotation({ point, viewportPoint, text: '' });
      return;
    }
    dragRef.current = { tool: event.button === 1 ? 'pan' : event.button === 2 ? 'zoom' : activeTool, start: point, last: point, windowWidth: viewport.windowWidth, windowCenter: viewport.windowCenter };
    if (['length', 'rectangleRoi', 'ellipseRoi'].includes(activeTool)) setDraft({ type: activeTool as MeasurementType, points: [point, point] });
    if (activeTool === 'probe') {
      const measurement = createMeasurement('probe', [point]);
      if (measurement) addMeasurement(measurement);
    }
    if (activeTool === 'angle') {
      setDraft((prev) => ({ type: 'angle', points: [...(prev?.points ?? []), point].slice(0, 3) }));
    }
  };

  const onPointerMove = (event: React.PointerEvent): void => {
    const viewportPoint = viewportPointFromEvent(event);
    if (viewportPoint && activePointers.current.has(event.pointerId)) {
      activePointers.current.set(event.pointerId, viewportPoint);
      const pinch = pinchRef.current;
      const points = Array.from(activePointers.current.values());
      if (pinch && points.length >= 2) {
        const [a, b] = points;
        const distance = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
        const midpoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        updateCamera(viewport.id, {
          zoom: clamp(pinch.zoom * (distance / pinch.distance), 0.1, 20),
          pan: {
            x: pinch.pan.x + midpoint.x - pinch.midpoint.x,
            y: pinch.pan.y + midpoint.y - pinch.midpoint.y
          }
        });
        return;
      }
    }
    const drag = dragRef.current;
    if (!drag || !currentFrame) return;
    const point = imagePointFromEvent(event);
    if (!point) return;
    const dx = event.movementX;
    const dy = event.movementY;
    if (drag.tool === 'windowLevel') setWindow(viewport.id, Math.max(1, drag.windowWidth + (point.x - drag.start.x) * 2), drag.windowCenter - (point.y - drag.start.y) * 2);
    if (drag.tool === 'pan') updateCamera(viewport.id, { pan: { x: viewport.camera.pan.x + dx, y: viewport.camera.pan.y + dy } });
    if (drag.tool === 'zoom') updateCamera(viewport.id, { zoom: clamp(viewport.camera.zoom * (1 - dy * 0.01), 0.1, 20) });
    if (draft && ['length', 'rectangleRoi', 'ellipseRoi'].includes(draft.type)) setDraft({ ...draft, points: [draft.points[0], point] });
    drag.last = point;
  };

  const onPointerUp = (event: React.PointerEvent): void => {
    activePointers.current.delete(event.pointerId);
    if (activePointers.current.size < 2) pinchRef.current = undefined;
    const drag = dragRef.current;
    dragRef.current = undefined;
    if (draft && draft.type !== 'angle') {
      const measurement = createMeasurement(draft.type, draft.points);
      if (measurement) addMeasurement(measurement);
      setDraft(undefined);
    } else if (draft?.type === 'angle' && draft.points.length === 3) {
      const measurement = createMeasurement('angle', draft.points);
      if (measurement) addMeasurement(measurement);
      setDraft(undefined);
    }
    if (drag) render();
  };

  const visibleMeasurements = measurements.filter((measurement) => measurement.sopInstanceUID === currentFrame?.metadata.sopInstanceUID);
  const allOverlayMeasurements = draft ? [...visibleMeasurements, { id: 'draft', type: draft.type, points: draft.points, label: '' } as Measurement] : visibleMeasurements;

  return (
    <div className={`viewport-wrap ${(currentSeries?.instances.length ?? 0) <= 1 ? 'single-image' : ''}`} onContextMenu={(event) => event.preventDefault()}>
      <canvas
        ref={canvasRef}
        className="viewport-canvas"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
      <Overlay frame={currentFrame} viewport={viewport} series={currentSeries} measurements={allOverlayMeasurements} />
      {pendingAnnotation && (
        <form
          className="annotation-editor"
          style={{ left: pendingAnnotation.viewportPoint.x, top: pendingAnnotation.viewportPoint.y }}
          onSubmit={(event) => {
            event.preventDefault();
            const label = pendingAnnotation.text.trim();
            if (label && currentFrame) {
              const measurement = createMeasurement('annotation', [pendingAnnotation.point]);
              if (measurement) addMeasurement({ ...measurement, label });
            }
            setPendingAnnotation(undefined);
          }}
        >
          <input
            autoFocus
            value={pendingAnnotation.text}
            placeholder="Annotation"
            onChange={(event) => setPendingAnnotation({ ...pendingAnnotation, text: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setPendingAnnotation(undefined);
            }}
          />
          <button type="submit">Add</button>
        </form>
      )}
      <div className="viewport-controls">
        <WindowPresets viewportId={viewport.id} modality={currentFrame?.metadata.modality} />
      </div>
      {currentSeries && currentSeries.instances.length > 1 && (
        <div className="slice-scrubber">
          <span>{viewport.instanceIndex + 1}</span>
          <input
            type="range" aria-label="Image slice"
            min={0}
            max={Math.max(0, currentSeries.instances.length - 1)}
            value={viewport.instanceIndex}
            onChange={(event) => setInstanceIndex(viewport.id, Number(event.target.value))}
          />
          <span>{currentSeries.instances.length}</span>
        </div>
      )}
      {!currentFrame && <div className="viewport-empty">Preparing {currentSeries?.description ?? 'viewport'}</div>}
    </div>
  );
}

function Overlay({ frame, viewport, series, measurements }: { frame?: DecodedFrame; viewport: ViewportState; series?: Series; measurements: Measurement[] }): JSX.Element {
  const canvas = document.querySelector('.viewport-canvas') as HTMLCanvasElement | null;
  const rect = canvas?.getBoundingClientRect();
  const width = rect?.width ?? 1;
  const height = rect?.height ?? 1;
  const toVp = (point: Point) => frame ? imageToViewport(point, viewport.camera, width, height, frame.metadata.columns, frame.metadata.rows) : point;

  return (
    <div className="viewport-overlay">
      <div className="ov top-left"><span>{frame?.metadata.patientName ?? '--'}</span><span>{frame?.metadata.patientId ?? '--'}</span></div>
      <div className="ov top-right"><span>{frame?.metadata.modality ?? '--'}</span><span>{series?.description ?? '--'}</span></div>
      <div className="ov bottom-left"><span>WW {formatNumber(viewport.windowWidth, 0)} WL {formatNumber(viewport.windowCenter, 0)}</span><span>{viewport.camera.zoom.toFixed(2)}x</span><span>{series ? `${viewport.instanceIndex + 1} / ${series.instances.length}` : '--'}</span></div>
      <div className="ov bottom-right"><span>Thk {frame?.metadata.sliceThickness ?? '--'}</span><span>Spacing {frame?.metadata.pixelSpacing?.join(' x ') ?? '--'}</span></div>
      <div className="orientation top">A</div><div className="orientation bottom">P</div><div className="orientation left">R</div><div className="orientation right">L</div>
      <svg className="measurement-layer">
        {measurements.map((measurement) => <MeasurementOverlay key={measurement.id} measurement={measurement} toVp={toVp} />)}
      </svg>
    </div>
  );
}

function MeasurementOverlay({ measurement, toVp }: { measurement: Measurement; toVp: (point: Point) => Point }): JSX.Element | null {
  const points = measurement.points.map(toVp);
  if (measurement.type === 'length' && points.length >= 2) {
    return <g><line className="measure-shape" x1={points[0].x} y1={points[0].y} x2={points[1].x} y2={points[1].y} /><text x={(points[0].x + points[1].x) / 2 + 8} y={(points[0].y + points[1].y) / 2}>{measurement.label}</text></g>;
  }
  if (measurement.type === 'angle' && points.length >= 2) {
    return <g>{points.length >= 3 && <line className="measure-shape" x1={points[1].x} y1={points[1].y} x2={points[2].x} y2={points[2].y} />}<line className="measure-shape" x1={points[0].x} y1={points[0].y} x2={points[1].x} y2={points[1].y} /><text x={points[1].x + 8} y={points[1].y - 8}>{measurement.label}</text></g>;
  }
  if ((measurement.type === 'rectangleRoi' || measurement.type === 'ellipseRoi') && points.length >= 2) {
    const x = Math.min(points[0].x, points[1].x);
    const y = Math.min(points[0].y, points[1].y);
    const w = Math.abs(points[1].x - points[0].x);
    const h = Math.abs(points[1].y - points[0].y);
    return <g>{measurement.type === 'ellipseRoi' ? <ellipse className="measure-shape" cx={x + w / 2} cy={y + h / 2} rx={w / 2} ry={h / 2} /> : <rect className="measure-shape" x={x} y={y} width={w} height={h} />}<text x={x + w + 8} y={y + 14}>{measurement.label}</text>{measurement.stats && <text x={x + w + 8} y={y + 32}>Min {formatNumber(measurement.stats.min)} Max {formatNumber(measurement.stats.max)}</text>}</g>;
  }
  if (measurement.type === 'probe' && points.length >= 1) {
    return <g><circle className="measure-shape" cx={points[0].x} cy={points[0].y} r={4} /><text x={points[0].x + 8} y={points[0].y - 8}>{measurement.label}</text></g>;
  }
  if (measurement.type === 'annotation' && points.length >= 1) {
    return <g><line className="annotation-leader" x1={points[0].x} y1={points[0].y} x2={points[0].x + 20} y2={points[0].y - 18} /><circle className="measure-shape" cx={points[0].x} cy={points[0].y} r={3} /><text className="annotation-text" x={points[0].x + 24} y={points[0].y - 20}>{measurement.label}</text></g>;
  }
  return null;
}
