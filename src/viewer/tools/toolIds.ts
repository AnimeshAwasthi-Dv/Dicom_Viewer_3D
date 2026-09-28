/** Viewer tools, as named in remote-control state. Kept free of imports: the server validates against this list. */
export const TOOL_IDS = [
  'scroll', 'windowLevel', 'pan', 'zoom',
  'length', 'angle', 'cobbAngle', 'bidirectional', 'probe', 'annotation',
  'rectangleRoi', 'ellipseRoi', 'circleRoi', 'freehandRoi', 'splineRoi', 'livewire'
] as const;

export type ToolId = (typeof TOOL_IDS)[number];

/** Tools that create measurements (as opposed to navigating the image). */
export const MEASUREMENT_TOOL_IDS = TOOL_IDS.filter((id): id is Exclude<ToolId, 'scroll' | 'windowLevel' | 'pan' | 'zoom'> =>
  !['scroll', 'windowLevel', 'pan', 'zoom'].includes(id));
export type MeasurementType = (typeof MEASUREMENT_TOOL_IDS)[number];
