import { describe, expect, it } from "vitest";
import { applyAction } from "../../core/reducer";
import { DEFAULT_STATE } from "../gameState";
import type { Course, SurfaceFeature, Terrain } from "./types";
import { corridorFeature, rasterizeSurfaceFeatureDetailed } from "./surfaceIntent";
import { prepareSurfaceFeatureEdit } from "./surfaceFeatureEdit";

function authoredCourse(terrain: Terrain = "fairway"): { course: Course; feature: SurfaceFeature } {
  const width = 18;
  const height = 14;
  const base: Course = {
    ...DEFAULT_STATE.course,
    width,
    height,
    tiles: new Array<Terrain>(width * height).fill("rough"),
    elevations: new Array<number>(width * height).fill(0),
    estate: undefined,
    surfaceIntent: undefined,
  };
  const feature = corridorFeature(
    base,
    terrain,
    [{ x: 2.5, y: 4.5 }, { x: 8.5, y: 4.5 }, { x: 14.5, y: 4.5 }],
    2.5,
  );
  const raster = rasterizeSurfaceFeatureDetailed(feature, width, height);
  feature.coverage = raster.tiles.map((point) => point.y * width + point.x);
  feature.renderRings = raster.rings;
  const tiles = base.tiles.slice();
  for (const index of feature.coverage) tiles[index] = terrain;
  return {
    feature,
    course: {
      ...base,
      tiles,
      surfaceIntent: { version: 1, nextId: 2, features: [feature] },
    },
  };
}

