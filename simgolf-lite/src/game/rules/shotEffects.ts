import type {
  LieEffect,
  ShotFlightProfile,
  ShotLie,
} from "./contracts";

export const SHOT_EFFECTS_VERSION = 1 as const;

export type ShotClubId =
  | "driver"
  | "three_wood"
  | "five_iron"
  | "seven_iron"
  | "pitching_wedge"
  | "sand_wedge"
  | "chip"
  | "putter";

export type ShotClubFamily = "wood" | "iron" | "wedge" | "specialty" | "putter";

export type ShotTechnique =
  | "normal"
  | "draw"
  | "fade"
  | "punch"
  | "flop"
  | "backspin";

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

export interface ShotEffectSelection {
  clubId: string;
  lie: ShotLie;
  recoverySkill: number;
  technique: string;
  flightProfile: string;
}

export type ShotEffectBlockerCode =
  | "unknown_club"
  | "unplayable_lie"
  | "club_lie_mismatch"
  | "unsupported_technique"
  | "unsupported_flight"
  | "technique_requires_low_flight"
  | "technique_requires_high_flight";

export interface ShotEffectBlocker {
  code: ShotEffectBlockerCode;
  message: string;
}

export interface ShotEffectModifiers {
  carryMultiplier: number;
  dispersionMultiplier: number;
  rollMultiplier: number;
}

export interface CalculatedFlightShape {
  profile: ShotFlightProfile;
  effectiveLoftDegrees: number;
  launchAngleDegrees: number;
  apexHeightYards: number;
}

export interface CalculatedShotEffects {
  version: typeof SHOT_EFFECTS_VERSION;
  clubId: ShotClubId;
  lie: ShotLie;
  recoverySkill: number;
  technique: ShotTechnique;
  flightProfile: ShotFlightProfile;
  lieEffect: LieEffect;
  modifiers: ShotEffectModifiers;
  flight: CalculatedFlightShape;
  carryYards: number;
  dispersionTiles: number;
  rolloutYards: number;
  /**
   * This pure playability layer never awards rules penalties. Penalty areas,
   * out of bounds, and relief are resolved by the authoritative ruling layer.
   */
  penaltyStrokes: 0;
}

export type ShotEffectResult =
  | {
      ok: true;
      value: CalculatedShotEffects;
    }
  | {
      ok: false;
      blocker: ShotEffectBlocker;
    };

interface LieBalance {
  playable: boolean;
  carryMultiplier: number;
  dispersionMultiplier: number;
  rollMultiplier: number;
}

interface FlightBalance {
  carryMultiplier: number;
  dispersionMultiplier: number;
  rollMultiplier: number;
  loftDeltaDegrees: number;
  apexMultiplier: number;
}

interface TechniqueBalance {
  carryMultiplier: number;
  dispersionMultiplier: number;
  rollMultiplier: number;
}

const ALL_FLIGHTS = ["low", "standard", "high"] as const;
const STANDARD_ONLY = ["standard"] as const;

const WOOD_TECHNIQUES = ["normal", "draw", "fade", "punch"] as const;
const IRON_TECHNIQUES = ["normal", "draw", "fade", "punch", "backspin"] as const;
const WEDGE_TECHNIQUES = ["normal", "draw", "fade", "punch", "flop", "backspin"] as const;
const RECOVERY_TECHNIQUES = ["normal", "punch", "flop", "backspin"] as const;
const PUTTER_TECHNIQUES = ["normal"] as const;

/**
 * Shared eight-club M50 bag. Values are immutable inputs to both preview and
 * execution callers; callers may scale the resulting output for weather or
 * player power, but should not duplicate lie or flight-shape balance.
 */
