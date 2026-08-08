import { describe, expect, it } from "vitest";
import { applyAction } from "../../core/reducer";
import { CURRENT_SAVE_SCHEMA_VERSION, parseSaveText } from "../../utils/save";
import { hashCanonicalValue } from "../../utils/stateHash";
import { DEFAULT_WORLD } from "../models/defaults";
import type { Course, Hole, LandTheme, PinRotation, Point, TeeSet, Terrain } from "../models/types";
import { createDefaultPlayerPro } from "../playerPro/playerPro";
import type { PlayerCareerRound } from "../models/playerProTypes";
import {
  architectureReferencePlanDiagnostics,
  architectureReferencePlans,
  buildArchitectureReferencePlan,
  resetArchitectureReferencePlanDiagnostics,
  withArchitectureReferencePlans,
} from "../architecture/referencePlan";
import { buildArchitectureReview, defaultArchitectureFilters } from "../architecture/review";
import { buildM62FullEstateCourse } from "./m62Certification";
import { createReferenceCourse } from "./referenceCourse";
import type { GameState } from "../gameState";
import { getPinPosition, getTeeBox } from "../models/courseSetup";
import {
  emptyEditorEditHistory,
  recordEditorEdit,
  redoEditorEdit,
  undoEditorEdit,
  type EditorCapitalSnapshot,
} from "../editor/editorHistory";

