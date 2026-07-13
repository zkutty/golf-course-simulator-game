import {
  isoDepth,
  rotateWorld,
  worldToIso,
  type IsoPoint,
  type IsoRotation,
} from "./iso";

/**
 * Object placement & depth sorting (ZKU-140).
 *
 * Every object in the renderer's `objects` layer — props, golfers, balls,
 * future buildings — declares a FOOTPRINT (tile rect) and gets:
 *  - a ground-anchor screen position: the projected screen-front corner of
 *    the footprint (sprites use anchor (0.5, 1), "standing" on that point)
 *  - a zIndex depth key: the iso depth of the front-most footprint tile,
 *    so taller-behind objects draw behind and closer ones in front.
 *
 * Both are rotation-aware: which corner of a footprint is "front" changes
 * with the camera's cardinal rotation.
 */

export interface Footprint {
  /** Tile-space origin (top-left in world axes). Fractional for entities. */
  x: number;
  y: number;
  /** Size in tiles; 1×1 for props/golfers, up to 4×4 for buildings. */
  w: number;
  d: number;
}

export interface Placement {
  /** Screen position of the ground anchor (pair with sprite anchor (0.5, 1)). */
  position: IsoPoint;
  /** Depth key for zIndex within the objects layer. */
  zIndex: number;
}

/** The footprint corner that projects closest to the camera. */
export function frontCorner(fp: Footprint, rotation: IsoRotation): IsoPoint {
  const corners: IsoPoint[] = [
    { x: fp.x, y: fp.y },
    { x: fp.x + fp.w, y: fp.y },
    { x: fp.x + fp.w, y: fp.y + fp.d },
    { x: fp.x, y: fp.y + fp.d },
  ];
  let best = corners[0];
  let bestDepth = -Infinity;
  for (const c of corners) {
    const r = rotateWorld(c.x, c.y, rotation);
    const depth = r.x + r.y;
    if (depth > bestDepth) {
      bestDepth = depth;
      best = c;
    }
  }
  return best;
}

/**
 * Compute ground-anchor position and depth key for an object.
 *
 * The depth key uses the center of the front-most tile (not the corner) so
 * a 1×1 entity standing beside a multi-tile building on the same front row
 * sorts by its actual position, and elevation feeds the standard bias.
 */
export function placeObject(
  fp: Footprint,
  elevation: number,
  rotation: IsoRotation
): Placement {
  const corner = frontCorner(fp, rotation);
  const position = worldToIso(corner.x, corner.y, elevation, rotation);
  // Front-most tile center: half a tile back from the front corner along
  // both world axes of the footprint's near edge.
  const cx = corner.x === fp.x ? fp.x + 0.5 : fp.x + fp.w - 0.5;
  const cy = corner.y === fp.y ? fp.y + 0.5 : fp.y + fp.d - 0.5;
  return { position, zIndex: isoDepth(cx, cy, elevation, rotation) };
}

/**
 * Depth key for a point entity (golfer, ball) at continuous tile coords.
 * Matches placeObject's key space so entities interleave correctly with
 * footprint objects.
 */
export function entityDepth(
  tileX: number,
  tileY: number,
  elevation: number,
  rotation: IsoRotation
): number {
  return isoDepth(tileX + 0.5, tileY + 0.5, elevation, rotation);
}
