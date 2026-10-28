import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { transpileModule, ModuleKind, ScriptTarget } from "typescript";
import type { LandTheme, Terrain } from "../models/types";
import { getBiomeDefinition } from "../models/biomes";
import { createParklandVisualReferenceCourse } from "../testing/referenceCourse";
import { buildVisualHeightfield, sampleVisualHeight } from "./landscapeGeometry";
import type { VisualHeightfield } from "./landscapeGeometry";
import { buildMacroLandformRaster } from "./macroLandform";
import type { MacroLandformRaster } from "./macroLandform";

// Frozen exact59 oracle, including imports/comments. Only import declarations
// are removed when compiling; the production sampler/biome resolver are injected.
const BASELINE_SOURCE = String.raw`import type { LandTheme, Terrain } from "../models/types";
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

/**
 * A small world-space tent filter. Applying it before differentiating keeps
 * slope light broad across authored ridges without turning a height step into
 * adjacent contour bands. The same coordinates are used at every rotation.
 */
function filteredHeight(field: VisualHeightfield, x: number, y: number): number {
  const center = sampleVisualHeight(field, x, y) * 4;
  const cardinal =
    sampleVisualHeight(field, x - 1.2, y) +
    sampleVisualHeight(field, x + 1.2, y) +
    sampleVisualHeight(field, x, y - 1.2) +
    sampleVisualHeight(field, x, y + 1.2);
  return (center + cardinal) / 8;
}

function filteredGradient(field: VisualHeightfield, x: number, y: number): { dx: number; dy: number } {
  const derivativeRadius = 1.6;
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
  let shadedSamples = 0;

  for (let py = 0; py < height; py++) for (let px = 0; px < width; px++) {
    const x = (px + 0.5) / density;
    const y = (py + 0.5) / density;
    const terrain = sampleTerrain(tiles, field.width, field.height, x, y);
    const offset = (py * width + px) * 4;
    shadow[offset + 3] = 0;
    highlight[offset + 3] = 0;
    if (!isShadedLand(terrain)) continue;

    const { dx, dy } = filteredGradient(field, x, y);
    maximumGrade = Math.max(maximumGrade, Math.hypot(dx, dy));

    // Diffuse exposure is a two-dimensional surface property, not a stroke
    // following an elevation boundary. Broad normals carry the shoulder and
    // local sky occlusion carries its foot. Flat summits remain flat, with no
    // manufactured vertical face on the reverse bearing.
    const center = filteredHeight(field, x, y);
    const surround = (filteredHeight(field, x - 2.4, y) + filteredHeight(field, x + 2.4, y) +
      filteredHeight(field, x, y - 2.4) + filteredHeight(field, x, y + 2.4)) / 4;
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
`;
const candidateSource = readFileSync(new URL("./macroLandform.ts", import.meta.url), "utf8");

function loadRaster(source: string, sampler = sampleVisualHeight, counters = {}) {
  const exports: { buildMacroLandformRaster?: typeof buildMacroLandformRaster } = {};
  const code = transpileModule(source.replace(/^import .*;\n/gm, ""), {
    compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 },
  }).outputText;
  new Function("exports", "getBiomeDefinition", "sampleVisualHeight", "counters", code)(
    exports, getBiomeDefinition, sampler, counters,
  );
  if (!exports.buildMacroLandformRaster) throw new Error("Missing frozen raster export");
  return exports.buildMacroLandformRaster;
}

function equalRaster(a: MacroLandformRaster, b: MacroLandformRaster): boolean {
  return a.width === b.width && a.height === b.height &&
    Object.is(a.maximumGrade, b.maximumGrade) && a.shadedSamples === b.shadedSamples &&
    Buffer.from(a.shadow).equals(Buffer.from(b.shadow)) &&
    Buffer.from(a.highlight).equals(Buffer.from(b.highlight));
}