export const SHOT_CLUBS: readonly ShotClubDefinition[] = [
  {
    id: "driver",
    label: "Driver",
    family: "wood",
    loftDegrees: 10.5,
    nativeLaunchAngleDegrees: 12,
    nativeApexHeightYards: 30,
    carryYards: 270,
    dispersionTiles: 3.7,
    rolloutYards: 24,
    allowedLies: ["tee", "fairway"],
    allowedTechniques: WOOD_TECHNIQUES,
    allowedFlightProfiles: ALL_FLIGHTS,
  },
  {
    id: "three_wood",
    label: "3 Wood",
    family: "wood",
    loftDegrees: 15,
    nativeLaunchAngleDegrees: 14,
    nativeApexHeightYards: 32,
    carryYards: 235,
    dispersionTiles: 3.2,
    rolloutYards: 20,
    allowedLies: ["tee", "fairway", "rough"],
    allowedTechniques: WOOD_TECHNIQUES,
    allowedFlightProfiles: ALL_FLIGHTS,
  },
  {
    id: "five_iron",
    label: "5 Iron",
    family: "iron",
    loftDegrees: 27,
    nativeLaunchAngleDegrees: 17,
    nativeApexHeightYards: 29,
    carryYards: 185,
    dispersionTiles: 2.55,
    rolloutYards: 14,
    allowedLies: ["tee", "fairway", "rough", "waste_area"],
    allowedTechniques: IRON_TECHNIQUES,
    allowedFlightProfiles: ALL_FLIGHTS,
  },
  {
    id: "seven_iron",
    label: "7 Iron",
    family: "iron",
    loftDegrees: 34,
    nativeLaunchAngleDegrees: 20,
    nativeApexHeightYards: 27,
    carryYards: 155,
    dispersionTiles: 2.1,
    rolloutYards: 10,
    allowedLies: ["tee", "fairway", "rough", "waste_area", "sand"],
    allowedTechniques: IRON_TECHNIQUES,
    allowedFlightProfiles: ALL_FLIGHTS,
  },
  {
    id: "pitching_wedge",
    label: "Pitching Wedge",
    family: "wedge",
    loftDegrees: 46,
    nativeLaunchAngleDegrees: 27,
    nativeApexHeightYards: 23,
    carryYards: 115,
    dispersionTiles: 1.55,
    rolloutYards: 6,
    allowedLies: ["tee", "fairway", "rough", "deep_rough", "waste_area", "sand"],
    allowedTechniques: WEDGE_TECHNIQUES,
    allowedFlightProfiles: ALL_FLIGHTS,
  },
  {
    id: "sand_wedge",
    label: "Sand Wedge",
    family: "wedge",
    loftDegrees: 56,
    nativeLaunchAngleDegrees: 32,
    nativeApexHeightYards: 19,
    carryYards: 78,
    dispersionTiles: 1.35,
    rolloutYards: 3,
    allowedLies: ["fairway", "rough", "deep_rough", "sand", "waste_area"],
    allowedTechniques: RECOVERY_TECHNIQUES,
    allowedFlightProfiles: ALL_FLIGHTS,
  },
  {
    id: "chip",
    label: "Chip",
    family: "specialty",
    loftDegrees: 36,
    nativeLaunchAngleDegrees: 18,
    nativeApexHeightYards: 6,
    carryYards: 38,
    dispersionTiles: 0.82,
    rolloutYards: 8,
    allowedLies: ["fairway", "rough", "deep_rough", "green", "sand", "waste_area"],
    allowedTechniques: RECOVERY_TECHNIQUES,
    allowedFlightProfiles: ALL_FLIGHTS,
  },
  {
    id: "putter",
    label: "Putter",
    family: "putter",
    loftDegrees: 3,
    nativeLaunchAngleDegrees: 0,
    nativeApexHeightYards: 0,
    carryYards: 28,
    dispersionTiles: 0.38,
    rolloutYards: 0,
    allowedLies: ["green", "fairway"],
    allowedTechniques: PUTTER_TECHNIQUES,
    allowedFlightProfiles: STANDARD_ONLY,
  },
] as const;

