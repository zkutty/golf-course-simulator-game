import { effectiveTerrainForPaintPreview } from "../conditions/surfaceCare";
import { appendSurfaceFeature } from "../models/surfaceIntent";
import type { TerrainStrokePreview } from "../models/terrainStroke";
import type { Course, SurfacePoint, SurfaceFeature } from "../models/types";
import { authoredBunkerRings, captureBunkerPresentation, capturedBunkerBoundary } from "./bunkerPresentation";
import { buildBunkerVisualRings, classifyBunkerVisualType } from "./bunkerShapes";
import { buildHazardBankFacePlan } from "./hazardDepth";
import { buildLandscapeComponents } from "./landscapeGeometry";
import { buildTerrainPresentationMap } from "./terrainPresentationPolicy";

export interface SandStrokePreviewComponent {
  cells: number[];
  boundary: SurfacePoint[][];
  floor: SurfacePoint[][];
  authored: boolean;
}
interface Input {
  course: Course;
  effectiveTiles: Course["tiles"] | readonly Course["tiles"][number][];
  preview: TerrainStrokePreview;
  quality: "low" | "medium" | "high";
}

/** One current preview owns one synthetic estate. Camera ticks reuse it;
 * dropping/replacing the preview releases its copied arrays and masks. */
export function createSandStrokePreviewResolver() {
  let latest: { input: Input; width: number; height: number; theme: Course["theme"];
    features: Course["surfaceIntent"]; featureRoot: readonly SurfaceFeature[] | undefined; care: Course["surfaceCare"];
    accepted: TerrainStrokePreview["acceptedTiles"]; feature: TerrainStrokePreview["surfaceFeature"];
    components: SandStrokePreviewComponent[] } | null = null;
  return {
    clear() { latest = null; },
    resolve(input: Input): SandStrokePreviewComponent[] {
      const old = latest?.input;
      if (old && old.course === input.course && old.effectiveTiles === input.effectiveTiles
        && old.preview === input.preview && old.quality === input.quality
        && latest!.width === input.course.width && latest!.height === input.course.height && latest!.theme === input.course.theme
        && latest!.features === input.course.surfaceIntent && latest!.featureRoot === input.course.surfaceIntent?.features && latest!.care === input.course.surfaceCare
        && latest!.accepted === input.preview.acceptedTiles && latest!.feature === input.preview.surfaceFeature) return latest!.components;
      const { course, effectiveTiles, preview, quality } = input;
      if (preview.previewKind !== "stroke" || !Number.isInteger(course.width) || !Number.isInteger(course.height)
        || course.width <= 0 || course.height <= 0 || effectiveTiles.length !== course.width * course.height) {
        latest = null;
        return [];
      }
      const tiles = [...effectiveTiles];
      const affected = new Set<number>();
      for (const tile of preview.acceptedTiles) {
        if (tile.terrain !== "sand" || !Number.isInteger(tile.x) || !Number.isInteger(tile.y)
          || tile.x < 0 || tile.y < 0 || tile.x >= course.width || tile.y >= course.height) continue;
        const cell = tile.y * course.width + tile.x;
        tiles[cell] = effectiveTerrainForPaintPreview(course, cell, tile.terrain);
        if (tiles[cell] === "sand") affected.add(cell);
      }
      const canonicalTiles = [...course.tiles];
      for (const tile of preview.tiles) canonicalTiles[tile.y * course.width + tile.x] = tile.terrain;
      const presentationTiles = buildTerrainPresentationMap(tiles, course.width, course.height, course.theme).presentationTiles;
      const features = preview.surfaceFeature
        ? appendSurfaceFeature({ ...course, tiles: canonicalTiles }, preview.surfaceFeature).features
        : course.surfaceIntent?.features;
      let components: SandStrokePreviewComponent[];
      if (quality === "low") {
        components = captureBunkerPresentation(presentationTiles, course.width, course.height, features)
          .filter((component) => component.cells.some((cell) => affected.has(cell)))
          .map((component) => ({ cells: component.cells,
            boundary: capturedBunkerBoundary(component).map((ring) => ring.map((point) => ({ ...point }))),
            floor: component.rings,
            authored: authoredBunkerRings(component.cells, features, course.width, course.height) !== null }));
      } else {
        const high = quality === "high";
        components = buildLandscapeComponents(presentationTiles, course.width, course.height,
          { cornerRadius: high ? .4 : .32, cornerSegments: high ? 4 : 2 })
          .filter((component) => component.terrain === "sand" && component.cells.some((cell) => affected.has(cell)))
          .map((component) => {
            const authored = authoredBunkerRings(component.cells, features, course.width, course.height);
            const boundary = authored ?? buildBunkerVisualRings(component.rings, component.topologyKey, component.cells.length,
              classifyBunkerVisualType(component.cells, presentationTiles, course.width, course.height));
            return { cells: component.cells, boundary, authored: authored !== null,
              floor: boundary.map((ring) => (buildHazardBankFacePlan("sand", component.cells.length, ring)?.innerRing ?? ring)
                .map((point) => ({ ...point }))) };
          });
      }
      latest = { input, components, width: course.width, height: course.height, theme: course.theme,
        features: course.surfaceIntent, featureRoot: course.surfaceIntent?.features, care: course.surfaceCare, accepted: preview.acceptedTiles, feature: preview.surfaceFeature };
      return components;
    },
  };
}
