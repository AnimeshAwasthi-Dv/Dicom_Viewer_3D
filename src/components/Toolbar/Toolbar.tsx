import { useEffect, useState } from 'react';
import { Activity, ArrowUpRight, Box, Camera, ChevronsUpDown, Circle, Download, FileText, FlipHorizontal, FlipVertical, Gauge, Keyboard, MoreHorizontal, Move, Pause, Pencil, Play, Plus, RotateCw, Ruler, ScanLine, Search, Spline, Square, Target, Trash2, Triangle, Undo2, Waypoints } from 'lucide-react';
import { useMeasurementStore } from '../../store/measurementStore';
import { useUiStore } from '../../store/uiStore';
import { useViewerStore } from '../../store/viewerStore';
import { selectCurrentSeries, useStudyStore } from '../../store/studyStore';
import type { ToolId } from '../../viewer/tools/toolIds';
import { imageCount, seriesFrames } from '../../viewer/study/StudyManager';

type ToolButton = { id: ToolId; label: string; shortLabel: string; icon: JSX.Element };

const primaryTools: ToolButton[] = [
  { id: 'scroll', label: 'Scroll slices (drag up or down)', shortLabel: 'Scroll', icon: <ChevronsUpDown size={16} /> },
  { id: 'windowLevel', label: 'Window / Level', shortLabel: 'Window', icon: <Gauge size={16} /> },
  { id: 'pan', label: 'Pan', shortLabel: 'Pan', icon: <Move size={16} /> },
  { id: 'zoom', label: 'Zoom', shortLabel: 'Zoom', icon: <Search size={16} /> },
  { id: 'length', label: 'Length', shortLabel: 'Length', icon: <Ruler size={16} /> }
];

// Annotation lives here so the primary row, which includes Scroll, still fits on one line on phones.
const advancedTools: ToolButton[] = [
  { id: 'bidirectional', label: 'Bidirectional (long and short axis)', shortLabel: 'Bidir', icon: <Plus size={16} /> },
  { id: 'annotation', label: 'Arrow annotation', shortLabel: 'Arrow', icon: <ArrowUpRight size={16} /> },
  { id: 'angle', label: 'Angle', shortLabel: 'Angle', icon: <ScanLine size={16} /> },
  { id: 'cobbAngle', label: 'Cobb angle', shortLabel: 'Cobb', icon: <Triangle size={16} /> },
  { id: 'probe', label: 'Probe', shortLabel: 'Probe', icon: <Target size={16} /> },
  { id: 'rectangleRoi', label: 'Rectangle ROI', shortLabel: 'Rect', icon: <Square size={16} /> },
  { id: 'ellipseRoi', label: 'Ellipse ROI', shortLabel: 'Ellipse', icon: <Circle size={16} /> },
  { id: 'circleRoi', label: 'Circle ROI', shortLabel: 'Circle', icon: <Circle size={16} /> },
  { id: 'freehandRoi', label: 'Freehand ROI', shortLabel: 'Freehand', icon: <Pencil size={16} /> },
  { id: 'splineRoi', label: 'Spline ROI', shortLabel: 'Spline', icon: <Spline size={16} /> },
  { id: 'livewire', label: 'Livewire (edge-following outline)', shortLabel: 'Livewire', icon: <Waypoints size={16} /> }
];

