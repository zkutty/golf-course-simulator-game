import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import {
  PARKLAND_COMPOSABLE_LOW_CONTRACT,
  PARKLAND_COMPOSABLE_PATTERNS,
  PARKLAND_COMPOSABLE_SEMANTICS,
  PARKLAND_COMPOSABLE_WORLD_PERIOD_TILES,
  PARKLAND_MATERIAL_FIELD_SOURCE_HASHES,
  activeParklandComposableDiagnostics,
  isParklandComposableSemantic,
  parklandComposableUv,
  parklandCueTint,
  parklandSemanticFieldStyle,
  resolveParklandSemanticFieldSources,
  suppressesLegacyComposableTurfContour,
  transformParklandCuePixels,
  usesParklandComposableMaterial,
} from "./parklandComposable";

// Frozen from parklandComposable.ts at 28d866c (whole source SHA-256
// b81032940e7c6192b728d41aa89b0fac7d1de6913437639591c3abfd0c8e05ee).
// Keep this oracle independent of the optimized green-neighbor branch.
const ORIGINAL_MOTIF_ALPHA_CAPS = {
  high: { fairway: 20, rough: 64, deep_rough: 74, green: 74, tee: 76 },
  medium: { fairway: 20, rough: 58, deep_rough: 68, green: 68, tee: 72 },
  low: { fairway: 16, rough: 44, deep_rough: 56, green: 56, tee: 60 },
} as const;
const ORIGINAL_MOTIF_SIGNAL_GAINS = {
  fairway: 1, rough: 1, deep_rough: 1, green: 1, tee: 1,
} as const;
type MotifSemantic = typeof PARKLAND_COMPOSABLE_SEMANTICS[number];
type MotifQuality = "high" | "medium" | "low";
function originalBoundaryEnergy(alpha: Uint8ClampedArray, width: number, height: number): number {
  let energy = 0;
  let samples = 0;
  for (let step = 1; step < PARKLAND_COMPOSABLE_WORLD_PERIOD_TILES; step++) {
    const x = Math.round(step * width / PARKLAND_COMPOSABLE_WORLD_PERIOD_TILES);
    const y = Math.round(step * height / PARKLAND_COMPOSABLE_WORLD_PERIOD_TILES);
    if (x > 0 && x < width) for (let row = 0; row < height; row++) {
      energy += Math.abs(alpha[row * width + x] - alpha[row * width + x - 1]);
      samples++;
    }
    if (y > 0 && y < height) for (let column = 0; column < width; column++) {
      energy += Math.abs(alpha[y * width + column] - alpha[(y - 1) * width + column]);
      samples++;
    }
  }
  return samples === 0 ? 0 : energy / samples / 255;
}
function originalTransform(
  source: ArrayLike<number>, width: number, height: number,
  semantic: MotifSemantic, quality: MotifQuality,
) {
  if (source.length !== width * height * 4) throw new Error("invalid Parkland cue dimensions");
  let alphaFloor = 255;
  for (let offset = 3; offset < source.length; offset += 4) alphaFloor = Math.min(alphaFloor, source[offset]);
  const output = new Uint8ClampedArray(source.length);
  const alpha = new Uint8ClampedArray(width * height);
  const cap = ORIGINAL_MOTIF_ALPHA_CAPS[quality][semantic];
  let nonZero = 0;
  let alphaTotal = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const pixel = y * width + x;
    const offset = pixel * 4;
    const sourceAlpha = source[offset + 3];
    let colorOffset = offset;
    let motifAlpha = sourceAlpha;
    if (semantic === "green") for (const [sampleX, sampleY] of [
      [x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1],
    ] as const) {
      const sampleOffset = ((sampleY + height) % height * width + (sampleX + width) % width) * 4;
      if (source[sampleOffset + 3] <= motifAlpha) continue;
      motifAlpha = source[sampleOffset + 3];
      colorOffset = sampleOffset;
    }
    const residual = motifAlpha - alphaFloor;
    const signal = residual <= (quality === "low" ? 3 : 2)
      ? 0
      : Math.min(cap, Math.round(residual * ORIGINAL_MOTIF_SIGNAL_GAINS[semantic]));
    output[offset] = source[colorOffset];
    output[offset + 1] = source[colorOffset + 1];
    output[offset + 2] = source[colorOffset + 2];
    output[offset + 3] = signal;
    alpha[pixel] = signal;
    if (signal > 0) nonZero++;
    alphaTotal += signal;
  }
  return {
    pixels: output,
    metrics: {
      semantic,
      pattern: PARKLAND_COMPOSABLE_PATTERNS[semantic],
      sourceAlphaFloor: alphaFloor,
      outputAlphaFloor: 0,
      maximumAlpha: cap,
      nonZeroAlphaFraction: nonZero / Math.max(1, width * height),
      lowFrequencyPlateScore: alphaTotal / Math.max(1, width * height) / 255,
      tileBoundaryEdgeEnergy: originalBoundaryEnergy(alpha, width, height),
      motifExpansionPixels: semantic === "green" ? 1 : 0,
    },
  };
}

