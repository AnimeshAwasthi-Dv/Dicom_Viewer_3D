import { Grid2X2, Layers, List, PanelLeftClose, PanelLeftOpen, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useStudyStore } from '../../store/studyStore';
import { useViewerStore } from '../../store/viewerStore';
import type { Series } from '../../viewer/study/Series';
import type { Study } from '../../viewer/study/Study';
import { SeriesThumbnail } from './SeriesThumbnail';
import { imageCount } from '../../viewer/study/StudyManager';

type SeriesViewMode = 'tile' | 'list';

const viewModeKey = 'decxpert-series-view';

function storedViewMode(): SeriesViewMode {
  try {
    return localStorage.getItem(viewModeKey) === 'list' ? 'list' : 'tile';
  } catch {
    return 'tile';
  }
}

export function SeriesPanel({
  studies,
  selectedSeriesId,
  collapsed,
  drawerOpen,
  onToggleCollapsed,
  onCloseDrawer
}: {
  studies: Study[];
  selectedSeriesId?: string;
  collapsed: boolean;
  drawerOpen: boolean;
  onToggleCollapsed(): void;
  onCloseDrawer(): void;
}): JSX.Element {
  const [viewMode, setViewMode] = useState<SeriesViewMode>(storedViewMode);
  const selectSeries = useStudyStore((state) => state.selectSeries);
  const assignSeries = useViewerStore((state) => state.assignSeries);
  const seriesList = useMemo(() => studies.flatMap((study) => study.series), [studies]);
  const totalImages = useMemo(() => seriesList.reduce((count, series) => count + imageCount(series), 0), [seriesList]);

  const changeViewMode = (mode: SeriesViewMode): void => {
    setViewMode(mode);
    try {
      localStorage.setItem(viewModeKey, mode);
    } catch {
      // The choice just isn't remembered.
    }
  };

  const select = (series: Series): void => {
    selectSeries(series.id);
    assignSeries('viewport-1', series.id);
    onCloseDrawer();
  };

  // On phones the panel is a drawer, so it is never folded to the desktop rail.
  if (collapsed && !drawerOpen) {
    return (
      <aside className="series-panel collapsed">
        <button className="series-collapse-button" title="Show series panel" onClick={onToggleCollapsed}>
          <PanelLeftOpen size={17} />
        </button>
        <div className="panel-title vertical"><Layers size={15} /> SERIES</div>
      </aside>
    );
  }

  return (
    <>
      <aside className={`series-panel ${drawerOpen ? 'open' : ''}`} aria-label="Study series">
        <div className="series-browser-header">
          <div className="panel-title"><Layers size={15} /> SERIES</div>
          {seriesList.length > 0 && (
            <span className="series-summary">{seriesList.length} series · {totalImages} images</span>
          )}
          <div className="view-toggle" role="group" aria-label="Series view mode">
            <button className={viewMode === 'list' ? 'active' : ''} title="List view" aria-label="List view" onClick={() => changeViewMode('list')}><List size={15} /></button>
            <button className={viewMode === 'tile' ? 'active' : ''} title="Tile view" aria-label="Tile view" onClick={() => changeViewMode('tile')}><Grid2X2 size={15} /></button>
          </div>
          <button className="series-collapse-button desktop-only" title="Hide series panel" onClick={onToggleCollapsed}>
            <PanelLeftClose size={17} />
          </button>
          <button className="series-collapse-button mobile-only" title="Close series panel" onClick={onCloseDrawer}>
            <X size={18} />
          </button>
        </div>
        {seriesList.length === 0 && <p className="muted series-empty">No series loaded</p>}
        {seriesList.length > 0 && (
          <div className={`series-list ${viewMode}`}>
            {seriesList.map((series) => (
              <button
                key={series.id}
                className={`series-card ${selectedSeriesId === series.id ? 'selected' : ''}`}
                aria-pressed={selectedSeriesId === series.id}
                onClick={() => select(series)}
              >
                <SeriesThumbnail series={series} />
                <span className="series-copy">
                  <strong title={series.description}>{series.description}</strong>
                  <small>Series {series.seriesNumber ?? '—'} · {series.modality} · {imageCount(series)} {imageCount(series) === 1 ? 'image' : 'images'}</small>
                </span>
              </button>
            ))}
          </div>
        )}
      </aside>
      <button className={`drawer-backdrop ${drawerOpen ? 'open' : ''}`} aria-label="Close series panel" tabIndex={drawerOpen ? 0 : -1} onClick={onCloseDrawer} />
    </>
  );
}
