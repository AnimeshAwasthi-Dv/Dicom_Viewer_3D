import { ChevronLeft, ChevronRight, Grid2X2, Layers, List, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { useStudyStore } from '../../store/studyStore';
import { useViewerStore } from '../../store/viewerStore';
import type { Series } from '../../viewer/study/Series';
import type { Study } from '../../viewer/study/Study';
import { SeriesThumbnail } from './SeriesThumbnail';

type SeriesViewMode = 'grid' | 'list';

export function SeriesPanel({
  studies,
  selectedSeriesId,
  collapsed,
  onToggleCollapsed
}: {
  studies: Study[];
  selectedSeriesId?: string;
  collapsed: boolean;
  onToggleCollapsed(): void;
}): JSX.Element {
  const [viewMode, setViewMode] = useState<SeriesViewMode>('grid');
  const stripRef = useRef<HTMLDivElement>(null);
  const selectSeries = useStudyStore((state) => state.selectSeries);
  const assignSeries = useViewerStore((state) => state.assignSeries);
  const seriesList = useMemo(() => studies.flatMap((study) => study.series), [studies]);
  const selectedIndex = Math.max(0, seriesList.findIndex((series) => series.id === selectedSeriesId));

  const select = (series: Series): void => {
    selectSeries(series.id);
    assignSeries('viewport-1', series.id);
  };

  const navigateSeries = (direction: -1 | 1): void => {
    if (seriesList.length === 0) return;
    const nextIndex = Math.min(seriesList.length - 1, Math.max(0, selectedIndex + direction));
    select(seriesList[nextIndex]);
    requestAnimationFrame(() => {
      stripRef.current?.querySelector<HTMLElement>(`[data-series-index="${nextIndex}"]`)?.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'nearest'
      });
    });
  };

  if (collapsed) {
    return (
      <aside className="series-panel collapsed">
        <button className="series-collapse-button" title="Show studies" onClick={onToggleCollapsed}>
          <PanelLeftOpen size={17} />
        </button>
        <div className="panel-title vertical"><Layers size={15} /> SERIES</div>
      </aside>
    );
  }

  return (
    <aside className="series-panel">
      <div className="series-browser-header">
        <div className="series-header-main">
          <div className="panel-title"><Layers size={15} /> SERIES</div>
          <div className="view-toggle" role="group" aria-label="Series view mode">
            <button className={viewMode === 'list' ? 'active' : ''} title="List view" onClick={() => setViewMode('list')}><List size={16} /></button>
            <button className={viewMode === 'grid' ? 'active' : ''} title="Tile view" onClick={() => setViewMode('grid')}><Grid2X2 size={16} /></button>
          </div>
        </div>
        <button className="series-collapse-button" title="Hide series panel" onClick={onToggleCollapsed}>
          <PanelLeftClose size={17} />
        </button>
      </div>
      {seriesList.length === 0 && <p className="muted">No series loaded</p>}
      {seriesList.length > 0 && (
        <div className={`series-scroll-shell ${viewMode}`}>
          <button className="series-nav series-nav-left" title="Previous series" disabled={selectedIndex <= 0} onClick={() => navigateSeries(-1)}>
            <ChevronLeft size={17} />
          </button>
          <div className={`series-strip ${viewMode}`} ref={stripRef}>
            {seriesList.map((series, index) => (
              <button
                key={series.id}
                data-series-index={index}
                className={`series-tile ${viewMode} ${selectedSeriesId === series.id ? 'selected' : ''}`}
                onClick={() => select(series)}
              >
                <SeriesThumbnail series={series} />
                <div className="series-info">
                  <span className="series-modality">{series.modality}</span>
                  <strong>{series.description}</strong>
                  <span className="series-meta">S:{series.seriesNumber ?? '--'} - {series.instances.length} {series.instances.length === 1 ? 'image' : 'images'}</span>
                </div>
              </button>
            ))}
          </div>
          <button className="series-nav series-nav-right" title="Next series" disabled={selectedIndex >= seriesList.length - 1} onClick={() => navigateSeries(1)}>
            <ChevronRight size={17} />
          </button>
        </div>
      )}
    </aside>
  );
}