const LIE_BALANCE: Readonly<Record<ShotLie, LieBalance>> = {
  tee: {
    playable: true,
    carryMultiplier: 1,
    dispersionMultiplier: 1,
    rollMultiplier: 1,
  },
  fairway: {
    playable: true,
    carryMultiplier: 1,
    dispersionMultiplier: 1,
    rollMultiplier: 1,
  },
  rough: {
    playable: true,
    carryMultiplier: 0.9,
    dispersionMultiplier: 1.15,
    rollMultiplier: 0.9,
  },
  deep_rough: {
    playable: true,
    carryMultiplier: 0.7,
    dispersionMultiplier: 1.45,
    rollMultiplier: 0.65,
  },
  waste_area: {
    playable: true,
    carryMultiplier: 0.92,
    dispersionMultiplier: 1.2,
    rollMultiplier: 1.05,
  },
  sand: {
    playable: true,
    carryMultiplier: 0.65,
    dispersionMultiplier: 1.35,
    rollMultiplier: 0.35,
  },
  green: {
    playable: true,
    carryMultiplier: 1,
    dispersionMultiplier: 1,
    rollMultiplier: 1,
  },
  path: {
    playable: false,
    carryMultiplier: 1,
    dispersionMultiplier: 1,
    rollMultiplier: 1,
  },
  water: {
    playable: false,
    carryMultiplier: 1,
    dispersionMultiplier: 1,
    rollMultiplier: 1,
  },
  wetland: {
    playable: false,
    carryMultiplier: 1,
    dispersionMultiplier: 1,
    rollMultiplier: 1,
  },
  out_of_bounds: {
    playable: false,
    carryMultiplier: 1,
    dispersionMultiplier: 1,
    rollMultiplier: 1,
  },
};

const FLIGHT_BALANCE: Readonly<Record<ShotFlightProfile, FlightBalance>> = {
  low: {
    carryMultiplier: 0.9,
    dispersionMultiplier: 0.85,
    rollMultiplier: 1.45,
    loftDeltaDegrees: -4,
    apexMultiplier: 0.52,
  },
  standard: {
    carryMultiplier: 1,
    dispersionMultiplier: 1,
    rollMultiplier: 1,
    loftDeltaDegrees: 0,
    apexMultiplier: 1,
  },
  high: {
    carryMultiplier: 0.92,
    dispersionMultiplier: 1.15,
    rollMultiplier: 0.35,
    loftDeltaDegrees: 6,
    apexMultiplier: 1.55,
  },
};

const TECHNIQUE_BALANCE: Readonly<Record<ShotTechnique, TechniqueBalance>> = {
  normal: {
    carryMultiplier: 1,
    dispersionMultiplier: 1,
    rollMultiplier: 1,
  },
  draw: {
    carryMultiplier: 1,
    dispersionMultiplier: 1.05,
    rollMultiplier: 1,
  },
  fade: {
    carryMultiplier: 1,
    dispersionMultiplier: 1.05,
    rollMultiplier: 1,
  },
  punch: {
    carryMultiplier: 1,
    dispersionMultiplier: 0.95,
    rollMultiplier: 1.1,
  },
  flop: {
    carryMultiplier: 0.86,
    dispersionMultiplier: 1.1,
    rollMultiplier: 0.65,
  },
  backspin: {
    carryMultiplier: 0.97,
    dispersionMultiplier: 1.08,
    rollMultiplier: 0.45,
  },
};

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function rounded(value: number): number {
  return Number(value.toFixed(6));
}

function isTechnique(value: string): value is ShotTechnique {
  return Object.hasOwn(TECHNIQUE_BALANCE, value);
}

function isFlightProfile(value: string): value is ShotFlightProfile {
  return Object.hasOwn(FLIGHT_BALANCE, value);
}

export function shotClub(clubId: string): ShotClubDefinition | null {
  return SHOT_CLUBS.find((club) => club.id === clubId) ?? null;
}

export function availableShotClubs(lie: ShotLie): readonly ShotClubDefinition[] {
  if (!LIE_BALANCE[lie].playable) return [];
  return SHOT_CLUBS.filter((club) => club.allowedLies.includes(lie));
}

/**
 * Recovery skill removes at most half of each poor-lie penalty. A poor lie can
 * approach fairway behavior but can never outperform it.
 */
export function calculateLieEffect(lie: ShotLie, recoverySkill: number): LieEffect {
  const balance = LIE_BALANCE[lie];
  const boundedSkill = clamp(finiteOr(recoverySkill, 0), 0, 100);
  const recoveryShare = boundedSkill / 200;
  const recoverTowardOne = (value: number): number => {
    if (value < 1) return value + (1 - value) * recoveryShare;
    if (value > 1) return value - (value - 1) * recoveryShare;
    return value;
  };

  return {
    sourceLie: lie,
    effectiveLie: lie,
    carryMultiplier: rounded(clamp(recoverTowardOne(balance.carryMultiplier), 0.5, 1)),
    dispersionMultiplier: rounded(clamp(recoverTowardOne(balance.dispersionMultiplier), 1, 1.5)),
    rollMultiplier: rounded(clamp(recoverTowardOne(balance.rollMultiplier), 0.25, 1.2)),
  };
}

