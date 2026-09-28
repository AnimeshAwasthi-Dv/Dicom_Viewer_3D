import { memo, useEffect, useRef, useState } from 'react';
import { Enums, type StackViewport } from '@cornerstonejs/core';
import { cancelActiveManipulations, utilities as toolUtilities } from '@cornerstonejs/tools';
import { selectCurrentSeries, useStudyStore } from '../../store/studyStore';
import { useViewerStore } from '../../store/viewerStore';
import { markFirstImage, markInteraction } from '../../viewer/cache/BackgroundWork';
import type { ViewportState } from '../../viewer/core/Viewport';
import { captureViewport, downloadBlob } from '../../viewer/cornerstone/capture';
import { RENDERING_ENGINE_ID, renderingEngine } from '../../viewer/cornerstone/engine';
import { initCornerstone } from '../../viewer/cornerstone/init';
import { applyPendingMeasurements } from '../../viewer/cornerstone/measurementSync';
import { stackToolGroup } from '../../viewer/cornerstone/tools';
import { applyCamera, applyWindow, orientationMarkers, readCamera, readWindow } from '../../viewer/cornerstone/viewportSync';
import { deviceProfile } from '../../viewer/core/DeviceProfile';
import type { Series } from '../../viewer/study/Series';
import { WindowPresets } from '../WindowPresets/WindowPresets';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const format = (value: number | undefined, digits = 1) => value !== undefined && Number.isFinite(value) ? value.toFixed(digits) : '--';

function viewportStateOf(id: string): ViewportState | undefined {
  return useViewerStore.getState().viewports.find((viewport) => viewport.id === id);
}

let prefetchConfigured = false;
/** Prefetch around the slice on screen, bounded so long CT/MR series can't take a phone's memory. */
function configurePrefetch(): void {
  if (prefetchConfigured) return;
  prefetchConfigured = true;
  const { constrained, prefetchAhead, prefetchBehind } = deviceProfile();
  toolUtilities.stackContextPrefetch.setConfiguration({
    maxImagesToPrefetch: prefetchAhead + prefetchBehind,
    minBefore: constrained ? 2 : 4,
    maxAfter: prefetchAhead,
    directionExtraImages: constrained ? 2 : 4,
    preserveExistingPool: false
  });
}

