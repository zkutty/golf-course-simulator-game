import { describe, expect, it } from "vitest";
import type { Course, Hole, Point, Terrain } from "../models/types";
import { architectureReferencePlans, buildArchitectureReferencePlan } from "./referencePlan";
import { buildArchitectureReview, defaultArchitectureFilters, withArchitectureReferencePlans } from "./review";
import type { World } from "../models/types";
import { createReferenceCourse } from "../testing/referenceCourse";
import { analyzeArchitecture } from "./architecture";
import { computeRatingForSetup } from "../sim/courseRating";
import { buildStrategicPortfolio } from "./portfolio";

function fixture(args: {
  width?: number;
  height?: number;
  tee: Point;
  pin: Point;
  waypoints?: Point[];
  manualPar?: 3 | 4 | 5;
  paint?: (tiles: Terrain[], width: number, height: number) => void;
  elevations?: (values: number[], width: number, height: number) => void;
  obstacles?: Course["obstacles"];
  buildings?: Course["buildings"];
  teeBoxes?: Hole["teeBoxes"];
  pinPositions?: Hole["pinPositions"];
}): Course {
  const width = args.width ?? 84;
  const height = args.height ?? 32;
  const tiles = new Array<Terrain>(width * height).fill("rough");
  const elevations = new Array<number>(width * height).fill(0);
  const hole: Hole = {
    id: "reference-hole",
    tee: args.tee,
    green: args.pin,
    teeBoxes: args.teeBoxes ?? { forward: args.tee, member: args.tee, championship: args.tee },
    pinPositions: args.pinPositions ?? { A: args.pin },
    waypoints: args.waypoints,
    parMode: args.manualPar ? "MANUAL" : "AUTO",
    parManual: args.manualPar,
    parByTee: args.manualPar ? { forward: { mode: "MANUAL", par: args.manualPar }, member: { mode: "MANUAL", par: args.manualPar }, championship: { mode: "MANUAL", par: args.manualPar } } : undefined,
  };
  tiles[args.tee.y * width + args.tee.x] = "tee";
  for (let y = args.pin.y - 2; y <= args.pin.y + 2; y++) for (let x = args.pin.x - 2; x <= args.pin.x + 2; x++) {
    if (x >= 0 && y >= 0 && x < width && y < height) tiles[y * width + x] = "green";
  }
  args.paint?.(tiles, width, height);
  args.elevations?.(elevations, width, height);
  return {
    width,
    height,
    tiles,
    elevations,
    holes: [hole],
    layouts: [{ id: "reference-course", name: "Reference", draftHoleIds: [hole.id!], publishedHoleIds: [hole.id!], roundLength: 9, state: "open", greenFee: 50 }],
    activeCourseId: "reference-course",
    obstacles: args.obstacles ?? [],
    buildings: args.buildings ?? [],
    yardsPerTile: 10,
    name: "Reference",
    baseGreenFee: 50,
    condition: .9,
    theme: "parkland",
  };
}

function emptyWorld(): World {
  return {
    week: 1,
    difficulty: "normal",
    cash: 50_000,
    reputation: 0,
    golfers: [],
    rngState: 1,
  } as unknown as World;
}

