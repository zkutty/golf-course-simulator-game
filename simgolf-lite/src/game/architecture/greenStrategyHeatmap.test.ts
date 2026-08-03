import { describe, expect, it } from "vitest";
import type { Course, PinRotation, Terrain } from "../models/types";
import { courseForCourseSetup } from "../models/courseSetup";
import { createFlatGreenSurfaceV1, createGreenProgram, createHealthyGreenLocalState } from "../greens/greenSurface";
import type { ArchitectureShotEvidence } from "../livingClub/types";
import { DEFAULT_WORLD } from "../models/defaults";
import { buildGreenStrategyHeatmap, buildGreenStrategyHeatmapForReview } from "./greenStrategyHeatmap";
import { buildArchitectureReview, defaultArchitectureFilters, withGreenStrategyHeatmap } from "./review";

function greenCourse(pinRotation: PinRotation = "A", program: "receptive" | "championship" = "receptive"): Course {
  const width = 34;
  const height = 24;
  const tiles: Terrain[] = new Array(width * height).fill("fairway");
  const elevations = new Array(width * height).fill(0);
  for (let y = 7; y <= 16; y++) for (let x = 21; x <= 29; x++) {
    tiles[y * width + x] = "green";
    elevations[y * width + x] = x >= 26 ? 1 : y >= 12 ? .35 : 0;
  }
  for (let y = 5; y <= 10; y++) for (let x = 29; x <= 32; x++) tiles[y * width + x] = "water";
  for (let y = 15; y <= 19; y++) for (let x = 19; x <= 24; x++) tiles[y * width + x] = "sand";
  const tee = { x: 5, y: 12 };
  const hole = {
    id: "green-1",
    name: "Strategy green",
    tee,
    green: { x: 23, y: 9 },
    teeBoxes: { member: tee },
    pinPositions: { A: { x: 23, y: 9 }, B: { x: 28, y: 13 }, C: { x: 25, y: 15 } },
    parMode: "MANUAL" as const,
    parManual: 3 as const,
  };
  const course: Course = {
    name: "ZK-644 strategy green",
    width,
    height,
    tiles,
    elevations,
    holes: [hole],
    layouts: [{ id: "course-primary", name: "Green", draftHoleIds: [hole.id], publishedHoleIds: [hole.id], roundLength: 9, state: "open", greenFee: 50 }],
    activeCourseId: "course-primary",
    obstacles: [],
    buildings: [],
    decorations: [],
    yardsPerTile: 10,
    baseGreenFee: 50,
    condition: .9,
    theme: "parkland",
    activePinRotation: pinRotation,
    greenSurface: createFlatGreenSurfaceV1(),
    greenProgram: createGreenProgram(program),
  };
  course.greenLocalState = createHealthyGreenLocalState(course);
  return courseForCourseSetup(course, "member", pinRotation);
}

const filters = (over: Partial<Parameters<typeof buildGreenStrategyHeatmap>[0]["filters"]> = {}) => ({
  kind: "green-preferred" as const,
  holeId: "green-1" as const,
  teeSet: "member" as const,
  pinRotation: "A" as const,
  cohortId: "all" as const,
  ...over,
});

function evidence(geometryVersion: string, id: string, current = false): ArchitectureShotEvidence {
  return {
    id,
    source: "regular",
    sourceSegment: "member",
    golferId: `golfer-${id}`,
    golferName: "Evidence Golfer",
    roundId: `round-${id}`,
    week: 4,
    day: 2,
    courseId: "course-primary",
    courseName: "Green",
    holeId: "green-1",
    teeSet: "member",
    geometryVersion,
    shotType: "approach",
    shotNumber: 2,
    from: { x: 16, y: 12 },
    landing: current ? { x: 23, y: 10 } : { x: 26, y: 14 },
    physicalRest: current ? { x: 24, y: 10 } : { x: 27, y: 15 },
    rest: current ? { x: 24, y: 10 } : { x: 27, y: 15 },
    scoreToPar: 0,
    waitMinutes: 0,
    lieBefore: "fairway",
    lieAfter: "green",
  };
}

function coordinates(result: ReturnType<typeof buildGreenStrategyHeatmap>): string[] {
  return result.overlay.cells
    .filter((item) => item.source === "predicted")
    .map((item) => `${item.x},${item.y}`)
    .sort();
}

