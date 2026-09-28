import { useEffect, useRef, useState } from 'react';
import {
  cache,
  Enums,
  eventTarget,
  setVolumesForViewports,
  utilities as csUtilities,
  volumeLoader,
  type Types,
  type VolumeViewport,
  type VolumeViewport3D
} from '@cornerstonejs/core';
import { CrosshairsTool, PanTool, StackScrollTool, ToolGroupManager, TrackballRotateTool, WindowLevelTool, ZoomTool, Enums as ToolEnums } from '@cornerstonejs/tools';
import { Box, Crosshair, Gauge, Move, RotateCcw, Search } from 'lucide-react';
import { selectCurrentSeries, useStudyStore } from '../../store/studyStore';
import { useUiStore } from '../../store/uiStore';
import { useRemoteControlStore } from '../../store/remoteControlStore';
import type { MprSettings } from '../../types/remote';
import { deviceProfile } from '../../viewer/core/DeviceProfile';
import { RENDERING_ENGINE_ID, renderingEngine } from '../../viewer/cornerstone/engine';
import { initCornerstone } from '../../viewer/cornerstone/init';
import { MPR_TOOL_GROUP, VOLUME_3D_TOOL_GROUP } from '../../viewer/cornerstone/tools';
import { toRange, toWindow } from '../../viewer/cornerstone/viewportSync';
import { imageCount } from '../../viewer/study/StudyManager';
import type { Series } from '../../viewer/study/Series';

type Plane = 'axial' | 'coronal' | 'sagittal';
const PLANES: Array<{ id: Plane; label: string; orientation: Enums.OrientationAxis }> = [
  { id: 'axial', label: 'Axial', orientation: Enums.OrientationAxis.AXIAL },
  { id: 'coronal', label: 'Coronal', orientation: Enums.OrientationAxis.CORONAL },
  { id: 'sagittal', label: 'Sagittal', orientation: Enums.OrientationAxis.SAGITTAL }
];
const VIEWPORT_ID: Record<Plane | 'volume', string> = { axial: 'mpr-axial', coronal: 'mpr-coronal', sagittal: 'mpr-sagittal', volume: 'mpr-3d' };

type VolumePreset = MprSettings['volumePreset'];
type RenderMode = MprSettings['renderMode'];
type Quality = MprSettings['volumeQuality'];

const VOLUME_PRESETS: Record<VolumePreset, { label: string; ct: string; mr: string; window: { width: number; center: number } }> = {
  lung: { label: 'Lung', ct: 'CT-Lung', mr: 'MR-Default', window: { width: 1500, center: -650 } },
  soft: { label: 'Soft tissue', ct: 'CT-Soft-Tissue', mr: 'MR-Default', window: { width: 420, center: 45 } },
  bone: { label: 'Bone', ct: 'CT-Bone', mr: 'MR-T2-Brain', window: { width: 2200, center: 450 } },
  mip: { label: 'MIP', ct: 'CT-MIP', mr: 'MR-MIP', window: { width: 1200, center: 300 } }
};
const RENDER_MODES: Record<RenderMode, { label: string; blend: Enums.BlendModes }> = {
  mpr: { label: 'MPR', blend: Enums.BlendModes.COMPOSITE },
  dvr: { label: 'Volume', blend: Enums.BlendModes.COMPOSITE },
  mip: { label: 'MIP', blend: Enums.BlendModes.MAXIMUM_INTENSITY_BLEND },
  minip: { label: 'MinIP', blend: Enums.BlendModes.MINIMUM_INTENSITY_BLEND },
  aip: { label: 'AIP', blend: Enums.BlendModes.AVERAGE_INTENSITY_BLEND }
};
/** Ray-casting step: larger is faster and coarser. */
const QUALITY: Record<Quality, { label: string; sampleDistance: number }> = {
  fast: { label: 'Fast', sampleDistance: 4 },
  hd: { label: 'HD', sampleDistance: 2 },
  ultra: { label: 'Ultra', sampleDistance: 1 }
};
type MprTool = 'crosshairs' | 'windowLevel' | 'pan' | 'zoom';
const MPR_TOOLS: Record<MprTool, { name: string; label: string; icon: JSX.Element }> = {
  crosshairs: { name: CrosshairsTool.toolName, label: 'Crosshairs', icon: <Crosshair size={15} /> },
  windowLevel: { name: WindowLevelTool.toolName, label: 'Window', icon: <Gauge size={15} /> },
  pan: { name: PanTool.toolName, label: 'Pan', icon: <Move size={15} /> },
  zoom: { name: ZoomTool.toolName, label: 'Zoom', icon: <Search size={15} /> }
};

