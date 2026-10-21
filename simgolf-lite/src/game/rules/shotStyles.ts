import type { ShotFlightProfile, ShotLie } from "./contracts";
import { dispersionClub, type ShotClubId, type ShotTechnique } from "./dispersionRegistry";
import {
  calculateShotEffects,
  type CalculatedShotEffects,
  type ShotEffectBlocker,
} from "./shotEffects";

/** Internal CourseCraft balance assumptions, not measured launch-monitor data. */
export const SHOT_STYLE_VERSION = 1 as const;
export const CLUB_IMPACT_VERSION = 1 as const;
export type ShotStyleId = "straight_run" | "high_spin" | "pitch" | "draw" | "fade" | "chip" | "punch" | "flop" | "putt";

export interface ShotStyleDefinition {
  id: ShotStyleId;
  label: string;
  technique: ShotTechnique;
  /** null permits the existing low/standard/high selection, defaulting to standard. */
  flightProfile: ShotFlightProfile | null;
}

/** Technique gates remain owned by the caller; mapping never unlocks a technique. */
export const SHOT_STYLES: readonly ShotStyleDefinition[] = [
  { id: "straight_run", label: "Straight / Run", technique: "normal", flightProfile: null },
  { id: "high_spin", label: "High Spin", technique: "backspin", flightProfile: "high" },
  { id: "pitch", label: "Pitch", technique: "normal", flightProfile: "standard" },
  { id: "draw", label: "Draw", technique: "draw", flightProfile: null },
  { id: "fade", label: "Fade", technique: "fade", flightProfile: null },
  { id: "chip", label: "Chip / Bump-and-run", technique: "normal", flightProfile: "low" },
  { id: "punch", label: "Punch", technique: "punch", flightProfile: "low" },
  { id: "flop", label: "Flop", technique: "flop", flightProfile: "high" },
  { id: "putt", label: "Putt", technique: "normal", flightProfile: "standard" },
];

interface ClubImpactBaseline {
  landingAngleDegrees: number;
  stoppingPotential: number;
}

/** Registry still owns native launch, carry, apex and roll; these add descent/check. */
export const CLUB_IMPACT_BASELINES: Readonly<Record<ShotClubId, ClubImpactBaseline>> = {
  driver: { landingAngleDegrees: 26, stoppingPotential: .1 },
  three_wood: { landingAngleDegrees: 30, stoppingPotential: .16 },
  five_iron: { landingAngleDegrees: 38, stoppingPotential: .3 },
  seven_iron: { landingAngleDegrees: 43, stoppingPotential: .43 },
  pitching_wedge: { landingAngleDegrees: 50, stoppingPotential: .63 },
  sand_wedge: { landingAngleDegrees: 55, stoppingPotential: .77 },
  chip: { landingAngleDegrees: 30, stoppingPotential: .28 },
  putter: { landingAngleDegrees: 0, stoppingPotential: 0 },
};

/**
 * Pre-surface impact potential, not a promised rest distance or reverse velocity.
 * The existing ground solver consumes forwardRollPotentialYards once, bypassing
 * its legacy spin/lie/trajectory/angle energy factors for this contract. Surface
 * firmness, moisture, friction and slope remain the ground solver's authority.
 */
export interface ClubImpactV1 {
  version: typeof CLUB_IMPACT_VERSION;
  clubId: ShotClubId;
  style: ShotStyleId;
  power: number;
  launchAngleDegrees: number;
  landingAngleDegrees: number;
  spinControl: number;
  stoppingPotential: number;
  forwardRollPotentialYards: number;
  rollbackSupported: false;
}

export interface ShotStyleSelection {
  clubId: string;
  lie: ShotLie;
  style: string;
  power: number;
  recoverySkill: number;
  shortGameSkill: number;
  /** Normalized strike authority; defaults to a neutral full-quality strike. */
  strikeQuality?: number;
  /** Frozen equipment authority supplied by the caller, never live inventory. */
  spinCapabilityMultiplier?: number;
  flightProfile?: ShotFlightProfile;
}

