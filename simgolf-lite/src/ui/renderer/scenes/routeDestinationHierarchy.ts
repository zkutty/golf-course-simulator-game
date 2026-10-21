import { getPinPosition } from "../../../game/models/courseSetup";
import type { Hole, PinRotation, Point } from "../../../game/models/types";

/** Pure route geometry needed before the deferred world scene is activated. */
export function routeDestinationHierarchy(
  hole: Hole | undefined,
  activePinRotation: PinRotation,
  solverDestinations: readonly Point[] | undefined,
): readonly Point[] {
  const pin = hole && (getPinPosition(hole, activePinRotation) ?? getPinPosition(hole, "A"));
  const source = hole?.waypoints?.length ? hole.waypoints : solverDestinations ?? [];
  const seen = new Set<string>();
  const hierarchy: Point[] = [];
  for (const point of source) {
    const key = `${point.x}:${point.y}`;
    if (pin && point.x === pin.x && point.y === pin.y || seen.has(key)) continue;
    seen.add(key);
    hierarchy.push({ ...point });
  }
  if (pin) hierarchy.push({ ...pin });
  return hierarchy;
}
