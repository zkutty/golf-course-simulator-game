import { entityDepth } from "./objectPlacement";
import { tileCenterIso, type IsoRotation } from "./iso";
import type { SegmentKind } from "../live/types";

/** The shadow is a child of the feet-anchored golfer holder, never a screen decal. */
export const GOLFER_CONTACT_SHADOW = Object.freeze({
  x: 1.5,
  y: 0.8,
  radiusX: 8,
  radiusY: 3.4,
  alpha: 0.18,
});

/** Grounding itself never allocates gameplay effects or duplicate entities. */
export const GOLFER_GROUNDING_RENDER_BUDGET = Object.freeze({
  holdersPerGolfer: 1,
  contactShadowsPerHolder: 1,
  newWorldEffectsPerTick: 0,
});

export interface GroundedGolferFrame {
  readonly elevation: number;
  readonly screen: { readonly x: number; readonly y: number };
  readonly depth: number;
  /** Local contact point. The holder's screen point is the sampled surface. */
  readonly shadow: typeof GOLFER_CONTACT_SHADOW;
}

/**
 * Single presentation authority for golfer feet, contact shadow, and depth.
 * Sampling the continuous landscape at the same tile-center point prevents
 * a crest/basin from separating the character from its terrain surface.
 */
export function groundedGolferFrame(
  x: number,
  y: number,
  rotation: IsoRotation,
  surfaceHeightAt: (x: number, y: number) => number,
): GroundedGolferFrame {
  const elevation = surfaceHeightAt(x + 0.5, y + 0.5);
  const screen = tileCenterIso(x, y, elevation, rotation);
  return {
    elevation,
    screen,
    depth: Math.round(entityDepth(x, y, elevation, rotation) * 10) / 10,
    shadow: GOLFER_CONTACT_SHADOW,
  };
}

/**
 * Distance-driven stride accumulation. Pauses, flights, and unchanged walk
 * positions retain the prior phase, so feet cannot slide while stationary.
 */
export function advanceGroundedWalkPhase(
  phase: number,
  previous: { readonly x: number; readonly y: number } | null,
  current: { readonly x: number; readonly y: number },
  segKind: SegmentKind | null,
  stridesPerTile: number,
): number {
  if (segKind !== "walk" || !previous) return phase;
  return phase + Math.hypot(current.x - previous.x, current.y - previous.y) * stridesPerTile;
}

/**
 * Deterministic ZK-330 capture matrix. This is data, not a simulation route:
 * live itinerary/routing remains owned by the existing walking authority.
 */
export const ZK330_GROUNDED_GOLFER_CAPTURE_MANIFEST = Object.freeze({
  version: 1,
  seed: "zk330-grounded-golfer-v1",
  traveller: Object.freeze({ id: 330, start: Object.freeze({ x: 2, y: 2 }), destination: Object.freeze({ x: 7, y: 2 }) }),
  traversal: Object.freeze([
    Object.freeze({ label: "flat-fairway", x: 2, y: 2, terrain: "fairway", elevation: 0 }),
    Object.freeze({ label: "gentle-rough-slope", x: 3, y: 2, terrain: "rough", elevation: 1 }),
    Object.freeze({ label: "crest-fairway", x: 4, y: 2, terrain: "fairway", elevation: 2 }),
    Object.freeze({ label: "basin-rough", x: 5, y: 2, terrain: "rough", elevation: 0 }),
    Object.freeze({ label: "green-destination", x: 7, y: 2, terrain: "green", elevation: 1 }),
  ]),
  bankCases: Object.freeze([
    Object.freeze({ label: "valid-bridge-crossing", expectedReachable: true }),
    Object.freeze({ label: "blocked-water-bank", expectedReachable: false }),
  ]),
  captures: Object.freeze([
    Object.freeze({ rotation: 0, graphicsQuality: "high", reducedMotion: false }),
    Object.freeze({ rotation: 90, graphicsQuality: "medium", reducedMotion: false }),
    Object.freeze({ rotation: 180, graphicsQuality: "low", reducedMotion: true }),
    Object.freeze({ rotation: 270, graphicsQuality: "high", reducedMotion: true }),
  ]),
});