describe("ZK-644 green strategy heatmaps", () => {
  it("is deterministic, bounded, and carries static non-color evidence patterns", () => {
    const course = greenCourse();
    const args = { course, filters: filters({ pinRotation: "all" as const }), evidence: [], currentGeometryVersion: "geometry-current" };
    const first = buildGreenStrategyHeatmap(args);
    const second = buildGreenStrategyHeatmap(args);

    expect(second).toEqual(first);
    expect(first.predictiveSamples).toBeGreaterThan(0);
    expect(first.overlay.cells.length).toBeLessThanOrEqual(240);
    expect(first.legend.map((item) => item.pattern)).toEqual(["dots", "cross", "diagonal", "diagonal"]);
    expect(first.reducedMotionSafe).toBe(true);
    expect(first.textSummary).not.toContain("observed facts");
    expect(first.textSummary).toContain("Forecast on current geometry");
    const kinds = ["green-preferred", "green-putts", "green-leaves", "green-misses", "green-rollout", "green-risk"] as const;
    for (const kind of kinds) {
      const result = buildGreenStrategyHeatmap({ ...args, filters: filters({ kind, pinRotation: "A" }) });
      expect(result.overlay.kind).toBe(kind);
      expect(result.overlay.cells.length + result.overlay.points.length + result.overlay.traces.length).toBeGreaterThan(0);
      expect(result.overlay.cells.length).toBeLessThanOrEqual(240);
      expect(result.overlay.points.length).toBeLessThanOrEqual(240);
      expect(result.overlay.traces.length).toBeLessThanOrEqual(320);
    }
  });

  it("materially changes canonical forecasts by pin, cohort, and maintenance program", () => {
    const currentGeometryVersion = "geometry-current";
    const pinA = buildGreenStrategyHeatmap({ course: greenCourse("A"), filters: filters({ pinRotation: "A" }), evidence: [], currentGeometryVersion });
    const pinB = buildGreenStrategyHeatmap({ course: greenCourse("B"), filters: filters({ pinRotation: "B" }), evidence: [], currentGeometryVersion });
    const power = buildGreenStrategyHeatmap({ course: greenCourse("A"), filters: filters({ cohortId: "power" }), evidence: [], currentGeometryVersion });
    const casual = buildGreenStrategyHeatmap({ course: greenCourse("A"), filters: filters({ cohortId: "casual" }), evidence: [], currentGeometryVersion });
    const receptive = buildGreenStrategyHeatmap({ course: greenCourse("A", "receptive"), filters: filters({ kind: "green-putts" }), evidence: [], currentGeometryVersion });
    const championship = buildGreenStrategyHeatmap({ course: greenCourse("A", "championship"), filters: filters({ kind: "green-putts" }), evidence: [], currentGeometryVersion });

    expect(coordinates(pinA)).not.toEqual(coordinates(pinB));
    expect(coordinates(power)).not.toEqual(coordinates(casual));
    expect(receptive.overlay.points.map((item) => item.value)).not.toEqual(championship.overlay.points.map((item) => item.value));
    expect(receptive.maintenanceProgram).toBe("receptive");
    expect(championship.maintenanceProgram).toBe("championship");
  });

  it("combines forecasts with observed leaves without relabeling frozen geometry", () => {
    const result = buildGreenStrategyHeatmap({
      course: greenCourse(),
      filters: filters({ kind: "green-leaves" }),
      evidence: [evidence("geometry-current", "current", true), evidence("geometry-old", "historical")],
      currentGeometryVersion: "geometry-current",
    });
    const current = result.overlay.points.find((item) => item.id === "observed-leave-current");
    const historical = result.overlay.points.find((item) => item.id === "observed-leave-historical");

    expect(current).toMatchObject({ source: "observed", current: true, pattern: "cross" });
    expect(historical).toMatchObject({ source: "observed", current: false, pattern: "diagonal" });
    expect(historical?.label).toContain("frozen geometry geometry-old");
    expect(result.observedGeometryVersions).toEqual([
      { geometryVersion: "geometry-current", current: true, shots: 1 },
      { geometryVersion: "geometry-old", current: false, shots: 1 },
    ]);
    expect(result.textSummary).toContain("1 current and 1 frozen historical shots");
  });

  it("reports every required design read and emits click-target recommendations", () => {
    const base = greenCourse("B", "championship");
    const exposed: Course = {
      ...base,
      tiles: base.tiles.map((terrain, index) => {
        if (terrain !== "green") return terrain;
        const x = index % base.width;
        const y = Math.floor(index / base.width);
        return x >= 26 && x <= 29 && y >= 11 && y <= 15 ? "green" : "water";
      }),
    };
    exposed.greenLocalState = createHealthyGreenLocalState(exposed);
    const result = buildGreenStrategyHeatmap({ course: exposed, filters: filters({ pinRotation: "all" }), evidence: [], currentGeometryVersion: "geometry-current" });

    expect(result.report).toEqual(expect.objectContaining({
      attackExpectedPutts: expect.any(Number),
      safeExpectedPutts: expect.any(Number),
      approachAdvantage: expect.any(Number),
      shortSidePunishment: expect.any(Number),
      rotationVariety: expect.any(Number),
      cohortSeparation: expect.any(Number),
      unfairness: expect.any(Number),
    }));
    expect(result.recommendations.length).toBeGreaterThan(0);
    expect(result.recommendations.every((item) => item.holeId === "green-1" && Number.isFinite(item.location.x) && Number.isFinite(item.location.y))).toBe(true);
  });

  it("integrates the selected green evidence into Architecture Review", () => {
    const course = greenCourse();
    const selectedFilters = {
      ...defaultArchitectureFilters(course),
      kind: "green-risk",
      holeId: "green-1",
      cohortId: "accuracy",
      pinRotation: "B",
    } as const;
    const base = buildArchitectureReview(course, DEFAULT_WORLD, selectedFilters);
    const review = withGreenStrategyHeatmap(base, buildGreenStrategyHeatmapForReview({
      course,
      filters: selectedFilters,
      evidence: base.evidence,
      currentGeometryVersion: base.currentGeometryVersion,
    }));

    expect(review.greenStrategy).not.toBeNull();
    expect(review.greenStrategy?.selectedCohorts).toEqual(["accuracy"]);
    expect(review.greenStrategy?.selectedPins).toEqual(["B"]);
    expect(review.overlay.kind).toBe("green-risk");
    expect(review.overlay.points.length).toBeGreaterThan(0);
  });
});
