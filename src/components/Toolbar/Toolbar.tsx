import { useEffect, useState } from 'react';
import { Activity, Box, Download, FileText, FlipHorizontal, FlipVertical, Gauge, Keyboard, MoreHorizontal, Move, Pause, Play, RotateCw, Ruler, ScanLine, Search, Square, Target, Trash2, Type, Undo2 } from 'lucide-react';
import { useMeasurementStore } from '../../store/measurementStore';
import { useUiStore } from '../../store/uiStore';
import { useViewerStore } from '../../store/viewerStore';
import { selectCurrentSeries, useStudyStore } from '../../store/studyStore';
import type { ToolId } from '../../viewer/tools/BaseTool';

const primaryTools: Array<{ id: ToolId; label: string; shortLabel: string; icon: JSX.Element }> = [
  { id: 'windowLevel', label: 'Window / Level', shortLabel: 'Window', icon: <Gauge size={16} /> },
  { id: 'pan', label: 'Pan', shortLabel: 'Pan', icon: <Move size={16} /> },
  { id: 'zoom', label: 'Zoom', shortLabel: 'Zoom', icon: <Search size={16} /> },
  { id: 'length', label: 'Length', shortLabel: 'Length', icon: <Ruler size={16} /> },
  { id: 'annotation', label: 'Annotation', shortLabel: 'Note', icon: <Type size={16} /> }
];

const advancedTools: Array<{ id: ToolId; label: string; shortLabel: string; icon: JSX.Element }> = [
  { id: 'angle', label: 'Angle', shortLabel: 'Angle', icon: <ScanLine size={16} /> },
  { id: 'rectangleRoi', label: 'Rectangle ROI', shortLabel: 'Rect', icon: <Square size={16} /> },
  { id: 'ellipseRoi', label: 'Ellipse ROI', shortLabel: 'Ellipse', icon: <Square size={16} /> },
  { id: 'probe', label: 'Probe', shortLabel: 'Probe', icon: <Target size={16} /> }
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
  const { studies, selectedSeriesId } = useStudyStore();
  const { viewports, cinePlaying, cineFps, setCineFps, toggleCine, updateCamera, resetCamera, setLayout, layout } = useViewerStore();
  const viewport = viewports[0];
  const series = selectCurrentSeries(studies, selectedSeriesId);
  const currentSopUID = series?.instances[viewport.instanceIndex]?.metadata.sopInstanceUID;

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
  const rotate = (): void => updateCamera(viewport.id, { rotation: ((viewport.camera.rotation + 90) % 360) as 0 | 90 | 180 | 270 });
  const cineButton = (
    <button disabled={disabled} title="Cine" className={cinePlaying ? 'active' : ''} onClick={toggleCine}>
      {cinePlaying ? <Pause size={16} /> : <Play size={16} />}<span>Cine</span>
    </button>
  );

  return (
    <nav className="toolbar">
      <div className="tool-group primary-tools">
        {primaryTools.map((tool) => (
          <button key={tool.id} disabled={disabled} className={activeTool === tool.id ? 'active' : ''} title={tool.label} onClick={() => selectTool(tool.id)}>
            {tool.icon}<span>{tool.shortLabel}</span>
          </button>
        ))}
      </div>

      <div className="tool-group toolbar-actions">
        <button disabled={disabled} title="Undo last annotation or measurement (Ctrl+Z)" onClick={undoLast}><Undo2 size={16} /><span>Undo</span></button>
        <button disabled={disabled || (series?.instances.length ?? 0) < 2} title="3D MPR" className={mprOpen ? 'active' : ''} onClick={toggleMpr}><Box size={16} /><span>MPR</span></button>
        {cineButton}
        <button title="More tools" className={moreMenuOpen ? 'active' : ''} onPointerDown={(event) => event.stopPropagation()} onClick={() => setMoreMenuOpen((open) => !open)}>
          <MoreHorizontal size={17} />
        </button>
        {moreMenuOpen && (
          <div className="more-menu" onPointerDown={(event) => event.stopPropagation()}>
            <div className="more-menu-section">
              <span className="more-menu-title">Tools</span>
              <div className="more-tool-grid">
                {advancedTools.map((tool) => (
                  <button key={tool.id} disabled={disabled} className={activeTool === tool.id ? 'active' : ''} title={tool.label} onClick={() => selectTool(tool.id)}>
                    {tool.icon}<span>{tool.shortLabel}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="more-menu-section">
              <span className="more-menu-title">Image</span>
              <div className="more-tool-grid">
                <button disabled={disabled} title="Invert" onClick={() => updateCamera(viewport.id, { inverted: !viewport.camera.inverted })}><Activity size={16} /><span>Invert</span></button>
                <button disabled={disabled} title="Rotate 90" onClick={rotate}><RotateCw size={16} /><span>Rotate</span></button>
                <button disabled={disabled} title="Flip Horizontal" onClick={() => updateCamera(viewport.id, { flipH: !viewport.camera.flipH })}><FlipHorizontal size={16} /><span>Flip H</span></button>
                <button disabled={disabled} title="Flip Vertical" onClick={() => updateCamera(viewport.id, { flipV: !viewport.camera.flipV })}><FlipVertical size={16} /><span>Flip V</span></button>
                <button disabled={disabled} title="Reset view" onClick={() => resetCamera(viewport.id)}><Undo2 size={16} /><span>Reset</span></button>
                <button disabled={disabled} title="Clear overlays" onClick={() => clearForInstance(currentSopUID)}><Trash2 size={16} /><span>Clear</span></button>
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
