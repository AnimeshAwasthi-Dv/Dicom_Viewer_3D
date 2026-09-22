import { createViewport, type ViewportState } from './Viewport';

export type ViewportLayout = '1x1' | '1x2' | '2x1' | '2x2';

export function viewportCount(layout: ViewportLayout): number {
  return layout === '1x1' ? 1 : layout === '2x2' ? 4 : 2;
}

export function createViewports(layout: ViewportLayout): ViewportState[] {
  return Array.from({ length: viewportCount(layout) }, (_, index) => createViewport(`viewport-${index + 1}`));
}

