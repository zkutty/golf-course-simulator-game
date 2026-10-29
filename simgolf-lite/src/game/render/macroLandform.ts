import type { LandTheme, Terrain } from "../models/types";
import { getBiomeDefinition } from "../models/biomes";
import type { VisualHeightfield } from "./landscapeGeometry";

export interface MacroLandformRaster {
  width: number;
  height: number;
  /** Black RGBA veil used with multiply blending. */
  shadow: Uint8ClampedArray;
  /** White RGBA veil used with screen blending. */
  highlight: Uint8ClampedArray;
  maximumGrade: number;
  shadedSamples: number;
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

// Five filtered centers, each with its center and original +/-1.2 samples.
// Each slot stores the unchanged clamp/index/fraction triple. Tables live only
// for this raster; unshaded rows/columns never prepare entries.
const AXIS_VALUES_PER_PIXEL = 5 * 3 * 3;

function prepareAxisCoordinate(table: Float64Array, offset: number, coordinate: number, maximum: number): void {
  const clamped = Math.max(0, Math.min(maximum, coordinate));
  const first = Math.min(maximum - 1, Math.max(0, Math.floor(clamped)));
  table[offset] = first;
  table[offset + 1] = Math.min(maximum, first + 1);
  table[offset + 2] = clamped - first;
}

function prepareFilteredAxis(table: Float64Array, offset: number, center: number, maximum: number): void {
  prepareAxisCoordinate(table, offset, center, maximum);
  prepareAxisCoordinate(table, offset + 3, center - 1.2, maximum);
  prepareAxisCoordinate(table, offset + 6, center + 1.2, maximum);
}

function prepareAxis(table: Float64Array, offset: number, coordinate: number, maximum: number): void {
  prepareFilteredAxis(table, offset, coordinate, maximum);
  prepareFilteredAxis(table, offset + 9, coordinate + 1.6, maximum);
  prepareFilteredAxis(table, offset + 18, coordinate - 1.6, maximum);
  prepareFilteredAxis(table, offset + 27, coordinate - 2.4, maximum);
  prepareFilteredAxis(table, offset + 36, coordinate + 2.4, maximum);
}

function samplePreparedHeight(
  field: VisualHeightfield,
  columns: Float64Array,
  xOffset: number,
  rows: Float64Array,
  yOffset: number,
): number {
  const x0 = columns[xOffset];
  const x1 = columns[xOffset + 1];
  const tx = columns[xOffset + 2];
  const y0 = rows[yOffset];
  const y1 = rows[yOffset + 1];
  const ty = rows[yOffset + 2];
  const stride = field.width + 1;
  const top = field.vertices[y0 * stride + x0] * (1 - tx) +
    field.vertices[y0 * stride + x1] * tx;
  const bottom = field.vertices[y1 * stride + x0] * (1 - tx) +
    field.vertices[y1 * stride + x1] * tx;
  return top * (1 - ty) + bottom * ty;
}

/** Original tent-filter sum order, with coordinate preparation reused. */
function filteredHeight(
  field: VisualHeightfield,
  columns: Float64Array,
  xOffset: number,
  rows: Float64Array,
  yOffset: number,
): number {
  const center = samplePreparedHeight(field, columns, xOffset, rows, yOffset) * 4;
  const cardinal =
    samplePreparedHeight(field, columns, xOffset + 3, rows, yOffset) +
    samplePreparedHeight(field, columns, xOffset + 6, rows, yOffset) +
    samplePreparedHeight(field, columns, xOffset, rows, yOffset + 3) +
    samplePreparedHeight(field, columns, xOffset, rows, yOffset + 6);
  return (center + cardinal) / 8;
}

function filteredGradient(
  field: VisualHeightfield,
  columns: Float64Array,
  xOffset: number,
  rows: Float64Array,
  yOffset: number,
): { dx: number; dy: number } {
  const derivativeRadius = 1.6;
  return {
    dx: (filteredHeight(field, columns, xOffset + 9, rows, yOffset) -
      filteredHeight(field, columns, xOffset + 18, rows, yOffset)) / (derivativeRadius * 2),
    dy: (filteredHeight(field, columns, xOffset, rows, yOffset + 9) -
      filteredHeight(field, columns, xOffset, rows, yOffset + 18)) / (derivativeRadius * 2),
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
  const columns = new Float64Array(width * AXIS_VALUES_PER_PIXEL);
  const rows = new Float64Array(height * AXIS_VALUES_PER_PIXEL);
  const preparedColumns = new Uint8Array(width);
  const preparedRows = new Uint8Array(height);
  let maximumGrade = 0;
  let shadedSamples = 0;

  for (let py = 0; py < height; py++) for (let px = 0; px < width; px++) {
    const x = (px + 0.5) / density;
    const y = (py + 0.5) / density;
    const terrain = sampleTerrain(tiles, field.width, field.height, x, y);
    const offset = (py * width + px) * 4;
    shadow[offset + 3] = 0;
    highlight[offset + 3] = 0;
    if (!isShadedLand(terrain)) continue;

    const xOffset = px * AXIS_VALUES_PER_PIXEL;
    const yOffset = py * AXIS_VALUES_PER_PIXEL;
    if (!preparedColumns[px]) {
      prepareAxis(columns, xOffset, x, field.width);
      preparedColumns[px] = 1;
    }
    if (!preparedRows[py]) {
      prepareAxis(rows, yOffset, y, field.height);
      preparedRows[py] = 1;
    }
    const { dx, dy } = filteredGradient(field, columns, xOffset, rows, yOffset);
    maximumGrade = Math.max(maximumGrade, Math.hypot(dx, dy));

    // Diffuse exposure is a two-dimensional surface property, not a stroke
    // following an elevation boundary. Broad normals carry the shoulder and
    // local sky occlusion carries its foot. Flat summits remain flat, with no
    // manufactured vertical face on the reverse bearing.
    const center = filteredHeight(field, columns, xOffset, rows, yOffset);
    const surround = (filteredHeight(field, columns, xOffset + 27, rows, yOffset) +
      filteredHeight(field, columns, xOffset + 36, rows, yOffset) +
      filteredHeight(field, columns, xOffset, rows, yOffset + 27) +
      filteredHeight(field, columns, xOffset, rows, yOffset + 36)) / 4;
    const exposure = (1 - 2.8 * (dx * .82 + dy * .57)) /
      Math.sqrt(1 + 7.84 * (dx * dx + dy * dy)) - 1;
    const shadowAlpha = Math.round(Math.min(100,
      Math.max(0, -exposure) * profile.shadow + Math.max(0, surround - center) * profile.ambientGrade,
    ));
    const highlightAlpha = Math.round(Math.min(22, Math.max(0, exposure) * profile.highlight * .45));
    if (shadowAlpha || highlightAlpha) shadedSamples++;
    shadow[offset] = 0;
    shadow[offset + 1] = 0;
    shadow[offset + 2] = 0;
    shadow[offset + 3] = shadowAlpha;
    highlight[offset] = 255;
    highlight[offset + 1] = 255;
    highlight[offset + 2] = 255;
    highlight[offset + 3] = highlightAlpha;
  }

  return { width, height, shadow, highlight, maximumGrade, shadedSamples };
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
