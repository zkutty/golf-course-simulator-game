import { describe, expect, it, vi } from "vitest";
import type * as PIXI from "pixi.js";
import { DEFAULT_STATE } from "../../../game/gameState";
import {
  GREEN_SURFACE_FIXED_POINT_SCALE,
  GREEN_SURFACE_SAMPLES_PER_AXIS,
  type GreenSurfaceV1,
} from "../../../game/greens/greenSurface";
import { buildContinuousPathPlan } from "../../../game/paths/continuousPathPlan";
import { continuousPathFixture } from "../../../game/testing/continuousPathFixtures";
import { pointInLandscapeRing, ringSignedArea } from "../../../game/render/landscapeGeometry";
import type { SurfaceFeature } from "../../../game/models/types";
import { worldToIso } from "../../../game/render/iso";
import type {
  RenderSnapshot,
  SurfaceEditorRenderSnapshot,
} from "../../../game/render/renderSnapshot";
import { SceneSystemHost } from "../SceneSystemHost";
import { createSurfaceEditorSceneSystem, surfacePathPreviewPolygons } from "./surfaceEditorScene";

type Operation = readonly [string, ...unknown[]];

interface FakeDisplay {
  parent: FakeContainer | null;
  destroyed: boolean;
  destroy: ReturnType<typeof vi.fn>;
}

interface FakeContainer {
  children: FakeDisplay[];
  addChild: (child: FakeDisplay) => FakeDisplay;
  removeChild: (child: FakeDisplay) => FakeDisplay;
}

interface FakeGraphics extends FakeDisplay {
  operations: Operation[];
  clearCount: number;
  clear: ReturnType<typeof vi.fn>;
  poly: ReturnType<typeof vi.fn>;
  cut: ReturnType<typeof vi.fn>;
  fill: ReturnType<typeof vi.fn>;
  stroke: ReturnType<typeof vi.fn>;
  circle: ReturnType<typeof vi.fn>;
  moveTo: ReturnType<typeof vi.fn>;
  lineTo: ReturnType<typeof vi.fn>;
}

function container(children: FakeDisplay[] = []): FakeContainer {
  const value: FakeContainer = {
    children,
    addChild: (child) => {
      child.parent?.removeChild(child);
      child.parent = value;
      value.children.push(child);
      return child;
    },
    removeChild: (child) => {
      value.children = value.children.filter((candidate) => candidate !== child);
      if (child.parent === value) child.parent = null;
      return child;
    },
  };
  for (const child of children) child.parent = value;
  return value;
}

function graphics(): FakeGraphics {
  const operations: Operation[] = [];
  const value = {
    parent: null,
    destroyed: false,
    operations,
    clearCount: 0,
  } as unknown as FakeGraphics;
  const record = (name: string) => vi.fn((...args: unknown[]) => {
    operations.push([name, ...args]);
    return value;
  });
  value.clear = vi.fn(() => {
    value.clearCount += 1;
    operations.splice(0, operations.length, ["clear"]);
    return value;
  });
  value.poly = record("poly");
  value.cut = record("cut");
  value.fill = record("fill");
  value.stroke = record("stroke");
  value.circle = record("circle");
  value.moveTo = record("moveTo");
  value.lineTo = record("lineTo");
  value.destroy = vi.fn(() => { value.destroyed = true; });
  return value;
}

const EMPTY_SURFACE: GreenSurfaceV1 = {
  version: 1,
  samplesPerAxis: GREEN_SURFACE_SAMPLES_PER_AXIS,
  fixedPointScale: GREEN_SURFACE_FIXED_POINT_SCALE,
  interpolation: "bilinear",
  tiles: [],
};

function editor(overrides: Partial<SurfaceEditorRenderSnapshot> = {}): SurfaceEditorRenderSnapshot {
  return {
    width: 1,
    height: 1,
    tiles: ["green"],
    elevations: [0],
    greenSurface: EMPTY_SURFACE,
    editorMode: "PAINT",
    showGridOverlays: false,
    graphicsQuality: "high",
    colorVision: "standard",
    terrainTool: "curve",
    splineDraft: [],
    splineHover: null,
    selectedFeature: null,
    selectedNode: null,
    rotation: 0,
    surfaceHeightAt: () => 0,
    ...overrides,
  };
}

