import type { ShotFlightProfile, ShotLie } from "./contracts";

/**
 * Versioned CourseCraft club/carry/dispersion registry.
 *
 * Every number in this registry is an internal CourseCraft balance assumption.
 * It is not calibrated against USGA, Arccos, or any external launch-monitor
 * dataset. Consumers may apply their established player, lie, and weather
 * modifiers, but must not duplicate these base values.
 */
export const DISPERSION_REGISTRY_VERSION = 2 as const;

export type ShotClubId =
  | "driver" | "three_wood" | "five_iron" | "seven_iron"
  | "pitching_wedge" | "sand_wedge" | "chip" | "putter";
export type ShotClubFamily = "wood" | "iron" | "wedge" | "specialty" | "putter";
export type ShotTechnique = "normal" | "draw" | "fade" | "punch" | "flop" | "backspin";

export interface ShotClubDefinition {
  id: ShotClubId;
  label: string;
  family: ShotClubFamily;
  loftDegrees: number;
  nativeLaunchAngleDegrees: number;
  nativeApexHeightYards: number;
  carryYards: number;
  dispersionTiles: number;
  rolloutYards: number;
  allowedLies: readonly ShotLie[];
  allowedTechniques: readonly ShotTechnique[];
  allowedFlightProfiles: readonly ShotFlightProfile[];
}

/**
 * Compatibility shape consumed by the deterministic course-rating solver.
 * These retain the legacy five-club projection exactly while making the
 * versioned dispersion registry its sole authority.
 */
export interface LegacySolverClubDefinition {
  baseClubId: ShotClubId;
  name: "Driver" | "3W" | "5I" | "7I" | "PW";
  carryYards: number;
  dispersionTilesBase: number;
}

export type LegacySolverProfileName = "SCRATCH" | "BOGEY";

const ALL_FLIGHTS = ["low", "standard", "high"] as const;
const STANDARD_ONLY = ["standard"] as const;
const WOOD_TECHNIQUES = ["normal", "draw", "fade", "punch"] as const;
const IRON_TECHNIQUES = ["normal", "draw", "fade", "punch", "backspin"] as const;
const WEDGE_TECHNIQUES = ["normal", "draw", "fade", "punch", "flop", "backspin"] as const;
const RECOVERY_TECHNIQUES = ["normal", "punch", "flop", "backspin"] as const;
const PUTTER_TECHNIQUES = ["normal"] as const;

/** Stable order, IDs, aliases, and internal CourseCraft balance assumptions. */
export const DISPERSION_CLUBS: readonly ShotClubDefinition[] = [
  { id: "driver", label: "Driver", family: "wood", loftDegrees: 10.5, nativeLaunchAngleDegrees: 12, nativeApexHeightYards: 30, carryYards: 270, dispersionTiles: 3.7, rolloutYards: 24, allowedLies: ["tee", "fairway"], allowedTechniques: WOOD_TECHNIQUES, allowedFlightProfiles: ALL_FLIGHTS },
  { id: "three_wood", label: "3 Wood", family: "wood", loftDegrees: 15, nativeLaunchAngleDegrees: 14, nativeApexHeightYards: 32, carryYards: 235, dispersionTiles: 3.2, rolloutYards: 20, allowedLies: ["tee", "fairway", "rough"], allowedTechniques: WOOD_TECHNIQUES, allowedFlightProfiles: ALL_FLIGHTS },
  { id: "five_iron", label: "5 Iron", family: "iron", loftDegrees: 27, nativeLaunchAngleDegrees: 17, nativeApexHeightYards: 29, carryYards: 185, dispersionTiles: 2.55, rolloutYards: 14, allowedLies: ["tee", "fairway", "rough", "waste_area"], allowedTechniques: IRON_TECHNIQUES, allowedFlightProfiles: ALL_FLIGHTS },
  { id: "seven_iron", label: "7 Iron", family: "iron", loftDegrees: 34, nativeLaunchAngleDegrees: 20, nativeApexHeightYards: 27, carryYards: 155, dispersionTiles: 2.1, rolloutYards: 10, allowedLies: ["tee", "fairway", "rough", "waste_area", "sand"], allowedTechniques: IRON_TECHNIQUES, allowedFlightProfiles: ALL_FLIGHTS },
  { id: "pitching_wedge", label: "Pitching Wedge", family: "wedge", loftDegrees: 46, nativeLaunchAngleDegrees: 27, nativeApexHeightYards: 23, carryYards: 115, dispersionTiles: 1.55, rolloutYards: 6, allowedLies: ["tee", "fairway", "rough", "deep_rough", "waste_area", "sand"], allowedTechniques: WEDGE_TECHNIQUES, allowedFlightProfiles: ALL_FLIGHTS },
  { id: "sand_wedge", label: "Sand Wedge", family: "wedge", loftDegrees: 56, nativeLaunchAngleDegrees: 32, nativeApexHeightYards: 19, carryYards: 78, dispersionTiles: 1.35, rolloutYards: 3, allowedLies: ["fairway", "rough", "deep_rough", "sand", "waste_area"], allowedTechniques: RECOVERY_TECHNIQUES, allowedFlightProfiles: ALL_FLIGHTS },
  { id: "chip", label: "Chip", family: "specialty", loftDegrees: 36, nativeLaunchAngleDegrees: 18, nativeApexHeightYards: 6, carryYards: 38, dispersionTiles: .82, rolloutYards: 8, allowedLies: ["fairway", "rough", "deep_rough", "green", "sand", "waste_area"], allowedTechniques: RECOVERY_TECHNIQUES, allowedFlightProfiles: ALL_FLIGHTS },
  { id: "putter", label: "Putter", family: "putter", loftDegrees: 3, nativeLaunchAngleDegrees: 0, nativeApexHeightYards: 0, carryYards: 28, dispersionTiles: .38, rolloutYards: 0, allowedLies: ["green", "fairway"], allowedTechniques: PUTTER_TECHNIQUES, allowedFlightProfiles: STANDARD_ONLY },
] as const;