describe("ZK-760 neutral architectural reference plan", () => {
  it("does not fabricate a fourth full shot for the intentionally oversized soak fixture", () => {
    const course = createReferenceCourse();
    const plan = buildArchitectureReferencePlan(course, course.holes[0], "member", "A");
    expect(plan).toMatchObject({ status: "implausible", fullShots: 0, segments: [] });
    expect(plan.explanation).toContain("No plausible neutral reference route");
  });

  it("uses one discrete tee-to-green shot for a carryable-water Par 3 and counts putts only in par", () => {
    const course = fixture({
      tee: { x: 3, y: 14 },
      pin: { x: 20, y: 14 },
      paint: (tiles, width) => {
        for (let y = 0; y < 32; y++) for (let x = 8; x <= 10; x++) tiles[y * width + x] = "water";
      },
    });
    const plan = buildArchitectureReferencePlan(course, course.holes[0], "member", "A");
    expect(plan.status).toBe("complete");
    expect(plan.recommendedPar).toBe(3);
    expect(plan.fullShots).toBe(1);
    expect(plan.expectedPutts).toBe(2);
    expect(plan.segments.map((segment) => [segment.from, segment.to])).toEqual([[{ x: 3, y: 14 }, { x: 20, y: 14 }]]);
    expect(plan.corridor.water).toBeGreaterThan(0);
  });

  it("creates one landing target for a dogleg Par 4 instead of tracing its dense fairway snake", () => {
    const waypoints = Array.from({ length: 13 }, (_, index) => ({
      x: index < 7 ? 5 + index * 3 : 23,
      y: index < 7 ? 5 : 5 + (index - 6) * 3,
    }));
    const course = fixture({ tee: { x: 3, y: 5 }, pin: { x: 23, y: 28 }, waypoints, manualPar: 4 });
    const plan = buildArchitectureReferencePlan(course, course.holes[0], "member", "A");
    expect(plan.fullShots).toBe(2);
    expect(plan.segments).toHaveLength(2);
    expect(plan.landingZones).toHaveLength(1);
    expect(plan.segments[0].to).toEqual(plan.segments[1].from);
    expect(plan.segments.length).toBeLessThan(waypoints.length);
    expect(plan.segments[0].to.x).toBeGreaterThan(12);
  });

  it("uses three meaningful advances for a conventional Par 5", () => {
    const course = fixture({ width: 90, tee: { x: 4, y: 15 }, pin: { x: 72, y: 15 } });
    const plan = buildArchitectureReferencePlan(course, course.holes[0], "member", "A");
    expect(plan.recommendedPar).toBe(5);
    expect(plan.fullShots).toBe(3);
    expect(plan.landingZones).toHaveLength(2);
    expect(plan.segments.every((segment) => segment.playsLikeYards > 100)).toBe(true);
  });

  it("distinguishes driveable and forced-layup Par 4s without following ground hazards", () => {
    const driveable = fixture({ tee: { x: 3, y: 13 }, pin: { x: 27, y: 13 }, manualPar: 4 });
    const driveablePlan = buildArchitectureReferencePlan(driveable, driveable.holes[0], "member", "A");
    expect(driveablePlan.recommendedPar).toBe(3);
    expect(driveablePlan.alternativePar).toBe(4);
    expect(driveablePlan.selectedPar).toBe(4);
    expect(driveablePlan.segments).toHaveLength(2);

    const layup = fixture({
      tee: { x: 3, y: 14 },
      pin: { x: 48, y: 14 },
      manualPar: 4,
      paint: (tiles, width, height) => {
        for (let y = 0; y < height; y++) for (let x = 28; x <= 34; x++) tiles[y * width + x] = "water";
        for (let y = 10; y <= 18; y++) for (let x = 20; x <= 27; x++) tiles[y * width + x] = "fairway";
      },
    });
    const layupPlan = buildArchitectureReferencePlan(layup, layup.holes[0], "member", "A");
    expect(layupPlan.segments).toHaveLength(2);
    expect(layupPlan.segments[0].to.x).toBeLessThan(28);
    expect(layupPlan.segments[1].to).toEqual({ x: 48, y: 14 });
  });

  it("surfaces the long-Par-4/short-Par-5 ambiguity while preserving a reachable manual Par 5", () => {
    const course = fixture({ tee: { x: 3, y: 14 }, pin: { x: 50, y: 14 }, manualPar: 5 });
    const plan = buildArchitectureReferencePlan(course, course.holes[0], "member", "A");
    expect(plan.recommendedPar).toBe(4);
    expect(plan.alternativePar).toBe(5);
    expect(plan.selectedPar).toBe(5);
    expect(plan.fullShots).toBe(3);
    expect(plan.warnings.some((warning) => warning.includes("Par 4/Par 5 ambiguity"))).toBe(true);
  });

  it("routes around blocking structures and reflects elevation in plays-like distance", () => {
    const base = fixture({
      tee: { x: 3, y: 14 },
      pin: { x: 45, y: 14 },
      manualPar: 4,
      buildings: [{ type: "clubhouse", x: 22, y: 12 }],
    });
    const routed = buildArchitectureReferencePlan(base, base.holes[0], "member", "A");
    expect(routed.segments).toHaveLength(2);
    expect(routed.landingZones[0].center.y).not.toBe(14);
    const uphill = {
      ...base,
      elevations: base.elevations.map((value, index) => index % base.width > 34 ? value + 4 : value),
    };
    const uphillPlan = buildArchitectureReferencePlan(uphill, uphill.holes[0], "member", "A");
    expect(uphillPlan.segments.at(-1)!.playsLikeYards).toBeGreaterThan(routed.segments.at(-1)!.playsLikeYards);
    expect(uphillPlan.version).not.toBe(routed.version);
  });

  it("solves tees and pins independently and keeps the neutral plan stable across daily state", () => {
    const course = fixture({
      width: 90,
      tee: { x: 15, y: 15 },
      pin: { x: 62, y: 15 },
      teeBoxes: { forward: { x: 25, y: 15 }, member: { x: 15, y: 15 }, championship: { x: 5, y: 15 } },
      pinPositions: { A: { x: 62, y: 15 }, B: { x: 66, y: 12 }, C: { x: 66, y: 18 } },
    });
    const forward = buildArchitectureReferencePlan(course, course.holes[0], "forward", "A");
    const member = buildArchitectureReferencePlan(course, course.holes[0], "member", "B");
    const championship = buildArchitectureReferencePlan(course, course.holes[0], "championship", "C");
    expect(new Set([forward.effectiveYardage, member.effectiveYardage, championship.effectiveYardage]).size).toBe(3);
    expect(forward.tee).toEqual({ x: 25, y: 15 });
    expect(member.pin).toEqual({ x: 66, y: 12 });
    expect(championship.tee).toEqual({ x: 5, y: 15 });
    const dailyChanged = { ...course, condition: .15, activePinRotation: "C" as const };
    const stable = buildArchitectureReferencePlan(dailyChanged, dailyChanged.holes[0], "member", "B");
    expect(stable.segments).toEqual(member.segments);
    expect(stable.recommendedPar).toBe(member.recommendedPar);
  });

  it("preserves an implausible manual par while warning and showing the credible route", () => {
    const course = fixture({ width: 90, tee: { x: 4, y: 15 }, pin: { x: 75, y: 15 }, manualPar: 3 });
    const plan = buildArchitectureReferencePlan(course, course.holes[0], "member", "A");
    expect(plan.selectedPar).toBe(3);
    expect(plan.recommendedPar).toBe(5);
    expect(plan.planPar).toBe(5);
    expect(plan.warnings.some((warning) => warning.includes("Manual Par 3 is preserved"))).toBe(true);
    expect(plan.segments).toHaveLength(3);
  });

  it("recomputes deterministically for geometry edits and exposes reference chords and landing zones to review", () => {
    const course = fixture({ tee: { x: 4, y: 15 }, pin: { x: 47, y: 15 }, manualPar: 4 });
    const first = buildArchitectureReferencePlan(course, course.holes[0], "member", "A");
    expect(buildArchitectureReferencePlan(course, course.holes[0], "member", "A")).toBe(first);
    const edited = { ...course, holes: [{ ...course.holes[0], teeBoxes: { ...course.holes[0].teeBoxes, member: { x: 7, y: 15 } }, tee: { x: 7, y: 15 } }] };
    const recomputed = buildArchitectureReferencePlan(edited, edited.holes[0], "member", "A");
    expect(recomputed.version).not.toBe(first.version);
    expect(recomputed.tee).toEqual({ x: 7, y: 15 });
    const filters = { ...defaultArchitectureFilters(edited), kind: "reference" as const, holeId: "reference-hole", teeSet: "member" as const, pinRotation: "A" as const };
    const review = withArchitectureReferencePlans(
      buildArchitectureReview(edited, emptyWorld(), filters),
      [recomputed],
    );
    expect(review.selectedReferencePlan?.id).toBe(recomputed.id);
    expect(review.overlay.traces).toHaveLength(recomputed.segments.length);
    expect(review.overlay.points).toHaveLength(recomputed.landingZones.length);
    expect(review.overlay.traces.every((trace) => trace.source === "reference")).toBe(true);
  });

  it("keeps selected tee/pin architecture, safety, rating, overlays, and explanations on one plan", () => {
    const one = fixture({
      width: 90,
      tee: { x: 15, y: 15 },
      pin: { x: 62, y: 15 },
      teeBoxes: { forward: { x: 25, y: 15 }, member: { x: 15, y: 15 }, championship: { x: 5, y: 15 } },
      pinPositions: { A: { x: 62, y: 15 }, B: { x: 64, y: 15 }, C: { x: 60, y: 15 } },
    });
    const holes = Array.from({ length: 9 }, (_, index) => ({ ...one.holes[0], id: `reference-${index + 1}` }));
    const course = {
      ...one,
      holes,
      layouts: [{ ...one.layouts![0], draftHoleIds: holes.map((hole) => hole.id!), publishedHoleIds: holes.map((hole) => hole.id!) }],
    };
    const plans = architectureReferencePlans(course, "member", "B");
    const filters = { ...defaultArchitectureFilters(course), kind: "reference" as const, teeSet: "member" as const, pinRotation: "B" as const };
    const review = withArchitectureReferencePlans(buildArchitectureReview(course, emptyWorld(), filters), plans, course);
    const rating = computeRatingForSetup(course, "member", "B", plans);
    const architecture = analyzeArchitecture(course, { teeSet: "member", pinRotation: "B" }, plans);

    expect(review.referenceSummary).toEqual(expect.objectContaining({
      teeSet: "member",
      pinRotation: "B",
      architectureScore: architecture.total,
      safetyScore: architecture.components.safety.score,
      courseRating: rating.courseRating,
      slope: rating.slope,
      effectiveYardage: rating.effectiveYardage,
    }));
    expect(review.overlay.traces.map((trace) => [trace.from, trace.to])).toEqual(
      plans.flatMap((plan) => plan.segments.map((segment) => [segment.from, segment.to])),
    );
    expect(review.overlay.traces.every((trace) => trace.label?.includes("member · shot"))).toBe(true);
    expect(rating.effectiveYardage).toBe(plans.reduce((sum, plan) => sum + plan.effectiveYardage, 0) * 2);
  }, 30_000);

  it("does not replace or mutate the live strategic choices", () => {
    const course = fixture({
      tee: { x: 3, y: 14 },
      pin: { x: 48, y: 14 },
      manualPar: 4,
      paint: (tiles, width) => {
        for (let y = 9; y <= 19; y++) for (let x = 18; x <= 24; x++) tiles[y * width + x] = "sand";
      },
    });
    const before = structuredClone(buildStrategicPortfolio(course, { samplesPerOption: 3, seed: 764 }));
    const reference = buildArchitectureReferencePlan(course, course.holes[0], "member", "A");
    const after = buildStrategicPortfolio(course, { samplesPerOption: 3, seed: 764 });
    expect(reference.segments.length).toBeGreaterThan(0);
    expect(after).toEqual(before);
    expect(after.evaluation.holes.flatMap((hole) => hole.options.map((option) => option.kind)))
      .toEqual(expect.arrayContaining(["safe", "hero"]));
  });
});
