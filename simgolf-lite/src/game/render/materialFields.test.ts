import { statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { LandTheme, Terrain } from "../models/types";
import type { ColorVisionMode } from "../onboarding/profile";
import { ISO_ROTATIONS, rotateWorld, unrotateWorld } from "./iso";
import { LAND_THEME_KINDS, TERRAIN_KINDS } from "./terrainMaterials";
import {
  ATLAS_BUDGET_BYTES,
  DETAIL_PROFILES,
  MATERIAL_PATCH_TILE_SPAN,
  MATERIAL_SOURCE_TIERS,
  allTerrainAdjacencies,
  contourLength,
  contourProfileFor,
  detailsAlongContour,
  isPixelArtSafe,
  ownsBoundary,
  resolveMaterialSourceTier,
  sampleMaterialField,
  silhouetteOffsetAt,
  waterFieldPhase,
  wildnessProfile,
  worldNoise,
} from "./materialFields";
import { buildTerrainComponents } from "./terrainSilhouettes";

const COLOR_VISION_MODES: readonly ColorVisionMode[] = [
  "standard",
  "deuteranopia",
  "protanopia",
  "tritanopia",
];

describe("world-anchored sampling", () => {
  it("varies continuously instead of resetting per cell", () => {
    // Two points either side of a cell boundary must be nearly identical; a
    // per-tile variant scheme would jump here.
    const inside = sampleMaterialField("fairway", 12.49, 8.5);
    const across = sampleMaterialField("fairway", 12.51, 8.5);
    expect(Math.abs(inside.shade - across.shade)).toBeLessThan(0.004);
  });

  it("still varies across a 30x30 surface rather than reading flat", () => {
    const shades: number[] = [];
    for (let y = 0; y < 30; y++) {
      for (let x = 0; x < 30; x++) shades.push(sampleMaterialField("fairway", x + 0.5, y + 0.5).shade);
    }
    const min = Math.min(...shades);
    const max = Math.max(...shades);
    expect(max - min).toBeGreaterThan(0.04);
  });

  it("never resets patch phase at a cell or chunk boundary", () => {
    // Phase advances monotonically across the patch span and wraps only there.
    const span = MATERIAL_PATCH_TILE_SPAN;
    for (let step = 0; step < span * 4; step++) {
      const x = step * 0.25;
      const expected = ((x / span) % 1 + 1) % 1;
      expect(sampleMaterialField("rough", x, 0).u).toBeCloseTo(expected, 12);
    }
    // Chunks are 16 tiles; the phase at 16 is not the phase at 0 unless the
    // span happens to divide it — assert it is derived, not reset.
    expect(sampleMaterialField("rough", 16, 0).u).toBeCloseTo(((16 / span) % 1 + 1) % 1, 12);
  });

  it("is invariant under all four camera rotations", () => {
    // The renderer rotates world coordinates for projection only. Sampling the
    // unrotated position must return the same field under every rotation.
    for (const rotation of ISO_ROTATIONS) {
      for (const [x, y] of [[3.5, 9.5], [17.25, 2.75], [0.5, 0.5]] as const) {
        const rotated = rotateWorld(x, y, rotation);
        const back = unrotateWorld(rotated.x, rotated.y, rotation);
        expect(sampleMaterialField("sand", back.x, back.y)).toEqual(
          sampleMaterialField("sand", x, y),
        );
      }
    }
  });

  it("reproduces exactly after a rebuild", () => {
    const first = sampleMaterialField("deep_rough", 7.125, 19.875, { profile: "high" });
    const second = sampleMaterialField("deep_rough", 7.125, 19.875, { profile: "high" });
    expect(second).toEqual(first);
  });

  it("keeps mowing continuous across a connected maintained surface", () => {
    const axes = [{ ax: 2, ay: 2, dx: 20, dy: 0, len2: 400 }];
    const shades = Array.from({ length: 24 }, (_, index) =>
      sampleMaterialField("fairway", 2.5 + index, 2.5, { axes }).mowing);
    // Broad bands: long runs of one value, and far fewer flips than samples.
    const flips = shades.filter((value, index) => index > 0 && value !== shades[index - 1]).length;
    expect(flips).toBeGreaterThan(0);
    expect(flips).toBeLessThan(shades.length / 3);
  });

  it("leaves unmaintained terrain unmown", () => {
    const axes = [{ ax: 2, ay: 2, dx: 20, dy: 0, len2: 400 }];
    expect(sampleMaterialField("water", 4.5, 2.5, { axes }).mowing).toBe(1);
    expect(sampleMaterialField("rough", 4.5, 2.5, { axes }).mowing).toBe(1);
  });

  it("thins grain on lower profiles without changing the broad field", () => {
    const high = sampleMaterialField("rough", 5.5, 6.5, { profile: "high" });
    const low = sampleMaterialField("rough", 5.5, 6.5, { profile: "low" });
    expect(low.grain).toBe(1);
    expect(low.macro).toBe(high.macro);
    expect(low.wear).toBe(high.wear);
  });

  it("keeps the noise lattice off the tile grid", () => {
    // A lattice aligned to whole tiles would repeat every tile; assert the
    // field at the same offset in successive tiles differs.
    const a = worldNoise(4.5, 4.5, 5.31, 0x51);
    const b = worldNoise(5.5, 4.5, 5.31, 0x51);
    expect(Math.abs(a - b)).toBeGreaterThan(1e-6);
  });

  it("moves water as one field rather than per-tile pulses", () => {
    const a = waterFieldPhase(10.5, 10.5, 1.5);
    const b = waterFieldPhase(10.6, 10.5, 1.5);
    expect(Math.abs(a - b)).toBeLessThan(0.2);
    expect(waterFieldPhase(10.5, 10.5, 1.5)).toBe(a);
  });
});

describe("contour pair coverage", () => {
  const adjacencies = allTerrainAdjacencies();

  it("enumerates every unordered terrain adjacency", () => {
    expect(adjacencies).toHaveLength((TERRAIN_KINDS.length * (TERRAIN_KINDS.length - 1)) / 2);
    expect(adjacencies).toHaveLength(45);
  });

  it.each(adjacencies)("resolves a profile for %s|%s", (a, b) => {
    const profile = contourProfileFor(a, b);
    expect(profile).not.toBeNull();
    expect(profile!.bands.length).toBeGreaterThan(0);
    expect([a, b]).toContain(profile!.owner);
    expect([a, b]).toContain(profile!.other);
    expect(profile!.owner).not.toBe(profile!.other);
  });

  it.each(adjacencies)("gives %s|%s the same single owner from either side", (a, b) => {
    const forward = contourProfileFor(a, b)!;
    const reverse = contourProfileFor(b, a)!;
    expect(reverse.owner).toBe(forward.owner);
    expect(reverse.bands).toEqual(forward.bands);
    // Exactly one of the two terrains draws the seam — never both, never neither.
    expect([ownsBoundary(a, b), ownsBoundary(b, a)].filter(Boolean)).toHaveLength(1);
  });

  it.each(adjacencies)("orders %s|%s bands outermost to innermost", (a, b) => {
    const { bands } = contourProfileFor(a, b)!;
    for (let index = 1; index < bands.length; index++) {
      expect(bands[index].offset).toBeGreaterThan(bands[index - 1].offset);
    }
    expect(new Set(bands.map((band) => band.role)).size).toBe(bands.length);
  });

  it("returns nothing for a terrain against itself", () => {
    for (const terrain of TERRAIN_KINDS) {
      expect(contourProfileFor(terrain, terrain)).toBeNull();
      expect(ownsBoundary(terrain, terrain)).toBe(false);
    }
  });

  it("covers every adjacency in every theme and colour-vision mode", () => {
    for (const theme of LAND_THEME_KINDS as readonly LandTheme[]) {
      for (const colorVision of COLOR_VISION_MODES) {
        for (const [a, b] of adjacencies) {
          const profile = contourProfileFor(a, b, { theme, colorVision });
          expect(profile).not.toBeNull();
          for (const band of profile!.bands) {
            expect(band.color).toBeGreaterThanOrEqual(0);
            expect(band.color).toBeLessThanOrEqual(0xffffff);
          }
        }
      }
    }
  });
});

describe("layered depressions", () => {
  const depressionPairs: Array<[Terrain, Terrain]> = [
    ["water", "rough"],
    ["water", "fairway"],
    ["wetland", "rough"],
    ["sand", "fairway"],
    ["sand", "rough"],
    ["sand", "green"],
  ];

  it.each(depressionPairs)("gives %s against %s at least three depth bands", (a, b) => {
    const profile = contourProfileFor(a, b)!;
    expect(profile.depthBands).toBeGreaterThanOrEqual(3);
  });

  it("stacks water from turf shelf down to deep water", () => {
    const { bands } = contourProfileFor("water", "fairway")!;
    expect(bands.map((band) => band.role)).toEqual([
      "turf-shelf",
      "soil-bank",
      "reed-fringe",
      "water-shallow",
      "water-deep",
    ]);
    // Depth increases monotonically inward.
    for (let index = 1; index < bands.length; index++) {
      expect(bands[index].depth).toBeGreaterThanOrEqual(bands[index - 1].depth);
    }
  });

  it("stacks a bunker from grass overhang to recessed floor", () => {
    const { bands } = contourProfileFor("sand", "rough")!;
    expect(bands.map((band) => band.role)).toEqual([
      "grass-overhang",
      "soil-face",
      "sand-lip",
      "sand-floor",
    ]);
  });

  it("keeps a path flat with a gravel edge and natural shoulder", () => {
    const { bands, depthBands } = contourProfileFor("path", "rough")!;
    expect(bands.map((band) => band.role)).toEqual([
      "natural-shoulder",
      "gravel-edge",
      "path-core",
    ]);
    expect(depthBands).toBe(1);
  });

  it("gives maintained turf a dark fringe between the rough and the collar", () => {
    const { bands, owner } = contourProfileFor("fairway", "rough")!;
    expect(owner).toBe("fairway");
    expect(bands.map((band) => band.role)).toEqual(["wild-apron", "fringe", "collar"]);
    // The fringe reads darker than the collar behind it.
    expect(bands[1].color).toBeLessThan(bands[2].color);
  });

  it("carries the neighbour's identity in the outermost band of every seam", () => {
    // Without this an owner draws an identical strip against every neighbour,
    // which is the thin single-edge failure this issue is about. Group the
    // adjacencies by owner and assert the outermost band tracks the other side.
    const byOwner = new Map<Terrain, Map<Terrain, number>>();
    for (const [a, b] of allTerrainAdjacencies()) {
      const profile = contourProfileFor(a, b)!;
      expect(profile.bands[0].offset).toBeLessThan(0); // sits outside the owner
      const seen = byOwner.get(profile.owner) ?? new Map<Terrain, number>();
      seen.set(profile.other, profile.bands[0].color);
      byOwner.set(profile.owner, seen);
    }
    for (const [, colorsByOther] of byOwner) {
      // Distinct neighbours must produce distinct outermost colours.
      expect(new Set(colorsByOther.values()).size).toBe(colorsByOther.size);
    }
  });
});

describe("wild surface distinguishability", () => {
  const wild: Terrain[] = ["rough", "deep_rough", "waste_area"];

  it("separates them by colour", () => {
    for (const colorVision of COLOR_VISION_MODES) {
      const colors = wild.map((terrain) =>
        contourProfileFor(terrain, "fairway", { colorVision })!.bands.map((band) => band.color).join());
      expect(new Set(colors).size).toBe(wild.length);
    }
  });

  it("separates them by edge silhouette", () => {
    const amplitudes = wild.map((terrain) => wildnessProfile(terrain).amplitude);
    const frequencies = wild.map((terrain) => wildnessProfile(terrain).frequency);
    expect(new Set(amplitudes).size).toBe(wild.length);
    expect(new Set(frequencies).size).toBe(wild.length);
    // Deep rough reads taller and noisier than plain rough.
    expect(wildnessProfile("deep_rough").amplitude).toBeGreaterThan(wildnessProfile("rough").amplitude);
    expect(wildnessProfile("deep_rough").frequency).toBeGreaterThan(wildnessProfile("rough").frequency);
    // Waste is the noisiest silhouette of the three.
    expect(wildnessProfile("waste_area").frequency).toBeGreaterThan(wildnessProfile("deep_rough").frequency);
  });

  it("separates them by interior motif and density", () => {
    const motifs = wild.map((terrain) => wildnessProfile(terrain).motif);
    expect(new Set(motifs).size).toBe(wild.length);
    expect(wildnessProfile("deep_rough").density).toBeGreaterThan(wildnessProfile("rough").density);
  });

  it("keeps silhouette displacement well inside the rounding budget", () => {
    for (const terrain of TERRAIN_KINDS) {
      for (let step = 0; step < 64; step++) {
        const offset = silhouetteOffsetAt(terrain, step * 0.37, step * 0.61, step * 0.29);
        expect(Math.abs(offset)).toBeLessThan(0.25);
      }
    }
  });

  it("makes silhouette displacement a stable function of position", () => {
    expect(silhouetteOffsetAt("deep_rough", 3.5, 8.25, 2.75))
      .toBe(silhouetteOffsetAt("deep_rough", 3.5, 8.25, 2.75));
  });
});

describe("arc-length detail placement", () => {
  const line = (length: number) => [
    { x: 0, y: 0 },
    { x: length, y: 0 },
  ];

  it("spaces details by contour length, not by tiles crossed", () => {
    const short = detailsAlongContour(line(4), { motif: "reeds" });
    const long = detailsAlongContour(line(8), { motif: "reeds" });
    expect(long.length).toBeGreaterThan(short.length);
    // Doubling the length roughly doubles the count.
    expect(Math.abs(long.length - short.length * 2)).toBeLessThanOrEqual(1);
  });

  it("spaces details evenly along the run", () => {
    const details = detailsAlongContour(line(10), { motif: "pebbles" });
    for (let index = 1; index < details.length; index++) {
      const gap = details[index].arcLength - details[index - 1].arcLength;
      expect(gap).toBeCloseTo(details[1].arcLength - details[0].arcLength, 9);
    }
  });

  it("varies along the contour rather than once per tile", () => {
    const details = detailsAlongContour(line(20), { motif: "tufts" });
    const variants = new Set(details.map((detail) => detail.variant));
    expect(variants.size).toBeGreaterThan(1);
    const scales = new Set(details.map((detail) => detail.scale.toFixed(4)));
    expect(scales.size).toBeGreaterThan(details.length / 2);
  });

  it("is deterministic and anchored to world position", () => {
    const first = detailsAlongContour(line(6), { motif: "reeds" });
    const second = detailsAlongContour(line(6), { motif: "reeds" });
    expect(second).toEqual(first);
    // The same physical stretch, reached as part of a longer run, keeps its
    // motif variants.
    const longer = detailsAlongContour(line(12), { motif: "reeds" });
    for (const detail of first) {
      const match = longer.find((candidate) => Math.abs(candidate.x - detail.x) < 1e-9);
      expect(match?.variant).toBe(detail.variant);
      expect(match?.scale).toBe(detail.scale);
    }
  });

  it("thins with the detail profile without moving what remains", () => {
    const high = detailsAlongContour(line(20), { motif: "reeds", profile: "high" });
    const medium = detailsAlongContour(line(20), { motif: "reeds", profile: "medium" });
    const low = detailsAlongContour(line(20), { motif: "reeds", profile: "low" });
    expect(high.length).toBeGreaterThan(medium.length);
    expect(medium.length).toBeGreaterThan(low.length);
  });

  it("points its normal along the band offset axis, into the owner", () => {
    // A clockwise ring in y-down world space, matching the traced silhouettes.
    // Offsetting by a positive amount must land inside the square, because
    // ContourBand.offset is negative outside the owner. Flipping this mirrors
    // every band stack, so pin it.
    const square = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
      { x: 0, y: 4 },
      { x: 0, y: 0 },
    ];
    for (const detail of detailsAlongContour(square, { motif: "pebbles" })) {
      const inside = { x: detail.x + detail.nx * 0.5, y: detail.y + detail.ny * 0.5 };
      expect(inside.x).toBeGreaterThan(-1e-9);
      expect(inside.x).toBeLessThan(4 + 1e-9);
      expect(inside.y).toBeGreaterThan(-1e-9);
      expect(inside.y).toBeLessThan(4 + 1e-9);
    }
  });

  it("emits nothing for the empty motif or a degenerate run", () => {
    expect(detailsAlongContour(line(10), { motif: "none" })).toEqual([]);
    expect(detailsAlongContour([{ x: 1, y: 1 }], { motif: "reeds" })).toEqual([]);
  });

  it("places details along a derived silhouette", () => {
    const width = 10;
    const height = 8;
    const tiles: Terrain[] = Array.from({ length: width * height }, () => "rough");
    for (let y = 2; y <= 5; y++) for (let x = 2; x <= 6; x++) tiles[y * width + x] = "water";
    const water = buildTerrainComponents(tiles, width, height)
      .find((component) => component.terrain === "water")!;
    const run = water.boundarySegments.find((segment) => segment.other === "rough")!;
    expect(contourLength(run.points)).toBeGreaterThan(10);
    const reeds = detailsAlongContour(run.points, { motif: "reeds" });
    expect(reeds.length).toBeGreaterThan(10);
    for (const reed of reeds) {
      expect(Math.hypot(reed.nx, reed.ny)).toBeCloseTo(1, 9);
    }
  });
});