export interface CalculatedShotStyleEffects {
  version: typeof SHOT_STYLE_VERSION;
  style: ShotStyleId;
  effectiveSelection: {
    clubId: ShotClubId;
    lie: ShotLie;
    recoverySkill: number;
    technique: ShotTechnique;
    flightProfile: ShotFlightProfile;
    /** Apply once to carry. Pitch is deliberately a partial wedge swing. */
    power: number;
  };
  /** Carry/dispersion use existing authority; impact replaces legacy rollout. */
  effects: CalculatedShotEffects;
  impact: ClubImpactV1;
}

export type ShotStyleBlocker = ShotEffectBlocker | {
  code: "unknown_style" | "style_club_mismatch" | "style_requires_flight" | "unknown_lie";
  message: string;
};
export type ShotStyleResult = { ok: true; value: CalculatedShotStyleEffects } | { ok: false; blocker: ShotStyleBlocker };

function bounded(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, typeof value === "number" && Number.isFinite(value) ? value : fallback));
}
function rounded(value: number): number { return Number(value.toFixed(6)); }
export function isShotStyleId(value: unknown): value is ShotStyleId {
  return typeof value === "string" && SHOT_STYLES.some((style) => style.id === value);
}
export function defaultShotStyle(clubId: string): ShotStyleId {
  return clubId === "putter" ? "putt" : clubId === "chip" ? "chip" : "straight_run";
}
/** Reader for existing technique selections; this does not migrate historical shots. */
export function shotStyleForTechnique(clubId: string, technique: ShotTechnique): ShotStyleId {
  if (technique === "normal") return defaultShotStyle(clubId);
  return technique === "backspin" ? "high_spin" : technique;
}

/** Strict finite bounds for retained impact metadata. Never repairs persisted facts. */
export function isClubImpactV1(value: unknown): value is ClubImpactV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = ["version", "clubId", "style", "power", "launchAngleDegrees", "landingAngleDegrees", "spinControl", "stoppingPotential", "forwardRollPotentialYards", "rollbackSupported"];
  if (Object.keys(value).length !== keys.length || Object.keys(value).some((key) => !keys.includes(key))) return false;
  const candidate = value as Partial<ClubImpactV1>;
  const inRange = (number: unknown, minimum: number, maximum: number): boolean => typeof number === "number"
    && Number.isFinite(number) && number >= minimum && number <= maximum;
  return candidate.version === CLUB_IMPACT_VERSION
    && typeof candidate.clubId === "string" && dispersionClub(candidate.clubId) !== null
    && isShotStyleId(candidate.style)
    && inRange(candidate.power, .25, 1.15)
    && inRange(candidate.launchAngleDegrees, 0, 55)
    && inRange(candidate.landingAngleDegrees, 0, 75)
    && inRange(candidate.spinControl, 0, 1)
    && inRange(candidate.stoppingPotential, 0, .95)
    && inRange(candidate.forwardRollPotentialYards, 0, 80)
    && candidate.rollbackSupported === false;
}

