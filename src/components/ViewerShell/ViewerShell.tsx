import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { PatientHeader } from '../PatientHeader/PatientHeader';
import { Toolbar } from '../Toolbar/Toolbar';
import { SeriesPanel } from '../SeriesPanel/SeriesPanel';
import { StatusBar } from '../StatusBar/StatusBar';
import { ViewportGrid } from '../ViewportGrid/ViewportGrid';
import { LocalLoader } from '../LocalLoader/LocalLoader';
import { selectCurrentSeries, useStudyStore } from '../../store/studyStore';
import { useUiStore } from '../../store/uiStore';

// Dialogs load on first open and are only mounted while open, so they don't re-render on every slice change.
const ShortcutsDialog = lazy(() => import('../ShortcutsDialog/ShortcutsDialog').then(module => ({ default: module.ShortcutsDialog })));
const DicomTagsDialog = lazy(() => import('../DicomTagsDialog/DicomTagsDialog').then(module => ({ default: module.DicomTagsDialog })));
const ExportDialog = lazy(() => import('../ExportDialog/ExportDialog').then(module => ({ default: module.ExportDialog })));

export function ViewerShell(): JSX.Element {
  const [seriesCollapsed, setSeriesCollapsed] = useState(false);
  const studies = useStudyStore((state) => state.studies);
  const selectedSeriesId = useStudyStore((state) => state.selectedSeriesId);
  const loading = useStudyStore((state) => state.loading);
  const errors = useStudyStore((state) => state.errors);
  const shortcutsOpen = useUiStore((state) => state.shortcutsOpen);
  const dicomTagsOpen = useUiStore((state) => state.dicomTagsOpen);
  const exportOpen = useUiStore((state) => state.exportOpen);
  const series = useMemo(() => selectCurrentSeries(studies, selectedSeriesId), [studies, selectedSeriesId]);
  const hasStudy = studies.length > 0;
  const seriesCount = useMemo(() => studies.reduce((count, study) => count + study.series.length, 0), [studies]);
  // On phones a single-series study starts with the series strip folded away to leave room for the image.
  useEffect(() => {
    if (seriesCount === 1 && window.matchMedia('(max-width: 760px), (max-height: 500px)').matches) setSeriesCollapsed(true);
  }, [seriesCount]);
  const remote = new URLSearchParams(window.location.search).has('session');

  return (
    <div className="viewer-shell">
      <PatientHeader study={studies.find(study => study.id === series?.studyInstanceUID) ?? studies[0]} series={series} />
      <Toolbar disabled={!hasStudy} />
      <div className={`workstation ${seriesCollapsed ? 'series-collapsed' : ''}`}>
        <SeriesPanel studies={studies} selectedSeriesId={selectedSeriesId} collapsed={seriesCollapsed} onToggleCollapsed={() => setSeriesCollapsed((collapsed) => !collapsed)} />
        <section className="viewport-stage">
          {!hasStudy ? (remote ? <div className="empty-state"><h1>Remote study session</h1><p>Your study will appear when the connection is ready.</p></div> : <LocalLoader />) : <ViewportGrid series={series} />}
          {loading && (
            <div className="load-banner">
              <strong>{loading.phase}</strong>
              <span>{loading.indexed} / {loading.total} images indexed</span>
            </div>
          )}
          {errors.length > 0 && (
            <div className="error-toast">
              {errors.slice(-2).map((error) => <div key={error}>{error}</div>)}
            </div>
          )}
        </section>
      </div>
      <StatusBar />
      <Suspense fallback={null}>
        {shortcutsOpen && <ShortcutsDialog />}
        {dicomTagsOpen && <DicomTagsDialog />}
        {exportOpen && <ExportDialog />}
      </Suspense>
    </div>
  );
}