export function Toolbar({ disabled }: { disabled: boolean }): JSX.Element {
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const activeTool = useUiStore((state) => state.activeTool);
  const setActiveTool = useUiStore((state) => state.setActiveTool);
  const toggleShortcuts = useUiStore((state) => state.toggleShortcuts);
  const toggleDicomTags = useUiStore((state) => state.toggleDicomTags);
  const toggleExport = useUiStore((state) => state.toggleExport);
  const mprOpen = useUiStore((state) => state.mprOpen);
  const toggleMpr = useUiStore((state) => state.toggleMpr);
  const undoLast = useMeasurementStore((state) => state.undoLast);
  const clearForInstance = useMeasurementStore((state) => state.clearForInstance);
  const series = useStudyStore((state) => selectCurrentSeries(state.studies, state.selectedSeriesId));
  const cinePlaying = useViewerStore((state) => state.cinePlaying);
  const cineFps = useViewerStore((state) => state.cineFps);
  const layout = useViewerStore((state) => state.layout);
  const { setCineFps, toggleCine, updateCamera, resetCamera, setLayout } = useViewerStore.getState();
  // Image actions read the viewport when clicked, so the toolbar doesn't re-render on every slice change.
  const viewportNow = () => useViewerStore.getState().viewports[0];
  const currentSopUID = () => (series ? seriesFrames(series)[viewportNow().instanceIndex]?.instance.metadata.sopInstanceUID : undefined);
  const capture = () => { window.dispatchEvent(new CustomEvent('viewer:export-screenshot')); setMoreMenuOpen(false); };

  useEffect(() => {
    if (!moreMenuOpen) return;
    const close = () => setMoreMenuOpen(false);
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [moreMenuOpen]);

  const selectTool = (tool: ToolId): void => {
    setActiveTool(tool);
    setMoreMenuOpen(false);
  };

  const openExport = (): void => {
    toggleExport();
    setMoreMenuOpen(false);
  };
  const rotate = (): void => { const viewport = viewportNow(); updateCamera(viewport.id, { rotation: ((viewport.camera.rotation + 90) % 360) as 0 | 90 | 180 | 270 }); };
  const cineButton = (
    <button disabled={disabled} title="Cine" className={cinePlaying ? 'active' : ''} onClick={toggleCine}>
      {cinePlaying ? <Pause size={16} /> : <Play size={16} />}<span>Cine</span>
    </button>
  );

  return (
    <nav className="toolbar" aria-label="Viewer tools">
      <div className="tool-group primary-tools">
        {primaryTools.map((tool) => (
          <button key={tool.id} disabled={disabled} className={activeTool === tool.id ? 'active' : ''} title={tool.label} aria-label={tool.label} aria-pressed={activeTool === tool.id} onClick={() => selectTool(tool.id)}>
            {tool.icon}<span>{tool.shortLabel}</span>
          </button>
        ))}
      </div>

      <div className="tool-group toolbar-actions">
        <div className="tool-group desktop-toolbar-actions">
        <button disabled={disabled} title="Undo last annotation or measurement (Ctrl+Z)" onClick={undoLast}><Undo2 size={16} /><span>Undo</span></button>
        <button disabled={disabled || (series ? imageCount(series) : 0) < 2} title="3D MPR" className={mprOpen ? 'active' : ''} onClick={toggleMpr}><Box size={16} /><span>MPR</span></button>
        {cineButton}
        <button disabled={disabled} title="Save the current view as PNG, with measurements (S)" onClick={capture}><Camera size={16} /><span>Capture</span></button>
        </div>
        <button title="More tools" aria-label="More tools" aria-expanded={moreMenuOpen} className={moreMenuOpen ? 'active' : ''} onPointerDown={(event) => event.stopPropagation()} onClick={() => setMoreMenuOpen((open) => !open)}>
          <MoreHorizontal size={17} /><span>More</span>
        </button>
        {moreMenuOpen && (
          <div className="more-menu" onPointerDown={(event) => event.stopPropagation()}>
            <div className="more-menu-section mobile-toolbar-actions">
              <span className="more-menu-title">Actions</span>
              <div className="more-tool-grid">
        <button disabled={disabled} title="Undo last annotation or measurement (Ctrl+Z)" onClick={undoLast}><Undo2 size={16} /><span>Undo</span></button>
        <button disabled={disabled || (series ? imageCount(series) : 0) < 2} title="3D MPR" className={mprOpen ? 'active' : ''} onClick={toggleMpr}><Box size={16} /><span>MPR</span></button>
        {cineButton}
        <button disabled={disabled} title="Save the current view as PNG, with measurements" onClick={capture}><Camera size={16} /><span>Capture</span></button>
              </div>
            </div>
            <div className="more-menu-section">
              <span className="more-menu-title">Tools</span>
              <div className="more-tool-grid">
                {advancedTools.map((tool) => (
                  <button key={tool.id} disabled={disabled} className={activeTool === tool.id ? 'active' : ''} title={tool.label} aria-label={tool.label} aria-pressed={activeTool === tool.id} onClick={() => selectTool(tool.id)}>
                    {tool.icon}<span>{tool.shortLabel}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="more-menu-section">
              <span className="more-menu-title">Image</span>
              <div className="more-tool-grid">
                <button disabled={disabled} title="Invert" onClick={() => { const viewport = viewportNow(); updateCamera(viewport.id, { inverted: !viewport.camera.inverted }); }}><Activity size={16} /><span>Invert</span></button>
                <button disabled={disabled} title="Rotate 90" onClick={rotate}><RotateCw size={16} /><span>Rotate</span></button>
                <button disabled={disabled} title="Flip Horizontal" onClick={() => { const viewport = viewportNow(); updateCamera(viewport.id, { flipH: !viewport.camera.flipH }); }}><FlipHorizontal size={16} /><span>Flip H</span></button>
                <button disabled={disabled} title="Flip Vertical" onClick={() => { const viewport = viewportNow(); updateCamera(viewport.id, { flipV: !viewport.camera.flipV }); }}><FlipVertical size={16} /><span>Flip V</span></button>
                <button disabled={disabled} title="Reset view" onClick={() => resetCamera(viewportNow().id)}><Undo2 size={16} /><span>Reset</span></button>
                <button disabled={disabled} title="Clear overlays" onClick={() => clearForInstance(currentSopUID())}><Trash2 size={16} /><span>Clear</span></button>
              </div>
            </div>
            <div className="more-menu-section more-menu-row">
              <label>FPS</label>
              <select disabled={disabled} title="Cine FPS" value={cineFps} onChange={(event) => setCineFps(Number(event.target.value))}>
                <option value={5}>5</option>
                <option value={10}>10</option>
                <option value={15}>15</option>
                <option value={20}>20</option>
                <option value={30}>30</option>
              </select>
              <label>Layout</label>
              <select disabled={disabled} title="Layout" value={layout} onChange={(event) => setLayout(event.target.value as typeof layout)}>
                <option value="1x1">1x1</option>
                <option value="1x2">1x2</option>
                <option value="2x1">2x1</option>
                <option value="2x2">2x2</option>
              </select>
            </div>
            <div className="more-menu-section">
              <div className="more-tool-grid">
                <button disabled={disabled} title="Export study" onClick={openExport}><Download size={16} /><span>Export</span></button>
                <button disabled={disabled} title="DICOM tags" onClick={() => { toggleDicomTags(); setMoreMenuOpen(false); }}><FileText size={16} /><span>Tags</span></button>
                <button title="Keyboard shortcuts" onClick={() => { toggleShortcuts(); setMoreMenuOpen(false); }}><Keyboard size={16} /><span>Keys</span></button>
              </div>
            </div>
          </div>
        )}
      </div>
    </nav>
  );
}
