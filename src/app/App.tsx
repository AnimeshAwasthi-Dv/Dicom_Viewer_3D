import { useEffect } from 'react';
import { ErrorBoundary } from '../components/ErrorBoundary/ErrorBoundary';
import { ViewerShell } from '../components/ViewerShell/ViewerShell';
import { KeyboardShortcutManager } from '../viewer/tools/KeyboardShortcutManager';
import { useUiStore } from '../store/uiStore';
import { useViewerStore } from '../store/viewerStore';
import { selectCurrentSeries, useStudyStore } from '../store/studyStore';
import { useMeasurementStore } from '../store/measurementStore';
import { RemoteSession } from '../components/RemoteSession/RemoteSession';

export function App(): JSX.Element {
  const setActiveTool = useUiStore((state) => state.setActiveTool);
  const toggleShortcuts = useUiStore((state) => state.toggleShortcuts);
  const toggleDicomTags = useUiStore((state) => state.toggleDicomTags);
  const toggleExport = useUiStore((state) => state.toggleExport);
  const undoLast = useMeasurementStore((state) => state.undoLast);
  const clearForInstance = useMeasurementStore((state) => state.clearForInstance);
  const { setInstanceIndex, toggleCine, updateCamera, resetCamera, setLayout } = useViewerStore.getState();

  // Shortcuts read the latest viewer state when pressed, so this attaches once instead of on every slice change.
  useEffect(() => {
    const viewportOf = () => useViewerStore.getState().viewports[0];
    const seriesOf = () => { const { studies, selectedSeriesId } = useStudyStore.getState(); return selectCurrentSeries(studies, selectedSeriesId); };
    const keyboard = new KeyboardShortcutManager({
      setTool: setActiveTool,
      undoLast,
      toggleInvert: () => { const viewport = viewportOf(); updateCamera(viewport.id, { inverted: !viewport.camera.inverted }); },
      toggleCine,
      rotate: () => { const viewport = viewportOf(); updateCamera(viewport.id, { rotation: ((viewport.camera.rotation + 90) % 360) as 0 | 90 | 180 | 270 }); },
      flipHorizontal: () => { const viewport = viewportOf(); updateCamera(viewport.id, { flipH: !viewport.camera.flipH }); },
      flipVertical: () => { const viewport = viewportOf(); updateCamera(viewport.id, { flipV: !viewport.camera.flipV }); },
      resetView: () => resetCamera(viewportOf().id),
      setLayout,
      toggleShortcuts,
      toggleDicomTags,
      exportScreenshot: toggleExport,
      clearOverlays: () => clearForInstance(seriesOf()?.instances[viewportOf().instanceIndex]?.metadata.sopInstanceUID),
      cancelMeasurement: () => window.dispatchEvent(new CustomEvent('viewer:cancel-measurement')),
      previousSlice: () => { const viewport = viewportOf(); setInstanceIndex(viewport.id, Math.max(0, viewport.instanceIndex - 1)); },
      nextSlice: () => { const viewport = viewportOf(); setInstanceIndex(viewport.id, Math.min((seriesOf()?.instances.length ?? 1) - 1, viewport.instanceIndex + 1)); },
      firstSlice: () => setInstanceIndex(viewportOf().id, 0),
      lastSlice: () => setInstanceIndex(viewportOf().id, Math.max(0, (seriesOf()?.instances.length ?? 1) - 1))
    });
    keyboard.attach();
    return () => keyboard.dispose();
  }, [clearForInstance, resetCamera, setActiveTool, setInstanceIndex, setLayout, toggleCine, toggleDicomTags, toggleExport, toggleShortcuts, undoLast, updateCamera]);

  return (
    <ErrorBoundary>
      <RemoteSession />
      <ViewerShell />
    </ErrorBoundary>
  );
}
