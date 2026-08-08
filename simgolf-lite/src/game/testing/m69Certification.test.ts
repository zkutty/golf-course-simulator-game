import { describe, expect, it } from "vitest";
import { applyAction } from "../../core/reducer";
import { CURRENT_SAVE_SCHEMA_VERSION, normalizeLoadedSaveResult } from "../../utils/save";
import { DEFAULT_WORLD } from "../models/defaults";
import type { Course, Hole, LandTheme, PinRotation, Point, TeeSet, Terrain } from "../models/types";
import { createDefaultPlayerPro } from "../playerPro/playerPro";
import type { PlayerCareerRound } from "../models/playerProTypes";
import {
  architectureReferencePlanDiagnostics,
  architectureReferencePlans,
  architectureReferenceReview,
  buildArchitectureReferencePlan,
  resetArchitectureReferencePlanDiagnostics,
  withArchitectureReferencePlans,
} from "../architecture/referencePlan";
import { buildArchitectureReview, defaultArchitectureFilters } from "../architecture/review";
import { buildM62FullEstateCourse } from "./m62Certification";
import type { GameState } from "../gameState";

const TEE_SETS: TeeSet[] = ["forward", "member", "championship"];
const PIN_ROTATIONS: PinRotation[] = ["A", "B", "C"];

type CanonicalKind = "water-par-3" | "dogleg-par-4" | "driveable-par-4" | "forced-layup-par-4" | "three-shot-par-5" | "reachable-par-5";

function courseFixture(args: {
  kind: CanonicalKind;
  width?: number;
  tee: Point;
  pin: Point;
  manualPar?: 3 | 4 | 5;
  parByTee?: Partial<Record<TeeSet, 3 | 4 | 5>>;
  waypoints?: Point[];
  theme?: LandTheme;
  forwardOffset?: number;
  paint?: (tiles: Terrain[], width: number, height: number) => void;
}): Course {
  const width = args.width ?? 90;
  const height = 34;
  const tiles = new Array<Terrain>(width * height).fill("rough");
  const elevations = new Array<number>(width * height).fill(0);
  const teeBoxes = {
    forward: { x: args.tee.x + (args.forwardOffset ?? 6), y: args.tee.y },
    member: args.tee,
    championship: { x: args.tee.x - 2, y: args.tee.y },
  };
  const pinPositions = {
    A: args.pin,
    B: { x: args.pin.x, y: args.pin.y - 1 },
    C: { x: args.pin.x, y: args.pin.y + 1 },
  };
  const hole: Hole = {
    id: `m69-${args.kind}`,
    name: args.kind,
    tee: teeBoxes.member,
    green: pinPositions.A,
    teeBoxes,
    pinPositions,
    waypoints: args.waypoints,
    parMode: args.manualPar ? "MANUAL" : "AUTO",
    parManual: args.manualPar,
    parByTee: args.manualPar ? Object.fromEntries(TEE_SETS.map((teeSet) => [teeSet, { mode: "MANUAL", par: args.parByTee?.[teeSet] ?? args.manualPar }])) : undefined,
  };
  args.paint?.(tiles, width, height);
  for (const tee of Object.values(teeBoxes)) tiles[tee.y * width + tee.x] = "tee";
  for (let y = args.pin.y - 3; y <= args.pin.y + 3; y++) for (let x = args.pin.x - 3; x <= args.pin.x + 3; x++) {
    if (x >= 0 && y >= 0 && x < width && y < height) tiles[y * width + x] = "green";
  }
  return {
    width,
    height,
    tiles,
    elevations,
    holes: [hole],
    layouts: [{ id: `layout-${args.kind}`, name: args.kind, draftHoleIds: [hole.id!], publishedHoleIds: [hole.id!], roundLength: 9, state: "open", greenFee: 50 }],
    activeCourseId: `layout-${args.kind}`,
    activePinRotation: "A",
    obstacles: [],
    buildings: [],
    yardsPerTile: 10,
    name: `M69 ${args.kind}`,
    baseGreenFee: 50,
    condition: .9,
    theme: args.theme ?? "parkland",
  };
}