export const DISPERSION_CLUB_BY_ID: Readonly<Record<ShotClubId, ShotClubDefinition>> = Object.fromEntries(
  DISPERSION_CLUBS.map((club) => [club.id, club]),
) as Readonly<Record<ShotClubId, ShotClubDefinition>>;
export const DISPERSION_CLUB_ID_BY_LABEL: Readonly<Record<string, ShotClubId>> = Object.fromEntries(
  DISPERSION_CLUBS.map((club) => [club.label, club.id]),
) as Readonly<Record<string, ShotClubId>>;
export function dispersionClub(clubId: string): ShotClubDefinition | null {
  if (!Object.hasOwn(DISPERSION_CLUB_BY_ID, clubId)) return null;
  return DISPERSION_CLUB_BY_ID[clubId as ShotClubId] ?? null;
}
export function dispersionClubIdForLabel(label: string): ShotClubId | null {
  if (!Object.hasOwn(DISPERSION_CLUB_ID_BY_LABEL, label)) return null;
  return DISPERSION_CLUB_ID_BY_LABEL[label] ?? null;
}

/**
 * Stable legacy solver projections. These are intentionally separate from
 * player-facing club definitions: their values preserve pre-registry rating
 * behavior exactly while their baseClubId keeps each projection traceable to
 * the canonical club registry.
 */
export const LEGACY_SOLVER_CLUB_PROFILES: Readonly<Record<LegacySolverProfileName, readonly LegacySolverClubDefinition[]>> = {
  SCRATCH: [
    { baseClubId: "driver", name: "Driver", carryYards: 280, dispersionTilesBase: 3.5 },
    { baseClubId: "three_wood", name: "3W", carryYards: 250, dispersionTilesBase: 3.0 },
    { baseClubId: "five_iron", name: "5I", carryYards: 200, dispersionTilesBase: 2.4 },
    { baseClubId: "seven_iron", name: "7I", carryYards: 170, dispersionTilesBase: 2.0 },
    { baseClubId: "pitching_wedge", name: "PW", carryYards: 135, dispersionTilesBase: 1.5 },
  ],
  BOGEY: [
    { baseClubId: "driver", name: "Driver", carryYards: 220, dispersionTilesBase: 4.2 },
    { baseClubId: "three_wood", name: "3W", carryYards: 200, dispersionTilesBase: 3.7 },
    { baseClubId: "five_iron", name: "5I", carryYards: 160, dispersionTilesBase: 3.1 },
    { baseClubId: "seven_iron", name: "7I", carryYards: 140, dispersionTilesBase: 2.6 },
    { baseClubId: "pitching_wedge", name: "PW", carryYards: 110, dispersionTilesBase: 2.1 },
  ],
};

/** Reference-plan adapters retain its pre-existing neutral capability math. */
export const REFERENCE_CLUB_ADAPTERS = [
  { label: "Reference driver", baseClubId: "driver", carry: "tee", carryScale: 1, dispersionScale: 1, roundCarry: false },
  { label: "Reference fairway wood", baseClubId: "three_wood", carry: "tee", carryScale: .88, dispersionScale: .88, roundCarry: true },
  { label: "Reference long iron", baseClubId: "five_iron", carry: "approach", carryScale: 1, dispersionScale: .72, roundCarry: false },
  { label: "Reference mid iron", baseClubId: "seven_iron", carry: "approach", carryScale: .8, dispersionScale: .58, roundCarry: true },
  { label: "Reference wedge", baseClubId: "pitching_wedge", carry: "approach", carryScale: .61, dispersionScale: .43, roundCarry: true },
] as const;
