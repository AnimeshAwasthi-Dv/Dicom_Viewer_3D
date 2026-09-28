import {
  addTool,
  AngleTool,
  ArrowAnnotateTool,
  BidirectionalTool,
  CircleROITool,
  CobbAngleTool,
  CrosshairsTool,
  EllipticalROITool,
  Enums as ToolEnums,
  LengthTool,
  LivewireContourTool,
  PanTool,
  PlanarFreehandROITool,
  ProbeTool,
  RectangleROITool,
  SplineROITool,
  StackScrollTool,
  ToolGroupManager,
  TrackballRotateTool,
  WindowLevelTool,
  ZoomTool
} from '@cornerstonejs/tools';
import type { ToolId } from '../tools/toolIds';
import { requestText } from './textPrompt';

type ToolGroup = NonNullable<ReturnType<typeof ToolGroupManager.getToolGroup>>;

/** Our tool names to Cornerstone's. */
export const CORNERSTONE_TOOL: Record<ToolId, string> = {
  scroll: StackScrollTool.toolName,
  windowLevel: WindowLevelTool.toolName,
  pan: PanTool.toolName,
  zoom: ZoomTool.toolName,
  length: LengthTool.toolName,
  angle: AngleTool.toolName,
  cobbAngle: CobbAngleTool.toolName,
  bidirectional: BidirectionalTool.toolName,
  probe: ProbeTool.toolName,
  annotation: ArrowAnnotateTool.toolName,
  rectangleRoi: RectangleROITool.toolName,
  ellipseRoi: EllipticalROITool.toolName,
  circleRoi: CircleROITool.toolName,
  freehandRoi: PlanarFreehandROITool.toolName,
  splineRoi: SplineROITool.toolName,
  livewire: LivewireContourTool.toolName
};

export const TOOL_FOR_CORNERSTONE = Object.fromEntries(Object.entries(CORNERSTONE_TOOL).map(([id, name]) => [name, id as ToolId])) as Record<string, ToolId>;

const { MouseBindings, KeyboardBindings } = ToolEnums;
type Binding = { mouseButton?: number; numTouchPoints?: number; modifierKey?: number };

/**
 * Gestures that work whichever tool is selected: wheel scrolls slices, Ctrl+wheel and right-drag zoom, middle-drag
 * pans, and pinch zooms on touch screens.
 */
const STANDING_BINDINGS: Partial<Record<string, Binding[]>> = {
  [StackScrollTool.toolName]: [{ mouseButton: MouseBindings.Wheel }],
  [ZoomTool.toolName]: [{ mouseButton: MouseBindings.Secondary }, { numTouchPoints: 2 }, { mouseButton: MouseBindings.Wheel, modifierKey: KeyboardBindings.Ctrl }],
  [PanTool.toolName]: [{ mouseButton: MouseBindings.Auxiliary }]
};

export const STACK_TOOL_GROUP = 'decxpert-stack';
export const MPR_TOOL_GROUP = 'decxpert-mpr';
export const VOLUME_3D_TOOL_GROUP = 'decxpert-volume3d';

const ALL_TOOLS = [
  StackScrollTool, WindowLevelTool, PanTool, ZoomTool, LengthTool, AngleTool, CobbAngleTool, BidirectionalTool,
  ProbeTool, ArrowAnnotateTool, RectangleROITool, EllipticalROITool, CircleROITool, PlanarFreehandROITool,
  SplineROITool, LivewireContourTool, CrosshairsTool, TrackballRotateTool
];

export function registerTools(): void {
  ALL_TOOLS.forEach((tool) => addTool(tool));
}

const arrowConfiguration = {
  // Our own text box instead of window.prompt, which is blocked in some embedded frames.
  getTextCallback: (done: (text?: string) => void) => { void requestText('').then((text) => done(text ?? undefined)); },
  changeTextCallback: (data: { text?: string }, _event: unknown, done: (text?: string) => void) => { void requestText(data.text ?? '').then((text) => done(text ?? data.text)); }
};

/** The tool group shared by the 2D viewports, created on first use. */
export function stackToolGroup(): ToolGroup {
  const existing = ToolGroupManager.getToolGroup(STACK_TOOL_GROUP);
  if (existing) return existing;
  const group = ToolGroupManager.createToolGroup(STACK_TOOL_GROUP)!;
  for (const [id, name] of Object.entries(CORNERSTONE_TOOL)) {
    if (id === 'annotation') group.addTool(name, arrowConfiguration);
    // Loop: scrolling past the last slice doesn't wrap; the scroll tool drags through the whole stack.
    else if (id === 'scroll') group.addTool(name, { loop: false });
    else group.addTool(name);
  }
  return group;
}

/** Makes `toolId` the primary-button and one-finger tool of `group`, keeping the standing gestures. */
export function setPrimaryTool(group: ToolGroup, toolId: ToolId): void {
  const primary = CORNERSTONE_TOOL[toolId];
  for (const name of Object.values(CORNERSTONE_TOOL)) {
    // Remove touch bindings too, or the previous tool keeps handling one-finger gestures.
    group.setToolPassive(name, { removeAllBindings: true });
  }
  for (const name of Object.values(CORNERSTONE_TOOL)) {
    const bindings: Binding[] = [...(STANDING_BINDINGS[name] ?? [])];
    if (name === primary) bindings.push({ mouseButton: MouseBindings.Primary }, { numTouchPoints: 1 });
    if (bindings.length) group.setToolActive(name, { bindings });
  }
}
