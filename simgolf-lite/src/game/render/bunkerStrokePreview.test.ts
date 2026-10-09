import { describe, expect, it } from "vitest";
import { applyAction } from "../../core/reducer";
import { DEFAULT_STATE } from "../gameState";
import { appendSurfaceFeature } from "../models/surfaceIntent";
import { DEFAULT_COURSE } from "../models/defaults";
import { previewTerrainStroke, type TerrainStrokePreview } from "../models/terrainStroke";
import type { Course, SurfaceFeature, Terrain } from "../models/types";
import { authoredBunkerRings, captureBunkerPresentation, capturedBunkerBoundary, normalizeBunkerPresentation } from "./bunkerPresentation";
import { createSandStrokePreviewResolver } from "./bunkerStrokePreview";
import { buildBunkerVisualRings, classifyBunkerVisualType } from "./bunkerShapes";
import { buildHazardBankFacePlan } from "./hazardDepth";
import { buildLandscapeComponents } from "./landscapeGeometry";
import { buildTerrainPresentationMap } from "./terrainPresentationPolicy";

function course(): Course {
  return { ...DEFAULT_COURSE, width: 32, height: 8, tiles: Array<Terrain>(256).fill("rough"),
    elevations: Array(256).fill(0), holes: [], layouts: [], obstacles: [], buildings: [], decorations: [] };
}
function stroke(c: Course, cells: number[], feature?: SurfaceFeature): TerrainStrokePreview {
  return { ...previewTerrainStroke(c, cells.map((cell) => ({ x: cell % c.width, y: Math.floor(cell / c.width) })), "sand", 1_000_000, 1, 100), surfaceFeature: feature };
}
function final(c: Course, preview: TerrainStrokePreview, quality: "low" | "medium" | "high") {
  const tiles = [...c.tiles];
  for (const tile of preview.acceptedTiles) tiles[tile.y * c.width + tile.x] = tile.terrain;
  const world = buildTerrainPresentationMap(tiles, c.width, c.height, c.theme).presentationTiles;
  const features = preview.surfaceFeature ? appendSurfaceFeature({ ...c, tiles }, preview.surfaceFeature).features : c.surfaceIntent?.features;
  if (quality === "low") return captureBunkerPresentation(world, c.width, c.height, features).map((component) => ({
    cells: component.cells, boundary: capturedBunkerBoundary(component), floor: component.rings,
    authored: authoredBunkerRings(component.cells, features, c.width, c.height) !== null,
  }));
  return buildLandscapeComponents(world, c.width, c.height,
    { cornerRadius: quality === "high" ? .4 : .32, cornerSegments: quality === "high" ? 4 : 2 })
    .filter((component) => component.terrain === "sand").map((component) => {
      const authored = authoredBunkerRings(component.cells, features, c.width, c.height);
      const boundary = authored ?? buildBunkerVisualRings(component.rings, component.topologyKey, component.cells.length,
        classifyBunkerVisualType(component.cells, world, c.width, c.height));
      return { cells: component.cells, boundary, authored: authored !== null,
        floor: boundary.map((ring) => (buildHazardBankFacePlan("sand", component.cells.length, ring)?.innerRing ?? ring).map((p) => ({ ...p }))) };
    });
}

describe("complete world sand preview", () => {
  for (const quality of ["low", "medium", "high"] as const) {
    it(`joins the full long component beyond the old local crop at ${quality}`, () => {
      const c = course();
      for (let x = 2; x <= 26; x++) c.tiles[3 * c.width + x] = "sand";
      c.tiles[3 * c.width + 1] = "green"; // Full-world greenside classification.
      const preview = stroke(c, [3 * c.width + 26, 3 * c.width + 27]);
      const before = JSON.stringify({ c, preview });
      const result = createSandStrokePreviewResolver().resolve({ course: c, effectiveTiles: c.tiles, preview, quality });
      expect(result).toEqual(final(c, preview, quality));
      expect(result[0].cells).toHaveLength(26);
      expect(result[0].cells).toContain(3 * c.width + 2);
      expect(preview.tiles).toHaveLength(1);
      expect(preview.acceptedTiles).toHaveLength(2);
      expect(JSON.stringify({ c, preview })).toBe(before);
    });
    it(`bridges existing components using the final ambiguous ownership fallback at ${quality}`, () => {
      const c = course();
      for (const [start, end] of [[2, 10], [14, 24]]) for (let x = start; x <= end; x++) c.tiles[3 * c.width + x] = "sand";
      const oldCells = Array.from({ length: 9 }, (_, i) => 3 * c.width + 2 + i);
      const oldFeature: SurfaceFeature = { id: "old", order: 1, terrain: "sand", coverage: oldCells,
        geometry: { kind: "region", ring: [] }, renderRings: [[{ x: 2, y: 3 }, { x: 11, y: 3 }, { x: 11, y: 4 }, { x: 2, y: 4 }]] };
      c.surfaceIntent = { version: 1, nextId: 3, features: [oldFeature] };
      const bridge = [11, 12, 13].map((x) => 3 * c.width + x);
      const preview = stroke(c, bridge, { ...oldFeature, id: "new", order: 2, coverage: bridge });
      const result = createSandStrokePreviewResolver().resolve({ course: c, effectiveTiles: c.tiles, preview, quality });
      expect(result).toEqual(final(c, preview, quality));
      expect(result[0].cells).toHaveLength(23);
      expect(result[0].authored).toBe(false);
    });
    it(`isolated legacy pot boundary and floor match final at ${quality}`, () => {
      const c = course();
      const preview = stroke(c, [3 * c.width + 12]);
      expect(createSandStrokePreviewResolver().resolve({ course: c, effectiveTiles: c.tiles, preview, quality })).toEqual(final(c, preview, quality));
    });
  }
  it("retains only the current preview and invalidates course, dimension, intent, theme, tier and undo roots", () => {
    const c = course();
    const preview = stroke(c, [108]);
    const resolver = createSandStrokePreviewResolver();
    const input = { course: c, effectiveTiles: c.tiles, preview, quality: "high" as const };
    const first = resolver.resolve(input);
    expect(resolver.resolve({ ...input })).toBe(first);
    expect(resolver.resolve({ ...input, quality: "medium" })).not.toBe(first);
    expect(resolver.resolve(input)).not.toBe(first);
    for (const next of [{ ...c, theme: "links" as const }, { ...c, width: 16, height: 16 },
      { ...c, surfaceIntent: { version: 1 as const, nextId: 1, features: [] } }, { ...c, tiles: [...c.tiles] }]) {
      expect(resolver.resolve({ ...input, course: next, effectiveTiles: next.tiles })).not.toBe(first);
    }
    const replacement = resolver.resolve({ ...input, preview: { ...preview } });
    expect(replacement).not.toBe(first);
    resolver.clear();
    expect(resolver.resolve(input)).not.toBe(replacement);
    const legacy = captureBunkerPresentation(c.tiles, c.width, c.height);
    expect(normalizeBunkerPresentation(JSON.parse(JSON.stringify(legacy)), c.tiles, c.width)).toEqual(legacy);
  });
});


