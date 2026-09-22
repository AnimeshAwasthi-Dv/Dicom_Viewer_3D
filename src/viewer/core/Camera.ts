export interface CameraState {
  zoom: number;
  pan: { x: number; y: number };
  rotation: 0 | 90 | 180 | 270;
  flipH: boolean;
  flipV: boolean;
  inverted: boolean;
}

export const defaultCamera: CameraState = {
  zoom: 1,
  pan: { x: 0, y: 0 },
  rotation: 0,
  flipH: false,
  flipV: false,
  inverted: false
};