function canonicalCourses(): Record<CanonicalKind, Course> {
  return {
    "water-par-3": courseFixture({
      kind: "water-par-3",
      tee: { x: 5, y: 15 },
      pin: { x: 22, y: 15 },
      paint: (tiles, width, height) => {
        for (let y = 0; y < height; y++) for (let x = 10; x <= 12; x++) tiles[y * width + x] = "water";
      },
    }),
    "dogleg-par-4": courseFixture({
      kind: "dogleg-par-4",
      tee: { x: 5, y: 5 },
      pin: { x: 27, y: 29 },
      manualPar: 4,
      waypoints: Array.from({ length: 13 }, (_, index) => ({
        x: index < 7 ? 7 + index * 3 : 25,
        y: index < 7 ? 5 : 5 + (index - 6) * 4,
      })),
    }),
    "driveable-par-4": courseFixture({ kind: "driveable-par-4", tee: { x: 5, y: 15 }, pin: { x: 29, y: 15 }, manualPar: 4 }),
    "forced-layup-par-4": courseFixture({
      kind: "forced-layup-par-4",
      tee: { x: 5, y: 15 },
      pin: { x: 50, y: 15 },
      manualPar: 4,
      parByTee: { forward: 5 },
      forwardOffset: 13,
      paint: (tiles, width, height) => {
        for (let y = 0; y < height; y++) for (let x = 30; x <= 36; x++) tiles[y * width + x] = "water";
        for (let y = 10; y <= 20; y++) for (let x = 20; x <= 29; x++) tiles[y * width + x] = "fairway";
      },
    }),
    "three-shot-par-5": courseFixture({ kind: "three-shot-par-5", tee: { x: 5, y: 15 }, pin: { x: 74, y: 15 } }),
    "reachable-par-5": courseFixture({ kind: "reachable-par-5", tee: { x: 5, y: 15 }, pin: { x: 52, y: 15 }, manualPar: 5 }),
  };
}

function state(course: Course): GameState {
  return {
    course,
    world: { ...structuredClone(DEFAULT_WORLD), cash: 1_000_000 },
    selectedTerrain: "fairway",
    terrainVersion: 0,
    obstaclesVersion: 0,
    markersVersion: 0,
    economyVersion: 0,
  };
}

