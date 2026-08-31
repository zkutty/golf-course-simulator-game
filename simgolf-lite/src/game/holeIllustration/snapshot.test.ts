import { describe, expect, it } from "vitest";
import {
  GREEN_SURFACE_FIXED_POINT_SCALE,
  GREEN_SURFACE_SAMPLES_PER_AXIS,
  GREEN_SURFACE_VERSION,
} from "../greens/greenSurface";
import type { Course, Hole, Point } from "../models/types";
import { createHoleIllustrationSnapshot } from "./snapshot";

type Shape = "parallel" | "crossing" | "dogleg" | "split" | "short" | "long";

function fixture(shape: Shape = "dogleg", yardsPerTile = 10): Course {
  const width = 80;
  const height = 60;
  const tiles: Course["tiles"] = Array.from({ length: width * height }, () => "rough");
  const elevations = Array.from({ length: width * height }, () => 0);
  const tee = { x: 5, y: 10 };
  const pin = { x: shape === "short" ? 15 : shape === "long" ? 70 : 55, y: shape === "dogleg" || shape === "split" ? 30 : 10 };
  const waypoints: Point[] = shape === "dogleg" ? [{ x: 35, y: 10 }]
    : shape === "split" ? [{ x: 25, y: 6 }, { x: 38, y: 14 }]
      : [];
  const selected: Hole = {
    id: "a",
    tee,
    green: pin,
    teeBoxes: { forward: { x: 8, y: 10 }, member: tee, championship: { x: 3, y: 10 } },
    pinPositions: { A: pin, B: { x: pin.x - 1, y: pin.y + 1 }, C: { x: pin.x - 2, y: pin.y - 1 } },
    waypoints,
    parMode: "AUTO",
    templateAttribution: { templateId: "template-a", sourceLabel: "Fixture architect", licenseName: "CC-BY", attribution: "Example credit" },
  };
  const other: Hole = shape === "crossing"
    ? { id: "b", tee: { x: 30, y: 2 }, green: { x: 30, y: 45 }, parMode: "MANUAL", parManual: 4 }
    : { id: "b", tee: { x: 5, y: 45 }, green: { x: 55, y: 45 }, parMode: "MANUAL", parManual: 4 };
  const secondCourseHole: Hole = { id: "c", tee: { x: 62, y: 42 }, green: { x: 74, y: 52 }, parMode: "MANUAL", parManual: 3 };
  for (const marker of [tee, pin]) tiles[marker.y * width + marker.x] = marker === tee ? "tee" : "green";
  for (let x = 12; x <= 48; x++) {
    tiles[8 * width + x] = "fairway";
    if (shape === "split") tiles[16 * width + x] = "fairway";
  }
  tiles[10 * width + 25] = "water";
  if (shape === "crossing") tiles[10 * width + 30] = "sand";
  tiles[45 * width + 30] = "deep_rough";
  const offsets = Array.from({ length: 16 }, (_, index) => index === 0 ? 128 : 0);
  return {
    width,
    height,
    tiles,
    elevations,
    holes: [selected, other, secondCourseHole],
    layouts: [
      { id: "one", name: "One", draftHoleIds: ["b", "a"], publishedHoleIds: ["a", "b"], roundLength: 9, state: "open", greenFee: 50 },
      { id: "two", name: "Two", draftHoleIds: ["c"], publishedHoleIds: ["c"], roundLength: 9, state: "closed", greenFee: 40 },
    ],
    activeCourseId: "one",
    obstacles: [{ x: 20, y: 10, type: "tree" }, { x: 10, y: 28, type: "rock" }],
    buildings: [{ type: "clubhouse", x: 20, y: 5 }],
    decorations: [
      { kind: "bridge", x: 25, y: 3, rotation: 1, span: 3 },
      { kind: "bench", x: 10, y: 28, rotation: 0 },
    ],
    greenSurface: {
      version: GREEN_SURFACE_VERSION,
      samplesPerAxis: GREEN_SURFACE_SAMPLES_PER_AXIS,
      fixedPointScale: GREEN_SURFACE_FIXED_POINT_SCALE,
      interpolation: "bilinear",
      tiles: [{ x: pin.x, y: pin.y, offsets }],
    },
    yardsPerTile,
    name: "Fixture",
    baseGreenFee: 50,
    condition: 1,
  };
}

