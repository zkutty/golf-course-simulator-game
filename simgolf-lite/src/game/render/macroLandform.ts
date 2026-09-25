import type { LandTheme, Terrain } from "../models/types";
import { getBiomeDefinition } from "../models/biomes";
import type { VisualHeightfield } from "./landscapeGeometry";
import { sampleVisualHeight } from "./landscapeGeometry";

export interface MacroLandformRaster {
  width: number;
  height: number;
  /** Black RGBA veil used with multiply blending. */
  shadow: Uint8ClampedArray;
  /** White RGBA veil used with screen blending. */
  highlight: Uint8ClampedArray;
  maximumGrade: number;
}

const SHADE_PROFILES: Record<LandTheme, {
  shadow: number;
  highlight: number;
  ambientGrade: number;
}> = {
  parkland: { shadow: 118, highlight: 66, ambientGrade: 38 },
  links: { shadow: 126, highlight: 74, ambientGrade: 42 },
  desert: { shadow: 104, highlight: 58, ambientGrade: 34 },
};

const isShadedLand = (terrain: Terrain) => (
  terrain !== "sand" && terrain !== "waste_area" &&
  terrain !== "water" && terrain !== "wetland" && terrain !== "path"
);

function sampleTerrain(
  tiles: readonly Terrain[],
  width: number,
  height: number,
  x: number,
  y: number,
): Terrain {
  const cx = Math.max(0, Math.min(width - 1, Math.floor(x)));
  const cy = Math.max(0, Math.min(height - 1, Math.floor(y)));
  return tiles[cy * width + cx];
}

/**
 * A small world-space tent filter. Applying it before differentiating keeps
 * slope light broad across authored ridges without turning a height step into
 * adjacent contour bands. The same coordinates are used at every rotation.
 */
function filteredHeight(field: VisualHeightfield, x: number, y: number): number {
  const center = sampleVisualHeight(field, x, y) * 4;
  const cardinal =
    sampleVisualHeight(field, x - 0.42, y) +
    sampleVisualHeight(field, x + 0.42, y) +
    sampleVisualHeight(field, x, y - 0.42) +
    sampleVisualHeight(field, x, y + 0.42);
  return (center + cardinal) / 8;
}

function filteredGradient(field: VisualHeightfield, x: number, y: number): { dx: number; dy: number } {
  const derivativeRadius = 0.72;
  return {
    dx: (filteredHeight(field, x + derivativeRadius, y) - filteredHeight(field, x - derivativeRadius, y)) /
      (derivativeRadius * 2),
    dy: (filteredHeight(field, x, y + derivativeRadius) - filteredHeight(field, x, y - derivativeRadius)) /
      (derivativeRadius * 2),
  };
}

/**
 * Builds a world-anchored, continuous slope-light raster from the shared
 * presentation heightfield. The derivative is sampled across tile borders;
 * no tile edge or adjacency is emitted into the image. Organic hazards and
 * paths are transparent so their purpose-built planes remain visually level.
 */
export function buildMacroLandformRaster(
  field: VisualHeightfield,
  tiles: readonly Terrain[],
  theme: LandTheme | undefined,
  samplesPerTile = 4,
): MacroLandformRaster {
  const density = Math.max(2, Math.min(8, Math.round(samplesPerTile)));
  const width = field.width * density;
  const height = field.height * density;
  const shadow = new Uint8ClampedArray(width * height * 4);
  const highlight = new Uint8ClampedArray(width * height * 4);
  const owner = getBiomeDefinition(theme).content.materials.terrain;
  const profile = SHADE_PROFILES[owner];
  let maximumGrade = 0;

  for (let py = 0; py < height; py++) for (let px = 0; px < width; px++) {
    const x = (px + 0.5) / density;
    const y = (py + 0.5) / density;
    const terrain = sampleTerrain(tiles, field.width, field.height, x, y);
    const offset = (py * width + px) * 4;
    shadow[offset + 3] = 0;
    highlight[offset + 3] = 0;
    if (!isShadedLand(terrain)) continue;

    const { dx, dy } = filteredGradient(field, x, y);
    const grade = Math.min(1, Math.hypot(dx, dy) / 1.35);
    maximumGrade = Math.max(maximumGrade, Math.hypot(dx, dy));

    // Fixed north-west world light. Rotating the camera rotates the shaded
    // landform with the course rather than relighting it in screen space.
    const signedLight = Math.max(-1, Math.min(1, -(dx * 0.82 + dy * 0.57) / 1.35));
    const shadowAlpha = Math.round(Math.min(112,
      grade * profile.ambientGrade + Math.max(0, -signedLight) * profile.shadow,
    ));
    const highlightAlpha = Math.round(Math.min(76,
      Math.max(0, signedLight) * profile.highlight,
    ));
    shadow[offset] = 0;
    shadow[offset + 1] = 0;
    shadow[offset + 2] = 0;
    shadow[offset + 3] = shadowAlpha;
    highlight[offset] = 255;
    highlight[offset + 1] = 255;
    highlight[offset + 2] = 255;
    highlight[offset + 3] = highlightAlpha;
  }

  return { width, height, shadow, highlight, maximumGrade };
}

export function rasterAlphaRange(
  raster: Uint8ClampedArray,
  width: number,
  predicate: (x: number, y: number) => boolean,
): { min: number; max: number } {
  let min = 255;
  let max = 0;
  let found = false;
  for (let offset = 3; offset < raster.length; offset += 4) {
    const pixel = (offset - 3) / 4;
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    if (!predicate(x, y)) continue;
    found = true;
    min = Math.min(min, raster[offset]);
    max = Math.max(max, raster[offset]);
  }
  return found ? { min, max } : { min: 0, max: 0 };
}