function snapshot(
  revision: number,
  surfaceEditor: SurfaceEditorRenderSnapshot | undefined = editor(),
  overrides: Partial<RenderSnapshot> = {},
): RenderSnapshot {
  const course = DEFAULT_STATE.course;
  return {
    course,
    obstacles: course.obstacles,
    effectiveTiles: course.tiles,
    holes: course.holes,
    draftTee: null,
    draftGreen: null,
    rotation: 0,
    graphicsQuality: "high",
    colorVision: "standard",
    reducedMotion: false,
    animationsEnabled: true,
    showObstacles: true,
    atlasRevision: 1,
    surveyMode: false,
    worldSeed: 42,
    surfaceHeightAt: () => 0,
    surfaceEditor,
    revisions: {
      atmosphere: 0,
      surfaceCare: 0,
      structuresProps: 0,
      playerProCollection: 0,
      naturalProps: 0,
      surfaceEditor: revision,
      overlaysDiagnostics: 0,
      estateSurvey: 0,
    },
    ...overrides,
  };
}

describe("surface editor scene ownership", () => {
  it("keeps one persistent child, ignores unrelated snapshots, clears empty state, and disposes twice safely", () => {
    const sibling = graphics();
    const layer = container([sibling]);
    const owned = graphics();
    const scene = createSurfaceEditorSceneSystem(
      layer as unknown as PIXI.Container,
      () => owned as unknown as PIXI.Graphics,
    );
    const host = new SceneSystemHost([scene]);

    expect(host.sync(snapshot(1))).toEqual(["surfaceEditor"]);
    expect(layer.children).toEqual([sibling, owned]);
    expect(owned.clearCount).toBe(1);

    expect(host.sync(snapshot(1, editor(), { course: { ...DEFAULT_STATE.course, name: "Unrelated" } }))).toEqual([]);
    expect(owned.clearCount).toBe(1);
    expect(layer.children).toEqual([sibling, owned]);

    expect(host.sync(snapshot(2, undefined))).toEqual(["surfaceEditor"]);
    expect(owned.clearCount).toBe(2);
    expect(owned.operations).toEqual([["clear"]]);

    host.dispose();
    host.dispose();
    expect(layer.children).toEqual([sibling]);
    expect(owned.destroy).toHaveBeenCalledTimes(1);
    expect(sibling.destroy).not.toHaveBeenCalled();
  });

  it("releases the derived preview cache on idempotent teardown and rebuilds after recreation", () => {
    const source = continuousPathFixture("straight"); const plan = buildContinuousPathPlan(source);
    const readLayers = vi.fn(() => plan.layers);
    const observedPlan = { ...plan, get layers() { return readLayers(); } };
    const state = editor({ width: source.width, height: source.height, tiles: source.tiles, pathPreview: observedPlan, pathPreviewCoverage: plan.coverage });
    const first = graphics(); const second = graphics(); const layer = container();
    const factory = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second);
    const scene = createSurfaceEditorSceneSystem(layer as unknown as PIXI.Container, factory);
    scene.create?.(snapshot(1, state));
    const firstPolygons = first.operations.filter(([name]) => name === "poly");
    expect(readLayers).toHaveBeenCalledTimes(1);
    scene.update?.(snapshot(2, { ...state, rotation: 90, graphicsQuality: "low" }));
    expect(readLayers).toHaveBeenCalledTimes(1);
    scene.destroy?.(); scene.destroy?.();
    expect(first.destroy).toHaveBeenCalledTimes(1); expect(layer.children).toEqual([]);
    scene.create?.(snapshot(3, state));
    expect(readLayers).toHaveBeenCalledTimes(2);
    expect(second.operations.filter(([name]) => name === "poly")).toEqual(firstPolygons);
    expect(layer.children).toEqual([second]);
    scene.destroy?.(); scene.destroy?.();
    expect(second.destroy).toHaveBeenCalledTimes(1); expect(layer.children).toEqual([]);
  });

  it("preserves green shading, contour, fall-line, arrow, palette, quality, and exact projection behavior", () => {
    const layer = container();
    const owned = graphics();
    const surfaceHeightAt = vi.fn((x: number, y: number) => x + y);
    const sculpt = editor({
      greenSurface: {
        ...EMPTY_SURFACE,
        tiles: [{
          x: 0,
          y: 0,
          offsets: Array.from({ length: 16 }, (_, index) => index * 96),
        }],
      },
      editorMode: "SCULPT",
      graphicsQuality: "low",
      colorVision: "protanopia",
      surfaceHeightAt,
    });
    const scene = createSurfaceEditorSceneSystem(
      layer as unknown as PIXI.Container,
      () => owned as unknown as PIXI.Graphics,
    );

    scene.create?.(snapshot(1, sculpt));

    expect(owned.operations[0]).toEqual(["clear"]);
    expect(owned.operations.some(([name]) => name === "poly")).toBe(true);
    expect(owned.operations.some(([name, options]) => name === "stroke"
      && (options as { color?: number }).color === 0x172033)).toBe(true);
    expect(owned.operations.some(([name, options]) => name === "stroke"
      && (options as { color?: number }).color === 0xfff4bd)).toBe(true);
    expect(owned.operations.some(([name, options]) => name === "stroke"
      && (options as { color?: number }).color === 0x1d6996)).toBe(true);
    expect(owned.operations.filter(([name, , , radius]) => name === "circle" && radius === 1.5).length)
      .toBeGreaterThanOrEqual(3);
    expect(surfaceHeightAt).toHaveBeenCalledWith(0.5, 0);
    expect(surfaceHeightAt).toHaveBeenCalledWith(1, 0.5);
  });

  it("preserves spline hover/nodes and selected path/node/tangent branches", () => {
    const layer = container();
    const owned = graphics();
    const surfaceHeightAt = vi.fn(() => 2);
    const scene = createSurfaceEditorSceneSystem(
      layer as unknown as PIXI.Container,
      () => owned as unknown as PIXI.Graphics,
    );
    const draft = [{ x: 1, y: 2 }, { x: 3, y: 2 }];

    scene.create?.(snapshot(1, editor({
      terrainTool: "spline",
      splineDraft: draft,
      splineHover: { x: 4, y: 3 },
      surfaceHeightAt,
    })));
    expect(owned.operations.filter(([name, , , radius]) => name === "circle" && radius === 4.5))
      .toHaveLength(2);
    expect(owned.operations.some(([name, options]) => name === "stroke"
      && (options as { color?: number }).color === 0xffe28a)).toBe(true);
    const projectedDraft = worldToIso(1, 2, 2, 0);
    expect(owned.operations).toContainEqual(["circle", projectedDraft.x, projectedDraft.y, 4.5]);
    expect(surfaceHeightAt).toHaveBeenCalledWith(1, 2);

    const selectedFeature: SurfaceFeature = {
      id: "surface-1",
      terrain: "fairway",
      order: 1,
      coverage: [0],
      geometry: {
        kind: "corridor",
        width: 1,
        knots: [{ x: 1, y: 1 }, { x: 3, y: 1 }],
        tangents: [
          { in: { x: 0.5, y: 1 }, out: { x: 1.5, y: 1 } },
          { in: { x: 2.5, y: 1 }, out: { x: 3.5, y: 1 } },
        ],
      },
    };
    scene.update?.(snapshot(2, editor({
      terrainTool: "edit",
      selectedFeature,
      selectedNode: 0,
      surfaceHeightAt,
    })));

    expect(owned.operations).toContainEqual(["circle", expect.any(Number), expect.any(Number), 6]);
    expect(owned.operations.filter(([name, options]) => name === "fill"
      && (options as { color?: number }).color === 0x5ea8ff)).toHaveLength(2);
    expect(owned.operations.filter(([name, options]) => name === "stroke"
      && (options as { color?: number }).color === 0xfff0b0)).toHaveLength(2);
  });
});

