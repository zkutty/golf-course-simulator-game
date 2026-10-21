import { describe, expect, it } from "vitest";
import { resolveGreenRollout, type FrozenGreenRolloutCourse } from "../greens/greenRollout";
import { createGreenProgram, normalizeGreenLocalState } from "../greens/greenSurface";
import { DISTANCE_BENCHMARK_OBSERVATIONS } from "./distanceBenchmarks";
import { dispersionClub, type ShotClubId } from "./dispersionRegistry";
import { calculateShotStyleEffects } from "./shotStyles";
import {
  abilityHandicapAnchor, calibratedClubCarryYards, CLUB_CARRY_RATIOS_V1,
  DRIVER_CARRY_ANCHORS_V1, freezeProfileCalibration, isProfileCalibrationV1,
  PROFILE_CALIBRATION_CLUBS, PROFILE_CALIBRATION_SOURCE,
  PROFILE_CALIBRATION_TOLERANCES, PROFILE_CALIBRATION_UNSUPPORTED,
  referenceDriverTotalYards, type ProfileCalibrationSkills,
} from "./profileCalibration";

function skills(value = 50): ProfileCalibrationSkills {
  return { power: value, driving: value, irons: value, shortGame: value, putting: value, recovery: value };
}
function populationAt(handicap: number): ProfileCalibrationSkills {
  return skills(100 * (1 - handicap / 28));
}

/** Offline calibration harness only: runtime calibration imports no physics. */
function referenceCourse(): FrozenGreenRolloutCourse {
  const course: FrozenGreenRolloutCourse = {
    width: 128, height: 16,
    tiles: new Array(128 * 16).fill("fairway"),
    elevations: new Array(128 * 16).fill(0),
    holes: [{ id: "profile-reference", green: { x: 126, y: 8 } }],
    greenProgram: createGreenProgram("balanced"),
  };
  course.greenLocalState = normalizeGreenLocalState(undefined, course);
  return course;
}
const REFERENCE_COURSE = referenceCourse();
function referenceGround(carryYards: number, clubId: ShotClubId = "driver", power = 1) {
  const result = calculateShotStyleEffects({
    clubId, lie: clubId === "driver" ? "tee" : "fairway", style: "straight_run",
    power, recoverySkill: 50, shortGameSkill: 50,
    strikeQuality: 1, spinCapabilityMultiplier: 1, flightProfile: "standard",
  });
  if (!result.ok) throw new Error(result.blocker.message);
  const impact = result.value.impact;
  const rollout = resolveGreenRollout({
    course: REFERENCE_COURSE, holeId: "profile-reference",
    landing: { x: 2 + carryYards / 10, y: 8 }, direction: { x: 1, y: 0 },
    requestedRollYards: impact.forwardRollPotentialYards, yardsPerTile: 10,
    club: dispersionClub(clubId)!.label, sourceLie: clubId === "driver" ? "tee" : "fairway",
    launchAngleDegrees: impact.launchAngleDegrees, landingAngleDegrees: impact.landingAngleDegrees,
    trajectory: "standard", spin: "neutral", impact,
    weather: { kind: "clear", rainInches: 0 }, drainageLevel: 1, seed: 1396,
  });
  return { totalYards: carryYards + rollout.rollYards, rollout, impact };
}
function solveReferenceCarry(totalYards: number): number {
  let lower = 0;
  let upper = totalYards;
  // Bounded inverse of the actual solver, never an assumed universal roll gap.
  for (let iteration = 0; iteration < 20; iteration++) {
    const middle = (lower + upper) / 2;
    if (referenceGround(middle).totalYards < totalYards) lower = middle;
    else upper = middle;
  }
  return (lower + upper) / 2;
}