describe("surface feature editing", () => {
  it("replaces persisted intent, restores the old underlay, and previews the exact atomic cost", () => {
    const { course, feature } = authoredCourse();
    if (feature.geometry.kind !== "corridor") throw new Error("expected corridor fixture");
    const moved: SurfaceFeature = {
      ...feature,
      geometry: {
        ...feature.geometry,
        knots: feature.geometry.knots.map((point) => ({ x: point.x, y: point.y + 4 })),
      },
    };
    const prepared = prepareSurfaceFeatureEdit(course, moved, 100_000, 1, 100);
    expect(prepared?.commitAllowed).toBe(true);
    expect(prepared?.preview.affordable).toBe(true);
    expect(prepared?.preview.changedCount).toBeGreaterThan(0);
    expect(prepared?.intent.features).toHaveLength(1);
    expect(prepared?.intent.features[0].id).toBe(feature.id);
    expect(prepared?.tiles[4 * course.width + 8]).toBe("rough");
    expect(prepared?.tiles[8 * course.width + 8]).toBe("fairway");

    const state = applyAction({
      ...DEFAULT_STATE,
      course,
      world: { ...DEFAULT_STATE.world, cash: 100_000, reputation: 100 },
    }, { type: "EDIT_SURFACE_FEATURE", feature: moved });
    expect(state.course.tiles).toEqual(prepared?.tiles);
    expect(state.course.surfaceIntent).toEqual(prepared?.intent);
    expect(state.world.cash).toBe(prepared?.preview.projectedCash);
    expect(state.terrainVersion).toBe(DEFAULT_STATE.terrainVersion + 1);
  });

  it("refuses an edit when its persisted terrain is currently locked", () => {
    const { course, feature } = authoredCourse("water");
    if (feature.geometry.kind !== "corridor") throw new Error("expected corridor fixture");
    const moved: SurfaceFeature = {
      ...feature,
      geometry: {
        ...feature.geometry,
        knots: feature.geometry.knots.map((point) => ({ x: point.x, y: point.y + 2 })),
      },
    };
    const prepared = prepareSurfaceFeatureEdit(course, moved, 100_000, 1, 0);
    expect(prepared?.commitAllowed).toBe(false);
    expect(prepared?.preview.excluded.locked).toBeGreaterThan(0);

    const state = applyAction({
      ...DEFAULT_STATE,
      course,
      world: { ...DEFAULT_STATE.world, cash: 100_000, reputation: 0 },
    }, { type: "EDIT_SURFACE_FEATURE", feature: moved });
    expect(state.course).toBe(course);
  });

  it("keeps the existing feature when an edit is fully clipped by unowned land", () => {
    const { course, feature } = authoredCourse();
    if (feature.geometry.kind !== "corridor") throw new Error("expected corridor fixture");
    // A sold property asset is intentionally non-authorable terrain.
    course.property = {
      assets: [{
        id: "sold-corridor",
        kind: "houses",
        name: "Sold corridor",
        category: "community",
        tier: 1,
        x: 0,
        y: 6,
        width: course.width,
        height: 8,
        capacity: 0,
        condition: 1,
        price: 0,
        enabled: true,
        tenure: "sold",
      }],
    } as Course["property"];
    const moved: SurfaceFeature = {
      ...feature,
      geometry: {
        ...feature.geometry,
        knots: feature.geometry.knots.map((point) => ({ x: point.x, y: point.y + 6 })),
      },
    };

    const prepared = prepareSurfaceFeatureEdit(course, moved, 100_000, 1, 100);
    expect(prepared?.commitAllowed).toBe(false);
    expect(prepared?.preview.changedCount).toBe(0);
    expect(prepared?.preview.excluded.unowned).toBeGreaterThan(0);
    expect(prepared?.intent).toBe(course.surfaceIntent);
    expect(prepared?.tiles).toEqual(course.tiles);

    const state = applyAction({
      ...DEFAULT_STATE,
      course,
      world: { ...DEFAULT_STATE.world, cash: 100_000, reputation: 100 },
    }, { type: "EDIT_SURFACE_FEATURE", feature: moved });
    expect(state.course).toBe(course);
    expect(state.world.cash).toBe(100_000);
  });

  it("moves water intent and excavates its new basin atomically", () => {
    const { course, feature } = authoredCourse("water");
    course.elevations.fill(6);
    if (feature.geometry.kind !== "corridor") throw new Error("expected corridor fixture");
    const moved: SurfaceFeature = {
      ...feature,
      geometry: {
        ...feature.geometry,
        knots: feature.geometry.knots.map((point) => ({ x: point.x, y: point.y + 4 })),
      },
    };
    const prepared = prepareSurfaceFeatureEdit(course, moved, 100_000, 1, 100);
    expect(prepared?.preview.earthworkSteps).toBeGreaterThan(0);
    expect(prepared?.preview.elevationDeltas.length).toBeGreaterThan(0);
    expect(prepared?.elevations).not.toEqual(course.elevations);

    const state = applyAction({
      ...DEFAULT_STATE,
      course,
      world: { ...DEFAULT_STATE.world, cash: 100_000, reputation: 100 },
    }, { type: "EDIT_SURFACE_FEATURE", feature: moved });
    expect(state.course.tiles).toEqual(prepared?.tiles);
    expect(state.course.elevations).toEqual(prepared?.elevations);
    expect(state.world.cash).toBe(prepared?.preview.projectedCash);
  });

  it("clears props covered by an edited water feature in the same commit", () => {
    const { course, feature } = authoredCourse("water");
    course.elevations.fill(6);
    if (feature.geometry.kind !== "corridor") throw new Error("expected corridor fixture");
    const moved: SurfaceFeature = {
      ...feature,
      geometry: {
        ...feature.geometry,
        knots: feature.geometry.knots.map((point) => ({ x: point.x, y: point.y + 4 })),
      },
    };
    const movedCoverage = rasterizeSurfaceFeatureDetailed(
      moved,
      course.width,
      course.height,
    ).tiles;
    const target = movedCoverage.find((point) => !feature.coverage.includes(
      point.y * course.width + point.x,
    ));
    expect(target).toBeDefined();
    course.obstacles = [
      { ...target!, type: "tree" },
      { x: 0, y: 0, type: "rock" },
    ];

    const prepared = prepareSurfaceFeatureEdit(course, moved, 100_000, 1, 100);
    expect(prepared?.preview.removedObstacles).toEqual([{ ...target!, type: "tree" }]);
    expect(prepared?.obstacles).toEqual([{ x: 0, y: 0, type: "rock" }]);

    const state = applyAction({
      ...DEFAULT_STATE,
      course,
      world: { ...DEFAULT_STATE.world, cash: 100_000, reputation: 100 },
    }, { type: "EDIT_SURFACE_FEATURE", feature: moved });
    expect(state.course.obstacles).toEqual(prepared?.obstacles);
    expect(state.obstaclesVersion).toBe(DEFAULT_STATE.obstaclesVersion + 1);
  });
});
