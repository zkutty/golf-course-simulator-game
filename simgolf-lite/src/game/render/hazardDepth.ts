import type { Terrain } from "../models/types";

export type RecessedHazardTerrain = "sand" | "water" | "wetland";

export interface HazardDepthProfile {
  readonly terrain: RecessedHazardTerrain;
  /** Width of the undisturbed grade immediately outside the shared boundary. */
  readonly shelfWidth: number;
  /** Horizontal run from the shared boundary to the bottom of the bank face. */
  readonly bankWidth: number;
  /** Narrow dark seam at the foot of the bank. */
  readonly contactWidth: number;
  /** Readable near-surface zone before the uninterrupted floor/deep plane. */
  readonly shallowWidth: number;
  /** Final transition run into the uninterrupted floor/deep plane. */
  readonly deepWidth: number;
  /** Minimum vertical separation between surrounding grade and hazard plane. */
  readonly minimumBankDrop: number;
  /** Presentation-only drop at the middle of a bunker. */
  readonly floorDrop: number;
  /** Distance over which the bunker floor reaches `floorDrop`. */
  readonly recessionRun: number;
}

const WATER_PROFILE: HazardDepthProfile = Object.freeze({
  terrain: "water",
  shelfWidth: 0.16,
  bankWidth: 0.24,
  contactWidth: 0.07,
  shallowWidth: 0.22,
  deepWidth: 0.17,
  minimumBankDrop: 0.82,
  floorDrop: 0,
  recessionRun: 0,
});

const WETLAND_PROFILE: HazardDepthProfile = Object.freeze({
  terrain: "wetland",
  shelfWidth: 0.13,
  bankWidth: 0.22,
  contactWidth: 0.06,
  shallowWidth: 0.18,
  deepWidth: 0.14,
  minimumBankDrop: 0.65,
  floorDrop: 0,
  recessionRun: 0,
});

/**
 * Presentation-only cross-section for a recessed hazard. It deliberately owns
 * no reeds, stones, texture, simulation height, or camera state. Shared
 * contours decide where the section runs; ecology and material fields remain
 * the sole owners of dressing and interior texture.
 */
export function hazardDepthProfile(
  terrain: Terrain,
  componentCellCount = 1,
): HazardDepthProfile | null {
  if (terrain === "water") return WATER_PROFILE;
  if (terrain === "wetland") return WETLAND_PROFILE;
  if (terrain !== "sand") return null;
  const floorDrop = componentCellCount === 1
    ? 0.7
    : componentCellCount <= 4
      ? 0.62
      : 0.55;
  return {
    terrain: "sand",
    shelfWidth: 0.12,
    bankWidth: 0.26,
    contactWidth: 0.07,
    shallowWidth: 0.14,
    deepWidth: 0.11,
    minimumBankDrop: 0.55,
    floorDrop,
    recessionRun: 0.26,
  };
}

/** Smoothstep recession: zero at grade, strictly increasing, flat at floor. */
export function hazardInteriorDropAt(
  profile: HazardDepthProfile,
  boundaryDistance: number,
): number {
  if (profile.floorDrop <= 0 || profile.recessionRun <= 0) return 0;
  const t = Math.max(0, Math.min(1, boundaryDistance / profile.recessionRun));
  const eased = t * t * (3 - 2 * t);
  return eased * profile.floorDrop;
}

export interface HazardDepthOffsets {
  readonly shelfOuter: number;
  readonly boundary: 0;
  readonly bankInner: number;
  readonly contactInner: number;
  readonly shallowInner: number;
  readonly deepInner: number;
}

export interface HazardBankPoint {
  readonly x: number;
  readonly y: number;
}

export interface HazardBankFacePlan {
  readonly terrain: RecessedHazardTerrain;
  /**
   * The accepted dense shared contour, copied once for this ring. The renderer
   * consumes it verbatim for both the upper strip row and the closed top lip.
   */
  readonly outerRing: readonly HazardBankPoint[];
  /**
   * A joined inward offset of `outerRing`. Its indexed correspondence means
   * adjacent bank triangles share endpoints instead of independently deriving
   * a second endpoint for every source edge.
   */
  readonly innerRing: readonly HazardBankPoint[];
  /**
   * Two triangles per closed-ring segment. Vertex `2n` is outer `n`; vertex
   * `2n + 1` is inner `n`. This is an indexed, deterministic strip rather
   * than a collection of edge-local filled quadrilaterals.
   */
  readonly stripIndices: readonly number[];
  /** A stroke-only cue at the top edge; it never owns an additional fill. */
  readonly lip: {
    readonly offset: 0;
    readonly width: number;
    readonly alpha: number;
  };
  /** Explicit integration contract: rejected multi-band fills are absent. */
  readonly suppressedFillKinds: readonly ["shelf", "contact", "shallow", "deep"];
}

