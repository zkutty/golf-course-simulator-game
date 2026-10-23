import type { ShotClubId } from "./dispersionRegistry";

/** A CourseCraft statistical template, not an individual or universal carry fit. */
export const PROFILE_CALIBRATION_VERSION = 1 as const;
export const PROFILE_CALIBRATION_MODEL = "coursecraft-usga-total-template-v1" as const;
export const PROFILE_CALIBRATION_CLUBS = [
  "driver", "three_wood", "five_iron", "seven_iron", "pitching_wedge", "sand_wedge", "chip", "putter",
] as const satisfies readonly ShotClubId[];
const SKILL_KEYS = ["power", "driving", "irons", "shortGame", "putting", "recovery"] as const;

// Factory results and both nested records are frozen before registration. Only
// these owned immutable values can reuse validation; persisted carriers still
// execute the complete structural and calibration-coherence reader.
const ownedProfiles = new WeakSet<object>();

export type ProfileCalibrationSkills = Record<typeof SKILL_KEYS[number], number>;
export interface ProfileCalibrationOptions {
  /** Explicit scenario adjustment; never inferred from identity or handicap. */
  driverTotalOffsetYards?: number;
}
export interface ProfileCalibrationV1 {
  version: typeof PROFILE_CALIBRATION_VERSION;
  model: typeof PROFILE_CALIBRATION_MODEL;
  skills: ProfileCalibrationSkills;
  /** Internal capability diagnostic, never an official Handicap Index. */
  abilityHandicapAnchor: number;
  /** Population distance-axis coordinate; distinct from the capability diagnostic. */
  powerHandicapAnchor: number;
  driverTotalOffsetYards: number;
  clubCarryYards: Record<ShotClubId, number>;
}

/**
 * Source: USGA Dec 2023 recreational-distance study, Figure 2 (male sample).
 * Metric: regression of median-of-seven driver TOTAL distance, R²=.57.
 * It supplies an amplitude reference only. No measured carry is asserted.
 */
export const PROFILE_CALIBRATION_SOURCE = Object.freeze({
  url: "https://www.usga.org/content/dam/usga/images/course-care/GolferExperience/DI_Golfer_Performance_Measurement%202023%20Update.pdf",
  figure: "Figure 2, page 3",
  population: "male participants in the USGA 2021–2023 recreational-golfer sample",
  metric: "regression of median-of-seven total driver distance",
  interceptYards: 265.32,
  yardsPerHandicapPoint: -3.02,
  rSquared: .57,
});

/**
 * Frozen calibration output: neutral full driver impact + real ground solver.
 * Reference conditions and tolerances live in SHOT_PROFILE_CALIBRATION.md.
 * Keep the ground solver out of this runtime module. These are model-derived
 * carry values, not source observations. Changing physics requires a new model.
 */
export const DRIVER_CARRY_ANCHORS_V1 = Object.freeze([
  Object.freeze({ handicap: 0, totalYards: 265.32, carryYards: 241.02 }),
  Object.freeze({ handicap: 10, totalYards: 235.12, carryYards: 210.82 }),
  Object.freeze({ handicap: 20, totalYards: 204.92, carryYards: 180.62 }),
  Object.freeze({ handicap: 28, totalYards: 180.76, carryYards: 156.46 }),
]);

/** Loft/gapping assumptions pending measured carry data; not registry carry. */
export const CLUB_CARRY_RATIOS_V1: Readonly<Record<ShotClubId, number>> = Object.freeze({
  driver: 1, three_wood: .86, five_iron: .7, seven_iron: .61,
  pitching_wedge: .47, sand_wedge: .34, chip: .14,
  // Putting has zero airborne carry. Its distance budget has a separate owner.
  putter: 0,
});

export const PROFILE_CALIBRATION_TOLERANCES = Object.freeze({
  sourceRegressionYards: .01,
  referenceTotalYards: .15,
  serializedCarryYards: .000001,
  // Unspecified-distance medians may only reject gross magnitude mistakes.
  unspecifiedDistanceCrossCheckYards: 35,
});
export const PROFILE_CALIBRATION_UNSUPPORTED = Object.freeze([
  "universal demographic carry fit", "individual carry prediction", "dispersion calibration",
  "measured non-driver carry", "mishit distribution", "rollback", "official handicap prediction",
] as const);

function rounded(value: number): number { return Number(value.toFixed(6)); }
function boundedFinite(value: number, minimum: number, maximum: number, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new RangeError(`${label} must be finite.`);
  return Math.max(minimum, Math.min(maximum, value));
}
function offsetYards(options: ProfileCalibrationOptions): number {
  const offset = options.driverTotalOffsetYards ?? 0;
  if (!Number.isFinite(offset) || offset < -40 || offset > 40) {
    throw new RangeError("driverTotalOffsetYards must be finite and between -40 and 40.");
  }
  return offset;
}
function boundedSkills(skills: ProfileCalibrationSkills): ProfileCalibrationSkills {
  return Object.fromEntries(SKILL_KEYS.map((key) => [key, boundedFinite(skills[key], 0, 100, key)])) as ProfileCalibrationSkills;
}

