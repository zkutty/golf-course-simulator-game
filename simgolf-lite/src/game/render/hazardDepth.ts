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
  bankWidth: 0.18,
  contactWidth: 0.07,
  shallowWidth: 0.22,
  deepWidth: 0.17,
  minimumBankDrop: 0.56,
  floorDrop: 0,
  recessionRun: 0,
});

const WETLAND_PROFILE: HazardDepthProfile = Object.freeze({
  terrain: "wetland",
  shelfWidth: 0.13,
  bankWidth: 0.16,
  contactWidth: 0.06,
  shallowWidth: 0.18,
  deepWidth: 0.14,
  minimumBankDrop: 0.42,
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
    ? 0.42
    : componentCellCount <= 4
      ? 0.36
      : 0.3;
  return {
    terrain: "sand",
    shelfWidth: 0.12,
    bankWidth: 0.14,
    contactWidth: 0.07,
    shallowWidth: 0.14,
    deepWidth: 0.11,
    minimumBankDrop: 0.34,
    floorDrop,
    recessionRun: 0.48,
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
