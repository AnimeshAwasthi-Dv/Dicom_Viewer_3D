import type { Series } from '../../viewer/study/Series';
import { lazy, Suspense, useEffect } from 'react';
import { Enums, eventTarget } from '@cornerstonejs/core';
import { useUiStore } from '../../store/uiStore';
import { useViewerStore } from '../../store/viewerStore';
import { Viewport } from '../Viewport/Viewport';
import { selectCurrentSeries, useStudyStore } from '../../store/studyStore';
import { initCornerstone } from '../../viewer/cornerstone/init';
import { startMeasurementSync } from '../../viewer/cornerstone/measurementSync';
import { setPrimaryTool, stackToolGroup } from '../../viewer/cornerstone/tools';

const MprViewer = lazy(() => import('../MprViewer/MprViewer').then(module => ({ default: module.MprViewer })));

export function ViewportGrid({ series }: { series?: Series }): JSX.Element {
  const layout = useViewerStore((state) => state.layout);
  const viewports = useViewerStore((state) => state.viewports);
  const mprOpen = useUiStore((state) => state.mprOpen);
  const activeTool = useUiStore((state) => state.activeTool);
  const studies = useStudyStore((state) => state.studies);
  const imageSource = useStudyStore((state) => state.imageSource);

  // The selected tool drives every 2D viewport.
  useEffect(() => {
    let cancelled = false;
    void initCornerstone().then(() => { if (!cancelled) setPrimaryTool(stackToolGroup(), activeTool); });
    return () => { cancelled = true; };
  }, [activeTool]);

  // Measurements drawn in the viewer and those in remote-control state are kept in step for the open study.
  useEffect(() => {
    let cancelled = false;
    void initCornerstone().then(() => { if (!cancelled) startMeasurementSync(imageSource); });
    return () => { cancelled = true; startMeasurementSync(undefined); };
  }, [imageSource]);

  // Images that fail to download or decode are reported once per reason, not once per slice.
  useEffect(() => {
    const reported = new Set<string>();
    const onFailed = (event: Event) => {
      const { error } = (event as CustomEvent<{ imageId: string; error: unknown }>).detail;
      const cause = (error as { error?: unknown })?.error ?? error;
      const reason = cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : 'the image data could not be decoded';
      if (reported.has(reason)) return;
      reported.add(reason);
      useStudyStore.getState().addError(`Some images could not be displayed: ${reason}`);
    };
    eventTarget.addEventListener(Enums.Events.IMAGE_LOAD_FAILED, onFailed);
    return () => eventTarget.removeEventListener(Enums.Events.IMAGE_LOAD_FAILED, onFailed);
  }, [imageSource]);

  if (mprOpen) return <Suspense fallback={<div className="viewport-empty">Loading MPR tools…</div>}><MprViewer series={series} /></Suspense>;
  return (
    <div className={`viewport-grid layout-${layout}`}>
      {viewports.map((viewport) => (
        <Viewport key={viewport.id} viewport={viewport} series={selectCurrentSeries(studies, viewport.seriesId) ?? series} />
      ))}
    </div>
  );
}
