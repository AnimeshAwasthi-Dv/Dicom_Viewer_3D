import { Enums, getRenderingEngine, RenderingEngine } from '@cornerstonejs/core';

export const RENDERING_ENGINE_ID = 'decxpert';

/** The one rendering engine every viewport (2D, MPR and 3D) belongs to. */
export function renderingEngine(): RenderingEngine {
  return (getRenderingEngine(RENDERING_ENGINE_ID) as RenderingEngine | undefined) ?? new RenderingEngine(RENDERING_ENGINE_ID);
}

let resizeFrame = 0;
let resizeObserver: ResizeObserver | undefined;

/** Fits every viewport to its element's new size, keeping zoom (relative to fit), pan, rotation and flips. */
function resizeViewports(): void {
  const engine = getRenderingEngine(RENDERING_ENGINE_ID) as RenderingEngine | undefined;
  if (!engine) return;
  // Cornerstone's own keep-camera option restores the old absolute scale, so a desktop-sized image is left cropped
  // in a phone-sized viewport. Refit instead, then put back the presentation relative to the new fit.
  const saved = engine.getViewports().map((viewport) => viewport.type === Enums.ViewportType.VOLUME_3D
    ? { viewport, camera: viewport.getCamera() }
    : { viewport, presentation: viewport.getViewPresentation() });
  engine.resize(true, false);
  for (const { viewport, camera, presentation } of saved) {
    if (camera) viewport.setCamera({ ...camera, parallelScale: viewport.getCamera().parallelScale });
    else viewport.setViewPresentation(presentation);
  }
  engine.render();
}

/**
 * Keeps an enabled element's canvas the size of the element. Cornerstone only reads the size when the element is
 * enabled, so without this a layout change (window resize, rotation, series panel, grid layout) stretches the old
 * canvas and distorts the image. One resize per frame covers every viewport.
 */
export function watchViewportSize(element: HTMLElement): () => void {
  resizeObserver ??= new ResizeObserver(() => {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(resizeViewports);
  });
  resizeObserver.observe(element);
  return () => resizeObserver?.unobserve(element);
}