function expectOriginalCueTransform(
  source: ArrayLike<number>, width: number, height: number,
  semantic: MotifSemantic, quality: MotifQuality,
) {
  const expected = originalTransform(source, width, height, semantic, quality);
  const actual = transformParklandCuePixels(source, width, height, semantic, quality);
  const actualBytes = Buffer.from(actual.pixels.buffer, actual.pixels.byteOffset, actual.pixels.byteLength);
  const expectedBytes = Buffer.from(expected.pixels.buffer, expected.pixels.byteOffset, expected.pixels.byteLength);
  expect(actualBytes.equals(expectedBytes)).toBe(true);
  expect(actual.metrics).toStrictEqual(expected.metrics);
}

describe("Parkland cue transform exact-output fast path", () => {
  it("matches frozen original bytes and metrics for every approved atlas", () => {
    for (const quality of ["high", "medium", "low"] as const) {
      for (const semantic of PARKLAND_COMPOSABLE_SEMANTICS) {
        const png = PNG.sync.read(readFileSync(new URL(
          `../../assets/terrain/parkland-composable-v1/${quality}/semantic-${semantic}.png`,
          import.meta.url,
        )));
        // PNG.data is a Buffer. Browser ImageData.data is Uint8ClampedArray.
        const source = new Uint8ClampedArray(png.data);
        const inputHash = createHash("sha256").update(source).digest("hex");
        expectOriginalCueTransform(source, png.width, png.height, semantic, quality);
        expect(createHash("sha256").update(source).digest("hex")).toBe(inputHash);
      }
    }
  });

  it("preserves row wraps, one-pixel dimensions, strict ties, alpha thresholds and caps", () => {
    for (const [width, height] of [[0, 0], [0, 1], [1, 0], [1, 1], [1, 7], [7, 1], [2, 2], [3, 5], [8, 8], [17, 11]]) {
      for (let seed = 0; seed < 4; seed++) {
        const source = new Uint8ClampedArray(width * height * 4);
        let random = 0x9e3779b9 ^ (width * 31 + height * 17 + seed);
        for (let pixel = 0; pixel < width * height; pixel++) {
          const offset = pixel * 4;
          random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
          source[offset] = random & 255;
          source[offset + 1] = (random >>> 8) & 255;
          source[offset + 2] = (random >>> 16) & 255;
          source[offset + 3] = [0, 1, 2, 3, 4, 20, 74, 76, 255][(pixel * 3 + seed) % 9];
        }
        for (const quality of ["high", "medium", "low"] as const) {
          for (const semantic of PARKLAND_COMPOSABLE_SEMANTICS) {
            expectOriginalCueTransform(source, width, height, semantic, quality);
          }
        }
      }
    }
    const ties = new Uint8ClampedArray([
      10, 20, 30, 50, 40, 50, 60, 50,
      70, 80, 90, 50, 100, 110, 120, 50,
    ]);
    expectOriginalCueTransform(ties, 2, 2, "green", "high");
  });

  it("retains the original fallback's getter order, mutations and errors", () => {
    const makeSource = (reads: number[], throwsAt = -1): ArrayLike<number> => {
      const values = [20, 40, 60, 5, 80, 100, 120, 20, 140, 160, 180, 20, 200, 220, 240, 2];
      return new Proxy({ length: values.length } as ArrayLike<number>, {
        get(target, property) {
          if (property === "length") return target.length;
          const index = Number(property);
          if (Number.isInteger(index) && index >= 0) {
            reads.push(index);
            if (index === throwsAt) throw new Error("indexed read failure");
            if (reads.length === 8) values[7] = 255;
            return values[index];
          }
          return undefined;
        },
      });
    };
    for (const throwsAt of [-1, 7]) {
      const originalReads: number[] = [];
      const actualReads: number[] = [];
      const originalSource = makeSource(originalReads, throwsAt);
      const actualSource = makeSource(actualReads, throwsAt);
      if (throwsAt < 0) {
        const expected = originalTransform(originalSource, 2, 2, "green", "high");
        const actual = transformParklandCuePixels(actualSource, 2, 2, "green", "high");
        expect(actual.pixels).toStrictEqual(expected.pixels);
        expect(actual.metrics).toStrictEqual(expected.metrics);
      } else {
        expect(() => originalTransform(originalSource, 2, 2, "green", "high"))
          .toThrow("indexed read failure");
        expect(() => transformParklandCuePixels(actualSource, 2, 2, "green", "high"))
          .toThrow("indexed read failure");
      }
      expect(actualReads).toStrictEqual(originalReads);
    }
    const invalid = new Uint8ClampedArray(15);
    expect(() => originalTransform(invalid, 2, 2, "green", "high"))
      .toThrow("invalid Parkland cue dimensions");
    expect(() => transformParklandCuePixels(invalid, 2, 2, "green", "high"))
      .toThrow("invalid Parkland cue dimensions");
  });
});