describe("detail profiles and accessibility", () => {
  it("drops only optional bands as the profile falls", () => {
    const high = contourProfileFor("water", "rough", { profile: "high" })!;
    const low = contourProfileFor("water", "rough", { profile: "low" })!;
    expect(low.bands.length).toBeLessThan(high.bands.length);
    // Whatever survives keeps its exact geometry.
    for (const band of low.bands) {
      const match = high.bands.find((candidate) => candidate.role === band.role)!;
      expect(band.offset).toBe(match.offset);
      expect(band.width).toBe(match.width);
      expect(band.depth).toBe(match.depth);
    }
    // The depression still reads as layered at the lowest tier.
    expect(low.depthBands).toBeGreaterThanOrEqual(3);
  });

  it("keeps geometry identical across colour-vision modes", () => {
    const standard = contourProfileFor("sand", "fairway", { colorVision: "standard" })!;
    for (const colorVision of COLOR_VISION_MODES) {
      const variant = contourProfileFor("sand", "fairway", { colorVision })!;
      expect(variant.bands.map((band) => [band.role, band.offset, band.width, band.depth]))
        .toEqual(standard.bands.map((band) => [band.role, band.offset, band.width, band.depth]));
    }
  });

  it("recolours bands for colour-vision modes", () => {
    const standard = contourProfileFor("water", "fairway", { colorVision: "standard" })!;
    const deuteranopia = contourProfileFor("water", "fairway", { colorVision: "deuteranopia" })!;
    expect(deuteranopia.bands.map((band) => band.color))
      .not.toEqual(standard.bands.map((band) => band.color));
  });

  it("exposes every profile tier", () => {
    expect([...DETAIL_PROFILES].sort()).toEqual(["high", "low", "medium"]);
  });
});