const HAZARD_EPSILON = 1e-6;

function samePoint(a: HazardBankPoint, b: HazardBankPoint): boolean {
  return Math.abs(a.x - b.x) <= HAZARD_EPSILON && Math.abs(a.y - b.y) <= HAZARD_EPSILON;
}

function signedCross(a: HazardBankPoint, b: HazardBankPoint, c: HazardBankPoint): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function signedArea(ring: readonly HazardBankPoint[]): number {
  let area = 0;
  for (let index = 0; index < ring.length; index++) {
    const current = ring[index];
    const next = ring[(index + 1) % ring.length];
    area += current.x * next.y - next.x * current.y;
  }
  return area / 2;
}

function properSegmentIntersection(
  a: HazardBankPoint,
  b: HazardBankPoint,
  c: HazardBankPoint,
  d: HazardBankPoint,
): boolean {
  const abC = signedCross(a, b, c);
  const abD = signedCross(a, b, d);
  const cdA = signedCross(c, d, a);
  const cdB = signedCross(c, d, b);
  return Math.abs(abC) > HAZARD_EPSILON && Math.abs(abD) > HAZARD_EPSILON &&
    Math.abs(cdA) > HAZARD_EPSILON && Math.abs(cdB) > HAZARD_EPSILON &&
    (abC > 0) !== (abD > 0) && (cdA > 0) !== (cdB > 0);
}

function hasProperSelfIntersection(ring: readonly HazardBankPoint[]): boolean {
  for (let first = 0; first < ring.length; first++) {
    const firstNext = (first + 1) % ring.length;
    for (let second = first + 1; second < ring.length; second++) {
      const secondNext = (second + 1) % ring.length;
      // Neighbouring edges meet by design. The first and final edge are also
      // neighbours in a closed ring.
      if (first === second || firstNext === second || secondNext === first) continue;
      if (properSegmentIntersection(ring[first], ring[firstNext], ring[second], ring[secondNext])) return true;
    }
  }
  return false;
}

function cleanClosedRing(
  ring: readonly { readonly x: number; readonly y: number }[],
): HazardBankPoint[] {
  const output: HazardBankPoint[] = [];
  for (const point of ring) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return [];
    const copy = { x: point.x, y: point.y };
    if (!output.length || !samePoint(output[output.length - 1], copy)) output.push(copy);
  }
  if (output.length > 1 && samePoint(output[0], output[output.length - 1])) output.pop();
  return output;
}

