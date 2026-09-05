import { describe, expect, it } from "vitest";
import { BIOME_KEYS } from "../models/biomes";
import type { Course, Point, Terrain } from "../models/types";
import { SEASONS } from "../seasons/types";
import {
  createHoleIllustrationRenderPlan,
  holeIllustrationSnapshotIntegrityHash,
  HOLE_ILLUSTRATION_LAYER_ORDER,
  HOLE_ILLUSTRATION_RENDER_LIMITS,
  type HoleIllustrationRenderPlan,
  type HoleIllustrationRenderPrimitive,
  type HoleIllustrationRenderSettings,
} from "./renderPlan";
import {
  HOLE_ILLUSTRATION_STYLE_IDS,
  HOLE_ILLUSTRATION_STYLE_REGISTRY,
  resolveHoleIllustrationStyle,
} from "./style";
import { createHoleIllustrationSnapshot } from "./snapshot";
import type { HoleIllustrationLocalPoint, HoleIllustrationSnapshot } from "./types";

const EXPECTED_LAYER_ORDER = [
  "terrain",
  "elevation-contours",
  "paths",
  "vegetation-obstacles",
  "surroundings",
  "tee",
  "pin",
  "route",
] as const;

function local(x: number, y: number): HoleIllustrationLocalPoint {
  return { x, y, teeToGreen: { x: y, y: 4 - x } };
}

const settings: HoleIllustrationRenderSettings = {
  frame: "north-up",
  biome: "parkland",
  season: "summer",
  contrast: "standard",
  viewport: { width: 1_200, height: 800, padding: 0.06 },
};

function signedSnapshot(snapshot: HoleIllustrationSnapshot): HoleIllustrationSnapshot {
  return { ...snapshot, hash: holeIllustrationSnapshotIntegrityHash(snapshot) };
}

function fixture(): HoleIllustrationSnapshot {
  const kinds: Terrain[] = [
    "fairway", "rough", "deep_rough", "sand", "waste_area", "water",
    "wetland", "green", "tee", "path", "fairway", "rough",
  ];
  const terrain = kinds.map((kind, index) => ({
    ...local(index % 4, Math.floor(index / 4)),
    terrain: kind,
    elevation: index % 4,
  }));
  return signedSnapshot({
    version: 1,
    hash: "0".repeat(64),
    route: { layoutId: "layout-a", source: "published", holeId: "hole-a", order: 0, length: 1, routingIds: ["hole-a"] },
    selection: { teeSet: "member", pinRotation: "A" },
    tee: local(0, 1),
    pin: local(3, 1),
    waypoints: [local(1, 0), local(2, 2)],
    par: 4,
    parMode: "AUTO",
    distanceTiles: 4.65,
    yardage: 46.5,
    yardsPerTile: 10,
    north: { x: 0, y: -1 },
    framing: {
      marginTiles: 0,
      corridorRadiusTiles: 4,
      northUp: {
        mode: "north-up", originCourse: { x: 0, y: 0 }, rotationDegrees: 0,
        matrix: { a: 1, b: 0, c: 0, d: 1 }, translation: { x: 0, y: 0 },
        crop: { width: 4, height: 3 }, scaleToUnit: 0.25,
      },
      teeToGreen: {
        mode: "tee-to-green", originCourse: { x: 0, y: 1 }, rotationDegrees: -90,
        matrix: { a: 0, b: -1, c: 1, d: 0 }, translation: { x: 1, y: 4 },
        crop: { width: 3, height: 4 }, scaleToUnit: 0.25,
      },
    },
    terrain,
    contours: {
      version: 1,
      samplesPerAxis: 4,
      fixedPointScale: 1024,
      interpolation: "bilinear",
      tiles: [{ ...local(3, 1), offsets: [-32, -24, -16, -8, -16, -8, 0, 8, 0, 8, 16, 24, 16, 24, 32, 40] }],
    },
    obstacles: [
      { ...local(1, 1), type: "tree" },
      { ...local(2, 0), type: "rock" },
    ],
    decorations: [{
      ...local(0, 2), kind: "bench", rotation: 0,
      footprint: [local(0, 2), local(1, 2)],
    }],
    surroundings: [{
      ...local(2, 0), type: "clubhouse", tier: 2,
      footprint: [local(2, 0), local(3, 0)],
    }],
  });
}

