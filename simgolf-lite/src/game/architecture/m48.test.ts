import { describe, expect, it } from "vitest";
import type { Course, Terrain } from "../models/types";
import { buildStrategicPortfolio } from "./portfolio";
import { buildStrategicRecommendations } from "./recommendations";
import { compareM48DesignTest, createM48DesignTestSession, refreshM48DesignTestSession } from "./comparison";
import { evaluateStrategicArchitecture, strategicHoleForSetup } from "./strategic";

function course(kind: "bailout" | "mandatory" | "portfolio" = "bailout"): Course {
  const width = 64;
  const height = 28;
  const tiles = Array.from({ length: width * height }, () => "fairway" as Terrain);
  const tee = { x: 5, y: 14 };
  const green = { x: 56, y: 14 };
  for (let y = 0; y < height; y++) {
    if (kind === "mandatory") for (let x = 27; x <= 33; x++) tiles[y * width + x] = "water";
    else if (kind === "bailout" && y > 3 && y < height - 4) tiles[y * width + 30] = "water";
  }
  if (kind !== "mandatory") for (const y of [8, 9, 10, 18, 19, 20]) for (let x = 27; x <= 33; x++) tiles[y * width + x] = "fairway";
  for (let y = green.y - 1; y <= green.y + 1; y++) for (let x = green.x - 1; x <= green.x + 1; x++) tiles[y * width + x] = "green";
  const holes = Array.from({ length: kind === "portfolio" ? 9 : 1 }, (_, index) => ({
    id: `m48-hole-${index + 1}`,
    tee: { x: tee.x, y: Math.min(height - 2, tee.y + index) },
    green: { x: green.x, y: Math.min(height - 2, green.y + index) },
    parMode: "MANUAL" as const,
    parManual: 4 as const,
    name: `M48 hole ${index + 1}`,
  }));
  return {
    width,
    height,
    tiles,
    elevations: new Array(width * height).fill(0),
    holes,
    layouts: [{ id: "m48-course", name: "M48 test", draftHoleIds: holes.map((hole) => hole.id), publishedHoleIds: holes.map((hole) => hole.id), roundLength: 9, state: "open", greenFee: 65 }],
    activeCourseId: "m48-course",
    obstacles: [],
    buildings: [],
    yardsPerTile: 10,
    name: "M48 test",
    baseGreenFee: 65,
    condition: .85,
    theme: "parkland",
  };
}

describe("M48 strategic architecture", () => {
  it("is deterministic, setup-aware, and cheap for incomplete editor states", () => {
    const first = evaluateStrategicArchitecture(course("bailout"), { samplesPerOption: 4 });
    const second = evaluateStrategicArchitecture(course("bailout"), { samplesPerOption: 4 });
    expect(second).toBe(first);
    expect(first.holes[0].status).toBe("complete");
    const incomplete = course("bailout");
    incomplete.holes[0].green = null;
    const pending = evaluateStrategicArchitecture(incomplete, { samplesPerOption: 8 });
    expect(pending.holes[0].status).toBe("incomplete");
    expect(pending.holes[0].sampleCount).toBe(0);
    expect(pending.holes[0].options).toHaveLength(0);
  });

  it("distinguishes a safe bailout from an unavoidable carry", () => {
    const bailout = strategicHoleForSetup(evaluateStrategicArchitecture(course("bailout"), { samplesPerOption: 4 }), "m48-hole-1", "member", "A")!;
    const mandatory = strategicHoleForSetup(evaluateStrategicArchitecture(course("mandatory"), { samplesPerOption: 4 }), "m48-hole-1", "member", "A")!;
    expect(bailout.safeRouteViability).toBeGreaterThan(mandatory.safeRouteViability);
    expect(mandatory.unavoidablePunishment).toBeGreaterThan(bailout.unavoidablePunishment);
    expect(bailout.optionCount).toBeGreaterThanOrEqual(mandatory.optionCount);
    expect(bailout.heroLineReward).toBeGreaterThanOrEqual(0);
  });

  it("exposes differentiated capability opportunities and rejects one-cohort portfolios", () => {
    const evaluation = evaluateStrategicArchitecture(course("bailout"), { samplesPerOption: 4 });
    const hole = evaluation.holes[0];
    expect(hole.cohorts.map((cohort) => cohort.cohortId)).toEqual(["power", "accuracy", "shortGame", "recovery", "casual"]);
    expect(new Set(hole.cohorts.map((cohort) => cohort.preferredOption)).size).toBeGreaterThan(1);
    const portfolio = buildStrategicPortfolio(course("portfolio"), { samplesPerOption: 3 });
    expect(portfolio.summary.holeCount).toBeGreaterThanOrEqual(9);
    expect(Object.values(portfolio.summary.favoredCohorts).some((count) => count > 0)).toBe(true);
    expect(buildStrategicRecommendations(course("mandatory"), { samplesPerOption: 3 }).every((recommendation) => recommendation.holeId)).toBe(true);
  });

  it("keeps the design/watch/play/redesign context deterministic and truthful", () => {
    const beforeCourse = course("bailout");
    const session = createM48DesignTestSession({ course: beforeCourse, courseId: "m48-course", holeId: "m48-hole-1", week: 4, seed: 480404 });
    expect(session?.noEconomy).toBe(true);
    expect(session?.stage).toBe("designed");
    if (!session) return;
    const afterCourse = { ...beforeCourse, tiles: [...beforeCourse.tiles] };
    afterCourse.tiles[14 * afterCourse.width + 30] = "fairway";
    const returned = refreshM48DesignTestSession({ course: afterCourse, session: { ...session, stage: "returned", selectedCohortId: "casual" } });
    expect(returned.after?.geometryVersion).not.toBe(session.before?.geometryVersion);
    const comparison = compareM48DesignTest(returned);
    expect(comparison?.changed).toBe(true);
    expect(comparison?.evidenceLabel).toBe("provisional");
  });
});