export function calculateShotStyleEffects(selection: ShotStyleSelection): ShotStyleResult {
  const style = SHOT_STYLES.find((candidate) => candidate.id === selection.style);
  if (!style) return { ok: false, blocker: { code: "unknown_style", message: `Unknown shot style "${selection.style}".` } };
  const club = dispersionClub(selection.clubId);
  if (!club) return { ok: false, blocker: { code: "unknown_club", message: `Unknown club "${selection.clubId}".` } };
  if (!["tee", "fairway", "rough", "deep_rough", "waste_area", "sand", "green", "path", "water", "wetland", "out_of_bounds"].includes(selection.lie)) {
    return { ok: false, blocker: { code: "unknown_lie", message: "This lie is not supported." } };
  }
  if ((style.id === "pitch" && club.family !== "wedge")
    || (style.id === "chip" && club.id !== "chip")
    || (style.id === "putt" && club.id !== "putter")
    || (club.id === "putter" && style.id !== "putt")) {
    return { ok: false, blocker: { code: "style_club_mismatch", message: `${style.label} is not available with ${club.label}${style.id === "pitch" ? "; choose a wedge for a controlled partial shot" : ""}.` } };
  }
  if (style.flightProfile && selection.flightProfile && selection.flightProfile !== style.flightProfile) {
    return { ok: false, blocker: { code: "style_requires_flight", message: `${style.label} requires ${style.flightProfile} flight.` } };
  }
  const flightProfile = style.flightProfile ?? selection.flightProfile ?? "standard";
  const requestedPower = bounded(selection.power, 1, .25, 1.15);
  const power = rounded(style.id === "pitch" ? bounded(requestedPower * .55, .55, .25, .65) : requestedPower);
  const recoverySkill = rounded(bounded(selection.recoverySkill, 0, 0, 100));
  const effectiveSelection = { clubId: club.id, lie: selection.lie, recoverySkill, technique: style.technique, flightProfile, power };
  const calculated = calculateShotEffects(effectiveSelection);
  if (!calculated.ok) return calculated;

  const baseline = CLUB_IMPACT_BASELINES[club.id];
  const quality = bounded(selection.strikeQuality, 1, 0, 1);
  const shortGame = bounded(selection.shortGameSkill, 0, 0, 100) / 100;
  const equipment = bounded(selection.spinCapabilityMultiplier, 1, .75, 1.25);
  const lieControl = selection.lie === "rough" ? .55 : selection.lie === "deep_rough" ? .25
    : selection.lie === "sand" ? .45 : selection.lie === "waste_area" ? .65 : 1;
  // Recovery can regain a small share but cannot turn rough into fairway spin.
  const recoveredControl = lieControl + (1 - lieControl) * recoverySkill / 400;
  const spinControl = rounded(bounded(recoveredControl * quality * (.75 + shortGame * .25)
    * Math.min(1, Math.sqrt(power)) * equipment, 0, 0, 1));
  const flightStop = flightProfile === "low" ? -.08 : flightProfile === "high" ? .08 : 0;
  const styleStop = style.id === "high_spin" ? .08 + baseline.stoppingPotential * .22
    : style.id === "fade" ? .025 : style.id === "draw" ? -.025 : 0;
  const stoppingPotential = club.id === "putter" ? 0 : rounded(bounded(
    (baseline.stoppingPotential + flightStop + styleStop) * spinControl, 0, 0, .95,
  ));
  // Partial pitches have an intermediate arc; they never borrow flop's launch.
  const launchAngleDegrees = club.id === "putter" ? 0 : rounded(bounded(
    calculated.value.flight.launchAngleDegrees + (style.id === "pitch" ? -2 : 0), 0, 0, 55,
  ));
  const flightDescent = flightProfile === "low" ? -10 : flightProfile === "high" ? 10 : 0;
  const landingAngleDegrees = club.id === "putter" ? 0 : rounded(bounded(
    baseline.landingAngleDegrees + flightDescent + (style.id === "pitch" ? -4 : 0)
      + (power - 1) * 8, 0, 8, 75,
  ));
  const flightRoll = flightProfile === "low" ? 1.4 : flightProfile === "high" ? .6 : 1;
  const styleRoll = style.id === "flop" ? .65 : style.id === "draw" ? 1.06 : style.id === "fade" ? .95 : 1;
  const forwardRollPotentialYards = rounded(bounded(
    club.rolloutYards * Math.pow(power, .7) * flightRoll * styleRoll
      * (1 + (baseline.stoppingPotential - stoppingPotential) * .95), 0, 0, 80,
  ));
  const impact: ClubImpactV1 = {
    version: CLUB_IMPACT_VERSION, clubId: club.id, style: style.id, power,
    launchAngleDegrees, landingAngleDegrees, spinControl, stoppingPotential,
    forwardRollPotentialYards, rollbackSupported: false,
  };
  return {
    ok: true,
    value: {
      version: SHOT_STYLE_VERSION, style: style.id, effectiveSelection,
      effects: {
        ...calculated.value,
        flight: {
          ...calculated.value.flight,
          launchAngleDegrees,
          apexHeightYards: rounded(calculated.value.flight.apexHeightYards * Math.sqrt(power)),
        },
        // This is the complete pre-surface budget; do not multiply it by legacy
        // effects.modifiers.rollMultiplier or equipment spin a second time.
        rolloutYards: forwardRollPotentialYards,
      },
      impact,
    },
  };
}