function builderFixture(pin: Point, waypoints: Point[] = []): Course {
  const width = 50;
  const height = 50;
  const tee = { x: 25, y: 25 };
  const tiles: Course["tiles"] = Array.from({ length: width * height }, () => "rough");
  tiles[tee.y * width + tee.x] = "tee";
  tiles[pin.y * width + pin.x] = "green";
  return {
    width,
    height,
    tiles,
    elevations: Array.from({ length: width * height }, (_, index) => index % 7),
    holes: [{
      id: "angle-hole",
      tee,
      green: pin,
      teeBoxes: { forward: tee, member: tee, championship: tee },
      pinPositions: { A: pin, B: pin, C: pin },
      waypoints,
      parMode: "AUTO",
    }],
    layouts: [{
      id: "angle-layout",
      name: "Angle layout",
      draftHoleIds: ["angle-hole"],
      publishedHoleIds: ["angle-hole"],
      roundLength: 9,
      state: "open",
      greenFee: 50,
    }],
    activeCourseId: "angle-layout",
    obstacles: [],
    buildings: [],
    decorations: [],
    yardsPerTile: 10,
    name: "Angle fixture",
    baseGreenFee: 50,
    condition: 1,
  };
}

function builtSnapshot(pin: Point, waypoints: Point[] = []): HoleIllustrationSnapshot {
  const result = createHoleIllustrationSnapshot(builderFixture(pin, waypoints), {
    layoutId: "angle-layout",
    routeSource: "published",
    holeId: "angle-hole",
    teeSet: "member",
    pinRotation: "A",
    marginTiles: 0,
  });
  if (!result.complete) throw new Error(`${result.code}: ${result.message}`);
  return result.snapshot;
}

function complete(snapshot = fixture(), overrides: Partial<HoleIllustrationRenderSettings> = {}): HoleIllustrationRenderPlan {
  const result = createHoleIllustrationRenderPlan(snapshot, { ...settings, ...overrides });
  if (!result.complete) throw new Error(`${result.code}: ${result.message}`);
  return result.plan;
}

function primitivePoints(primitive: HoleIllustrationRenderPrimitive) {
  if (primitive.kind === "polygon" || primitive.kind === "polyline") return primitive.points;
  if (primitive.kind === "ellipse") return [primitive.center];
  return primitive.samples.map((sample) => sample.point);
}