describe("continuous path editor preview", () => {
  it("projects the final G triangles while retaining a loop's empty interior", () => {
    const source = continuousPathFixture("loop"); const plan = buildContinuousPathPlan(source); const layer = container(); const owned = graphics();
    const polygons = surfacePathPreviewPolygons(plan, plan.coverage, source.width, source.height);
    const scene = createSurfaceEditorSceneSystem(layer as unknown as PIXI.Container, () => owned as unknown as PIXI.Graphics);
    scene.create?.(snapshot(1, editor({ width: source.width, height: source.height, tiles: source.tiles, pathPreview: plan, pathPreviewCoverage: plan.coverage, pathPreviewAffordable: true })));
    expect(polygons.length).toBeGreaterThan(0);
    expect(polygons.some((polygon) => pointInLandscapeRing(polygon, { x: 7.5, y: 7.5 }))).toBe(false);
    expect(owned.operations.filter(([name]) => name === "poly")).toEqual(polygons.map((polygon) => ["poly", polygon.flatMap((point) => { const p = worldToIso(point.x, point.y, 0, 0); return [p.x, p.y]; })]));
    let finalArea = 0;
    for (const mesh of plan.layers) for (let index = 0; index < mesh.indices.length; index += 3) {
      const triangle = mesh.indices.slice(index, index + 3).map((vertex) => ({ x: mesh.positions[vertex * 2], y: mesh.positions[vertex * 2 + 1] }));
      finalArea += Math.abs(ringSignedArea(triangle));
    }
    expect(polygons.reduce((sum, polygon) => sum + Math.abs(ringSignedArea(polygon)), 0)).toBeCloseTo(finalArea, 10);
    expect(owned.operations).toContainEqual(["fill", { color: 0xffe28a, alpha: .38 }]);
  });
  it("does not highlight an unrelated path in the final post-edit plan", () => {
    const source = continuousPathFixture("straight");
    const affected = source.tiles.flatMap((terrain, index) => terrain === "path" ? [index] : []);
    for (let x = 2; x <= 10; x++) source.tiles[10 * source.width + x] = "path";
    const plan = buildContinuousPathPlan(source);
    const polygons = surfacePathPreviewPolygons(plan, affected, source.width, source.height);
    expect(plan.coverage.some((index) => Math.floor(index / source.width) === 10)).toBe(true);
    expect(polygons.length).toBeGreaterThan(0);
    expect(polygons.every((polygon) => polygon.every((point) => point.y >= 4 && point.y <= 5))).toBe(true);
    const owned = graphics();
    const scene = createSurfaceEditorSceneSystem(container() as unknown as PIXI.Container, () => owned as unknown as PIXI.Graphics);
    scene.create?.(snapshot(1, editor({ width: source.width, height: source.height, tiles: source.tiles, pathPreview: plan, pathPreviewCoverage: affected })));
    expect(owned.poly).toHaveBeenCalledTimes(polygons.length);
  });
  it("clips a crossing final triangle to affected coverage instead of selecting its centroid", () => {
    const source = continuousPathFixture("empty"); const plan = buildContinuousPathPlan(source);
    const crossing = { ...plan, layers: [{ role: "core" as const, rings: [], positions: [0, 0, 2, 0, 0, 2], indices: [0, 1, 2] }] };
    const polygons = surfacePathPreviewPolygons(crossing, [0], source.width, source.height);
    expect(polygons.reduce((sum, polygon) => sum + Math.abs(ringSignedArea(polygon)), 0)).toBeCloseTo(1, 10);
    expect(polygons.flat().every((point) => point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1)).toBe(true);
    expect(surfacePathPreviewPolygons(crossing, [], source.width, source.height)).toEqual([]);
  });
  it("uses unaffordable feedback while preserving the identical clipped footprint", () => {
    const source = continuousPathFixture("straight"); const plan = buildContinuousPathPlan(source); const owned = graphics();
    const scene = createSurfaceEditorSceneSystem(container() as unknown as PIXI.Container, () => owned as unknown as PIXI.Graphics);
    scene.create?.(snapshot(1, editor({ width: source.width, height: source.height, tiles: source.tiles, pathPreview: plan, pathPreviewCoverage: plan.coverage, pathPreviewAffordable: false })));
    expect(owned.operations).toContainEqual(["fill", { color: 0xff7664, alpha: .38 }]); expect(owned.poly).toHaveBeenCalled();
  });
});
