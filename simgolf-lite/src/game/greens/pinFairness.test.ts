import { describe, expect, it } from "vitest";
import { DEFAULT_WORLD } from "../models/defaults";
import type { Course, PinRotation } from "../models/types";
import { withNormalizedHoleSetup, validateHoleCourseSetup } from "../models/courseSetup";
import { createReferenceCourse, createTournamentStandardsCourse } from "../testing/referenceCourse";
import { createGreenProgram, createHealthyGreenLocalState, GREEN_SURFACE_FIXED_POINT_SCALE, GREEN_SURFACE_SAMPLES_PER_AXIS } from "./greenSurface";
import { analyzePinFairness, analyzePinRotation, pinPhysicalBlockers } from "./pinFairness";
import { computeCourseRatingAndSlope, computeRatingForSetup } from "../sim/courseRating";
import { CURRENT_SAVE_SCHEMA_VERSION, normalizeLoadedSaveResult } from "../../utils/save";
import { createCoursePackage, packageText, validatePackageText } from "../contentPackages/packageFormat";
import { evaluateTournamentCourseQualification } from "../tournaments/eligibility";

function courseWithRotations(): Course {
  const base = createReferenceCourse();
  const source = base.holes[0];
  const pinA = source.green!;
  const pinB = { x: pinA.x - 2, y: pinA.y };
  const pinC = { x: pinA.x + 2, y: pinA.y };
  const tiles = base.tiles.slice();
  const elevations = new Array(base.width * base.height).fill(0);
  for (let y = pinA.y - 4; y <= pinA.y + 4; y++) for (let x = pinA.x - 5; x <= pinA.x + 5; x++) {
    if (x >= 0 && y >= 0 && x < base.width && y < base.height) tiles[y * base.width + x] = "green";
  }
  const hole = withNormalizedHoleSetup({
    ...source,
    id: "fairness-hole",
    parMode: "MANUAL",
    parManual: 4,
    teeBoxes: { member: source.tee },
    pinPositions: { A: pinA, B: pinB, C: pinC },
  });
  const holes = [hole];
  const offsets = Array.from({ length: GREEN_SURFACE_SAMPLES_PER_AXIS ** 2 }, (_, index) => {
    const x = index % GREEN_SURFACE_SAMPLES_PER_AXIS;
    const y = Math.floor(index / GREEN_SURFACE_SAMPLES_PER_AXIS);
    return Math.min(2048, (x + y) * Math.round(GREEN_SURFACE_FIXED_POINT_SCALE * .34));
  });
  return {
    ...base,
    tiles,
    elevations,
    holes,
    obstacles: base.obstacles ?? [],
    decorations: base.decorations ?? [],
    buildings: base.buildings ?? [],
    greenSurface: {
      version: 1,
      samplesPerAxis: GREEN_SURFACE_SAMPLES_PER_AXIS,
      fixedPointScale: GREEN_SURFACE_FIXED_POINT_SCALE,
      interpolation: "bilinear",
      tiles: [{ x: pinB.x, y: pinB.y, offsets }],
    },
    greenProgram: createGreenProgram("championship"),
    greenLocalState: createHealthyGreenLocalState({ holes }),
  };
}

function pin(course: Course, rotation: PinRotation) {
  return course.holes[0].pinPositions![rotation]!;
}