function blocker(code: ShotEffectBlockerCode, message: string): ShotEffectResult {
  return {
    ok: false,
    blocker: { code, message },
  };
}

/**
 * Deterministic shared calculation for shot preview and execution.
 *
 * The result is composed only of primitives and plain objects, so identical
 * inputs produce JSON-stable values without runtime classes or seeded rolls.
 */
export function calculateShotEffects(selection: ShotEffectSelection): ShotEffectResult {
  const club = shotClub(selection.clubId);
  if (!club) {
    return blocker("unknown_club", `Unknown club "${selection.clubId}".`);
  }

  if (!LIE_BALANCE[selection.lie].playable) {
    return blocker(
      "unplayable_lie",
      `A shot cannot be played from ${selection.lie.replaceAll("_", " ")}; resolve relief first.`,
    );
  }

  if (!club.allowedLies.includes(selection.lie)) {
    return blocker(
      "club_lie_mismatch",
      `${club.label} cannot be played from ${selection.lie.replaceAll("_", " ")}.`,
    );
  }

  if (!isTechnique(selection.technique) || !club.allowedTechniques.includes(selection.technique)) {
    return blocker(
      "unsupported_technique",
      `${club.label} does not support the ${selection.technique.replaceAll("_", " ")} technique.`,
    );
  }

  if (!isFlightProfile(selection.flightProfile) || !club.allowedFlightProfiles.includes(selection.flightProfile)) {
    return blocker(
      "unsupported_flight",
      `${club.label} does not support ${selection.flightProfile.replaceAll("_", " ")} flight.`,
    );
  }

  if (selection.technique === "punch" && selection.flightProfile !== "low") {
    return blocker("technique_requires_low_flight", "Punch shots require low flight.");
  }

  if (selection.technique === "flop" && selection.flightProfile !== "high") {
    return blocker("technique_requires_high_flight", "Flop shots require high flight.");
  }

  const recoverySkill = rounded(clamp(finiteOr(selection.recoverySkill, 0), 0, 100));
  const lieEffect = calculateLieEffect(selection.lie, recoverySkill);
  const flightBalance = FLIGHT_BALANCE[selection.flightProfile];
  const techniqueBalance = TECHNIQUE_BALANCE[selection.technique];
  const carryMultiplier = rounded(clamp(
    lieEffect.carryMultiplier
      * flightBalance.carryMultiplier
      * techniqueBalance.carryMultiplier,
    0.25,
    1,
  ));
  const dispersionMultiplier = rounded(clamp(
    lieEffect.dispersionMultiplier
      * flightBalance.dispersionMultiplier
      * techniqueBalance.dispersionMultiplier,
    0.5,
    2,
  ));
  const rollMultiplier = rounded(clamp(
    lieEffect.rollMultiplier
      * flightBalance.rollMultiplier
      * techniqueBalance.rollMultiplier,
    0.1,
    2,
  ));
  const effectiveLoftDegrees = rounded(clamp(
    club.loftDegrees + flightBalance.loftDeltaDegrees,
    0,
    64,
  ));
  const launchAngleDegrees = rounded(clamp(
    club.nativeLaunchAngleDegrees + flightBalance.loftDeltaDegrees * 0.75,
    0,
    55,
  ));
  const apexHeightYards = rounded(clamp(
    club.nativeApexHeightYards * flightBalance.apexMultiplier,
    0,
    60,
  ));

  return {
    ok: true,
    value: {
      version: SHOT_EFFECTS_VERSION,
      clubId: club.id,
      lie: selection.lie,
      recoverySkill,
      technique: selection.technique,
      flightProfile: selection.flightProfile,
      lieEffect,
      modifiers: {
        carryMultiplier,
        dispersionMultiplier,
        rollMultiplier,
      },
      flight: {
        profile: selection.flightProfile,
        effectiveLoftDegrees,
        launchAngleDegrees,
        apexHeightYards,
      },
      carryYards: rounded(club.carryYards * carryMultiplier),
      dispersionTiles: rounded(club.dispersionTiles * dispersionMultiplier),
      rolloutYards: rounded(club.rolloutYards * rollMultiplier),
      penaltyStrokes: 0,
    },
  };
}
