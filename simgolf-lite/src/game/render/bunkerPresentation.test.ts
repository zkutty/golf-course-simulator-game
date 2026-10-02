import { describe, expect, it } from "vitest";
import type { SurfaceFeature, Terrain } from "../models/types";
import { corridorFeature, rasterizeSurfaceFeatureDetailed } from "../models/surfaceIntent";
import { authoredBunkerRings, bunkerDisplayPoint, cachedBunkerPresentation, captureBunkerPresentation, insideBunkerRings, normalizeBunkerPresentation, reconcileBunkerRest } from "./bunkerPresentation";
import { resolvePlayableShot } from "../playerPro/playerPro";
import type { PlayerRoundCourseSnapshot } from "../models/playerProTypes";
import { buildLandscapeComponents, landscapeTopologyKey } from "./landscapeGeometry";
import { buildBunkerVisualRings } from "./bunkerShapes";
import { worldToIso } from "./iso";

const square = [{ x: 0.2, y: 0.2 }, { x: 0.8, y: 0.2 }, { x: 0.8, y: 0.8 }, { x: 0.2, y: 0.8 }];
const feature: SurfaceFeature = { id: "sand-1", terrain: "sand", order: 1, coverage: [0], geometry: { kind: "region", ring: square }, renderRings: [square] };

