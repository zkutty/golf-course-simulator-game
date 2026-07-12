/**
 * Isometric (2:1 dimetric) projection core — ZKU-137.
 *
 * Pure math, no PIXI/DOM imports. All renderers, picking, and depth sorting
 * derive from these functions so world↔screen conversion has exactly one
 * definition.
 *
 * Conventions:
 * - World coordinates are continuous tile-space values. Integer coordinates
 *   are grid VERTICES; tile (i, j) occupies [i, i+1] × [j, j+1] and its
 *   center is (i + 0.5, j + 0.5).
 * - worldToIso projects a world point to screen-space pixels where the world
 *   origin projects to (0, 0). Camera pan/zoom is applied by the renderer on
 *   top of this projection, never inside it.
 * - Camera rotation is one of four cardinal steps. It is modeled as a
 *   world-axis remap (rotate the world, then project) so that picking and
 *   depth sorting stay exact — not as a screen-space transform.
 * - +elevation moves a point visually UP the screen (negative screen y).
 */

export const TILE_W = 64; // diamond width in px at zoom 1
export const TILE_H = 32; // diamond height in px at zoom 1 (2:1 dimetric)
export const ELEVATION_STEP_PX = 8; // vertical px offset per elevation step

/** Small bias so higher terrain sorts in front of equal-(x+y) ground. */
export const ELEVATION_DEPTH_BIAS = 1e-3;

export type IsoRotation = 0 | 90 | 180 | 270;

export const ISO_ROTATIONS: readonly IsoRotation[] = [0, 90, 180, 270];

export interface IsoPoint {
  x: number;
  y: number;
}

/** Rotate the next cardinal step clockwise (Q/E camera controls). */
export function nextRotation(rotation: IsoRotation, direction: 1 | -1): IsoRotation {
  const idx = ISO_ROTATIONS.indexOf(rotation);
  return ISO_ROTATIONS[(idx + direction + 4) % 4];
}

/**
 * Remap a continuous world point for a cardinal camera rotation
 * (clockwise rotation of the world about the origin).
 */
export function rotateWorld(x: number, y: number, rotation: IsoRotation): IsoPoint {
  // `+ 0` normalizes -0 to +0 so projected coordinates and depth keys are
  // Object.is-stable regardless of rotation.
  switch (rotation) {
    case 0:
      return { x, y };
    case 90:
      return { x: y, y: -x + 0 };
    case 180:
      return { x: -x + 0, y: -y + 0 };
    case 270:
      return { x: -y + 0, y: x };
  }
}

/** Inverse of {@link rotateWorld}. */
export function unrotateWorld(x: number, y: number, rotation: IsoRotation): IsoPoint {
  switch (rotation) {
    case 0:
      return { x, y };
    case 90:
      return { x: -y + 0, y: x };
    case 180:
      return { x: -x + 0, y: -y + 0 };
    case 270:
      return { x: y, y: -x + 0 };
  }
}

/**
 * Project a continuous world point (tile space) to screen-space pixels.
 * Elevation raises the point vertically on screen.
 */
export function worldToIso(
  x: number,
  y: number,
  elevation: number = 0,
  rotation: IsoRotation = 0
): IsoPoint {
  const r = rotateWorld(x, y, rotation);
  return {
    x: (r.x - r.y) * (TILE_W / 2),
    y: (r.x + r.y) * (TILE_H / 2) - elevation * ELEVATION_STEP_PX,
  };
}

/**
 * Inverse projection: screen-space pixels back to continuous world
 * coordinates, ignoring elevation (callers that need elevation-aware picking
 * iterate elevation levels front-to-back and call this with an adjusted
 * screen y — see ZKU-144).
 */
export function isoToWorld(
  screenX: number,
  screenY: number,
  rotation: IsoRotation = 0
): IsoPoint {
  const rx = screenX / TILE_W + screenY / TILE_H;
  const ry = screenY / TILE_H - screenX / TILE_W;
  return unrotateWorld(rx, ry, rotation);
}

/**
 * The tile containing a screen point (integer tile coords, may be outside
 * course bounds — callers clamp/validate).
 */
export function isoToTile(
  screenX: number,
  screenY: number,
  rotation: IsoRotation = 0
): IsoPoint {
  const w = isoToWorld(screenX, screenY, rotation);
  return { x: Math.floor(w.x), y: Math.floor(w.y) };
}

/** Screen position of a tile's center. */
export function tileCenterIso(
  tileX: number,
  tileY: number,
  elevation: number = 0,
  rotation: IsoRotation = 0
): IsoPoint {
  return worldToIso(tileX + 0.5, tileY + 0.5, elevation, rotation);
}

/**
 * The 4 projected corners of a tile's ground diamond, in world corner order
 * (tileX,tileY), (tileX+1,tileY), (tileX+1,tileY+1), (tileX,tileY+1).
 * Neighboring tiles share corner values exactly (same inputs → same output).
 */
export function tileDiamondCorners(
  tileX: number,
  tileY: number,
  elevation: number = 0,
  rotation: IsoRotation = 0
): [IsoPoint, IsoPoint, IsoPoint, IsoPoint] {
  return [
    worldToIso(tileX, tileY, elevation, rotation),
    worldToIso(tileX + 1, tileY, elevation, rotation),
    worldToIso(tileX + 1, tileY + 1, elevation, rotation),
    worldToIso(tileX, tileY + 1, elevation, rotation),
  ];
}

/**
 * Back-to-front depth key: larger = closer to the camera = drawn later.
 * Works for continuous coordinates (moving entities) and integer tiles.
 * Elevation contributes a small bias so raised objects at the same ground
 * footprint sort in front of flat ones (full elevation-aware sorting lands
 * with ZKU-140/144 on top of this key).
 */
export function isoDepth(
  x: number,
  y: number,
  elevation: number = 0,
  rotation: IsoRotation = 0
): number {
  const r = rotateWorld(x, y, rotation);
  return r.x + r.y + elevation * ELEVATION_DEPTH_BIAS;
}