describe("ZK-768 deterministic top-down illustration render plan", () => {
  it("renders every authored terrain kind and stable semantic layer in the published z-order", () => {
    const plan = complete();
    expect(HOLE_ILLUSTRATION_LAYER_ORDER).toEqual(EXPECTED_LAYER_ORDER);
    expect(plan.layers.map(({ id, z }) => ({ id, z }))).toEqual(
      EXPECTED_LAYER_ORDER.map((id, z) => ({ id, z })),
    );
    const terrain = plan.layers[0].primitives.map((primitive) => primitive.semantic);
    for (const kind of ["fairway", "rough", "deep_rough", "sand", "waste_area", "water", "wetland", "green", "tee", "path"] as const) {
      expect(terrain).toContain(`terrain:${kind}`);
    }
    const relief = plan.layers.find((layer) => layer.id === "elevation-contours")!.primitives;
    expect(relief.find((primitive) => primitive.kind === "sample-grid")).toMatchObject({
      semantic: "contour:bilinear-fixed-1024",
    });
    const firstContour = relief.findIndex((primitive) => primitive.semantic.startsWith("contour:"));
    expect(firstContour).toBeGreaterThan(0);
    expect(relief.slice(0, firstContour).every((primitive) => primitive.semantic.startsWith("elevation:"))).toBe(true);
    expect(plan.layers.find((layer) => layer.id === "route")?.primitives[0]).toMatchObject({
      kind: "polyline",
      semantic: "route:tee-waypoints-pin",
      closed: false,
    });
    expect(new Set(plan.layers.flatMap((layer) => layer.primitives.map((primitive) => primitive.kind))))
      .toEqual(new Set(["polygon", "polyline", "ellipse", "sample-grid"]));
  });

  it("accepts builder-produced quantized snapshots through an angle sweep, dogleg, and both frames", () => {
    const pins = Array.from({ length: 32 }, (_, index) => {
      const radians = index * Math.PI * 2 / 32;
      return { x: Math.round(25 + Math.cos(radians) * 20), y: Math.round(25 + Math.sin(radians) * 20) };
    });
    for (const pin of pins) for (const frame of ["north-up", "tee-to-green"] as const) {
      const result = createHoleIllustrationRenderPlan(builtSnapshot(pin), { ...settings, frame });
      expect(result.complete, `${frame} ${pin.x},${pin.y}`).toBe(true);
    }
    const dogleg = builtSnapshot({ x: 44, y: 40 }, [{ x: 10, y: 8 }, { x: 39, y: 12 }]);
    for (const frame of ["north-up", "tee-to-green"] as const) {
      expect(createHoleIllustrationRenderPlan(dogleg, { ...settings, frame }).complete).toBe(true);
    }
  });

  it("projects north-up and tee-to-green consistently into finite normalized authoritative bounds", () => {
    for (const frame of ["north-up", "tee-to-green"] as const) {
      const plan = complete(fixture(), { frame });
      expect(plan.frame.mode).toBe(frame);
      for (const primitive of plan.layers.flatMap((layer) => layer.primitives)) {
        for (const point of primitivePoints(primitive)) {
          expect(Number.isFinite(point.x) && Number.isFinite(point.y)).toBe(true);
          expect(point.x).toBeGreaterThanOrEqual(0);
          expect(point.x).toBeLessThanOrEqual(1);
          expect(point.y).toBeGreaterThanOrEqual(0);
          expect(point.y).toBeLessThanOrEqual(1);
        }
      }
      const route = plan.layers.find((layer) => layer.id === "route")?.primitives[0];
      expect(route?.kind).toBe("polyline");
      if (frame === "tee-to-green" && route?.kind === "polyline") {
        expect(route.points.at(-1)!.y).toBeLessThan(route.points[0].y);
      }
    }
  });

  it("registers every playable biome/season combination with standard and high-contrast palettes", () => {
    expect(HOLE_ILLUSTRATION_STYLE_IDS).toHaveLength(BIOME_KEYS.length * SEASONS.length);
    expect(Object.keys(HOLE_ILLUSTRATION_STYLE_REGISTRY).sort()).toEqual([...HOLE_ILLUSTRATION_STYLE_IDS].sort());
    for (const biome of BIOME_KEYS) for (const season of SEASONS) {
      const id = `${biome}:${season}` as const;
      expect(HOLE_ILLUSTRATION_STYLE_REGISTRY[id]).toMatchObject({ version: 1, id, biome, season });
      expect(Object.keys(resolveHoleIllustrationStyle(biome, season, "standard").terrain).sort())
        .toEqual(["deep_rough", "fairway", "green", "path", "rough", "sand", "tee", "waste_area", "water", "wetland"].sort());
      const accessible = complete(fixture(), { biome, season, contrast: "high-contrast" });
      expect(accessible.styleId).toBe(id);
      expect(accessible.background).toBe("#ffffff");
      expect(accessible.layers[0].primitives.every((primitive) => primitive.stroke === "#000000")).toBe(true);
    }
  });

  it("is deterministic under repeat calls and canonical source permutations", () => {
    const base = fixture();
    const source = signedSnapshot({
      ...base,
      decorations: [
        ...base.decorations,
        { ...local(2, 2), kind: "bench", rotation: 2, footprint: [local(2, 2), local(3, 2)] },
      ],
      surroundings: [
        ...base.surroundings,
        { ...local(0, 0), type: "clubhouse", tier: 1, footprint: [local(0, 0), local(1, 0)] },
      ],
    });
    const first = complete(source);
    expect(complete(source)).toEqual(first);
    const permuted: HoleIllustrationSnapshot = {
      ...source,
      terrain: [...source.terrain].reverse(),
      contours: { ...source.contours, tiles: [...source.contours.tiles].reverse() },
      obstacles: [...source.obstacles].reverse(),
      decorations: [...source.decorations].reverse().map((item) => ({ ...item, footprint: [...item.footprint].reverse() })),
      surroundings: [...source.surroundings].reverse().map((item) => ({ ...item, footprint: [...item.footprint].reverse() })),
    };
    expect(complete(permuted)).toEqual(first);
    expect(complete(source, { season: "autumn" }).hash).not.toBe(first.hash);
    expect(first.hashAlgorithm).toBe("fnv1a32-canonical-v1");
  });

  it("returns owned deeply immutable facts and ignores undeclared runtime settings", () => {
    const source = fixture();
    const baseline = complete(source);
    const withExtra = createHoleIllustrationRenderPlan(source, {
      ...settings,
      viewport: { ...settings.viewport, debugScale: 99 },
      debugLabel: "not-a-contract-setting",
    } as HoleIllustrationRenderSettings & { debugLabel: string });
    expect(withExtra.complete).toBe(true);
    if (!withExtra.complete) return;
    expect(withExtra.plan).toEqual(baseline);
    expect(Object.keys(withExtra.plan.settings).sort()).toEqual(["biome", "contrast", "frame", "season", "viewport"]);
    expect(Object.keys(withExtra.plan.settings.viewport).sort()).toEqual(["height", "padding", "width"]);

    const capturedWidth = baseline.frame.crop.width;
    (source.framing.northUp.crop as { width: number }).width = 99;
    expect(baseline.frame.crop.width).toBe(capturedWidth);
    expect(Object.isFrozen(baseline)).toBe(true);
    expect(Object.isFrozen(baseline.frame.crop)).toBe(true);
    expect(Object.isFrozen(baseline.settings.viewport)).toBe(true);
    expect(Object.isFrozen(baseline.layers[0].primitives[0])).toBe(true);
    expect(Object.isFrozen((baseline.layers[0].primitives[0] as { points: readonly unknown[] }).points)).toBe(true);

    const palette = resolveHoleIllustrationStyle("parkland", "summer", "standard");
    expect(Object.isFrozen(HOLE_ILLUSTRATION_STYLE_REGISTRY["parkland:summer"])).toBe(true);
    expect(Object.isFrozen(palette)).toBe(true);
    expect(Object.isFrozen(palette.elevation)).toBe(true);
    expect(Object.isFrozen(palette.vegetation)).toBe(true);
    expect(() => { (palette.elevation as { low: string }).low = "#ff00ff"; }).toThrow(TypeError);
    expect(resolveHoleIllustrationStyle("parkland", "summer", "standard").elevation.low).toBe("#ffffff");
  });

  it("ignores cyclic, deep, and oversized undeclared snapshot fields without affecting order or hash", () => {
    const source = fixture();
    const baseline = complete(source);
    const poison: Record<string, unknown> = { payload: "x".repeat(1_000_000) };
    poison.self = poison;
    const withExtras = {
      ...source,
      ignoredTopLevel: poison,
      terrain: source.terrain.map((cell, index) => index === 0 ? { ...cell, ignored: poison } : cell),
      obstacles: source.obstacles.map((item, index) => index === 0 ? { ...item, ignored: poison } : item),
      decorations: source.decorations.map((item) => ({
        ...item,
        ignored: poison,
        footprint: item.footprint.map((point, index) => index === 0 ? { ...point, ignored: poison } : point),
      })),
      surroundings: source.surroundings.map((item) => ({ ...item, ignored: poison })),
    } as unknown as HoleIllustrationSnapshot;
    expect(holeIllustrationSnapshotIntegrityHash(withExtras)).toBe(source.hash);
    expect(complete(withExtras)).toEqual(baseline);
  });

  it("rejects fractional or duplicated authoritative geography before rendering", () => {
    const source = fixture();
    const fractional = signedSnapshot({
      ...source,
      terrain: [{ ...source.terrain[0], x: 0.5, teeToGreen: { x: source.terrain[0].teeToGreen.x, y: 3.5 } }, ...source.terrain.slice(1)],
    });
    const duplicateTerrain = signedSnapshot({ ...source, terrain: [...source.terrain, source.terrain[0]] });
    const duplicateContour = signedSnapshot({
      ...source,
      contours: { ...source.contours, tiles: [...source.contours.tiles, source.contours.tiles[0]] },
    });
    const duplicateOwnDecoration = signedSnapshot({
      ...source,
      decorations: source.decorations.map((item) => ({ ...item, footprint: [...item.footprint, item.footprint[0]] })),
    });
    const duplicateGlobalDecoration = signedSnapshot({
      ...source,
      decorations: [
        ...source.decorations,
        { ...local(2, 2), kind: "bench", rotation: 1, footprint: [source.decorations[0].footprint[0]] },
      ],
    });
    const duplicateOwnSurrounding = signedSnapshot({
      ...source,
      surroundings: source.surroundings.map((item) => ({ ...item, footprint: [...item.footprint, item.footprint[0]] })),
    });
    const duplicateGlobalSurrounding = signedSnapshot({
      ...source,
      surroundings: [
        ...source.surroundings,
        { ...local(0, 0), type: "clubhouse", footprint: [source.surroundings[0].footprint[0]] },
      ],
    });
    for (const malformed of [
      fractional,
      duplicateTerrain,
      duplicateContour,
      duplicateOwnDecoration,
      duplicateGlobalDecoration,
      duplicateOwnSurrounding,
      duplicateGlobalSurrounding,
    ]) {
      expect(createHoleIllustrationRenderPlan(malformed, settings)).toMatchObject({ complete: false, code: "INVALID_SNAPSHOT" });
    }
  });

  it("verifies the builder's exact canonical SHA-256 snapshot integrity contract", () => {
    const built = builtSnapshot({ x: 43, y: 7 }, [{ x: 12, y: 31 }]);
    expect(built.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(holeIllustrationSnapshotIntegrityHash(built)).toBe(built.hash);
    expect(createHoleIllustrationRenderPlan(built, settings).complete).toBe(true);

    const forged: HoleIllustrationSnapshot = { ...built, hash: "f".repeat(64) };
    const stale: HoleIllustrationSnapshot = {
      ...built,
      terrain: built.terrain.map((cell, index) => index === 0 ? { ...cell, elevation: cell.elevation + 1 } : cell),
    };
    const oversized: HoleIllustrationSnapshot = { ...built, hash: "a".repeat(65) };
    const uppercase: HoleIllustrationSnapshot = { ...built, hash: built.hash.toUpperCase() };
    for (const malformed of [forged, stale, oversized, uppercase]) {
      expect(createHoleIllustrationRenderPlan(malformed, settings)).toMatchObject({ complete: false, code: "INVALID_SNAPSHOT" });
    }
  });

  it("rejects hostile settings and out-of-crop geometry without throwing or partial plans", () => {
    const hostile = [
      { ...settings, frame: "camera" },
      { ...settings, biome: "tropical" },
      { ...settings, season: "monsoon" },
      { ...settings, contrast: "maximum" },
      { ...settings, viewport: { ...settings.viewport, width: Number.NaN } },
      { ...settings, viewport: { ...settings.viewport, height: HOLE_ILLUSTRATION_RENDER_LIMITS.maxViewportDimension + 1 } },
      { ...settings, viewport: { ...settings.viewport, padding: 0.5 } },
    ];
    for (const candidate of hostile) {
      expect(() => createHoleIllustrationRenderPlan(fixture(), candidate as HoleIllustrationRenderSettings)).not.toThrow();
      expect(createHoleIllustrationRenderPlan(fixture(), candidate as HoleIllustrationRenderSettings)).toMatchObject({
        complete: false,
        code: "INVALID_SETTINGS",
      });
    }
    const source = fixture();
    const outOfCrop: HoleIllustrationSnapshot = { ...source, tee: { ...source.tee, x: 100 } };
    expect(createHoleIllustrationRenderPlan(outOfCrop, settings)).toMatchObject({ complete: false, code: "INVALID_SNAPSHOT" });

    const malformedSnapshots: HoleIllustrationSnapshot[] = [
      {
        ...fixture(),
        framing: {
          ...fixture().framing,
          northUp: { ...fixture().framing.northUp, crop: { width: 257, height: 3 }, scaleToUnit: 1 / 257 },
        },
      },
      {
        ...fixture(),
        framing: {
          ...fixture().framing,
          teeToGreen: { ...fixture().framing.teeToGreen, matrix: { a: 1, b: 1, c: 1, d: 1 } },
        },
      },
      {
        ...fixture(),
        framing: {
          ...fixture().framing,
          teeToGreen: { ...fixture().framing.teeToGreen, scaleToUnit: 0.75 },
        },
      },
      { ...fixture(), obstacles: [{ ...local(1, 1), type: "dragon" }] },
      {
        ...fixture(),
        decorations: [{
          ...local(0, 2),
          kind: "bench",
          rotation: 0,
          footprint: Array.from({ length: HOLE_ILLUSTRATION_RENDER_LIMITS.maxFootprintPoints + 1 }, () => local(0, 2)),
        }],
      },
    ];
    for (const malformed of malformedSnapshots) {
      expect(createHoleIllustrationRenderPlan(malformed, settings)).toMatchObject({ complete: false, code: "INVALID_SNAPSHOT" });
    }
  });

  it("completes within declared bounded allocation and ordering costs at 256x256", () => {
    const source = fixture();
    const terrain = Array.from({ length: 256 * 256 }, (_, index) => {
      const x = index % 256;
      const y = Math.floor(index / 256);
      return { x, y, teeToGreen: { x, y }, terrain: "rough" as const, elevation: 0 };
    });
    const maximum = signedSnapshot({
      ...source,
      hash: "0".repeat(64),
      tee: { x: 0, y: 0, teeToGreen: { x: 0, y: 0 } },
      pin: { x: 255, y: 255, teeToGreen: { x: 255, y: 255 } },
      waypoints: [],
      terrain,
      contours: { ...source.contours, tiles: [] },
      obstacles: [],
      decorations: [],
      surroundings: [],
      framing: {
        ...source.framing,
        northUp: { ...source.framing.northUp, crop: { width: 256, height: 256 }, scaleToUnit: 1 / 256 },
        teeToGreen: {
          ...source.framing.teeToGreen,
          originCourse: { x: 0, y: 0 },
          rotationDegrees: 0,
          matrix: { a: 1, b: 0, c: 0, d: 1 },
          translation: { x: 0, y: 0 },
          crop: { width: 256, height: 256 },
          scaleToUnit: 1 / 256,
        },
      },
    });
    const first = complete(maximum, { viewport: { width: 8_192, height: 8_192, padding: 0 } });
    const repeat = complete(maximum, { viewport: { width: 8_192, height: 8_192, padding: 0 } });
    expect(first.hash).toBe(repeat.hash);
    expect(first.budget).toMatchObject({
      sourceCells: 65_536,
      sourceFeatures: 0,
      primitiveCount: 65_539,
      runtime: "bounded-n-log-n",
      memory: "bounded",
    });
    expect(first.budget.primitiveCount).toBeLessThanOrEqual(HOLE_ILLUSTRATION_RENDER_LIMITS.maxPrimitives);
    expect(first.budget.pointCount).toBeLessThanOrEqual(HOLE_ILLUSTRATION_RENDER_LIMITS.maxPoints);
  });
});
