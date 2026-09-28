import { useStudyStore } from '../../store/studyStore';
import { useViewerStore } from '../../store/viewerStore';
import { useUiStore } from '../../store/uiStore';
import { useMeasurementStore } from '../../store/measurementStore';
import { defaultCamera } from '../core/Camera';
import { createViewports } from '../core/ViewportManager';
import type { RemoteState } from '../../types/remote';
import { useRemoteControlStore } from '../../store/remoteControlStore';

export function applyRemoteState(state: RemoteState): void {
  useViewerStore.setState({
    layout: state.layout,
    viewports: createViewports(state.layout).map((viewport, index) => {
      const desired = state.viewports[index];
      return {
        ...viewport, ...desired,
        windowWidth: desired.windowWidth ?? viewport.windowWidth,
        windowCenter: desired.windowCenter ?? viewport.windowCenter,
        windowInitialized: desired.windowWidth !== undefined,
        camera: desired.camera ?? { ...defaultCamera, pan: { ...defaultCamera.pan } }
      };
    }),
    cinePlaying: state.cinePlaying, cineFps: state.cineFps
  });
  useStudyStore.getState().selectSeries(state.viewports[0].seriesId);
  useUiStore.setState({ activeTool: state.activeTool, mprOpen: state.mprOpen, ...state.dialogs });
  useRemoteControlStore.setState({ mprRequest: state.mpr ? { settings: state.mpr } : undefined });
  useMeasurementStore.setState({ measurements: state.measurements });
}

export function captureRemoteState(): RemoteState {
  const viewer = useViewerStore.getState();
  const ui = useUiStore.getState();
  const study = useStudyStore.getState();
  return {
    layout: viewer.layout,
    viewports: viewer.viewports.map(viewport => ({
      seriesId: viewport.seriesId ?? study.selectedSeriesId ?? '', instanceIndex: viewport.instanceIndex,
      ...(viewport.windowInitialized ? { windowWidth: viewport.windowWidth, windowCenter: viewport.windowCenter } : {}),
      camera: viewport.camera
    })),
    cinePlaying: viewer.cinePlaying, cineFps: viewer.cineFps,
    activeTool: ui.activeTool, mprOpen: ui.mprOpen,
    ...(ui.mprOpen ? { mpr: useRemoteControlStore.getState().mprActual } : {}),
    dialogs: { dicomTagsOpen: ui.dicomTagsOpen, shortcutsOpen: ui.shortcutsOpen, exportOpen: ui.exportOpen },
    measurements: useMeasurementStore.getState().measurements
  };
}
