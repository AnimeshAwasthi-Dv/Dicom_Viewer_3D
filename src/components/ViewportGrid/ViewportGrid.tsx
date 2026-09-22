import type { Series } from '../../viewer/study/Series';
import { lazy, Suspense } from 'react';
import { useUiStore } from '../../store/uiStore';
import { useViewerStore } from '../../store/viewerStore';
import { ViewportCanvas } from '../ViewportCanvas/ViewportCanvas';
import { selectCurrentSeries, useStudyStore } from '../../store/studyStore';

const MprViewer = lazy(() => import('../MprViewer/MprViewer').then(module => ({ default: module.MprViewer })));

export function ViewportGrid({ series }: { series?: Series }): JSX.Element {
  const { layout, viewports } = useViewerStore();
  const mprOpen = useUiStore((state) => state.mprOpen);
  const studies = useStudyStore((state) => state.studies);
  if (mprOpen) return <Suspense fallback={<div className="viewport-empty">Loading MPR tools…</div>}><MprViewer series={series} /></Suspense>;
  return (
    <div className={`viewport-grid layout-${layout}`}>
      {viewports.map((viewport) => (
        <ViewportCanvas key={viewport.id} viewport={viewport} series={selectCurrentSeries(studies, viewport.seriesId) ?? series} />
      ))}
    </div>
  );
}