describe("authored bunker ownership", () => {
  it("consumes a copied contour only for one exact owner", () => {
    expect(authoredBunkerRings([0], [feature], 1, 8)![0].length).toBe(16);
    const rings = authoredBunkerRings([0], [feature], 1, 8)!;
    rings[0][0].x = 99;
    expect(feature.renderRings![0][0].x).toBe(0.2);
    expect(authoredBunkerRings([0, 1], [feature], 1, 8)).toBeNull();
    expect(authoredBunkerRings([0], [feature, { ...feature, id: "overlap" }], 1, 8)).toBeNull();
    expect(authoredBunkerRings([1], [feature], 1, 8)).toBeNull();
  });
  it("rejects legacy, non-finite, degenerate and oversized rings", () => {
    for (const renderRings of [undefined, [], [[{ x: NaN, y: 0 }, ...square]], [[{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }]], [Array.from({ length: 4097 }, () => square[0])]]) {
      expect(authoredBunkerRings([0], [{ ...feature, renderRings }], 1, 8)).toBeNull();
    }
  });
  it("retains authored world coordinates after reload and all camera rotations", () => {
    const restored = JSON.parse(JSON.stringify(feature)) as SurfaceFeature;
    for (const rotation of [0, 90, 180, 270] as const) {
      expect(authoredBunkerRings([0], [restored], 1, 8)![0].map((point) => worldToIso(point.x, point.y, 0, rotation)))
        .toEqual(authoredBunkerRings([0], [feature], 1, 8)![0].map((point) => worldToIso(point.x, point.y, 0, rotation)));
    }
  });
  it("rounds estate-edge corners without cutting through an unowned concave notch", () => {
    const ring = [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 2 }, { x: 0, y: 2 }];
    const clipped: SurfaceFeature = { ...feature, coverage: [0, 1, 2, 3], geometry: { kind: "region", ring }, renderRings: [ring] };
    const rounded = authoredBunkerRings(clipped.coverage, [clipped], 3, 8)!;
    expect(rounded[0].length).toBeGreaterThan(ring.length);
    expect(rounded[0]).not.toEqual(ring);
    expect(rounded[0].some((point) => point.x % 1 !== 0 && point.y % 1 !== 0)).toBe(true);
    expect(rounded[0]).toContainEqual({ x: 1, y: 1 });
    expect(authoredBunkerRings(clipped.coverage, [{ ...clipped, renderRings: rounded }], 3, 8, false)).toEqual(rounded);
    expect(insideBunkerRings({ x: 1.01, y: 1.01 }, rounded)).toBe(false);
    expect(Math.min(...rounded[0].map((point) => point.x))).toBe(0);
    expect(Math.min(...rounded[0].map((point) => point.y))).toBe(0);
    const mirrored = { ...clipped, coverage: [0, 1, 2, 5], renderRings: [ring.map((point) => ({ x: 3 - point.x, y: point.y }))] };
    expect(authoredBunkerRings(mirrored.coverage, [mirrored], 3, 8)![0].length).toBeGreaterThan(ring.length);
  });
  it("does not miss a tiny diagonal excursion through an uncharged tile corner", () => {
    const ring = [{ x: 0.2, y: 0.2 }, { x: 1.01, y: 1 }, { x: 1, y: 1.01 }, { x: 0.2, y: 0.8 }];
    expect(authoredBunkerRings([0, 1, 2], [{ ...feature, coverage: [0, 1, 2], renderRings: [ring] }], 2, 8, false)).toBeNull();
  });
  it("rejects extreme finite coordinates and invalid widths before traversing grid lines", () => {
    expect(authoredBunkerRings([0, Number.MAX_SAFE_INTEGER], [{ ...feature, coverage: [0, Number.MAX_SAFE_INTEGER] }], 1, 8)).toBeNull();
    const extreme = [[{ x: 0.2, y: 0.2 }, { x: 1e300, y: 0.2 }, { x: 0.2, y: 0.8 }]];
    expect(authoredBunkerRings([0], [{ ...feature, renderRings: extreme }], 1, 8)).toBeNull();
    expect(normalizeBunkerPresentation([{ cells: [0], rings: extreme }], ["sand"], 1)).toBeUndefined();
    expect(authoredBunkerRings([0], [feature], 0, 8)).toBeNull();
    expect(authoredBunkerRings([0], [feature], 1.5, 8)).toBeNull();
  });
  it("rejects repeated vertices, backtracking edges and touching or crossing rings", () => {
    const duplicate = [{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.1 }, { x: 0.9, y: 0.9 }, { x: 0.5, y: 0.5 }, { x: 0.1, y: 0.9 }, { x: 0.5, y: 0.5 }];
    const overlap = [{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.1 }, { x: 0.5, y: 0.1 }, { x: 0.9, y: 0.9 }, { x: 0.1, y: 0.9 }];
    const touch = [{ x: 0.2, y: 0.2 }, { x: 0.5, y: 0.3 }, { x: 0.3, y: 0.5 }];
    const crossing = square.map((point) => ({ x: point.x + 0.1, y: point.y + 0.1 }));
    for (const renderRings of [[duplicate], [overlap], [square, touch], [square, crossing]]) {
      expect(authoredBunkerRings([0], [{ ...feature, renderRings }], 1, 8)).toBeNull();
    }
  });
  it("rejects hidden unowned interiors and owned-cell omissions while preserving disjoint nested islands", () => {
    const outer = [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 3 }, { x: 0, y: 3 }];
    const hole = [{ x: 1, y: 1 }, { x: 1, y: 2 }, { x: 2, y: 2 }, { x: 2, y: 1 }];
    const cells = [0, 1, 2, 3, 5, 6, 7, 8];
    const island = { ...feature, coverage: cells, renderRings: [outer, hole] };
    expect(authoredBunkerRings(cells, [{ ...island, renderRings: [outer] }], 3, 8)).toBeNull();
    expect(authoredBunkerRings([...cells, 4], [{ ...island, coverage: [...cells, 4] }], 3, 8)).toBeNull();
    const result = authoredBunkerRings(cells, [island], 3, 8)!;
    expect(result).not.toBeNull();
    expect(insideBunkerRings({ x: 1.5, y: 1.5 }, result)).toBe(false);
    expect(insideBunkerRings({ x: 0.5, y: 1.5 }, result)).toBe(true);
    expect(authoredBunkerRings(cells, [{ ...island, renderRings: result }], 3, 8, false)).toEqual(result);
  });
});