const TEST_COLORS = {
  fairway: 0x4fa64f,
  rough: 0x4a8547,
  deep_rough: 0x356d37,
  green: 0x63bd5a,
  tee: 0x70b65b,
} as const;

function finalSurfaceMetrics(
  quality: "high" | "medium",
  semantic: typeof PARKLAND_COMPOSABLE_SEMANTICS[number],
  useAuthoritativeField: boolean,
) {
  const field = PNG.sync.read(readFileSync(new URL(
    `../../assets/terrain/fields/parkland/${quality}/${semantic}.png`,
    import.meta.url,
  )));
  const undercoat = PNG.sync.read(readFileSync(new URL(
    `../../assets/terrain/parkland-composable-v1/${quality}/undercoat.png`,
    import.meta.url,
  )));
  const cue = PNG.sync.read(readFileSync(new URL(
    `../../assets/terrain/parkland-composable-v1/${quality}/semantic-${semantic}.png`,
    import.meta.url,
  )));
  const transformed = transformParklandCuePixels(cue.data, cue.width, cue.height, semantic, quality);
  const tint = parklandCueTint(semantic, TEST_COLORS[semantic], true);
  const tintChannels = [(tint >> 16) & 0xff, (tint >> 8) & 0xff, tint & 0xff] as const;
  const pixels = new Uint8ClampedArray(field.width * field.height * 4);
  const source = useAuthoritativeField ? field : undercoat;
  for (let y = 0; y < field.height; y++) for (let x = 0; x < field.width; x++) {
    const offset = (y * field.width + x) * 4;
    const sourceX = Math.floor(x * source.width / field.width) % source.width;
    const sourceY = Math.floor(y * source.height / field.height) % source.height;
    const sourceOffset = (sourceY * source.width + sourceX) * 4;
    const cueX = Math.floor(x * cue.width / field.width) % cue.width;
    const cueY = Math.floor(y * cue.height / field.height) % cue.height;
    const cueOffset = (cueY * cue.width + cueX) * 4;
    const alpha = transformed.pixels[cueOffset + 3] / 255;
    for (let channel = 0; channel < 3; channel++) {
      const ink = transformed.pixels[cueOffset + channel] * tintChannels[channel] / 255;
      pixels[offset + channel] = Math.round(
        ink * alpha + source.data[sourceOffset + channel] * (1 - alpha),
      );
    }
    pixels[offset + 3] = 255;
  }
  const luminance = (x: number, y: number) => {
    const offset = (y * field.width + x) * 4;
    return pixels[offset] * 0.2126 + pixels[offset + 1] * 0.7152 + pixels[offset + 2] * 0.0722;
  };
  let total = 0;
  let squaredTotal = 0;
  let gradientTotal = 0;
  let gradientSamples = 0;
  for (let y = 0; y < field.height; y++) for (let x = 0; x < field.width; x++) {
    const value = luminance(x, y);
    total += value;
    squaredTotal += value ** 2;
    if (x + 1 < field.width) {
      gradientTotal += Math.abs(value - luminance(x + 1, y));
      gradientSamples++;
    }
    if (y + 1 < field.height) {
      gradientTotal += Math.abs(value - luminance(x, y + 1));
      gradientSamples++;
    }
  }
  const count = field.width * field.height;
  const mean = total / count;
  return {
    mean,
    rmsContrast: Math.sqrt(squaredTotal / count - mean ** 2),
    gradientEnergy: gradientTotal / gradientSamples,
  };
}