const TEE_SETS: TeeSet[] = ["forward", "member", "championship"];
const PIN_ROTATIONS: PinRotation[] = ["A", "B", "C"];
const EMPTY_CAPITAL: EditorCapitalSnapshot = { spent: 0, refunded: 0, byTerrainSpent: {}, byTerrainTiles: {} };

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
    const matrix: unknown[] = [];
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
        if (kind === "water-par-3") {
          expect(plan).toMatchObject({ fullShots: 1, recommendedPar: 3, selectedPar: 3 });
          expect(plan.corridor.water).toBeGreaterThan(0);
        } else if (kind === "dogleg-par-4") {
          expect(plan).toMatchObject({ fullShots: 2, recommendedPar: 4, selectedPar: 4 });
          expect(plan.landingZones).toHaveLength(1);
        } else if (kind === "driveable-par-4") {
          expect(plan).toMatchObject({ fullShots: 2, recommendedPar: 3, selectedPar: 4 });
        } else if (kind === "forced-layup-par-4") {
          expect(plan.fullShots).toBe(teeSet === "forward" ? 3 : 2);
          expect(plan.selectedPar).toBe(teeSet === "forward" ? 5 : 4);
          expect(plan.corridor.water).toBeGreaterThan(0);
          expect(plan.segments[0].to.x).toBeLessThan(30);
        } else if (kind === "three-shot-par-5") {
          expect(plan).toMatchObject({ fullShots: 3, recommendedPar: 5, selectedPar: 5 });
          expect(plan.landingZones).toHaveLength(2);
        } else {
          expect(plan).toMatchObject({ fullShots: 3, recommendedPar: 4, alternativePar: 5, selectedPar: 5 });
          expect(plan.landingZones).toHaveLength(2);
        }
        matrix.push([kind, teeSet, pinRotation, plan.fullShots, plan.recommendedPar, plan.alternativePar, plan.selectedPar, plan.corridor.water]);
      }
    }
    expect(Object.fromEntries(Object.keys(courses).map((kind) => [kind, hashCanonicalValue(matrix.filter((row) => (row as unknown[])[0] === kind))]))).toEqual({
      "water-par-3": "c2492ca5",
      "dogleg-par-4": "d1641d5d",
      "driveable-par-4": "6963a5b0",
      "forced-layup-par-4": "e55766ee",
      "three-shot-par-5": "80bcb252",
      "reachable-par-5": "b94fcaaf",
    });

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

  it("uses authoritative marker reducers and editor history for placement, movement, selection, undo, and redo", () => {
    const initial = state(canonicalCourses()["forced-layup-par-4"]);
    let current = initial;
    let history = emptyEditorEditHistory();
    const dispatch = (action: Parameters<typeof applyAction>[1]) => {
      const previous = current;
      const next = applyAction(previous, action);
      history = recordEditorEdit(history, previous, next, EMPTY_CAPITAL, action);
      current = next;
      return next;
    };
    const restore = (direction: "undo" | "redo") => {
      const result = direction === "undo"
        ? undoEditorEdit(history, current, EMPTY_CAPITAL)
        : redoEditorEdit(history, current, EMPTY_CAPITAL);
      expect(result).not.toBeNull();
      if (!result) return;
      history = result.history;
      current = {
        ...current,
        course: result.snapshot.course,
        world: result.snapshot.world,
        terrainVersion: current.terrainVersion + 1,
        obstaclesVersion: current.obstaclesVersion + 1,
        markersVersion: current.markersVersion + 1,
        economyVersion: current.economyVersion + 1,
      };
    };

    const originalJson = JSON.stringify({ course: initial.course, world: initial.world });
    dispatch({ type: "REMOVE_TEE_BOX", holeIndex: 0, teeSet: "forward" });
    expect(getTeeBox(current.course.holes[0], "forward")).toBeNull();
    expect(buildArchitectureReferencePlan(current.course, current.course.holes[0], "forward", "A").status).toBe("incomplete");
    dispatch({ type: "SET_TEE_BOX", holeIndex: 0, teeSet: "forward", position: { x: 17, y: 15 } });
    expect(getTeeBox(current.course.holes[0], "forward")).toEqual({ x: 17, y: 15 });
    const placedTee = buildArchitectureReferencePlan(current.course, current.course.holes[0], "forward", "A");
    dispatch({ type: "SET_TEE_BOX", holeIndex: 0, teeSet: "forward", position: { x: 16, y: 15 } });
    expect(getTeeBox(current.course.holes[0], "forward")).toEqual({ x: 16, y: 15 });
    expect(buildArchitectureReferencePlan(current.course, current.course.holes[0], "forward", "A").version).not.toBe(placedTee.version);

    dispatch({ type: "REMOVE_PIN_POSITION", holeIndex: 0, pinRotation: "B" });
    expect(getPinPosition(current.course.holes[0], "B")).toBeNull();
    expect(buildArchitectureReferencePlan(current.course, current.course.holes[0], "member", "B").status).toBe("incomplete");
    dispatch({ type: "SET_PIN_POSITION", holeIndex: 0, pinRotation: "B", position: { x: 49, y: 14 } });
    expect(getPinPosition(current.course.holes[0], "B")).toEqual({ x: 49, y: 14 });
    const placedPin = buildArchitectureReferencePlan(current.course, current.course.holes[0], "member", "B");
    dispatch({ type: "SET_PIN_POSITION", holeIndex: 0, pinRotation: "B", position: { x: 51, y: 14 } });
    expect(getPinPosition(current.course.holes[0], "B")).toEqual({ x: 51, y: 14 });
    expect(buildArchitectureReferencePlan(current.course, current.course.holes[0], "member", "B").version).not.toBe(placedPin.version);
    dispatch({ type: "SET_ACTIVE_PIN_ROTATION", pinRotation: "C" });
    expect(current.course.activePinRotation).toBe("C");
    const finalJson = JSON.stringify({ course: current.course, world: current.world });
    expect(history.undo).toHaveLength(7);

    for (let index = 0; index < 7; index++) restore("undo");
    expect(JSON.stringify({ course: current.course, world: current.world })).toBe(originalJson);
    expect(history.redo).toHaveLength(7);
    for (let index = 0; index < 7; index++) restore("redo");
    expect(JSON.stringify({ course: current.course, world: current.world })).toBe(finalJson);
    expect(current.course.activePinRotation).toBe("C");
  }, 60_000);

  it("recomputes affected route, terrain, and elevation while retaining property-only reads", () => {
    const initial = state(canonicalCourses()["forced-layup-par-4"]);
    const original = buildArchitectureReferencePlan(initial.course, initial.course.holes[0], "member", "A");
    const propertyOnly = { ...initial.course, baseGreenFee: 175 };
    expect(buildArchitectureReferencePlan(propertyOnly, propertyOnly.holes[0], "member", "A")).toBe(original);

    const selectedFilters = { ...defaultArchitectureFilters(initial.course), kind: "reference" as const, holeId: initial.course.holes[0].id!, teeSet: "member" as const, pinRotation: "A" as const };
    const selected = withArchitectureReferencePlans(buildArchitectureReview(initial.course, initial.world, selectedFilters), [original], initial.course);
    expect(selected.selectedReferencePlan).toBe(original);
    expect(selected.overlay.traces).toHaveLength(original.segments.length);
    expect(selected.overlay.points).toHaveLength(original.landingZones.length);

    const routed = applyAction(initial, { type: "ADD_WAYPOINT", holeIndex: 0, position: { x: 21, y: 12 }, segmentIndex: 0 });
    const routedPlan = buildArchitectureReferencePlan(routed.course, routed.course.holes[0], "member", "A");
    expect(routedPlan.version).not.toBe(original.version);
    const rerouted = applyAction(routed, { type: "UPDATE_WAYPOINT", holeIndex: 0, waypointIndex: 0, position: { x: 22, y: 13 } });
    expect(buildArchitectureReferencePlan(rerouted.course, rerouted.course.holes[0], "member", "A").version).not.toBe(routedPlan.version);
    const routeRemoved = applyAction(rerouted, { type: "REMOVE_WAYPOINT", holeIndex: 0, waypointIndex: 0 });
    expect(buildArchitectureReferencePlan(routeRemoved.course, routeRemoved.course.holes[0], "member", "A").version).toBe(original.version);

    const painted = applyAction(initial, { type: "PAINT_TILES", tiles: [{ x: 24, y: 15, terrain: "sand" }] });
    const paintedPlan = buildArchitectureReferencePlan(painted.course, painted.course.holes[0], "member", "A");
    expect(paintedPlan.version).not.toBe(original.version);
    const sculpted = applyAction(painted, { type: "SCULPT_TILES", deltas: [{ x: 44, y: 15, delta: 3 }] });
    expect(buildArchitectureReferencePlan(sculpted.course, sculpted.course.holes[0], "member", "A").version).not.toBe(paintedPlan.version);
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
      const serialized = JSON.stringify({ schemaVersion, savedAt: 765, course, world, history: [] });
      const loaded = parseSaveText(serialized);
      expect(loaded.ok).toBe(true);
      if (!loaded.ok) continue;
      expect(JSON.stringify(loaded.payload.world.playerPro?.rounds)).toBe(historicalJson);
      const loadedPlan = buildArchitectureReferencePlan(loaded.payload.course, loaded.payload.course.holes[0], "championship", "C");
      expect(loadedPlan.version).toBe(plan.version);
      expect(loadedPlan.segments).toEqual(plan.segments);
      if (schemaVersion === 28) expect(loaded.migratedFrom).toBe(28);
    }

    const legacy = createReferenceCourse();
    const legacyTee = structuredClone(legacy.holes[0].tee!);
    const legacyGreen = structuredClone(legacy.holes[0].green!);
    const migrated = parseSaveText(JSON.stringify({ schemaVersion: 6, savedAt: 6, course: legacy, world: DEFAULT_WORLD, history: [] }));
    expect(migrated.ok).toBe(true);
    if (!migrated.ok) return;
    expect(migrated.migratedFrom).toBe(6);
    expect(getTeeBox(migrated.payload.course.holes[0], "member")).toEqual({ x: legacyTee.x + 55, y: legacyTee.y + 35 });
    expect(getPinPosition(migrated.payload.course.holes[0], "A")).toEqual({ x: legacyGreen.x + 55, y: legacyGreen.y + 35 });
    expect(getTeeBox(migrated.payload.course.holes[0], "forward")).toBeNull();
    const migratedPlan = buildArchitectureReferencePlan(migrated.payload.course, migrated.payload.course.holes[0], "member", "A");
    expect(migratedPlan.tee).toEqual(getTeeBox(migrated.payload.course.holes[0], "member"));
    expect(migratedPlan.pin).toEqual(getPinPosition(migrated.payload.course.holes[0], "A"));
  }, 60_000);

  it("precisely invalidates one edited hole on a 36-hole estate and keeps selected reads cache-only", () => {
    const course = buildM62FullEstateCourse();
    const first = architectureReferencePlans(course, "member", "A");
    const editedState = applyAction(state(course), {
      type: "ADD_WAYPOINT",
      holeIndex: 0,
      position: { x: course.holes[0].tee!.x + 2, y: course.holes[0].tee!.y + 1 },
      segmentIndex: 0,
    });
    expect(editedState.course).not.toBe(course);
    resetArchitectureReferencePlanDiagnostics();
    const edited = architectureReferencePlans(editedState.course, "member", "A");
    const editedMetrics = architectureReferencePlanDiagnostics();
    expect(editedMetrics).toEqual({ requests: 36, cacheHits: 0, retainedHits: 35, solves: 1 });
    expect(edited[0].version).not.toBe(first[0].version);
    expect(edited.slice(1).map((plan) => plan.version)).toEqual(first.slice(1).map((plan) => plan.version));

    resetArchitectureReferencePlanDiagnostics();
    const pointerStarted = performance.now();
    for (let pointerSample = 0; pointerSample < 1_000; pointerSample++) {
      buildArchitectureReferencePlan(editedState.course, editedState.course.holes[0], "member", "A");
    }
    const pointerElapsedMs = performance.now() - pointerStarted;
    expect(architectureReferencePlanDiagnostics()).toEqual({ requests: 1_000, cacheHits: 1_000, retainedHits: 0, solves: 0 });
    expect(pointerElapsedMs).toBeLessThan(750);
  }, 120_000);
});