it("retains the frozen raster and exact coordinate stream within its pre-counted call budget", () => {
  expect(createHash("sha256").update(BASELINE_SOURCE).digest("hex"))
    .toBe("d2b9d12f6bbcbfee166e84a539e2ac977b0953d378df64f8286355d455fbde03");
  const reference = createParklandVisualReferenceCourse();
  const field = (width: number, height: number, mode: "irregular" | "flat" | "step"): VisualHeightfield => ({
    width, height,
    vertices: Float32Array.from({ length: (width + 1) * (height + 1) }, (_, index) => (
      mode === "flat" ? 2 : mode === "step" ? (index % (width + 1) < width / 2 ? 0 : 2) :
        Math.sin(index * 1.21) * .71 + Math.cos(index * .31) * 2
    )),
  });
  const excluded: Terrain[] = ["sand", "waste_area", "water", "wetland", "path"];
  type RasterCase = { field: VisualHeightfield; tiles: Terrain[]; theme: LandTheme | undefined; density: number };
  const cases: RasterCase[] = [
    { field: buildVisualHeightfield(reference), tiles: reference.tiles, theme: reference.theme, density: 4 },
    { field: field(7, 5, "irregular"), tiles: new Array<Terrain>(35).fill("rough"), theme: "links", density: 3 },
    { field: field(9, 4, "step"), tiles: new Array<Terrain>(36).fill("rough"), theme: "desert", density: 8 },
    { field: field(3, 7, "flat"), tiles: new Array<Terrain>(21).fill("rough"), theme: undefined, density: 2 },
    { field: field(11, 3, "irregular"), tiles: Array.from({ length: 33 }, (_, i) => i % 2 ? "rough" : excluded[i % 5]), theme: "parkland", density: 4 },
    { field: field(5, 1, "irregular"), tiles: excluded, theme: "links", density: 3 },
    ...[-3, 99, 2.49, 3.5].map((density): RasterCase => ({
      field: field(2, 1, "irregular"), tiles: new Array<Terrain>(2).fill("rough"), theme: "desert", density,
    })),
  ];
  const mutants = [
    candidateSource.replace("prepareAxis(rows, yOffset, y, field.height)", "prepareAxis(rows, yOffset, x, field.height)"),
    candidateSource.replace("table[offset + 1] = Math.min(maximum, first + 1)", "table[offset + 1] = Math.min(maximum, first)"),
  ];
  // Ten pairs and two controls: no hidden baseline calls or later reruns.
  const plannedRasterCalls = cases.length * 2 + mutants.length;
  expect(plannedRasterCalls).toBe(22);
  expect(plannedRasterCalls).toBeLessThanOrEqual(24);
  let rasterCalls = 0;
  const saved: MacroLandformRaster[] = [];
  const instrumentation = candidateSource
    .replace("  const clamped =", "  counters.prepare(table, offset, coordinate);\n  const clamped =")
    .replace("  const x0 = columns[xOffset];", "  counters.sample(columns, xOffset, rows, yOffset);\n  const x0 = columns[xOffset];");
  expect(instrumentation).not.toBe(candidateSource);
  const ledger = [];
  for (const c of cases) {
    const density = Math.max(2, Math.min(8, Math.round(c.density)));
    const width = c.field.width * density, height = c.field.height * density;
    expect(width).toBeLessThanOrEqual(384);
    expect(height).toBeLessThanOrEqual(288);
    const before = JSON.stringify({ field: c.field, tiles: c.tiles });
    const baselineCoordinates = createHash("sha256"), candidateCoordinates = createHash("sha256");
    const coordinateBytes = Buffer.alloc(16);
    const record = (hash: ReturnType<typeof createHash>, x: number, y: number) => {
      coordinateBytes.writeDoubleLE(x, 0); coordinateBytes.writeDoubleLE(y, 8); hash.update(coordinateBytes);
    };
    let baselineSamples = 0, candidateSamples = 0, preparations = 0;
    const coordinates = new WeakMap<Float64Array, number[]>();
    const counters = {
      prepare(table: Float64Array, offset: number, coordinate: number) {
        preparations++;
        let values = coordinates.get(table);
        if (!values) { values = []; coordinates.set(table, values); }
        values[offset] = coordinate;
      },
      sample(columns: Float64Array, xOffset: number, rows: Float64Array, yOffset: number) {
        candidateSamples++;
        const x = coordinates.get(columns)?.[xOffset], y = coordinates.get(rows)?.[yOffset];
        if (x === undefined || y === undefined) throw new Error("Unprepared sample coordinate");
        record(candidateCoordinates, x, y);
      },
    };
    const original = loadRaster(BASELINE_SOURCE, (f, x, y) => {
      baselineSamples++; record(baselineCoordinates, x, y); return sampleVisualHeight(f, x, y);
    })(c.field, c.tiles, c.theme, c.density); rasterCalls++;
    const candidate = loadRaster(instrumentation, sampleVisualHeight, counters)(c.field, c.tiles, c.theme, c.density); rasterCalls++;
    saved.push(original);
    expect(equalRaster(original, candidate)).toBe(true);
    expect(baselineCoordinates.digest("hex")).toBe(candidateCoordinates.digest("hex"));
    expect(JSON.stringify({ field: c.field, tiles: c.tiles })).toBe(before);
    const eligiblePixels = c.tiles.filter((t) => !excluded.includes(t)).length * density * density;
    expect(baselineSamples).toBe(45 * eligiblePixels);
    expect(candidateSamples).toBe(baselineSamples);
    const usedColumns = new Set<number>(), usedRows = new Set<number>();
    c.tiles.forEach((terrain, cell) => {
      if (excluded.includes(terrain)) return;
      for (let i = 0; i < density; i++) {
        usedColumns.add((cell % c.field.width) * density + i);
        usedRows.add(Math.floor(cell / c.field.width) * density + i);
      }
    });
    expect(preparations).toBe(15 * (usedColumns.size + usedRows.size));
    expect(preparations).toBeLessThanOrEqual(15 * (width + height));
    if (eligiblePixels > 0) expect(preparations).toBeLessThan(2 * baselineSamples);
    else expect(preparations).toBe(0); // Two empty tables/flags still allocate: no zero-work benefit claim.
    ledger.push({ width, height, eligiblePixels, baselineSamples, preparations });
  }
  mutants.forEach((source) => {
    expect(source).not.toBe(candidateSource);
    const c = cases[1];
    const mutant = loadRaster(source)(c.field, c.tiles, c.theme, c.density); rasterCalls++;
    expect(equalRaster(saved[1], mutant)).toBe(false);
  });
  expect(rasterCalls).toBe(plannedRasterCalls);
  expect(readFileSync(new URL("./macroLandform.ts", import.meta.url), "utf8")).toBe(candidateSource);
  console.info("macro axis oracle ledger", JSON.stringify({ plannedRasterCalls, rasterCalls, ledger }));
});
