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
  const { viewports, setInstanceIndex, toggleCine, updateCamera, resetCamera, setLayout } = useViewerStore();
  const { studies, selectedSeriesId } = useStudyStore();
  const series = selectCurrentSeries(studies, selectedSeriesId);
  const viewport = viewports[0];

  useEffect(() => {
    const keyboard = new KeyboardShortcutManager({
      setTool: setActiveTool,
      undoLast,
      toggleInvert: () => updateCamera(viewport.id, { inverted: !viewport.camera.inverted }),
      toggleCine,
      rotate: () => updateCamera(viewport.id, { rotation: ((viewport.camera.rotation + 90) % 360) as 0 | 90 | 180 | 270 }),
      flipHorizontal: () => updateCamera(viewport.id, { flipH: !viewport.camera.flipH }),
      flipVertical: () => updateCamera(viewport.id, { flipV: !viewport.camera.flipV }),
      resetView: () => resetCamera(viewport.id),
      setLayout,
      toggleShortcuts,
      toggleDicomTags,
      exportScreenshot: toggleExport,
      clearOverlays: () => clearForInstance(series?.instances[viewport.instanceIndex]?.metadata.sopInstanceUID),
      cancelMeasurement: () => window.dispatchEvent(new CustomEvent('viewer:cancel-measurement')),
      previousSlice: () => setInstanceIndex(viewport.id, Math.max(0, viewport.instanceIndex - 1)),
      nextSlice: () => setInstanceIndex(viewport.id, Math.min((series?.instances.length ?? 1) - 1, viewport.instanceIndex + 1)),
      firstSlice: () => setInstanceIndex(viewport.id, 0),
      lastSlice: () => setInstanceIndex(viewport.id, Math.max(0, (series?.instances.length ?? 1) - 1))
    });
    keyboard.attach();
    return () => keyboard.dispose();
  }, [clearForInstance, resetCamera, series?.instances, setActiveTool, setInstanceIndex, setLayout, toggleCine, toggleDicomTags, toggleExport, toggleShortcuts, undoLast, updateCamera, viewport]);

  return (
    <ErrorBoundary>
      <RemoteSession />
      <ViewerShell />
    </ErrorBoundary>
  );
}
