import { readFileSync } from "node:fs";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import {
  PARKLAND_COMPOSABLE_LOW_CONTRACT,
  PARKLAND_COMPOSABLE_SEMANTICS,
  activeParklandComposableDiagnostics,
  isParklandComposableSemantic,
  parklandComposableUv,
  suppressesLegacyComposableTurfContour,
  transformParklandCuePixels,
  usesParklandComposableMaterial,
} from "./parklandComposable";

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

  it("reports one undercoat, bounded semantic cues, and an outline-free Low path", () => {
    const diagnostics = activeParklandComposableDiagnostics("low", ["tee", "rough", "fairway", "rough"]);
    expect(diagnostics).toMatchObject({
      active: true,
      source: "approved-zk463-assets",
      undercoatDraws: 1,
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
          expect(transformed.metrics.maximumAlpha).toBe({ high: 12, medium: 10, low: 8 }[quality]);
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
        expect(transformed.metrics.lowFrequencyPlateScore).toBeLessThan(0.04);
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
});