describe("visible sand rest", () => {
  it("projects grass cutout rests only within the same logical component", () => {
    const components = [{ cells: [0], rings: [square] }, { cells: [2], rings: [square.map((point) => ({ ...point, x: point.x + 2 }))] }];
    const projected = reconcileBunkerRest({ x: 0.05, y: 0.05 }, 3, components);
    expect(insideBunkerRings(projected, [square])).toBe(true);
    expect(Math.floor(projected.y) * 3 + Math.floor(projected.x)).toBe(0);
    expect(reconcileBunkerRest({ x: 1.1, y: 0.1 }, 3, components)).toEqual({ x: 1.1, y: 0.1 });
    expect(reconcileBunkerRest({ x: 0.5, y: 0.5 }, 3, components)).toEqual({ x: 0.5, y: 0.5 });
  });
  it("preserves grass islands and freezes authored floor masks", () => {
    const outer = square.map((point) => ({ x: point.x * 5, y: point.y * 5 }));
    expect(insideBunkerRings({ x: 2.5, y: 2.5 }, [outer, square.map((point) => ({ x: point.x + 2, y: point.y + 2 }))])).toBe(false);
    const tiles: Terrain[] = ["sand"];
    const snapshot = captureBunkerPresentation(tiles, 1, 1, [feature]);
    feature.renderRings![0][0].x = 0.21;
    expect(snapshot[0].rings[0][0].x).not.toBe(0.21);
    feature.renderRings![0][0].x = 0.2;
    expect(normalizeBunkerPresentation(snapshot, tiles, 1)).toEqual(snapshot);
    expect(normalizeBunkerPresentation(snapshot, ["rough"], 1)).toBeUndefined();
    expect(normalizeBunkerPresentation([{ cells: [0], rings: [[null]] }], tiles, 1)).toBeUndefined();
    expect(normalizeBunkerPresentation([], tiles, 1)).toBeUndefined();
    expect(normalizeBunkerPresentation(snapshot, ["sand", "sand"], 2)).toBeUndefined();
    expect(normalizeBunkerPresentation([{ cells: [0, 1], rings: [square] }], ["sand", "sand"], 2)).toBeUndefined();
    expect(normalizeBunkerPresentation([{ cells: [0], rings: [square.map((point) => ({ ...point, x: point.x + 1 }))] }], ["sand", "rough"], 2)).toBeUndefined();
    const boxOuter = [{ x: 0.1, y: 0.1 }, { x: 2.9, y: 0.1 }, { x: 2.9, y: 2.9 }, { x: 0.1, y: 2.9 }];
    expect(normalizeBunkerPresentation([{ cells: [0, 1, 2, 3, 5, 6, 7, 8], rings: [boxOuter] }],
      ["sand", "sand", "sand", "sand", "rough", "sand", "sand", "sand", "sand"], 3)).toBeUndefined();
    const hollow = [{ x: 0.2, y: 0.2 }, { x: 2.8, y: 0.2 }, { x: 2.8, y: 2.8 }, { x: 0.2, y: 2.8 }];
    expect(normalizeBunkerPresentation([{ cells: Array.from({ length: 9 }, (_, cell) => cell), rings: [boxOuter, hollow] }], Array(9).fill("sand"), 3)).toBeUndefined();
  });
  it("maps display endpoints and the next displayed origin identically without mutating canonical coordinates", () => {
    const canonical = { x: 0.8, y: 0.8 };
    const components = [{ cells: [0], rings: [square] }];
    const displayedRest = bunkerDisplayPoint(canonical, 2, components);
    const nextDisplayedOrigin = bunkerDisplayPoint(canonical, 2, components);
    expect(displayedRest).toEqual(nextDisplayedOrigin);
    expect(insideBunkerRings(displayedRest, [square])).toBe(true);
    expect(canonical).toEqual({ x: 0.8, y: 0.8 });
    expect(bunkerDisplayPoint({ x: 1.1, y: 0.1 }, 2, components)).toEqual({ x: 1.6, y: 0.6 });
    const tiles: Terrain[] = ["sand", "rough"];
    expect(cachedBunkerPresentation(tiles, 2, 1)).toBe(cachedBunkerPresentation(tiles, 2, 1));
    expect(cachedBunkerPresentation([...tiles], 2, 1)).not.toBe(cachedBunkerPresentation(tiles, 2, 1));
  });
  it("optional presentation geometry cannot change canonical shots or their subsequent seed stream", () => {
    const snapshot: PlayerRoundCourseSnapshot = {
      courseId: "bunker", courseName: "Bunker", theme: "parkland", width: 12, height: 4, yardsPerTile: 10,
      tiles: Array.from({ length: 48 }, (_, cell) => cell === 24 ? "tee" : "sand"), elevations: Array(48).fill(0), obstacles: [],
      holes: [{ id: "one", name: "One", par: 4, tee: { x: 0, y: 2 }, pin: { x: 11, y: 2 }, waypoints: [] }],
    };
    const base = { snapshot, holeId: "one", shotNumber: 1, from: { x: 0, y: 2 }, lie: "tee",
      skills: { power: 50, driving: 50, irons: 50, shortGame: 50, putting: 50, recovery: 50 },
      selection: { club: "Sand Wedge", aim: { x: 6, y: 2 }, power: 1, technique: "normal" }, seed: 713 } as const;
    const canonical = resolvePlayableShot(base);
    const decorated = { ...snapshot, bunkerPresentation: captureBunkerPresentation(snapshot.tiles as Terrain[], 12, 4) };
    expect(resolvePlayableShot({ ...base, snapshot: decorated })).toEqual(canonical);
    expect(resolvePlayableShot({ ...base, shotNumber: 2, from: canonical.rest, lie: canonical.lieAfter, seed: 714, snapshot: decorated }))
      .toEqual(resolvePlayableShot({ ...base, shotNumber: 2, from: canonical.rest, lie: canonical.lieAfter, seed: 714 }));
  });
  it("shares an actual corridor's accepted raster after authoring/reload", () => {
    const course = { width: 8, height: 8, surfaceIntent: undefined } as Parameters<typeof corridorFeature>[0];
    const authored = corridorFeature(course, "sand", [{ x: 2, y: 2 }, { x: 5, y: 3 }], 2);
    const rawRaster = rasterizeSurfaceFeatureDetailed(authored, 8, 8);
    // The editor and reducer clip a second raster to charged/accepted cells;
    // the first mask can contain partial uncharged fringe cells.
    const accepted = new Set(rawRaster.tiles.map((tile) => tile.y * 8 + tile.x));
    const raster = rasterizeSurfaceFeatureDetailed(authored, 8, 8, accepted);
    authored.coverage = raster.tiles.map((tile) => tile.y * 8 + tile.x);
    authored.renderRings = raster.rings;
    expect(authoredBunkerRings(authored.coverage, [authored], 8, 8)).not.toBeNull();
    expect(authoredBunkerRings(authored.coverage, [JSON.parse(JSON.stringify(authored))], 8, 8)).toEqual(authoredBunkerRings(authored.coverage, [authored], 8, 8));
    const tiles: Terrain[] = Array(64).fill("rough");
    for (const cell of authored.coverage) tiles[cell] = "sand";
    const snapshot = captureBunkerPresentation(tiles, 8, 8, [authored]);
    expect(normalizeBunkerPresentation(JSON.parse(JSON.stringify(snapshot)), tiles, 8)).toEqual(snapshot);
  });
});


it("uses the final world topology seed for an isolated pot preview", () => {
  const tiles: Terrain[] = Array(100).fill("rough");
  tiles[44] = "sand";
  const final = buildLandscapeComponents(tiles, 10, 10).find((component) => component.terrain === "sand")!;
  const local: Terrain[] = Array(9).fill("rough");
  local[4] = "sand";
  const preview = buildLandscapeComponents(local, 3, 3).find((component) => component.terrain === "sand")!;
  const worldCells = preview.cells.map((cell) => (Math.floor(cell / 3) + 3) * 10 + cell % 3 + 3);
  const worldKey = landscapeTopologyKey("sand", worldCells, 10, 10);
  expect(worldKey).toBe(final.topologyKey);
  const worldRings = preview.rings.map((ring) => ring.map((point) => ({ x: point.x + 3, y: point.y + 3 })));
  expect(buildBunkerVisualRings(worldRings, worldKey, 1)).toEqual(buildBunkerVisualRings(final.rings, final.topologyKey, 1));
});