const { MouseBindings } = ToolEnums;

function orthographic(plane: Plane): VolumeViewport {
  return renderingEngine().getViewport(VIEWPORT_ID[plane]) as VolumeViewport;
}

function volumeViewport(): VolumeViewport3D {
  return renderingEngine().getViewport(VIEWPORT_ID.volume) as VolumeViewport3D;
}

function createToolGroups(): void {
  if (!ToolGroupManager.getToolGroup(MPR_TOOL_GROUP)) {
    const group = ToolGroupManager.createToolGroup(MPR_TOOL_GROUP)!;
    [WindowLevelTool, PanTool, ZoomTool, StackScrollTool].forEach((tool) => group.addTool(tool.toolName));
    group.addTool(CrosshairsTool.toolName, {
      getReferenceLineColor: (viewportId: string) => ({ [VIEWPORT_ID.axial]: 'rgb(255, 99, 99)', [VIEWPORT_ID.coronal]: 'rgb(99, 255, 132)', [VIEWPORT_ID.sagittal]: 'rgb(99, 176, 255)' })[viewportId] ?? 'rgb(200, 200, 200)',
      mobile: { enabled: deviceProfile().constrained, opacity: 0.8 }
    });
  }
  if (!ToolGroupManager.getToolGroup(VOLUME_3D_TOOL_GROUP)) {
    const group = ToolGroupManager.createToolGroup(VOLUME_3D_TOOL_GROUP)!;
    [TrackballRotateTool, PanTool, ZoomTool].forEach((tool) => group.addTool(tool.toolName));
    group.setToolActive(TrackballRotateTool.toolName, { bindings: [{ mouseButton: MouseBindings.Primary }, { numTouchPoints: 1 }] });
    group.setToolActive(ZoomTool.toolName, { bindings: [{ mouseButton: MouseBindings.Secondary }, { mouseButton: MouseBindings.Wheel }, { numTouchPoints: 2 }] });
    group.setToolActive(PanTool.toolName, { bindings: [{ mouseButton: MouseBindings.Auxiliary }] });
  }
}

function setMprTool(tool: MprTool): void {
  const group = ToolGroupManager.getToolGroup(MPR_TOOL_GROUP);
  if (!group) return;
  for (const { name } of Object.values(MPR_TOOLS)) group.setToolPassive(name, { removeAllBindings: true });
  for (const [id, { name }] of Object.entries(MPR_TOOLS)) {
    const bindings: Array<{ mouseButton?: number; numTouchPoints?: number }> = [];
    if (id === tool) bindings.push({ mouseButton: MouseBindings.Primary }, { numTouchPoints: 1 });
    if (name === ZoomTool.toolName) bindings.push({ mouseButton: MouseBindings.Secondary }, { numTouchPoints: 2 });
    if (name === PanTool.toolName) bindings.push({ mouseButton: MouseBindings.Auxiliary });
    if (bindings.length) group.setToolActive(name, { bindings });
  }
  group.setToolActive(StackScrollTool.toolName, { bindings: [{ mouseButton: MouseBindings.Wheel }] });
}

/** The camera turned `degrees` about its up axis through the focal point (turntable rotation of the 3D view). */
function orbit(camera: Types.ICamera, degrees: number): Types.ICamera {
  const { position, focalPoint, viewUp } = camera;
  if (!position || !focalPoint || !viewUp) return camera;
  const angle = (degrees * Math.PI) / 180;
  const [kx, ky, kz] = viewUp;
  const v = [position[0] - focalPoint[0], position[1] - focalPoint[1], position[2] - focalPoint[2]];
  const cross = [ky * v[2] - kz * v[1], kz * v[0] - kx * v[2], kx * v[1] - ky * v[0]];
  const dot = kx * v[0] + ky * v[1] + kz * v[2];
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  // Rodrigues' rotation of the view direction about the up vector.
  const rotated = [0, 1, 2].map((axis) => v[axis] * cos + cross[axis] * sin + viewUp[axis] * dot * (1 - cos));
  return { ...camera, position: [focalPoint[0] + rotated[0], focalPoint[1] + rotated[1], focalPoint[2] + rotated[2]] as Types.Point3 };
}

/** The loaded volume's centre and largest extent in mm. */
function volumeFrame(): { center: Types.Point3; extent: number } | undefined {
  const volume = cache.getVolumes()[0];
  if (!volume) return undefined;
  const [x0, x1, y0, y1, z0, z1] = volume.imageData?.getBounds() ?? [0, 0, 0, 0, 0, 0];
  return {
    center: [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2],
    extent: Math.max(1, ...volume.dimensions.map((size, axis) => size * volume.spacing[axis]))
  };
}