function joinedInnerRing(
  outerRing: readonly HazardBankPoint[],
  requestedWidth: number,
): HazardBankPoint[] | null {
  // A contour traced by landscapeGeometry keeps its filled component on the
  // right of every directed edge, including hole rings. Therefore the right
  // normal is consistently the hazard-side direction without a camera- or
  // screen-space branch.
  for (let scale = 1; scale >= 0.1; scale *= 0.72) {
    const width = requestedWidth * scale;
    const innerRing: HazardBankPoint[] = [];
    for (let index = 0; index < outerRing.length; index++) {
      const previous = outerRing[(index - 1 + outerRing.length) % outerRing.length];
      const current = outerRing[index];
      const next = outerRing[(index + 1) % outerRing.length];
      const previousLength = Math.hypot(current.x - previous.x, current.y - previous.y);
      const nextLength = Math.hypot(next.x - current.x, next.y - current.y);
      if (previousLength <= HAZARD_EPSILON || nextLength <= HAZARD_EPSILON) {
        innerRing.length = 0;
        break;
      }
      const previousNormal = {
        x: (current.y - previous.y) / previousLength,
        y: -(current.x - previous.x) / previousLength,
      };
      const nextNormal = {
        x: (next.y - current.y) / nextLength,
        y: -(next.x - current.x) / nextLength,
      };
      const bisectorLength = Math.hypot(
        previousNormal.x + nextNormal.x,
        previousNormal.y + nextNormal.y,
      );
      if (bisectorLength <= HAZARD_EPSILON) {
        innerRing.length = 0;
        break;
      }
      const bisector = {
        x: (previousNormal.x + nextNormal.x) / bisectorLength,
        y: (previousNormal.y + nextNormal.y) / bisectorLength,
      };
      // Keep an exact normal-width offset where the miter is tame, but bound
      // acute turns so dense canonical samples cannot grow long fins.
      const normalAlignment = Math.max(0.5, Math.abs(bisector.x * nextNormal.x + bisector.y * nextNormal.y));
      const miter = Math.min(width / normalAlignment, width * 1.6);
      innerRing.push({ x: current.x + bisector.x * miter, y: current.y + bisector.y * miter });
    }
    if (innerRing.length !== outerRing.length || hasProperSelfIntersection(innerRing)) continue;
    if (Math.abs(signedArea(innerRing)) <= HAZARD_EPSILON) continue;
    let valid = true;
    for (let index = 0; index < outerRing.length; index++) {
      const next = (index + 1) % outerRing.length;
      if (
        Math.abs(signedCross(outerRing[index], outerRing[next], innerRing[index])) <= HAZARD_EPSILON ||
        Math.abs(signedCross(outerRing[next], innerRing[next], innerRing[index])) <= HAZARD_EPSILON
      ) {
        valid = false;
        break;
      }
    }
    if (!valid) continue;
    // A valid skirt cannot cross the source contour: that would place a floor
    // vertex back through the grade at a tight concave turn.
    for (let outer = 0; outer < outerRing.length && valid; outer++) {
      const outerNext = (outer + 1) % outerRing.length;
      for (let inner = 0; inner < innerRing.length; inner++) {
        const innerNext = (inner + 1) % innerRing.length;
        if (properSegmentIntersection(outerRing[outer], outerRing[outerNext], innerRing[inner], innerRing[innerNext])) {
          valid = false;
          break;
        }
      }
    }
    if (valid) return innerRing;
  }
  return null;
}

/**
 * Produces the replacement one-face plan used by the renderer integration.
 *
 * `buildHazardDepthSections` remains in landscapeGeometry as the frozen
 * compatibility adapter until that integration lands. New presentation code
 * must consume this plan instead: it has no shallow/contact/deep fill areas
 * to accidentally layer back into the scene.
 */
export function buildHazardBankFacePlan(
  terrain: Terrain,
  componentCellCount: number,
  ring: readonly { readonly x: number; readonly y: number }[],
): HazardBankFacePlan | null {
  const profile = hazardDepthProfile(terrain, componentCellCount);
  const outerRing = cleanClosedRing(ring);
  if (!profile || outerRing.length < 3 || Math.abs(signedArea(outerRing)) <= HAZARD_EPSILON) return null;
  const innerRing = joinedInnerRing(outerRing, profile.bankWidth);
  if (!innerRing) return null;
  const stripIndices: number[] = [];
  for (let index = 0; index < outerRing.length; index++) {
    const next = (index + 1) % outerRing.length;
    stripIndices.push(index * 2, next * 2, index * 2 + 1, next * 2, next * 2 + 1, index * 2 + 1);
  }
  return Object.freeze({
    terrain: profile.terrain,
    outerRing: Object.freeze(outerRing.map((point) => Object.freeze({ ...point }))),
    innerRing: Object.freeze(innerRing.map((point) => Object.freeze({ ...point }))),
    stripIndices: Object.freeze(stripIndices),
    lip: Object.freeze({
      offset: 0,
      width: profile.terrain === "sand" ? 1.05 : 0.9,
      alpha: profile.terrain === "sand" ? 0.5 : 0.38,
    }),
    suppressedFillKinds: Object.freeze(["shelf", "contact", "shallow", "deep"] as const),
  });
}

/**
 * Bounded edge-local offsets. Short rounded contour samples taper together,
 * avoiding mitre fins and strip inversions while preserving the section order.
 */
export function hazardDepthOffsets(
  profile: HazardDepthProfile,
  edgeLength: number,
): HazardDepthOffsets {
  const finiteLength = Number.isFinite(edgeLength) ? Math.max(0, edgeLength) : 0;
  const scale = Math.max(0.3, Math.min(1, finiteLength / 0.34));
  const shelf = profile.shelfWidth * scale;
  const bank = profile.bankWidth * scale;
  const contact = profile.contactWidth * scale;
  const shallow = profile.shallowWidth * scale;
  const deep = profile.deepWidth * scale;
  return {
    shelfOuter: -shelf,
    boundary: 0,
    bankInner: bank,
    contactInner: bank + contact,
    shallowInner: bank + contact + shallow,
    deepInner: Math.min(0.72, bank + contact + shallow + deep),
  };
}
