import type { DecodedFrame } from '../../types/dicom';
import type { CameraState } from './Camera';

export interface RenderOptions {
  windowWidth: number;
  windowCenter: number;
  camera: CameraState;
}

export interface RenderingEngine {
  render(frame: DecodedFrame, options: RenderOptions): number;
  resize(width: number, height: number): void;
  dispose(): void;
}

