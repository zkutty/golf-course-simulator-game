import { isoToWorld, worldToIso, type IsoRotation } from "./iso";

export const WHEEL_LINE_HEIGHT_PX = 16;
export const MAX_WHEEL_DELTA_PX = 240;
export const WHEEL_ZOOM_RATE = 0.0012;

export interface WheelZoomCamera {
  cx: number;
  cy: number;
  zoom: number;
}

export interface WheelZoomViewport {
  width: number;
  height: number;
}

export interface WheelZoomCursor {
  x: number;
  y: number;
}

/** Normalize DOM_DELTA_PIXEL/LINE/PAGE without guessing the input device. */
export function normalizeWheelDelta(deltaY: number, deltaMode: number, pageHeight: number): number {
  const pixels = deltaMode === 1
    ? deltaY * WHEEL_LINE_HEIGHT_PX
    : deltaMode === 2
      ? deltaY * pageHeight
      : deltaY;
  return Math.max(-MAX_WHEEL_DELTA_PX, Math.min(MAX_WHEEL_DELTA_PX, pixels));
}

/**
 * Convert Safari's relative pinch scale into the same logarithmic delta used
 * by wheel zoom. A scale above 1 zooms in; below 1 zooms out.
 */
export function gestureScaleToWheelDelta(scaleRatio: number): number {
  if (!Number.isFinite(scaleRatio) || scaleRatio <= 0) return 0;
  return -Math.log(scaleRatio) / WHEEL_ZOOM_RATE;
}

/**
 * Build the next camera target while preserving the iso-plane point under the
 * cursor. The caller must pass the previous *target*, not the rendered camera,
 * so dense trackpad streams accumulate monotonically while rendering eases.
 */
export function nextWheelZoomTarget(args: {
  camera: WheelZoomCamera;
  cursor: WheelZoomCursor;
  viewport: WheelZoomViewport;
  deltaPixels: number;
  rotation: IsoRotation;
  minZoom: number;
  maxZoom: number;
}): WheelZoomCamera {
  const { camera, cursor, viewport, rotation } = args;
  const centerIso = worldToIso(camera.cx, camera.cy, 0, rotation);
  const anchorIso = {
    x: centerIso.x + (cursor.x - viewport.width / 2) / camera.zoom,
    y: centerIso.y + (cursor.y - viewport.height / 2) / camera.zoom,
  };
  const zoom = Math.max(
    args.minZoom,
    Math.min(args.maxZoom, camera.zoom * Math.exp(-args.deltaPixels * WHEEL_ZOOM_RATE)),
  );
  const pivotIso = {
    x: anchorIso.x - (cursor.x - viewport.width / 2) / zoom,
    y: anchorIso.y - (cursor.y - viewport.height / 2) / zoom,
  };
  const center = isoToWorld(pivotIso.x, pivotIso.y, rotation);
  return { cx: center.x, cy: center.y, zoom };
}
