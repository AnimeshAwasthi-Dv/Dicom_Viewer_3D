import { X } from 'lucide-react';
import { useUiStore } from '../../store/uiStore';

const shortcuts = [
  ['K', 'Scroll slices by dragging'],
  ['W', 'Window / Level'],
  ['P', 'Pan'],
  ['Z', 'Zoom'],
  ['M or L', 'Length measurement'],
  ['A', 'Angle measurement'],
  ['R', 'Rectangle ROI'],
  ['E', 'Ellipse ROI'],
  ['C', 'Circle ROI'],
  ['F', 'Freehand ROI'],
  ['B', 'Bidirectional (long and short axis)'],
  ['T', 'Arrow annotation'],
  ['I', 'Invert image'],
  ['O', 'Rotate 90 degrees'],
  ['H', 'Flip horizontal'],
  ['V', 'Flip vertical'],
  ['0', 'Reset view'],
  ['Space', 'Cine play / pause'],
  ['Ctrl + Z', 'Undo last annotation or measurement'],
  ['Arrow Up / Down', 'Previous / next slice'],
  ['Mouse wheel', 'Scroll slices (Ctrl + wheel zooms)'],
  ['Right drag / middle drag', 'Zoom / pan with any tool'],
  ['Home / End', 'First / last slice'],
  ['1 / 2 / 3 / 4', 'Layouts 1x1, 1x2, 2x1, 2x2'],
  ['?', 'Show / hide shortcuts'],
  ['D', 'Show DICOM tags'],
  ['S', 'Open export options'],
  ['Shift + Delete', 'Clear current-slice overlays'],
  ['Esc', 'Cancel active draft']
] as const;

export function ShortcutsDialog(): JSX.Element | null {
  const open = useUiStore((state) => state.shortcutsOpen);
  const setOpen = useUiStore((state) => state.setShortcutsOpen);
  if (!open) return null;

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={() => setOpen(false)}>
      <section className="shortcut-modal" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div>
            <p>Viewer Controls</p>
            <h2>Keyboard Shortcuts</h2>
          </div>
          <button title="Close" onClick={() => setOpen(false)}><X size={16} /></button>
        </header>
        <div className="shortcut-grid">
          {shortcuts.map(([key, action]) => (
            <div className="shortcut-row" key={`${key}-${action}`}>
              <kbd>{key}</kbd>
              <span>{action}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
