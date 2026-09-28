import { utilities as csUtilities, type StackViewport, type Types } from '@cornerstonejs/core';
import { utilities as toolUtilities } from '@cornerstonejs/tools';
import type { CameraState } from '../core/Camera';

const ROTATIONS = [0, 90, 180, 270] as const;

function nearestRotation(degrees: number): CameraState['rotation'] {
  const normalized = ((Math.round(degrees / 90) * 90) % 360 + 360) % 360;
  return ROTATIONS.find((rotation) => rotation === normalized) ?? 0;
}

/**
 * The viewport's presentation in remote-control terms: zoom relative to fit, pan as the image's shift in CSS pixels
 * (right and down positive; Cornerstone measures pan the same way), quarter-turn rotation, flips and inversion.
 */
export function readCamera(viewport: StackViewport): CameraState {
  const [x, y] = viewport.getPan();
  const { flipHorizontal = false, flipVertical = false } = viewport.getCamera();
  return {
    zoom: viewport.getZoom(),
    pan: { x, y },
    rotation: nearestRotation(viewport.getViewPresentation().rotation ?? 0),
    flipH: flipHorizontal,
    flipV: flipVertical,
    inverted: Boolean(viewport.getProperties().invert)
  };
}

const close = (a: number, b: number, tolerance: number) => Math.abs(a - b) <= tolerance;

/** Applies what differs; returns whether anything changed. */
export function applyCamera(viewport: StackViewport, camera: CameraState): boolean {
  const current = readCamera(viewport);
  let changed = false;
  if (current.flipH !== camera.flipH || current.flipV !== camera.flipV) {
    viewport.setCamera({ flipHorizontal: camera.flipH, flipVertical: camera.flipV });
    changed = true;
  }
  if (current.rotation !== camera.rotation) {
    viewport.setViewPresentation({ rotation: camera.rotation });
    changed = true;
  }
  if (!close(current.zoom, camera.zoom, 1e-3)) {
    viewport.setZoom(camera.zoom);
    changed = true;
  }
  const pan = readCamera(viewport).pan;
  if (!close(pan.x, camera.pan.x, 0.5) || !close(pan.y, camera.pan.y, 0.5)) {
    viewport.setPan([camera.pan.x, camera.pan.y] as Types.Point2);
    changed = true;
  }
  if (current.inverted !== camera.inverted) {
    viewport.setProperties({ invert: camera.inverted });
    changed = true;
  }
  return changed;
}

/** Window width and centre as DICOM defines them (PS3.3 C.11.2.1.2); Cornerstone stores the linear VOI as a range. */
export function toWindow(range?: { lower: number; upper: number }): { width: number; center: number } | undefined {
  if (!range) return undefined;
  const { windowWidth, windowCenter } = csUtilities.windowLevel.toWindowLevel(range.lower, range.upper);
  return { width: windowWidth, center: windowCenter };
}

export function toRange(width: number, center: number): { lower: number; upper: number } {
  return csUtilities.windowLevel.toLowHighRange(width, center);
}

export function readWindow(viewport: StackViewport): { width: number; center: number } | undefined {
  return toWindow(viewport.getProperties().voiRange);
}

export function applyWindow(viewport: StackViewport, width: number, center: number): boolean {
  const current = readWindow(viewport);
  if (current && close(current.width, width, 1e-3) && close(current.center, center, 1e-3)) return false;
  viewport.setProperties({ voiRange: toRange(width, center) });
  return true;
}

/** Patient-orientation letters at the four edges of the viewport, from its camera (L/R, A/P, H/F in LPS). */
export function orientationMarkers(viewport: StackViewport): { top: string; bottom: string; left: string; right: string } | undefined {
  const { viewUp, viewPlaneNormal } = viewport.getCamera();
  if (!viewUp || !viewPlaneNormal) return undefined;
  const right: Types.Point3 = [
    viewUp[1] * viewPlaneNormal[2] - viewUp[2] * viewPlaneNormal[1],
    viewUp[2] * viewPlaneNormal[0] - viewUp[0] * viewPlaneNormal[2],
    viewUp[0] * viewPlaneNormal[1] - viewUp[1] * viewPlaneNormal[0]
  ];
  const { getOrientationStringLPS, invertOrientationStringLPS } = toolUtilities.orientation;
  const top = getOrientationStringLPS(viewUp as Types.Point3);
  const rightLabel = getOrientationStringLPS(right);
  if (!top || !rightLabel) return undefined;
  return { top, bottom: invertOrientationStringLPS(top), right: rightLabel, left: invertOrientationStringLPS(rightLabel) };
}
