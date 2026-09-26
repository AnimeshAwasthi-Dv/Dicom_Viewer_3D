export type ToolId = 'scroll' | 'windowLevel' | 'pan' | 'zoom' | 'length' | 'angle' | 'rectangleRoi' | 'ellipseRoi' | 'probe' | 'annotation';

export interface PointerToolContext {
  viewportId: string;
  imagePoint: { x: number; y: number };
  viewportPoint: { x: number; y: number };
  delta: { x: number; y: number };
  button: number;
  shiftKey: boolean;
}

export interface Tool {
  id: ToolId;
  cursor: string;
}