/** Conservative CourseCraft projection domain, not a claim about the sample range. */
export function referenceDriverTotalYards(handicap: number): number {
  const anchor = boundedFinite(handicap, 0, 28, "handicap anchor");
  return rounded(PROFILE_CALIBRATION_SOURCE.interceptYards + PROFILE_CALIBRATION_SOURCE.yardsPerHandicapPoint * anchor);
}

/** Accuracy/short-game capability is independent of the power distance axis. */
export function abilityHandicapAnchor(skills: ProfileCalibrationSkills): number {
  const bounded = boundedSkills(skills);
  const control = bounded.driving * .25 + bounded.irons * .3 + bounded.shortGame * .2
    + bounded.putting * .2 + bounded.recovery * .05;
  return rounded(28 * (1 - control / 100));
}

function driverCarryAtPower(power: number): number {
  const handicap = 28 * (1 - boundedFinite(power, 0, 100, "power") / 100);
  const upperIndex = DRIVER_CARRY_ANCHORS_V1.findIndex((anchor) => anchor.handicap >= handicap);
  if (upperIndex <= 0) return DRIVER_CARRY_ANCHORS_V1[0].carryYards;
  const lower = DRIVER_CARRY_ANCHORS_V1[upperIndex - 1];
  const upper = DRIVER_CARRY_ANCHORS_V1[upperIndex];
  const fraction = (handicap - lower.handicap) / (upper.handicap - lower.handicap);
  return lower.carryYards + fraction * (upper.carryYards - lower.carryYards);
}

/**
 * Full neutral carry authority only. Apply selected effort, style, lie, equipment,
 * weather and performance once in the caller. Never apply legacy power scaling.
 * Control skills are validated but cannot silently inflate carry. Finite extreme
 * runtime skills are clamped; nonfinite inputs fail explicitly.
 */
export function calibratedClubCarryYards(
  input: ProfileCalibrationSkills & { clubId: ShotClubId },
  options: ProfileCalibrationOptions = {},
): number {
  if (!PROFILE_CALIBRATION_CLUBS.includes(input.clubId)) throw new RangeError("Unknown calibration club.");
  const skills = boundedSkills(input);
  return rounded((driverCarryAtPower(skills.power) + offsetYards(options)) * CLUB_CARRY_RATIOS_V1[input.clubId]);
}

/** Capture at round start. Historical snapshots without this field stay legacy. */
export function freezeProfileCalibration(
  skills: ProfileCalibrationSkills,
  options: ProfileCalibrationOptions = {},
): ProfileCalibrationV1 {
  const bounded = boundedSkills(skills);
  const offset = offsetYards(options);
  const carries = Object.fromEntries(PROFILE_CALIBRATION_CLUBS.map((clubId) => [
    clubId, calibratedClubCarryYards({ ...bounded, clubId }, { driverTotalOffsetYards: offset }),
  ])) as Record<ShotClubId, number>;
  const profile = Object.freeze({
    version: PROFILE_CALIBRATION_VERSION,
    model: PROFILE_CALIBRATION_MODEL,
    skills: Object.freeze(bounded),
    abilityHandicapAnchor: abilityHandicapAnchor(bounded),
    powerHandicapAnchor: rounded(28 * (1 - bounded.power / 100)),
    driverTotalOffsetYards: offset,
    clubCarryYards: Object.freeze(carries),
  });
  ownedProfiles.add(profile);
  return profile;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
function finiteRange(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum;
}

/** Strict persisted reader: no coercion, missing clubs, unsupported versions or repairs. */
export function isProfileCalibrationV1(value: unknown): value is ProfileCalibrationV1 {
  if (value !== null && typeof value === "object" && ownedProfiles.has(value)) return true;
  if (!record(value) || !exactKeys(value, ["version", "model", "skills", "abilityHandicapAnchor",
    "powerHandicapAnchor", "driverTotalOffsetYards", "clubCarryYards"])
    || value.version !== PROFILE_CALIBRATION_VERSION || value.model !== PROFILE_CALIBRATION_MODEL
    || !record(value.skills) || !exactKeys(value.skills, SKILL_KEYS)
    || !SKILL_KEYS.every((key) => finiteRange((value.skills as Record<string, unknown>)[key], 0, 100))
    || !finiteRange(value.driverTotalOffsetYards, -40, 40)
    || !record(value.clubCarryYards) || !exactKeys(value.clubCarryYards, PROFILE_CALIBRATION_CLUBS)) return false;
  const expected = freezeProfileCalibration(value.skills as ProfileCalibrationSkills,
    { driverTotalOffsetYards: value.driverTotalOffsetYards });
  return value.abilityHandicapAnchor === expected.abilityHandicapAnchor
    && value.powerHandicapAnchor === expected.powerHandicapAnchor
    && PROFILE_CALIBRATION_CLUBS.every((clubId) => {
      const carry = (value.clubCarryYards as Record<string, unknown>)[clubId];
      return finiteRange(carry, 0, 350)
        && Math.abs(carry - expected.clubCarryYards[clubId]) <= PROFILE_CALIBRATION_TOLERANCES.serializedCarryYards;
    });
}