describe("ZK-643 pin fairness", () => {
  it("keeps demanding pins legal while explaining fine-surface and cohort consequences", () => {
    const course = courseWithRotations();
    const flat = analyzePinFairness(course, course.holes[0], pin(course, "A"), "A");
    const demanding = analyzePinFairness(course, course.holes[0], pin(course, "B"), "B");

    expect(demanding.legal).toBe(true);
    expect(demanding.localSlope).toBeGreaterThan(flat.localSlope);
    expect(demanding.warnings.some((warning) => warning.code === "EXCESSIVE_LOCAL_SLOPE")).toBe(true);
    expect(demanding.cohorts.scratch.expectedPutts).toBeLessThan(demanding.cohorts.bogey.expectedPutts);
    expect(demanding.cohorts.bogey.expectedPutts).toBeLessThan(demanding.cohorts.casual.expectedPutts);
    expect(demanding.cohorts.casual.paceMinutesDelta).toBeGreaterThan(demanding.cohorts.scratch.paceMinutesDelta);
    expect(demanding.tournamentReadiness).toBeLessThan(flat.tournamentReadiness);
    expect(demanding.warnings.every((warning) => warning.message.includes("Pin B"))).toBe(true);
  });

  it("blocks only physical invalidity and carries that gate through setup and save validation", () => {
    const course = courseWithRotations();
    const invalid = { x: 0, y: 0 };
    expect(pinPhysicalBlockers(course, invalid)).toEqual(["Cup lacks the required usable green coverage and clearance."]);
    const invalidHole = withNormalizedHoleSetup({
      ...course.holes[0],
      pinPositions: { ...course.holes[0].pinPositions, B: invalid },
    });
    expect(validateHoleCourseSetup(course, invalidHole)).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "PIN_NOT_ON_GREEN", message: expect.stringContaining("Pin B") }),
    ]));

    const loaded = normalizeLoadedSaveResult({
      schemaVersion: CURRENT_SAVE_SCHEMA_VERSION,
      savedAt: Date.now(),
      course: { ...course, holes: [invalidHole] },
      world: DEFAULT_WORLD,
    });
    expect(loaded.ok).toBe(false);
    if (!loaded.ok) expect(loaded.error.code).toBe("INVALID_COURSE");
  });

  it("rejects physically invalid imported packages while retaining legal warning pins", async () => {
    const source = createTournamentStandardsCourse();
    const course = {
      ...source,
      decorations: source.decorations ?? [],
      buildings: source.buildings ?? [],
    };
    const legalPackage = await createCoursePackage({
      course,
      title: "Pin fairness",
      description: "Legal warning pin",
      author: { id: "pin-author", displayName: "Pin Author" },
      requiredGameVersion: "1.0.0",
      now: new Date("2026-08-02T12:00:00.000Z"),
    });
    const legalResult = await validatePackageText(packageText(legalPackage));
    expect(legalResult, JSON.stringify(legalResult)).toMatchObject({ status: "compatible" });

    const invalidCourse = {
      ...course,
      holes: course.holes.map((hole, index) => index === 0 ? withNormalizedHoleSetup({
        ...hole,
        pinPositions: { ...hole.pinPositions, B: { x: 0, y: 0 } },
      }) : hole),
    };
    const invalidPackage = await createCoursePackage({
      course: invalidCourse,
      title: "Invalid pin",
      description: "Invalid cup coverage",
      author: { id: "pin-author", displayName: "Pin Author" },
      requiredGameVersion: "1.0.0",
      now: new Date("2026-08-02T12:00:00.000Z"),
    });
    const result = await validatePackageText(packageText(invalidPackage));
    expect(result.status).toBe("corrupt");
    if (result.status === "corrupt") expect(result.errors.join(" ")).toContain("Pin B");
  });

  it("makes A/B/C operationally distinct without changing the published tee contract", () => {
    const course = courseWithRotations();
    const rotationA = analyzePinRotation(course, "A");
    const rotationB = analyzePinRotation(course, "B");
    expect(rotationB.difficulty).toBeGreaterThan(rotationA.difficulty);
    expect(rotationB.paceMinutesDelta).toBeGreaterThan(rotationA.paceMinutesDelta);
    expect(rotationB.satisfactionDelta).toBeLessThan(rotationA.satisfactionDelta);
    expect(computeRatingForSetup(course, "member", "B").pinDifficultyDelta)
      .toBeGreaterThan(computeRatingForSetup(course, "member", "A").pinDifficultyDelta);
    expect(computeCourseRatingAndSlope({ ...course, activePinRotation: "A" }))
      .toEqual(computeCourseRatingAndSlope({ ...course, activePinRotation: "B" }));

    const qualification = evaluateTournamentCourseQualification(course, "local");
    const readiness = qualification.requirements.find((item) => item.id === "pin-fairness");
    expect(readiness?.label).toContain(`Pin ${qualification.pinRotation}`);
    expect(readiness?.current).toContain("casual");

    const standards = createTournamentStandardsCourse();
    const local = evaluateTournamentCourseQualification(standards, "local");
    const regional = evaluateTournamentCourseQualification(standards, "regional");
    expect(local, JSON.stringify({ blockers: local.blockingReasons, setup: computeRatingForSetup(standards, "member", local.pinRotation) })).toMatchObject({ eligible: true });
    expect(regional, regional.blockingReasons.join(" ")).toMatchObject({ eligible: true });
  }, 30_000);
});