/** Slab thickness in mm for a fraction of the volume's largest extent (remote state stores the fraction). */
function slabMillimetres(fraction: number): number {
  const frame = volumeFrame();
  return frame ? Math.max(0.5, fraction * frame.extent) : 1;
}

/**
 * Remote state gives the 3D camera relative to the volume: offsets from its centre in units of its largest extent.
 * That keeps the numbers small and independent of where the scanner put the patient.
 */
function toRelative(point: Types.Point3): [number, number, number] {
  const frame = volumeFrame();
  if (!frame) return [0, 0, 0];
  return point.map((value, axis) => Math.max(-100, Math.min(100, (value - frame.center[axis]) / frame.extent))) as [number, number, number];
}

function fromRelative(point: [number, number, number]): Types.Point3 {
  const frame = volumeFrame();
  if (!frame) return point;
  return point.map((value, axis) => frame.center[axis] + value * frame.extent) as Types.Point3;
}

/**
 * MPR and 3D on the GPU: three orthogonal reconstructions linked by crosshairs, with slab MIP / MinIP / average, and a
 * ray-cast volume rendering. The volume streams in, so planes fill in while it loads.
 */
export function MprViewer({ series: seriesProp }: { series?: Series }): JSX.Element {
  const source = useStudyStore((state) => state.imageSource);
  const studies = useStudyStore((state) => state.studies);
  const selectedSeriesId = useStudyStore((state) => state.selectedSeriesId);
  const series = seriesProp ?? selectCurrentSeries(studies, selectedSeriesId);
  const setMprOpen = useUiStore((state) => state.setMprOpen);
  const mprRequest = useRemoteControlStore((state) => state.mprRequest);
  const elements = useRef<Record<Plane | 'volume', HTMLDivElement | null>>({ axial: null, coronal: null, sagittal: null, volume: null });
  const [ready, setReady] = useState(false);
  const [progress, setProgress] = useState<{ loaded: number; total: number }>();
  const [error, setError] = useState<string>();
  const [tool, setTool] = useState<MprTool>('crosshairs');
  const [volumePreset, setVolumePreset] = useState<VolumePreset>('soft');
  const [renderMode, setRenderMode] = useState<RenderMode>('mpr');
  const [slab, setSlab] = useState(0.05);
  const [quality, setQuality] = useState<Quality>(() => (deviceProfile().constrained ? 'fast' : 'hd'));
  const [autoRotate, setAutoRotate] = useState(false);
  const [sliceInfo, setSliceInfo] = useState<Record<Plane, { index: number; count: number }>>();
  const modality = series?.modality === 'MR' ? 'mr' : 'ct';

  // Build the viewports and stream the volume.
  useEffect(() => {
    if (!source || !series) return;
    let cancelled = false;
    const volumeId = `cornerstoneStreamingImageVolume:${series.id}`;
    setReady(false);
    setError(undefined);
    const onProgress = (event: Event) => {
      const detail = (event as CustomEvent<{ volumeId: string; numberOfFrames: number; framesProcessed: number }>).detail;
      if (detail.volumeId === volumeId) setProgress(detail.framesProcessed >= detail.numberOfFrames ? undefined : { loaded: detail.framesProcessed, total: detail.numberOfFrames });
    };
    eventTarget.addEventListener(Enums.Events.IMAGE_VOLUME_MODIFIED, onProgress);
    void (async () => {
      await initCornerstone();
      createToolGroups();
      const loaded = await source.ensureSeries(series);
      const imageIds = source.imageIds(loaded);
      if (imageIds.length < 2) throw new Error('3D MPR needs a series with at least two slices.');
      if (cancelled) return;
      setProgress({ loaded: 0, total: imageIds.length });
      const engine = renderingEngine();
      const inputs: Types.PublicViewportInput[] = [
        ...PLANES.map((plane) => ({
          viewportId: VIEWPORT_ID[plane.id],
          element: elements.current[plane.id]!,
          type: Enums.ViewportType.ORTHOGRAPHIC,
          defaultOptions: { orientation: plane.orientation, background: [0, 0, 0] as Types.Point3 }
        })),
        { viewportId: VIEWPORT_ID.volume, element: elements.current.volume!, type: Enums.ViewportType.VOLUME_3D, defaultOptions: { background: [0.02, 0.04, 0.06] as Types.Point3 } }
      ];
      inputs.forEach((input) => engine.enableElement(input));
      const mprGroup = ToolGroupManager.getToolGroup(MPR_TOOL_GROUP)!;
      PLANES.forEach((plane) => mprGroup.addViewport(VIEWPORT_ID[plane.id], RENDERING_ENGINE_ID));
      ToolGroupManager.getToolGroup(VOLUME_3D_TOOL_GROUP)!.addViewport(VIEWPORT_ID.volume, RENDERING_ENGINE_ID);
      const volume = await volumeLoader.createAndCacheVolume(volumeId, { imageIds });
      if (cancelled) return;
      void (volume as { load?: () => void }).load?.();
      await setVolumesForViewports(engine, [{ volumeId }], Object.values(VIEWPORT_ID));
      if (cancelled) return;
      setMprTool('crosshairs');
      setReady(true);
    })().catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : 'The volume could not be built.'); });
    return () => {
      cancelled = true;
      eventTarget.removeEventListener(Enums.Events.IMAGE_VOLUME_MODIFIED, onProgress);
      ToolGroupManager.getToolGroup(MPR_TOOL_GROUP)?.removeViewports(RENDERING_ENGINE_ID);
      ToolGroupManager.getToolGroup(VOLUME_3D_TOOL_GROUP)?.removeViewports(RENDERING_ENGINE_ID);
      const engine = renderingEngine();
      Object.values(VIEWPORT_ID).forEach((viewportId) => { if (engine.getViewport(viewportId)) engine.disableElement(viewportId); });
      cache.removeVolumeLoadObject(volumeId);
    };
  }, [series, source]);

  // Controller requests (remote-control `mpr` settings).
  useEffect(() => {
    if (!ready || !mprRequest) return;
    const { settings } = mprRequest;
    setVolumePreset(settings.volumePreset);
    setRenderMode(settings.renderMode);
    setSlab(settings.slabThickness);
    setQuality(settings.volumeQuality);
    setAutoRotate(settings.autoRotate);
    for (const plane of PLANES) {
      const element = elements.current[plane.id];
      if (element) void csUtilities.jumpToSlice(element, { imageIndex: settings.indices[plane.id] });
    }
    for (const plane of PLANES) {
      orthographic(plane.id).setProperties({ voiRange: toRange(settings.windowWidth, settings.windowCenter) });
    }
    if (settings.camera) volumeViewport().setCamera({ position: fromRelative(settings.camera.position), focalPoint: fromRelative(settings.camera.target) });
    renderingEngine().renderViewports(Object.values(VIEWPORT_ID));
  }, [mprRequest, ready]);

  // Blend mode and slab on the three planes.
  useEffect(() => {
    if (!ready) return;
    const { blend } = RENDER_MODES[renderMode];
    for (const plane of PLANES) {
      const viewport = orthographic(plane.id);
      viewport.setBlendMode(blend);
      if (blend === Enums.BlendModes.COMPOSITE) viewport.resetSlabThickness();
      else viewport.setSlabThickness(slabMillimetres(slab));
    }
    renderingEngine().renderViewports(PLANES.map((plane) => VIEWPORT_ID[plane.id]));
  }, [ready, renderMode, slab]);

  // 3D appearance.
  useEffect(() => {
    if (!ready) return;
    const viewport = volumeViewport();
    viewport.setProperties({ preset: VOLUME_PRESETS[volumePreset][modality], sampleDistanceMultiplier: QUALITY[quality].sampleDistance });
    viewport.render();
  }, [modality, quality, ready, volumePreset]);

  useEffect(() => {
    if (!ready || !autoRotate) return;
    let frame = requestAnimationFrame(function spin() {
      const viewport = volumeViewport();
      viewport.setCamera(orbit(viewport.getCamera(), 0.6));
      viewport.render();
      frame = requestAnimationFrame(spin);
    });
    return () => cancelAnimationFrame(frame);
  }, [autoRotate, ready]);

  useEffect(() => { if (ready) setMprTool(tool); }, [ready, tool]);

  // Slice positions for the overlays, and the actual settings reported back to a controller.
  useEffect(() => {
    if (!ready) return;
    const report = () => {
      const info = Object.fromEntries(PLANES.map((plane) => {
        const viewport = orthographic(plane.id);
        return [plane.id, { index: viewport.getSliceIndex(), count: viewport.getNumberOfSlices() }];
      })) as Record<Plane, { index: number; count: number }>;
      setSliceInfo(info);
      const voi = toWindow(orthographic('axial').getProperties()?.voiRange);
      const camera = volumeViewport().getCamera();
      const preset = VOLUME_PRESETS[volumePreset];
      useRemoteControlStore.setState({
        mprActual: {
          indices: { axial: info.axial.index, coronal: info.coronal.index, sagittal: info.sagittal.index },
          windowWidth: Math.max(1, voi?.width ?? preset.window.width),
          windowCenter: voi?.center ?? preset.window.center,
          volumePreset, renderMode,
          volumeWindowWidth: preset.window.width, volumeWindowCenter: preset.window.center,
          volumeOpacity: 0.4, slabThickness: slab, volumeQuality: quality, fourDCine: false, autoRotate,
          ...(camera.position && camera.focalPoint ? { camera: { position: toRelative(camera.position), target: toRelative(camera.focalPoint) } } : {})
        }
      });
    };
    report();
    const elementsNow = [...PLANES.map((plane) => elements.current[plane.id]), elements.current.volume].filter((element): element is HTMLDivElement => Boolean(element));
    elementsNow.forEach((element) => element.addEventListener(Enums.Events.CAMERA_MODIFIED, report));
    return () => elementsNow.forEach((element) => element.removeEventListener(Enums.Events.CAMERA_MODIFIED, report));
  }, [autoRotate, quality, ready, renderMode, slab, volumePreset]);

  const tooShort = series ? imageCount(series) < 2 : true;

  return (
    <div className="mpr-workspace">
      <div className="mpr-header">
        <div>
          <strong>3D MPR</strong>
          <span>{series?.description ?? 'No series'}</span>
        </div>
        <button title="Return to standard viewer" onClick={() => setMprOpen(false)}><RotateCcw size={16} /><span>Viewer</span></button>
      </div>

      {progress && !error && <div className="mpr-loading"><strong>Loading volume</strong><span>{progress.loaded} / {progress.total} slices</span></div>}
      {(error || tooShort) && <div className="mpr-loading error"><strong>MPR unavailable</strong><span>{error ?? '3D MPR needs a series with at least two slices.'}</span></div>}

      <div className="mpr-grid">
        <section className="mpr-plane mpr-model">
          <div ref={(node) => { elements.current.volume = node; }} className="cs-viewport" onContextMenu={(event) => event.preventDefault()} />
          <div className="mpr-plane-overlay"><strong>3D Volume</strong><span>{VOLUME_PRESETS[volumePreset].label}</span></div>
        </section>
        {PLANES.map((plane) => (
          <section key={plane.id} className={`mpr-plane mpr-${plane.id}`}>
            <div ref={(node) => { elements.current[plane.id] = node; }} className="cs-viewport" onContextMenu={(event) => event.preventDefault()} />
            <div className="mpr-plane-overlay">
              <strong>{plane.label}</strong>
              <span>{sliceInfo ? `${sliceInfo[plane.id].index + 1} / ${sliceInfo[plane.id].count}` : ''}</span>
            </div>
          </section>
        ))}
      </div>

      <div className="mpr-controls">
        <div className="mpr-tools" role="group" aria-label="MPR tools">
          {(Object.entries(MPR_TOOLS) as Array<[MprTool, typeof MPR_TOOLS[MprTool]]>).map(([id, item]) => (
            <button key={id} className={tool === id ? 'active' : ''} aria-pressed={tool === id} title={item.label} onClick={() => setTool(id)}>{item.icon}<span>{item.label}</span></button>
          ))}
        </div>
        <label>Mode
          <select value={renderMode} onChange={(event) => setRenderMode(event.target.value as RenderMode)}>
            {Object.entries(RENDER_MODES).map(([id, mode]) => <option key={id} value={id}>{mode.label}</option>)}
          </select>
        </label>
        <label>Slab <input type="range" min={0.03} max={0.5} step={0.01} value={slab} disabled={RENDER_MODES[renderMode].blend === Enums.BlendModes.COMPOSITE} onChange={(event) => setSlab(Number(event.target.value))} /></label>
        <label>3D
          <select value={volumePreset} onChange={(event) => setVolumePreset(event.target.value as VolumePreset)}>
            {Object.entries(VOLUME_PRESETS).map(([id, preset]) => <option key={id} value={id}>{preset.label}</option>)}
          </select>
        </label>
        <label>Quality
          <select value={quality} onChange={(event) => setQuality(event.target.value as Quality)}>
            {Object.entries(QUALITY).map(([id, item]) => <option key={id} value={id}>{item.label}</option>)}
          </select>
        </label>
        <label><input type="checkbox" checked={autoRotate} onChange={(event) => setAutoRotate(event.target.checked)} /> Rotate</label>
        <span><Box size={14} /> Drag in 3D to rotate</span>
      </div>
    </div>
  );
}
