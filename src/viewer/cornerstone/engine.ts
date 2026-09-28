import { getRenderingEngine, RenderingEngine } from '@cornerstonejs/core';

export const RENDERING_ENGINE_ID = 'decxpert';

/** The one rendering engine every viewport (2D, MPR and 3D) belongs to. */
export function renderingEngine(): RenderingEngine {
  return (getRenderingEngine(RENDERING_ENGINE_ID) as RenderingEngine | undefined) ?? new RenderingEngine(RENDERING_ENGINE_ID);
}