/** One 2D viewport: a Cornerstone stack viewport kept in step with the viewer store (and so with remote control). */
export const Viewport = memo(function Viewport({ viewport: state, series: seriesProp }: { viewport: ViewportState; series?: Series }): JSX.Element {
  const elementRef = useRef<HTMLDivElement>(null);
  const [stack, setStack] = useState<StackViewport>();
  const [imageId, setImageId] = useState<string>();
  const [imageCount, setImageCount] = useState(0);
  const [loading, setLoading] = useState(false);
  // True while this component is moving the viewport itself, so the events it causes aren't read back as user input.
  const applying = useRef(false);
  const source = useStudyStore((store) => store.imageSource);
  const studies = useStudyStore((store) => store.studies);
  const selectedSeriesId = useStudyStore((store) => store.selectedSeriesId);
  const addError = useStudyStore((store) => store.addError);
  const series = seriesProp ?? selectCurrentSeries(studies, selectedSeriesId);
  const cinePlaying = useViewerStore((store) => store.cinePlaying);
  const cineFps = useViewerStore((store) => store.cineFps);
  const id = state.id;

  // Enable the element with Cornerstone.
  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    let cancelled = false;
    let enabled = false;
    void initCornerstone().then(() => {
      if (cancelled) return;
      const engine = renderingEngine();
      engine.enableElement({ viewportId: id, element, type: Enums.ViewportType.STACK, defaultOptions: { background: [0, 0, 0] } });
      stackToolGroup().addViewport(id, RENDERING_ENGINE_ID);
      enabled = true;
      configurePrefetch();
      setStack(engine.getViewport(id) as StackViewport);
    }).catch((error: unknown) => addError(error instanceof Error ? error.message : 'The image renderer failed to start.'));
    return () => {
      cancelled = true;
      setStack(undefined);
      if (!enabled) return;
      toolUtilities.stackContextPrefetch.disable(element);
      stackToolGroup().removeViewports(RENDERING_ENGINE_ID, id);
      renderingEngine().disableElement(id);
    };
  }, [addError, id]);

  // Show the series, at the slice and presentation the store asks for.
  const seriesKey = series ? `${series.id}:${series.instances.length}` : '';
  useEffect(() => {
    const element = elementRef.current;
    if (!stack || !source || !series || !element) return;
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const loaded = await source.ensureSeries(series);
      const ids = source.imageIds(loaded);
      if (cancelled) return;
      if (!ids.length) throw new Error(`${series.description} has no displayable images.`);
      const desired = viewportStateOf(id);
      const index = clamp(desired?.instanceIndex ?? 0, 0, ids.length - 1);
      const current = stack.getImageIds();
      applying.current = true;
      try {
        if (current.length !== ids.length || current.some((imageId, position) => imageId !== ids[position])) {
          toolUtilities.stackContextPrefetch.disable(element);
          await stack.setStack(ids, index);
          if (cancelled) return;
        }
        if (desired?.windowInitialized) applyWindow(stack, desired.windowWidth, desired.windowCenter);
        if (desired) applyCamera(stack, desired.camera);
        stack.render();
      } finally {
        applying.current = false;
      }
      setImageCount(ids.length);
      setImageId(stack.getCurrentImageId());
      // Keep the store's window when the controller set one; otherwise report the image's own default.
      const shown = readWindow(stack);
      if (shown && !desired?.windowInitialized) useViewerStore.getState().setWindow(id, shown.width, shown.center, false);
      toolUtilities.stackContextPrefetch.enable(element);
      applyPendingMeasurements();
    })().catch((error: unknown) => {
      if (!cancelled) addError(error instanceof Error ? error.message : 'Unable to display this series.');
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // `seriesKey` covers a series whose instance list arrives later (DICOMweb).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addError, id, seriesKey, source, stack]);

  // Store -> viewport: slice, window and camera changes from the toolbar, keyboard or a remote controller.
  useEffect(() => {
    if (!stack) return;
    return useViewerStore.subscribe((store, previous) => {
      const next = store.viewports.find((viewport) => viewport.id === id);
      if (!next || next === previous.viewports.find((viewport) => viewport.id === id)) return;
      const count = stack.getImageIds().length;
      if (!count) return;
      applying.current = true;
      try {
        let changed = false;
        if (next.instanceIndex !== stack.getCurrentImageIdIndex() && next.instanceIndex < count) void stack.setImageIdIndex(next.instanceIndex);
        if (next.windowInitialized) changed = applyWindow(stack, next.windowWidth, next.windowCenter) || changed;
        changed = applyCamera(stack, next.camera) || changed;
        if (changed) stack.render();
      } finally {
        applying.current = false;
      }
    });
  }, [id, stack]);

  // Viewport -> store: what the user does with the tools.
  useEffect(() => {
    const element = elementRef.current;
    if (!stack || !element) return;
    let frame = 0;
    const publish = () => {
      frame = 0;
      const current = viewportStateOf(id);
      if (!current || !stack.getImageIds().length) return;
      const { setWindow, updateCamera } = useViewerStore.getState();
      const window = readWindow(stack);
      if (window && (Math.abs(window.width - current.windowWidth) > 1e-3 || Math.abs(window.center - current.windowCenter) > 1e-3)) setWindow(id, window.width, window.center);
      const camera = readCamera(stack);
      const before = current.camera;
      if (Math.abs(camera.zoom - before.zoom) > 1e-3 || Math.abs(camera.pan.x - before.pan.x) > 0.5 || Math.abs(camera.pan.y - before.pan.y) > 0.5 ||
        camera.rotation !== before.rotation || camera.flipH !== before.flipH || camera.flipV !== before.flipV || camera.inverted !== before.inverted) {
        updateCamera(id, camera);
      }
    };
    const onPresentation = () => {
      if (applying.current || frame) return;
      frame = requestAnimationFrame(publish);
    };
    const onNewImage = () => {
      const index = stack.getCurrentImageIdIndex();
      setImageId(stack.getCurrentImageId());
      if (viewportStateOf(id)?.instanceIndex !== index) useViewerStore.getState().setInstanceIndex(id, index);
    };
    const onRendered = () => markFirstImage();
    const onCancel = () => cancelActiveManipulations(element);
    window.addEventListener('viewer:cancel-measurement', onCancel);
    element.addEventListener(Enums.Events.VOI_MODIFIED, onPresentation);
    element.addEventListener(Enums.Events.CAMERA_MODIFIED, onPresentation);
    element.addEventListener(Enums.Events.STACK_NEW_IMAGE, onNewImage);
    element.addEventListener(Enums.Events.IMAGE_RENDERED, onRendered);
    const interaction = () => markInteraction();
    for (const name of ['wheel', 'pointerdown', 'touchstart'] as const) element.addEventListener(name, interaction, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('viewer:cancel-measurement', onCancel);
      element.removeEventListener(Enums.Events.VOI_MODIFIED, onPresentation);
      element.removeEventListener(Enums.Events.CAMERA_MODIFIED, onPresentation);
      element.removeEventListener(Enums.Events.STACK_NEW_IMAGE, onNewImage);
      element.removeEventListener(Enums.Events.IMAGE_RENDERED, onRendered);
      for (const name of ['wheel', 'pointerdown', 'touchstart'] as const) element.removeEventListener(name, interaction);
    };
  }, [id, stack]);

  // Cine.
  useEffect(() => {
    const element = elementRef.current;
    if (!stack || !element || !cinePlaying || imageCount < 2) return;
    toolUtilities.cine.playClip(element, { framesPerSecond: cineFps, loop: true });
    return () => toolUtilities.cine.stopClip(element);
  }, [cineFps, cinePlaying, imageCount, stack]);

  // PNG capture of the first viewport, from the toolbar, keyboard or export dialog.
  useEffect(() => {
    if (id !== 'viewport-1') return;
    const capture = () => {
      const element = elementRef.current;
      const metadata = imageId ? source?.locate(imageId)?.instance.metadata : undefined;
      if (!element || !metadata) return;
      const current = viewportStateOf(id);
      void captureViewport(element, {
        left: `${metadata.modality ?? ''} · ${series?.description ?? ''}`,
        right: `W ${format(current?.windowWidth, 0)} / L ${format(current?.windowCenter, 0)} · ${(current?.instanceIndex ?? 0) + 1}/${imageCount}`
      }).then((blob) => {
        const stem = (metadata.patientId ?? 'dicom').replace(/[^\w.-]+/g, '_');
        downloadBlob(blob, `${stem}-${(series?.description ?? 'series').replace(/[^\w.-]+/g, '_')}-${(current?.instanceIndex ?? 0) + 1}.png`);
      }).catch((error: unknown) => addError(error instanceof Error ? error.message : 'Capture failed.'));
    };
    window.addEventListener('viewer:export-screenshot', capture);
    return () => window.removeEventListener('viewer:export-screenshot', capture);
  }, [addError, id, imageCount, imageId, series?.description, source]);

  const metadata = imageId ? source?.locate(imageId)?.instance.metadata : undefined;
  // Only images that state their orientation get patient-orientation letters; guessed ones would mislead.
  const markers = stack && metadata?.imageOrientationPatient ? orientationMarkers(stack) : undefined;
  const count = imageCount || (series ? series.expectedImageCount ?? series.instances.length : 0);

  return (
    <div className={`viewport-wrap ${count <= 1 ? 'single-image' : ''}`} onContextMenu={(event) => event.preventDefault()}>
      <div ref={elementRef} className="cs-viewport" />
      <div className="viewport-overlay">
        <div className="ov top-left"><span>{metadata?.patientName ?? '--'}</span><span>{metadata?.patientId ?? '--'}</span></div>
        <div className="ov top-right"><span>{metadata?.modality ?? series?.modality ?? '--'}</span><span>{series?.description ?? '--'}</span></div>
        <div className="ov bottom-left">
          <span>WW {format(state.windowWidth, 0)} WL {format(state.windowCenter, 0)}</span>
          <span>{state.camera.zoom.toFixed(2)}x</span>
          <span>{count ? `${state.instanceIndex + 1} / ${count}` : '--'}</span>
        </div>
        <div className="ov bottom-right"><span>Thk {metadata?.sliceThickness ?? '--'}</span><span>Spacing {metadata?.pixelSpacing?.map((value) => format(value, 3)).join(' x ') ?? '--'}</span></div>
        {markers && <><div className="orientation top">{markers.top}</div><div className="orientation bottom">{markers.bottom}</div><div className="orientation left">{markers.left}</div><div className="orientation right">{markers.right}</div></>}
      </div>
      {loading && <div className="viewport-loading" role="status" aria-label="Loading series" />}
      <div className="viewport-controls">
        <WindowPresets viewportId={id} modality={metadata?.modality ?? series?.modality} voiPresets={metadata?.voiPresets} />
      </div>
      {count > 1 && (
        <div className="slice-scrubber">
          <span>{state.instanceIndex + 1}</span>
          <input
            type="range" aria-label="Image slice"
            min={0}
            max={Math.max(0, count - 1)}
            value={Math.min(state.instanceIndex, count - 1)}
            onChange={(event) => useViewerStore.getState().setInstanceIndex(id, Number(event.target.value))}
          />
          <span>{count}</span>
        </div>
      )}
      {!imageId && <div className="viewport-empty">Preparing {series?.description ?? 'viewport'}</div>}
    </div>
  );
});
