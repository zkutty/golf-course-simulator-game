import { describe, expect, it, vi } from "vitest";
import type * as PIXI from "pixi.js";
import { DEFAULT_STATE } from "../../../game/gameState";
import {
  GREEN_SURFACE_FIXED_POINT_SCALE,
  GREEN_SURFACE_SAMPLES_PER_AXIS,
  type GreenSurfaceV1,
} from "../../../game/greens/greenSurface";
import type { SurfaceFeature } from "../../../game/models/types";
import { worldToIso } from "../../../game/render/iso";
import type {
  RenderSnapshot,
  SurfaceEditorRenderSnapshot,
} from "../../../game/render/renderSnapshot";
import { SceneSystemHost } from "../SceneSystemHost";
import { createSurfaceEditorSceneSystem } from "./surfaceEditorScene";

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
