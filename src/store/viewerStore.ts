import { create } from 'zustand';
import type { DecodedFrame } from '../types/dicom';
import { defaultCamera, type CameraState } from '../viewer/core/Camera';
import { createViewports, type ViewportLayout } from '../viewer/core/ViewportManager';
import type { ViewportState } from '../viewer/core/Viewport';

interface ViewerStore {
  layout: ViewportLayout;
  viewports: ViewportState[];
  frames: Record<string, DecodedFrame>;
  renderTimeMs: number;
  cinePlaying: boolean;
  cineFps: number;
  setLayout(layout: ViewportLayout): void;
  assignSeries(viewportId: string, seriesId: string): void;
  setFrame(index: number, frame: DecodedFrame): void;
  setInstanceIndex(viewportId: string, index: number): void;
  setWindow(viewportId: string, windowWidth: number, windowCenter: number, windowInitialized?: boolean): void;
  updateCamera(viewportId: string, patch: Partial<CameraState>): void;
  resetCamera(viewportId: string): void;
  setRenderTime(ms: number): void;
  toggleCine(): void;
  setCineFps(fps: number): void;
}

export const useViewerStore = create<ViewerStore>((set) => ({
  layout: '1x1',
  viewports: createViewports('1x1'),
  frames: {},
  renderTimeMs: 0,
  cinePlaying: false,
  cineFps: 10,
  setLayout: (layout) => set({ layout, viewports: createViewports(layout) }),
  assignSeries: (viewportId, seriesId) =>
    set((state) => ({ viewports: state.viewports.map((vp) => (vp.id === viewportId ? { ...vp, seriesId, instanceIndex: 0, windowInitialized: false } : vp)), frames: {} })),
  setFrame: (index, frame) => set({ frames: { [index]: frame } }),
  setInstanceIndex: (viewportId, index) => set((state) => ({ viewports: state.viewports.map((vp) => (vp.id === viewportId ? { ...vp, instanceIndex: index } : vp)) })),
  setWindow: (viewportId, windowWidth, windowCenter, windowInitialized = true) => set((state) => ({ viewports: state.viewports.map((vp) => (vp.id === viewportId ? { ...vp, windowWidth, windowCenter, windowInitialized } : vp)) })),
  updateCamera: (viewportId, patch) =>
    set((state) => ({
      viewports: state.viewports.map((vp) =>
        vp.id === viewportId ? { ...vp, camera: { ...vp.camera, ...patch, pan: patch.pan ? { ...patch.pan } : vp.camera.pan } } : vp
      )
    })),
  resetCamera: (viewportId) => set((state) => ({ viewports: state.viewports.map((vp) => (vp.id === viewportId ? { ...vp, camera: { ...defaultCamera, pan: { x: 0, y: 0 } } } : vp)) })),
  setRenderTime: (renderTimeMs) => set({ renderTimeMs }),
  toggleCine: () => set((state) => ({ cinePlaying: !state.cinePlaying })),
  setCineFps: (cineFps) => set({ cineFps })
}));