describe("ZK-765 M69 architectural reference-plan certification", () => {
  it("certifies the six canonical hole classes for every tee and pin rotation", () => {
    const courses = canonicalCourses();
    for (const [kind, course] of Object.entries(courses) as Array<[CanonicalKind, Course]>) {
      for (const teeSet of TEE_SETS) for (const pinRotation of PIN_ROTATIONS) {
        const plan = buildArchitectureReferencePlan(course, course.holes[0], teeSet, pinRotation);
        expect(plan.status, `${kind}:${teeSet}:${pinRotation}`).toBe("complete");
        expect(plan.tee, `${kind}:${teeSet}:${pinRotation}:tee`).toEqual(course.holes[0].teeBoxes?.[teeSet]);
        expect(plan.pin, `${kind}:${teeSet}:${pinRotation}:pin`).toEqual(course.holes[0].pinPositions?.[pinRotation]);
        expect(plan.segments.at(-1)?.to, `${kind}:${teeSet}:${pinRotation}:finish`).toEqual(plan.pin);
        expect(plan.segments, `${kind}:${teeSet}:${pinRotation}:discrete`).toHaveLength(plan.fullShots);
        expect(plan.fullShots).toBeGreaterThanOrEqual(1);
        expect(plan.fullShots).toBeLessThanOrEqual(3);
        expect(buildArchitectureReferencePlan(course, course.holes[0], teeSet, pinRotation)).toBe(plan);
      }
    }

    expect(buildArchitectureReferencePlan(courses["water-par-3"], courses["water-par-3"].holes[0], "member", "A"))
      .toMatchObject({ recommendedPar: 3, fullShots: 1, expectedPutts: 2 });
    expect(buildArchitectureReferencePlan(courses["dogleg-par-4"], courses["dogleg-par-4"].holes[0], "member", "A").landingZones).toHaveLength(1);
    expect(buildArchitectureReferencePlan(courses["driveable-par-4"], courses["driveable-par-4"].holes[0], "member", "A"))
      .toMatchObject({ recommendedPar: 3, alternativePar: 4, selectedPar: 4, fullShots: 2 });
    const layup = buildArchitectureReferencePlan(courses["forced-layup-par-4"], courses["forced-layup-par-4"].holes[0], "member", "A");
    expect(layup.fullShots).toBe(2);
    expect(layup.segments[0].to.x).toBeLessThan(30);
    expect(buildArchitectureReferencePlan(courses["three-shot-par-5"], courses["three-shot-par-5"].holes[0], "member", "A").fullShots).toBe(3);
    expect(buildArchitectureReferencePlan(courses["reachable-par-5"], courses["reachable-par-5"].holes[0], "member", "A"))
      .toMatchObject({ recommendedPar: 4, alternativePar: 5, selectedPar: 5, fullShots: 3 });
  }, 60_000);

  it("pins both documented ambiguity bands without changing the selected manual par", () => {
    const short = canonicalCourses()["driveable-par-4"];
    const long = canonicalCourses()["reachable-par-5"];
    const shortPlan = buildArchitectureReferencePlan(short, short.holes[0], "member", "A");
    const longPlan = buildArchitectureReferencePlan(long, long.holes[0], "member", "A");
    expect(shortPlan.effectiveYardage).toBeGreaterThanOrEqual(210);
    expect(shortPlan.effectiveYardage).toBeLessThanOrEqual(290);
    expect(shortPlan.warnings.join(" ")).toContain("Par 3/Par 4 ambiguity");
    expect(longPlan.effectiveYardage).toBeGreaterThanOrEqual(400);
    expect(longPlan.effectiveYardage).toBeLessThanOrEqual(535);
    expect(longPlan.warnings.join(" ")).toContain("Par 4/Par 5 ambiguity");
  });

  it("recomputes only the affected geometry across marker, route, terrain, elevation, selection, undo, and redo", () => {
    const initial = state(canonicalCourses()["forced-layup-par-4"]);
    const original = buildArchitectureReferencePlan(initial.course, initial.course.holes[0], "member", "A");
    const propertyOnly = { ...initial.course, baseGreenFee: 175 };
    expect(buildArchitectureReferencePlan(propertyOnly, propertyOnly.holes[0], "member", "A")).toBe(original);

    const moved = applyAction(initial, { type: "MOVE_TEE", holeIndex: 0, oldPosition: original.tee!, position: { x: original.tee!.x + 1, y: original.tee!.y } });
    const movedPlan = buildArchitectureReferencePlan(moved.course, moved.course.holes[0], "member", "A");
    expect(movedPlan.version).not.toBe(original.version);
    expect(movedPlan.tee).toEqual({ x: original.tee!.x + 1, y: original.tee!.y });

    const selectedFilters = { ...defaultArchitectureFilters(moved.course), kind: "reference" as const, holeId: moved.course.holes[0].id!, teeSet: "member" as const, pinRotation: "A" as const };
    const selected = withArchitectureReferencePlans(buildArchitectureReview(moved.course, moved.world, selectedFilters), [movedPlan], moved.course);
    expect(selected.selectedReferencePlan).toBe(movedPlan);
    expect(selected.overlay.traces).toHaveLength(movedPlan.segments.length);

    const routed = applyAction(moved, { type: "ADD_WAYPOINT", holeIndex: 0, position: { x: 21, y: 12 }, segmentIndex: 0 });
    const routedPlan = buildArchitectureReferencePlan(routed.course, routed.course.holes[0], "member", "A");
    expect(routedPlan.version).not.toBe(movedPlan.version);
    const rerouted = applyAction(routed, { type: "UPDATE_WAYPOINT", holeIndex: 0, waypointIndex: 0, position: { x: 22, y: 13 } });
    expect(buildArchitectureReferencePlan(rerouted.course, rerouted.course.holes[0], "member", "A").version).not.toBe(routedPlan.version);
    const routeRemoved = applyAction(rerouted, { type: "REMOVE_WAYPOINT", holeIndex: 0, waypointIndex: 0 });
    expect(buildArchitectureReferencePlan(routeRemoved.course, routeRemoved.course.holes[0], "member", "A").version).toBe(movedPlan.version);

    const painted = applyAction(moved, { type: "PAINT_TILES", tiles: [{ x: 24, y: 15, terrain: "sand" }] });
    const paintedPlan = buildArchitectureReferencePlan(painted.course, painted.course.holes[0], "member", "A");
    expect(paintedPlan.version).not.toBe(movedPlan.version);
    const sculpted = applyAction(painted, { type: "SCULPT_TILES", deltas: [{ x: 44, y: 15, delta: 3 }] });
    expect(buildArchitectureReferencePlan(sculpted.course, sculpted.course.holes[0], "member", "A").version).not.toBe(paintedPlan.version);

    // App undo/redo owns whole immutable snapshots. Re-reading either snapshot
    // must restore the exact certified plan, not a plan derived from its peer.
    const undoSnapshot = initial;
    const redoSnapshot = moved;
    expect(buildArchitectureReferencePlan(undoSnapshot.course, undoSnapshot.course.holes[0], "member", "A")).toBe(original);
    expect(buildArchitectureReferencePlan(redoSnapshot.course, redoSnapshot.course.holes[0], "member", "A")).toBe(movedPlan);

    const removed = applyAction(moved, { type: "REMOVE_TEE_BOX", holeIndex: 0, teeSet: "member" });
    expect(buildArchitectureReferencePlan(removed.course, removed.course.holes[0], "member", "A").status).toBe("incomplete");
  }, 60_000);

  it("round-trips current and migrated saves while leaving completed-round history byte-identical", () => {
    const course = canonicalCourses()["dogleg-par-4"];
    const plan = buildArchitectureReferencePlan(course, course.holes[0], "championship", "C");
    const historical: PlayerCareerRound = {
      id: "m69-history",
      kind: "casual",
      courseId: course.activeCourseId!,
      courseName: course.name,
      week: 3,
      strokes: 4,
      penalties: 0,
      par: 4,
      scoreToPar: 0,
      result: "complete",
      earnings: 0,
      scorecard: [],
      shots: [],
      evidence: [],
      skillGains: {},
      geometryVersion: plan.version,
      teeSet: "championship",
      pinRotation: "C",
    };
    const career = createDefaultPlayerPro({ seed: 765 });
    const world = { ...structuredClone(DEFAULT_WORLD), playerPro: { ...career, rounds: [historical] } };
    const historicalJson = JSON.stringify(world.playerPro.rounds);

    for (const schemaVersion of [CURRENT_SAVE_SCHEMA_VERSION, 28] as const) {
      const loaded = normalizeLoadedSaveResult({ schemaVersion, savedAt: 765, course, world, history: [] });
      expect(loaded.ok).toBe(true);
      if (!loaded.ok) continue;
      expect(JSON.stringify(loaded.payload.world.playerPro?.rounds)).toBe(historicalJson);
      const loadedPlan = buildArchitectureReferencePlan(loaded.payload.course, loaded.payload.course.holes[0], "championship", "C");
      expect(loadedPlan.version).toBe(plan.version);
      expect(loadedPlan.segments).toEqual(plan.segments);
      if (schemaVersion === 28) expect(loaded.migratedFrom).toBe(28);
    }
  }, 60_000);

  it("keeps repeated 36-hole reads responsive and prevents pointer-sample cache reads from becoming estate solves", () => {
    const course = buildM62FullEstateCourse();
    resetArchitectureReferencePlanDiagnostics();
    const started = performance.now();
    const first = architectureReferenceReview(course, "member", "A");
    for (let pass = 0; pass < 12; pass++) {
      const repeated = architectureReferencePlans(course, "member", "A");
      expect(repeated.map((plan) => plan.version)).toEqual(first.map((plan) => plan.version));
    }
    const selected = course.holes[0];
    // This is deliberately harsher than the UI: even if every pointer sample
    // asks for the selected plan, all 1,000 reads must remain cache-only.
    for (let pointerSample = 0; pointerSample < 1_000; pointerSample++) {
      expect(buildArchitectureReferencePlan(course, selected, "member", "A")).toBe(first[0]);
    }
    const elapsedMs = performance.now() - started;
    const metrics = architectureReferencePlanDiagnostics();
    expect(course.holes).toHaveLength(36);
    expect(metrics.solves).toBe(36);
    expect(metrics.cacheHits).toBe(metrics.requests - metrics.solves);
    expect(elapsedMs).toBeLessThan(5_000);
  }, 120_000);
});
