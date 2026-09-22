import type { CameraState } from './Camera';
import { defaultCamera } from './Camera';

export interface ViewportState {
  id: string;
  seriesId?: string;
  instanceIndex: number;
  windowWidth: number;
  windowCenter: number;
  windowInitialized: boolean;
  camera: CameraState;
}

export function createViewport(id: string): ViewportState {
  return {
    id,
    instanceIndex: 0,
    windowWidth: 400,
    windowCenter: 40,
    windowInitialized: false,
    camera: { ...defaultCamera, pan: { ...defaultCamera.pan } }
  };
}
