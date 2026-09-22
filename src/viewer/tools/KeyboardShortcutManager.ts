import type { ToolId } from './BaseTool';

export interface KeyboardActions {
  setTool(tool: ToolId): void;
  undoLast(): void;
  toggleInvert(): void;
  toggleCine(): void;
  rotate(): void;
  flipHorizontal(): void;
  flipVertical(): void;
  resetView(): void;
  setLayout(layout: '1x1' | '1x2' | '2x1' | '2x2'): void;
  toggleShortcuts(): void;
  toggleDicomTags(): void;
  exportScreenshot(): void;
  clearOverlays(): void;
  cancelMeasurement(): void;
  previousSlice(): void;
  nextSlice(): void;
  firstSlice(): void;
  lastSlice(): void;
}

export class KeyboardShortcutManager {
  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
    const key = event.key.toLowerCase();
    const handled = true;
    if (event.ctrlKey && key === 'z') this.actions.undoLast();
    else if (key === 'w') this.actions.setTool('windowLevel');
    else if (key === 'p') this.actions.setTool('pan');
    else if (key === 'z') this.actions.setTool('zoom');
    else if (key === 'm') this.actions.setTool('length');
    else if (key === 'l') this.actions.setTool('length');
    else if (key === 'a') this.actions.setTool('angle');
    else if (key === 't') this.actions.setTool('annotation');
    else if (key === 'r') this.actions.setTool('rectangleRoi');
    else if (key === 'e') this.actions.setTool('ellipseRoi');
    else if (key === 'i') this.actions.toggleInvert();
    else if (key === 'o') this.actions.rotate();
    else if (key === 'h') this.actions.flipHorizontal();
    else if (key === 'v') this.actions.flipVertical();
    else if (key === '0') this.actions.resetView();
    else if (key === '?') this.actions.toggleShortcuts();
    else if (key === 'd') this.actions.toggleDicomTags();
    else if (key === 's') this.actions.exportScreenshot();
    else if (event.shiftKey && key === 'delete') this.actions.clearOverlays();
    else if (key === '1') this.actions.setLayout('1x1');
    else if (key === '2') this.actions.setLayout('1x2');
    else if (key === '3') this.actions.setLayout('2x1');
    else if (key === '4') this.actions.setLayout('2x2');
    else if (event.code === 'Space') this.actions.toggleCine();
    else if (event.key === 'Escape') this.actions.cancelMeasurement();
    else if (event.key === 'ArrowUp') this.actions.previousSlice();
    else if (event.key === 'ArrowDown') this.actions.nextSlice();
    else if (event.key === 'Home') this.actions.firstSlice();
    else if (event.key === 'End') this.actions.lastSlice();
    else return;
    if (handled) event.preventDefault();
  };

  constructor(private readonly actions: KeyboardActions) {}

  attach(): void {
    window.addEventListener('keydown', this.onKeyDown);
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
  }
}