describe("ZK-461 Parkland common-phase material contract", () => {
  it("activates only for Parkland while covering every approved quality", () => {
    for (const quality of ["high", "medium", "low"] as const) {
      expect(usesParklandComposableMaterial("parkland", quality)).toBe(true);
      expect(usesParklandComposableMaterial("links", quality)).toBe(false);
      expect(usesParklandComposableMaterial("desert", quality)).toBe(false);
    }
  });

  it("keeps source phase in unrotated world coordinates", () => {
    expect(parklandComposableUv(0, 0)).toEqual([0, 0]);
    expect(parklandComposableUv(8, 8)).toEqual([1, 1]);
    expect(parklandComposableUv(2.5, 6)).toEqual([0.3125, 0.75]);
  });

  it("limits compositing to the five approved turf semantics", () => {
    expect(PARKLAND_COMPOSABLE_SEMANTICS).toEqual(["fairway", "rough", "deep_rough", "green", "tee"]);
    expect(isParklandComposableSemantic("deep_rough")).toBe(true);
    expect(isParklandComposableSemantic("sand")).toBe(false);
    expect(isParklandComposableSemantic("path")).toBe(false);
  });

  it("selects complete authoritative fields only for Standard High/Medium", () => {
    const fields = Object.fromEntries(PARKLAND_COMPOSABLE_SEMANTICS.map((semantic) => [
      semantic,
      { semantic, destroyed: false },
    ]));
    const lookup = (semantic: typeof PARKLAND_COMPOSABLE_SEMANTICS[number]) => fields[semantic];
    const selected = resolveParklandSemanticFieldSources("medium", true, false, lookup);
    expect(selected).not.toBeNull();
    for (const semantic of PARKLAND_COMPOSABLE_SEMANTICS) {
      expect(selected?.[semantic]).toBe(fields[semantic]);
    }
    expect(resolveParklandSemanticFieldSources("low", true, false, lookup)).toBeNull();
    expect(resolveParklandSemanticFieldSources("high", false, false, lookup)).toBeNull();
    expect(resolveParklandSemanticFieldSources("high", true, true, lookup)).toBeNull();
    expect(resolveParklandSemanticFieldSources("high", true, false, (semantic) => (
      semantic === "rough" ? { semantic, destroyed: true } : fields[semantic]
    ))).toBeNull();
  });

  it("composites deterministic ZK-1203 material energy and rejects the undercoat negative", () => {
    for (const quality of ["high", "medium"] as const) {
      const final = Object.fromEntries(PARKLAND_COMPOSABLE_SEMANTICS.map((semantic) => [
        semantic,
        finalSurfaceMetrics(quality, semantic, true),
      ]));
      const negative = Object.fromEntries(PARKLAND_COMPOSABLE_SEMANTICS.map((semantic) => [
        semantic,
        finalSurfaceMetrics(quality, semantic, false),
      ]));
      const finalMeans = PARKLAND_COMPOSABLE_SEMANTICS.map((semantic) => final[semantic].mean);
      const negativeMeans = PARKLAND_COMPOSABLE_SEMANTICS.map((semantic) => negative[semantic].mean);
      expect(Math.max(...finalMeans) - Math.min(...finalMeans), `${quality}:field family separation`)
        .toBeGreaterThan(65);
      expect(Math.max(...negativeMeans) - Math.min(...negativeMeans), `${quality}:negative separation`)
        .toBeLessThan(3);
      for (const semantic of PARKLAND_COMPOSABLE_SEMANTICS) {
        expect(final[semantic].rmsContrast, `${quality}:${semantic}:final contrast`).toBeGreaterThan(4);
        expect(final[semantic].gradientEnergy, `${quality}:${semantic}:final detail`).toBeGreaterThan(0.2);
      }
    }
  });

  it("pins the exact authoritative material-field source bytes in diagnostics", () => {
    for (const quality of ["high", "medium"] as const) for (const semantic of PARKLAND_COMPOSABLE_SEMANTICS) {
      const bytes = readFileSync(new URL(
        `../../assets/terrain/fields/parkland/${quality}/${semantic}.png`,
        import.meta.url,
      ));
      expect(createHash("sha256").update(bytes).digest("hex"))
        .toBe(PARKLAND_MATERIAL_FIELD_SOURCE_HASHES[quality][semantic]);
    }
    const diagnostics = activeParklandComposableDiagnostics(
      "medium",
      PARKLAND_COMPOSABLE_SEMANTICS,
      5,
      [],
      undefined,
      null,
      PARKLAND_COMPOSABLE_SEMANTICS,
    );
    expect(diagnostics).toMatchObject({
      semanticFieldDraws: 5,
      semanticComposition: "zk1203-material-fields-with-motif-detail",
      motifOnly: false,
    });
    expect(diagnostics.materialFieldSourceIds).toHaveLength(5);
    expect(diagnostics.materialFieldSourceHashes).toHaveLength(5);
    expect(new Set(diagnostics.materialFieldSourceHashes).size).toBe(5);
  });

  it("reports one undercoat, bounded semantic cues, and an outline-free Low path", () => {
    const diagnostics = activeParklandComposableDiagnostics("low", ["tee", "rough", "fairway", "rough"]);
    expect(diagnostics).toMatchObject({
      active: true,
      source: "approved-zk463-assets",
      undercoatDraws: 1,
      semanticFieldDraws: 0,
      semanticCueDraws: 3,
      semantics: ["fairway", "rough", "tee"],
      independentPerCellPhase: false,
      samePresentationEmitters: 0,
      emittedLegacyTurfContourRuns: 0,
      fullCellOutlines: false,
      legacyDiamondTopPlane: false,
      lowContract: PARKLAND_COMPOSABLE_LOW_CONTRACT,
    });
    expect(new Set(diagnostics.sourceIds).size).toBe(diagnostics.sourceIds.length);
    expect(diagnostics.sourceHashes).toHaveLength(diagnostics.sourceIds.length);
    expect(diagnostics.sourceHashes.every((hash) => /^[a-f0-9]{64}$/u.test(hash))).toBe(true);
  });

  it("suppresses only obsolete composable-turf ribbons", () => {
    expect(suppressesLegacyComposableTurfContour("parkland", "medium", "deep_rough", "rough")).toBe(true);
    expect(suppressesLegacyComposableTurfContour("parkland", "low", "green", "fairway")).toBe(true);
    expect(suppressesLegacyComposableTurfContour("parkland", "medium", "water", "rough")).toBe(false);
    expect(suppressesLegacyComposableTurfContour("parkland", "medium", "path", "rough")).toBe(false);
    expect(suppressesLegacyComposableTurfContour("links", "medium", "green", "rough")).toBe(false);
  });

  it("removes every semantic alpha floor while keeping fairway mowing broad and subordinate", () => {
    const signatures = new Set<string>();
    for (const quality of ["high", "medium", "low"] as const) {
      for (const semantic of PARKLAND_COMPOSABLE_SEMANTICS) {
        const source = PNG.sync.read(readFileSync(new URL(
          `../../assets/terrain/parkland-composable-v1/${quality}/semantic-${semantic}.png`,
          import.meta.url,
        )));
        const transformed = transformParklandCuePixels(
          source.data,
          source.width,
          source.height,
          semantic,
          quality,
        );
        expect(transformed.metrics.sourceAlphaFloor).toBeGreaterThan(0);
        expect(transformed.metrics.outputAlphaFloor).toBe(0);
        expect(transformed.metrics.maximumAlpha).toBeLessThanOrEqual(76);
        if (semantic === "fairway") {
          expect(transformed.metrics.nonZeroAlphaFraction).toBeGreaterThan(0.35);
          expect(transformed.metrics.nonZeroAlphaFraction).toBeLessThan(0.45);
          expect(transformed.metrics.maximumAlpha).toBe({ high: 20, medium: 20, low: 16 }[quality]);
          let interiorPixels = 0;
          const alphaAt = (x: number, y: number) => transformed.pixels[(y * source.width + x) * 4 + 3];
          for (let y = 1; y < source.height - 1; y++) for (let x = 1; x < source.width - 1; x++) {
            if (alphaAt(x, y) > 0 && alphaAt(x - 1, y) > 0 && alphaAt(x + 1, y) > 0
              && alphaAt(x, y - 1) > 0 && alphaAt(x, y + 1) > 0) interiorPixels++;
          }
          expect(interiorPixels / (source.width * source.height)).toBeGreaterThan(0.28);
        } else {
          expect(transformed.metrics.nonZeroAlphaFraction).toBeLessThan(0.23);
        }
        expect(
          transformed.metrics.lowFrequencyPlateScore,
          `${quality}:${semantic}`,
        ).toBeLessThan(0.04);
        expect(transformed.metrics.tileBoundaryEdgeEnergy).toBeLessThan(0.025);
        expect(transformed.metrics.motifExpansionPixels).toBe(semantic === "green" ? 1 : 0);
        expect(Math.min(...transformed.pixels.filter((_, offset) => offset % 4 === 3))).toBe(0);
        signatures.add(transformed.metrics.pattern);
      }
    }
    expect(signatures.size).toBe(PARKLAND_COMPOSABLE_SEMANTICS.length);
  });

  it("keeps Low as the same motif language at a reduced alpha budget", () => {
    const source = new Uint8ClampedArray(8 * 8 * 4);
    for (let offset = 0; offset < source.length; offset += 4) {
      source[offset] = 120;
      source[offset + 1] = 150;
      source[offset + 2] = 90;
      source[offset + 3] = offset % 16 === 0 ? 150 : 50;
    }
    const high = transformParklandCuePixels(source, 8, 8, "tee", "high");
    const low = transformParklandCuePixels(source, 8, 8, "tee", "low");
    expect(low.metrics.pattern).toBe(high.metrics.pattern);
    expect(low.metrics.maximumAlpha).toBeLessThan(high.metrics.maximumAlpha);
    expect(low.metrics.lowFrequencyPlateScore).toBeLessThan(high.metrics.lowFrequencyPlateScore);
  });

  it("keeps connected maintained fields legible at Medium without outlining cells", () => {
    const colors = {
      fairway: 0x4fa64f,
      rough: 0x4a8547,
      deep_rough: 0x356d37,
      green: 0x63bd5a,
      tee: 0x70b65b,
    } as const;
    const field = Object.fromEntries(PARKLAND_COMPOSABLE_SEMANTICS.map((semantic) => [
      semantic,
      parklandSemanticFieldStyle("medium", semantic, colors[semantic]),
    ]));
    expect(field.rough.alpha).toBeLessThan(0.02);
    expect(field.fairway.alpha).toBeGreaterThanOrEqual(0.2);
    expect(field.green.alpha).toBeGreaterThan(field.fairway.alpha);
    expect(field.tee.alpha).toBeGreaterThan(field.fairway.alpha);
    expect(field.deep_rough.alpha).toBeGreaterThanOrEqual(0.4);
    expect(field.fairway.blendMode).toBe("screen");
    expect(field.green.blendMode).toBe("screen");
    expect(field.tee.blendMode).toBe("screen");
    expect(field.rough.blendMode).toBe("normal");
    expect(field.deep_rough.blendMode).toBe("normal");
    expect(new Set(Object.values(field).map(({ tint }) => tint)).size).toBe(5);
    expect(PARKLAND_COMPOSABLE_LOW_CONTRACT.fullCellOutlines).toBe(false);
  });
});