describe("ZK1396 bounded source-grounded profile template", () => {
  it.each([[0, 265.32], [10, 235.12], [20, 204.92]])("preserves USGA total regression at HI %s", (handicap, total) => {
    expect(Math.abs(referenceDriverTotalYards(handicap) - total))
      .toBeLessThanOrEqual(PROFILE_CALIBRATION_TOLERANCES.sourceRegressionYards);
    expect(PROFILE_CALIBRATION_SOURCE.metric).toContain("total");
    expect(PROFILE_CALIBRATION_SOURCE.population).toContain("male");
  });

  it.each(DRIVER_CARRY_ANCHORS_V1)("inverts real fairway ground physics at HI $handicap", (anchor) => {
    const carry = calibratedClubCarryYards({ ...populationAt(anchor.handicap), clubId: "driver" });
    const reference = referenceGround(carry);
    expect(Math.abs(reference.totalYards - anchor.totalYards))
      .toBeLessThanOrEqual(PROFILE_CALIBRATION_TOLERANCES.referenceTotalYards);
    expect(Math.abs(solveReferenceCarry(anchor.totalYards) - carry))
      .toBeLessThanOrEqual(PROFILE_CALIBRATION_TOLERANCES.referenceTotalYards);
    expect(reference.rollout.lieAfter).toBe("fairway");
    expect(reference.rollout.evidence.workloadCapped).toBe(false);
    expect(reference.rollout.evidence.steps).toBeGreaterThan(1);
    expect(reference.impact.version).toBe(1);
  });

  it("does not reuse the driver full-swing roll as a universal subtraction", () => {
    const driver = referenceGround(210.82);
    const wedge = referenceGround(99.0854, "pitching_wedge");
    const partial = referenceGround(105.41, "driver", .5);
    expect(driver.rollout.rollYards).toBeGreaterThan(wedge.rollout.rollYards);
    expect(driver.rollout.rollYards).toBeGreaterThan(partial.rollout.rollYards);
    expect(driver.impact.forwardRollPotentialYards).toBeCloseTo(24.285, 5);
  });

  it("keeps carry monotonic in strength, gapped by declared assumptions", () => {
    let previousDriver = 0;
    for (let power = 0; power <= 100; power++) {
      const profile = freezeProfileCalibration({ ...skills(), power });
      expect(profile.clubCarryYards.driver).toBeGreaterThan(previousDriver);
      previousDriver = profile.clubCarryYards.driver;
      for (let index = 1; index < PROFILE_CALIBRATION_CLUBS.length; index++) {
        expect(profile.clubCarryYards[PROFILE_CALIBRATION_CLUBS[index - 1]])
          .toBeGreaterThan(profile.clubCarryYards[PROFILE_CALIBRATION_CLUBS[index]]);
      }
      for (const clubId of PROFILE_CALIBRATION_CLUBS) {
        expect(profile.clubCarryYards[clubId]).toBeCloseTo(profile.clubCarryYards.driver * CLUB_CARRY_RATIOS_V1[clubId], 5);
      }
    }
  });

  it("supports a short accurate golfer and a long inconsistent golfer independently", () => {
    const accurate = freezeProfileCalibration({ ...skills(95), power: 20 });
    const inconsistent = freezeProfileCalibration({ ...skills(20), power: 90 });
    expect(accurate.abilityHandicapAnchor).toBeCloseTo(1.4);
    expect(inconsistent.abilityHandicapAnchor).toBeCloseTo(22.4);
    expect(accurate.clubCarryYards.driver).toBeLessThan(inconsistent.clubCarryYards.driver - 50);
    expect(calibratedClubCarryYards({ ...skills(0), power: 60, clubId: "seven_iron" }))
      .toBe(calibratedClubCarryYards({ ...skills(100), power: 60, clubId: "seven_iron" }));
  });

  it("does not depend on confidence or official handicap fields", () => {
    const input = { ...skills(), clubId: "driver" as const, confidence: 1, handicapIndex: 0 };
    const changed = { ...input, confidence: 0, handicapIndex: 54 };
    expect(calibratedClubCarryYards(input))
      .toBe(calibratedClubCarryYards(changed));
  });

  it("bounds unsupported finite extremes and rejects nonfinite numbers", () => {
    expect(referenceDriverTotalYards(-20)).toBe(referenceDriverTotalYards(0));
    expect(referenceDriverTotalYards(80)).toBe(referenceDriverTotalYards(28));
    expect(calibratedClubCarryYards({ ...skills(), power: -500, clubId: "driver" }))
      .toBe(calibratedClubCarryYards({ ...skills(), power: 0, clubId: "driver" }));
    expect(calibratedClubCarryYards({ ...skills(), power: 500, clubId: "driver" }))
      .toBe(calibratedClubCarryYards({ ...skills(), power: 100, clubId: "driver" }));
    for (const invalid of [NaN, Infinity, -Infinity]) {
      expect(() => calibratedClubCarryYards({ ...skills(), power: invalid, clubId: "driver" })).toThrow(RangeError);
      expect(() => freezeProfileCalibration({ ...skills(), irons: invalid })).toThrow(RangeError);
      expect(() => referenceDriverTotalYards(invalid)).toThrow(RangeError);
    }
    expect(() => calibratedClubCarryYards({ ...skills(), clubId: "unknown" as ShotClubId })).toThrow(RangeError);
  });

  it("permits an explicit scenario offset without inferring demographics", () => {
    const base = freezeProfileCalibration(skills());
    const adjusted = freezeProfileCalibration(skills(), { driverTotalOffsetYards: -25 });
    expect(base.clubCarryYards.driver - adjusted.clubCarryYards.driver).toBe(25);
    expect(adjusted.abilityHandicapAnchor).toBe(base.abilityHandicapAnchor);
    expect(isProfileCalibrationV1(adjusted)).toBe(true);
    expect(() => freezeProfileCalibration(skills(), { driverTotalOffsetYards: 41 })).toThrow(RangeError);
  });

  it("retains a deep-frozen JSON-safe map without live skill dependencies", () => {
    const live = skills();
    const captured = freezeProfileCalibration(live);
    const serialized = JSON.stringify(captured);
    live.power = 100;
    expect(JSON.stringify(captured)).toBe(serialized);
    expect(Object.isFrozen(captured)).toBe(true);
    expect(Object.isFrozen(captured.skills)).toBe(true);
    expect(Object.isFrozen(captured.clubCarryYards)).toBe(true);
    expect(isProfileCalibrationV1(JSON.parse(serialized))).toBe(true);
    expect(captured.clubCarryYards.putter).toBe(0);
  });

  it("strictly rejects malformed, unknown-version or changed persisted values", () => {
    const valid = freezeProfileCalibration(skills());
    const invalid: unknown[] = [null, [], { ...valid, version: 2 }, { ...valid, model: "universal-carry" },
      { ...valid, extra: 1 }, { ...valid, abilityHandicapAnchor: 0 },
      { ...valid, skills: { ...valid.skills, power: -1 } },
      { ...valid, skills: { ...valid.skills, confidence: 50 } },
      { ...valid, clubCarryYards: { ...valid.clubCarryYards, driver: NaN } },
      { ...valid, clubCarryYards: { ...valid.clubCarryYards, driver: -10 } },
      { ...valid, clubCarryYards: { ...valid.clubCarryYards, driver: valid.clubCarryYards.driver + .01 } },
      { ...valid, clubCarryYards: { ...valid.clubCarryYards, unknown: 100 } },
      { ...valid, clubCarryYards: Object.fromEntries(Object.entries(valid.clubCarryYards).filter(([key]) => key !== "chip")) },
      { ...valid, driverTotalOffsetYards: Infinity },
    ];
    for (const value of invalid) expect(isProfileCalibrationV1(value)).toBe(false);
  });

  it("generates a deterministic neutral population without claiming an official handicap fit", () => {
    const population = Array.from({ length: 29 }, (_, handicap) => freezeProfileCalibration(populationAt(handicap)));
    expect(population.map((profile) => profile.abilityHandicapAnchor)).toEqual(Array.from({ length: 29 }, (_, index) => index));
    expect(JSON.stringify(population)).toBe(JSON.stringify(Array.from({ length: 29 }, (_, handicap) => freezeProfileCalibration(populationAt(handicap)))));
    expect(abilityHandicapAnchor(skills(50))).toBe(14);
    expect(PROFILE_CALIBRATION_UNSUPPORTED).toContain("official handicap prediction");
  });

  it("uses unspecified Arccos medians only for a broad magnitude cross-check", () => {
    const observations = DISTANCE_BENCHMARK_OBSERVATIONS.filter((row) => row.sourceId === "arccos-2020-smart-distance");
    expect(observations).toHaveLength(6);
    for (const row of observations) {
      expect(row.carryStatus).toBe("unspecified");
      const clubId = row.club === "7-iron" ? "seven_iron" : "pitching_wedge";
      const carry = calibratedClubCarryYards({ ...populationAt(row.handicapValue!), clubId });
      const total = referenceGround(carry, clubId).totalYards;
      // This broad check cannot establish a carry fit or combine populations.
      expect(Math.abs(total - row.value)).toBeLessThanOrEqual(PROFILE_CALIBRATION_TOLERANCES.unspecifiedDistanceCrossCheckYards);
    }
  });
});