it("invalidates dimension, theme and intent root replacements even on the same course reference", () => {
  const c = course();
  const preview = stroke(c, [108]);
  const resolver = createSandStrokePreviewResolver();
  const input = { course: c, effectiveTiles: c.tiles, preview, quality: "high" as const };
  let previous = resolver.resolve(input);
  c.theme = "desert";
  let next = resolver.resolve(input); expect(next).not.toBe(previous); previous = next;
  c.surfaceIntent = { version: 1, nextId: 1, features: [] };
  next = resolver.resolve(input); expect(next).not.toBe(previous); previous = next;
  c.surfaceIntent.features = [];
  next = resolver.resolve(input); expect(next).not.toBe(previous); previous = next;
  c.width = 16; c.height = 16;
  next = resolver.resolve(input); expect(next).not.toBe(previous);
});

it("keeps rejected cells and unaffordable quotes outside presentation ownership", () => {
  const c = course();
  const preview = previewTerrainStroke(c, [{ x: -1, y: 3 }, { x: 12, y: 3 }, { x: 12, y: 3 }], "sand", 0, 1, 100);
  expect(preview.affordable).toBe(false);
  expect(preview.excluded.outOfBounds).toBe(1);
  const quote = JSON.stringify(preview);
  const [result] = createSandStrokePreviewResolver().resolve({ course: c, effectiveTiles: c.tiles, preview, quality: "high" });
  expect(result.cells).toEqual([108]);
  expect(preview.tiles).toHaveLength(1);
  expect(preview.duplicateCount).toBe(1);
  expect(JSON.stringify(preview)).toBe(quote);
});


it("predicts final ownership when the existing oldest feature is evicted by the append cap", () => {
  const c = course();
  c.tiles[108] = "sand";
  const ring = [{ x: 12, y: 3 }, { x: 14, y: 3 }, { x: 14, y: 4 }, { x: 12, y: 4 }];
  const oldest: SurfaceFeature = { id: "surface-1", terrain: "sand", order: 0, coverage: [108], geometry: { kind: "region", ring }, renderRings: [ring] };
  c.surfaceIntent = { version: 1, nextId: 513, features: [oldest, ...Array.from({ length: 511 }, (_, i) => ({ ...oldest, id: `surface-${i + 2}`, terrain: "rough" as const, coverage: [0] }))] };
  const feature = { ...oldest, id: "surface-513", coverage: [108, 109], order: 512 };
  const preview = stroke(c, [108, 109], feature);
  const result = createSandStrokePreviewResolver().resolve({ course: c, effectiveTiles: c.tiles, preview, quality: "high" });
  const committed = applyAction({ ...DEFAULT_STATE, course: c, world: { ...DEFAULT_STATE.world, reputation: 100, cash: 1_000_000 } },
    { type: "PAINT_TILES", tiles: preview.acceptedTiles, surfaceFeature: feature }).course;
  expect(committed.surfaceIntent!.features).toHaveLength(512);
  expect(committed.surfaceIntent!.features.some((f) => f.id === oldest.id)).toBe(false);
  expect(result[0].authored).toBe(true);
  expect(result).toEqual(final(committed, { ...preview, acceptedTiles: [], surfaceFeature: undefined }, "high"));
  expect(c.surfaceIntent.features[0]).toBe(oldest);
});