const request = {
  layoutId: "one",
  routeSource: "published" as const,
  holeId: "a",
  teeSet: "member" as const,
  pinRotation: "A" as const,
};

function complete(course: Course, overrides = {}) {
  const result = createHoleIllustrationSnapshot(course, { ...request, ...overrides });
  if (!result.complete) throw new Error(`${result.code}: ${result.message}`);
  return result.snapshot;
}

describe("ZK-767 authoritative hole illustration snapshot", () => {
  it("uses explicit published/draft route authority across multiple courses", () => {
    const input = fixture();
    expect(complete(input).route).toMatchObject({ layoutId: "one", source: "published", order: 0, routingIds: ["a", "b"] });
    expect(complete(input, { routeSource: "draft" }).route).toMatchObject({ source: "draft", order: 1, routingIds: ["b", "a"] });
    expect(createHoleIllustrationSnapshot(input, { ...request, layoutId: "two" })).toMatchObject({ complete: false, code: "HOLE_NOT_ROUTED" });
  });

  it("preserves every explicit tee/pin combination without setup fallback", () => {
    const input = fixture();
    for (const teeSet of ["forward", "member", "championship"] as const) for (const pinRotation of ["A", "B", "C"] as const) {
      expect(complete(input, { teeSet, pinRotation }).selection).toEqual({ teeSet, pinRotation });
    }
    const missingTee = { ...input, holes: input.holes.map((hole) => hole.id === "a" ? { ...hole, teeBoxes: { ...hole.teeBoxes, forward: null } } : hole) };
    expect(createHoleIllustrationSnapshot(missingTee, { ...request, teeSet: "forward" })).toMatchObject({ complete: false, code: "MISSING_TEE" });
    const missingPin = { ...input, holes: input.holes.map((hole) => hole.id === "a" ? { ...hole, pinPositions: { ...hole.pinPositions, C: null } } : hole) };
    expect(createHoleIllustrationSnapshot(missingPin, { ...request, pinRotation: "C" })).toMatchObject({ complete: false, code: "MISSING_PIN" });
  });

  it("isolates real parallel, crossing, dogleg, split-fairway, short, and long geometries", () => {
    for (const shape of ["parallel", "crossing", "dogleg", "split", "short", "long"] as const) {
      const snapshot = complete(fixture(shape), { marginTiles: 0 });
      expect(snapshot.terrain.length).toBeGreaterThan(0);
      expect(snapshot.terrain.every((cell) => cell.x >= 0 && cell.y >= 0)).toBe(true);
      expect(snapshot.framing.northUp.crop.width).toBeLessThanOrEqual(80);
      expect(snapshot.framing.northUp.crop.height).toBeLessThanOrEqual(60);
    }
    expect(complete(fixture("parallel"), { marginTiles: 0 }).terrain.some((cell) => cell.terrain === "deep_rough")).toBe(false);
    expect(complete(fixture("crossing"), { marginTiles: 0 }).terrain.some((cell) => cell.terrain === "sand")).toBe(true);
    const dogleg = complete(fixture("dogleg"), { marginTiles: 0 });
    expect(dogleg.waypoints).toHaveLength(1);
    expect(dogleg.terrain.some((cell) => cell.x === dogleg.waypoints[0].x && cell.y === dogleg.waypoints[0].y)).toBe(true);
    const split = complete(fixture("split"), { marginTiles: 0 });
    expect(split.terrain.filter((cell) => cell.terrain === "fairway").length).toBeGreaterThan(20);
    expect(complete(fixture("short"), { marginTiles: 0 }).distanceTiles).toBeLessThan(complete(fixture("long"), { marginTiles: 0 }).distanceTiles);
    const second = complete(fixture(), { layoutId: "two", holeId: "c" });
    expect(second.route).toMatchObject({ layoutId: "two", routingIds: ["c"], order: 0 });
  });

  it("provides deterministic north-up and tee-to-green crop, rotation, and scale", () => {
    const snapshot = complete(fixture("parallel"), { marginTiles: -20 });
    expect(snapshot.framing.marginTiles).toBe(0);
    expect(snapshot.framing.northUp).toMatchObject({ mode: "north-up", rotationDegrees: 0 });
    expect(snapshot.framing.teeToGreen.mode).toBe("tee-to-green");
    expect(snapshot.framing.teeToGreen.rotationDegrees).toBe(-90);
    expect(snapshot.framing.teeToGreen.matrix).toEqual({ a: 0, b: -1, c: 1, d: 0 });
    expect(snapshot.pin.teeToGreen.x).toBe(snapshot.tee.teeToGreen.x);
    expect(snapshot.pin.teeToGreen.y).toBeLessThan(snapshot.tee.teeToGreen.y);
    expect(snapshot.framing.teeToGreen.scaleToUnit).toBeGreaterThan(0);
    expect(snapshot.framing.teeToGreen.scaleToUnit).toBeLessThanOrEqual(1);
    expect(complete(fixture(), { marginTiles: 999 }).framing.marginTiles).toBe(64);
  });

  it("keeps AUTO par geometry-authoritative when display scale changes", () => {
    const ten = complete(fixture("parallel", 10));
    const twenty = complete(fixture("parallel", 20));
    expect(ten.distanceTiles).toBe(twenty.distanceTiles);
    expect(ten.par).toBe(twenty.par);
    expect(twenty.yardage).toBe(ten.yardage * 2);
    const threshold = fixture("parallel");
    threshold.holes = threshold.holes.map((hole) => hole.id === "a" ? {
      ...hole,
      tee: { x: 5, y: 5 },
      green: { x: 26, y: 26 },
      teeBoxes: { ...hole.teeBoxes, member: { x: 5, y: 5 } },
      pinPositions: { ...hole.pinPositions, A: { x: 26, y: 26 } },
      waypoints: [{ x: 6, y: 5 }, { x: 7, y: 6 }],
    } : hole);
    threshold.tiles[26 * threshold.width + 26] = "green";
    threshold.greenSurface = undefined;
    const edge = complete(threshold, { marginTiles: 0 });
    expect(edge.distanceTiles).toBe(30);
    expect(edge.par).toBe(5);
  });

  it("captures self-describing contours, compact provenance, and intersecting footprints", () => {
    const snapshot = complete(fixture("parallel"), { marginTiles: 0 });
    expect(snapshot.contours).toMatchObject({ version: 1, samplesPerAxis: 4, fixedPointScale: 1024, interpolation: "bilinear" });
    expect(snapshot.contours.tiles).toHaveLength(1);
    expect(snapshot.provenance).toEqual({ templateId: "template-a", sourceLabel: "Fixture architect", licenseName: "CC-BY", attribution: "Example credit" });
    expect(snapshot.decorations).toHaveLength(1);
    expect(snapshot.decorations[0].footprint.length).toBe(5);
    expect(snapshot.surroundings).toHaveLength(1);
    expect(snapshot.surroundings[0].footprint.length).toBe(9);
  });

  it("is immutable, canonical under source permutations, and hashes only relevant facts", () => {
    const input = fixture();
    const before = structuredClone(input);
    const first = complete(input, { marginTiles: 0 });
    expect(input).toEqual(before);
    const permuted = { ...input, obstacles: [...input.obstacles].reverse(), buildings: [...input.buildings].reverse(), decorations: [...input.decorations!].reverse() };
    expect(complete(permuted, { marginTiles: 0 }).hash).toBe(first.hash);

    const irrelevant = { ...input, tiles: [...input.tiles], elevations: [...input.elevations] };
    irrelevant.tiles[28 * irrelevant.width + 10] = "water";
    irrelevant.elevations[28 * irrelevant.width + 10] = 3;
    expect(complete(irrelevant, { marginTiles: 0 }).hash).toBe(first.hash);

    const relevant = { ...input, tiles: [...input.tiles] };
    relevant.tiles[10 * relevant.width + 20] = "sand";
    expect(complete(relevant, { marginTiles: 0 }).hash).not.toBe(first.hash);
    const reprovenanced = { ...input, holes: input.holes.map((hole) => hole.id === "a" ? { ...hole, templateAttribution: { ...hole.templateAttribution!, attribution: "Changed credit" } } : hole) };
    expect(complete(reprovenanced, { marginTiles: 0 }).hash).not.toBe(first.hash);
  });

  it("rejects hostile inputs without throwing or inventing a snapshot", () => {
    const input = fixture();
    const candidates: Array<[Course, object, string]> = [
      [{ ...input, obstacles: null } as unknown as Course, request, "INVALID_COURSE"],
      [{ ...input, tiles: [...input.tiles.slice(1)] } as Course, request, "INVALID_COURSE"],
      [{ ...input, holes: [...input.holes, input.holes[0]] }, request, "INVALID_COURSE"],
      [{ ...input, layouts: input.layouts!.map((layout) => layout.id === "one" ? { ...layout, publishedHoleIds: ["a", "a"] } : layout) }, request, "INVALID_LAYOUT"],
      [{ ...input, decorations: [{ kind: "bogus", x: 1, y: 1, rotation: 0 }] as unknown as Course["decorations"] }, request, "INVALID_COURSE"],
      [{ ...input, obstacles: [{ x: 1, y: 1, type: { toString: () => "tree" } }] as unknown as Course["obstacles"] }, request, "INVALID_COURSE"],
      [input, { ...request, teeSet: "tour" }, "INVALID_SELECTION"],
      [input, { ...request, marginTiles: 1.5 }, "INVALID_SELECTION"],
    ];
    for (const [course, hostileRequest, code] of candidates) {
      expect(() => createHoleIllustrationSnapshot(course, hostileRequest as typeof request)).not.toThrow();
      expect(createHoleIllustrationSnapshot(course, hostileRequest as typeof request)).toMatchObject({ complete: false, code });
    }
  });

  it("supports legacy courses through non-destructive layout normalization", () => {
    const input = fixture();
    const legacy = { ...input, layouts: undefined, activeCourseId: undefined };
    const before = structuredClone(legacy);
    const snapshot = complete(legacy, { layoutId: "course-primary" });
    expect(snapshot.route.routingIds).toEqual(["a", "b", "c"]);
    expect(legacy).toEqual(before);
  });

  it("completes deterministically at the maximum accepted 256x256 grid", () => {
    const input = fixture("parallel");
    input.width = 256;
    input.height = 256;
    input.tiles = Array.from({ length: 256 * 256 }, () => "rough");
    input.elevations = Array.from({ length: 256 * 256 }, () => 0);
    input.obstacles = [];
    input.buildings = [];
    input.decorations = [];
    input.greenSurface = undefined;
    input.holes = input.holes.map((hole) => hole.id === "a" ? {
      ...hole,
      tee: { x: 0, y: 0 },
      green: { x: 255, y: 255 },
      teeBoxes: { ...hole.teeBoxes, member: { x: 0, y: 0 } },
      pinPositions: { ...hole.pinPositions, A: { x: 255, y: 255 } },
      waypoints: [],
    } : hole);
    const first = complete(input, { marginTiles: 64 });
    const second = complete(input, { marginTiles: 64 });
    expect(first.terrain.length).toBeGreaterThan(30_000);
    expect(first.hash).toBe(second.hash);
  });
});
