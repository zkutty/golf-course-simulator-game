import { describe, expect, it } from "vitest";
import { createParklandVisualReferenceCourse } from "../testing/referenceCourse";
import { buildParklandPairFringePlan } from "./parklandPairFringes";
import {
  ORGANIC_HAZARD_TERRAINS,
  ROUTE_TERRAINS,
  TERRAIN_PRESENTATION_POLICY,
  TILE_SURFACE_TERRAINS,
  buildTerrainPresentationMap,
  terrainCellCounts,
} from "./terrainPresentationPolicy";

describe("ZK-1200 terrain presentation policy", () => {
  it("classifies every terrain into the exhaustive visual policy", () => {
    expect(TILE_SURFACE_TERRAINS).toEqual(["fairway", "rough", "deep_rough", "green", "tee"]);
    expect(ORGANIC_HAZARD_TERRAINS).toEqual(["sand", "water", "wetland", "waste_area"]);
    expect(ROUTE_TERRAINS).toEqual(["path"]);
    expect(Object.keys(TERRAIN_PRESENTATION_POLICY).sort()).toEqual([
      "deep_rough", "fairway", "green", "path", "rough",
      "sand", "tee", "waste_area", "water", "wetland",
    ]);
  });

  it("maps exactly M19's 49 deep-rough singletons and enclosed rough island", () => {
    const course = createParklandVisualReferenceCourse();
    const before = [...course.tiles];
    const result = buildTerrainPresentationMap(course.tiles, course.width, course.height, course.theme);
    const deepRough = result.mappings.filter((mapping) => mapping.reason === "singleton-deep-rough");
    const rough = result.mappings.filter((mapping) => mapping.reason === "enclosed-singleton-rough");

    expect(deepRough).toHaveLength(49);
    expect(deepRough.every((mapping) => mapping.from === "deep_rough" && mapping.to === "rough")).toBe(true);
    expect(rough).toEqual([{
      cell: 18 * course.width + 16,
      x: 16,
      y: 18,
      from: "rough",
      to: "fairway",
      reason: "enclosed-singleton-rough",
    }]);
    expect(course.tiles).toEqual(before);
    expect(result.authoritativeTiles).toBe(course.tiles);
    expect(terrainCellCounts(result.authoritativeTiles)).toMatchObject({
      fairway: 151, rough: 1269, deep_rough: 49,
    });
    expect(terrainCellCounts(result.presentationTiles)).toMatchObject({
      fairway: 152, rough: 1317, deep_rough: 0,
    });
  });

  it("is byte deterministic and leaves non-Parkland authority unmapped", () => {
    const course = createParklandVisualReferenceCourse();
    const first = buildTerrainPresentationMap(course.tiles, course.width, course.height, course.theme);
    const second = buildTerrainPresentationMap(course.tiles, course.width, course.height, course.theme);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.authoritativeBytes).not.toBe(first.presentationBytes);

    const links = buildTerrainPresentationMap(course.tiles, course.width, course.height, "links");
    expect(links.mappings).toEqual([]);
    expect(links.presentationTiles).toEqual(course.tiles);
    expect(links.authoritativeBytes).toBe(links.presentationBytes);
  });

  it("feeds both presentation sides to the pair planner without changing 104/16 ownership", () => {
    const course = createParklandVisualReferenceCourse();
    const presentation = buildTerrainPresentationMap(
      course.tiles, course.width, course.height, course.theme,
    );
    const plan = buildParklandPairFringePlan({
      tiles: presentation.presentationTiles,
      pairIdentityTiles: presentation.authoritativeTiles,
      elevations: course.elevations,
      width: course.width,
      height: course.height,
    });
    expect(plan.diagnostics).toMatchObject({
      authoritativeDifferingTurfAdjacencies: 108,
      sameElevationDifferingTurfAdjacencies: 104,
      omittedDifferentElevation: 4,
      omittedSamePresentation: 0,
      omittedBlocked: 0,
      plannedStrips: 104,
      cornerCandidates: 16,
      plannedCorners: 16,
      omittedMixedPairCorners: 2,
      mixedPairMasks: 0,
      fullCellSprites: 0,
      ownershipOverlaps: 0,
      doubleOwners: 0,
      pairCounts: {
        "fairway--green": 8,
        "fairway--rough": 61,
        "fairway--tee": 6,
        "rough--green": 15,
        "rough--tee": 14,
      },
      directionCounts: { n: 31, e: 20, s: 31, w: 22 },
    });
    expect(new Set(plan.edges.map((edge) => edge.ownerKey)).size).toBe(104);
    expect(new Set(plan.corners.map((corner) => corner.ownerKey)).size).toBe(16);
  });
});