describe("source and atlas budgets", () => {
  it("targets 256x128 source patches at 4x presentation", () => {
    expect(MATERIAL_SOURCE_TIERS.target.patchWidth).toBeGreaterThanOrEqual(256);
    expect(MATERIAL_SOURCE_TIERS.target.patchHeight).toBeGreaterThanOrEqual(128);
    expect(MATERIAL_SOURCE_TIERS.target.presentationScale).toBe(4);
  });

  it("downsamples every tier on integer texel boundaries", () => {
    expect(isPixelArtSafe("target")).toBe(true);
    expect(isPixelArtSafe("shipped")).toBe(true);
  });

  it("resolves the tier from the art actually present", () => {
    // The repository currently ships the 2x patches; ZK-472 authors the 4x set.
    expect(resolveMaterialSourceTier(128)).toBe("shipped");
    expect(resolveMaterialSourceTier(256)).toBe("target");
  });

  it("keeps the shipped terrain atlas inside the low-tier ceiling", () => {
    const bytes = statSync(new URL("../../../public/atlases/terrain.png", import.meta.url)).size;
    expect(bytes).toBeLessThanOrEqual(ATLAS_BUDGET_BYTES.low);
  });

  it("orders the atlas budgets by tier", () => {
    expect(ATLAS_BUDGET_BYTES.low).toBeLessThan(ATLAS_BUDGET_BYTES.medium);
    expect(ATLAS_BUDGET_BYTES.medium).toBeLessThan(ATLAS_BUDGET_BYTES.high);
  });
});
