import { useMemo, useState } from 'react';
import { PatientHeader } from '../PatientHeader/PatientHeader';
import { Toolbar } from '../Toolbar/Toolbar';
import { SeriesPanel } from '../SeriesPanel/SeriesPanel';
import { StatusBar } from '../StatusBar/StatusBar';
import { ViewportGrid } from '../ViewportGrid/ViewportGrid';
import { LocalLoader } from '../LocalLoader/LocalLoader';
import { ShortcutsDialog } from '../ShortcutsDialog/ShortcutsDialog';
import { DicomTagsDialog } from '../DicomTagsDialog/DicomTagsDialog';
import { ExportDialog } from '../ExportDialog/ExportDialog';
import { selectCurrentSeries, useStudyStore } from '../../store/studyStore';
import { useViewerStore } from '../../store/viewerStore';

export function ViewerShell(): JSX.Element {
  const [seriesCollapsed, setSeriesCollapsed] = useState(false);
  const { studies, selectedSeriesId, loading, errors } = useStudyStore();
  const { frames, renderTimeMs } = useViewerStore();
  const series = useMemo(() => selectCurrentSeries(studies, selectedSeriesId), [studies, selectedSeriesId]);
  const hasStudy = studies.length > 0;
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
      <StatusBar frameCount={Object.keys(frames).length} renderTimeMs={renderTimeMs} />
      <ShortcutsDialog />
      <DicomTagsDialog />
      <ExportDialog />
    </div>
  );
}
