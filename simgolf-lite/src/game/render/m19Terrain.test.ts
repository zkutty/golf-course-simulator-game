import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { AUTOTILE_DIRECTIONS, autotileFeatures, rotateAutotileMask } from "./autotile";
import {
  LAND_THEME_KINDS,
  TERRAIN_KINDS,
  TERRAIN_MATERIALS,
  getTerrainMaterial,
  mowingShadeAt,
  pickTerrainBaseFrame,
  terrainBoundaryFor,
  waterShimmerPhase,
} from "./terrainMaterials";

describe("M19 terrain material registry", () => {
  it("is complete for every land theme and terrain", () => {
    for (const theme of LAND_THEME_KINDS) {
      expect(Object.keys(TERRAIN_MATERIALS[theme]).sort()).toEqual([...TERRAIN_KINDS].sort());
      for (const terrain of TERRAIN_KINDS) expect(getTerrainMaterial(theme, terrain).id).toBe(`${theme}.${terrain}`);
    }
  });

  it("ships authored M21 material frames for every biome", () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
    const atlas = JSON.parse(readFileSync(path.join(root, "public/atlases/terrain.json"), "utf8")) as { frames: Record<string, unknown> };
    for (const theme of LAND_THEME_KINDS) for (const terrain of TERRAIN_KINDS) {
      const material = getTerrainMaterial(theme, terrain);
      expect(material.source).toBe("atlas-2x");
      for (const base of material.baseFrames) expect(atlas.frames[base.frame]).toBeTruthy();
      for (const feature of Object.values(material.transitionFrames).flatMap((frames) => Object.values(frames))) expect(atlas.frames[feature]).toBeTruthy();
    }
  });

  it("selects authored base variants deterministically", () => {
    const material = getTerrainMaterial("parkland", "fairway");
    expect(pickTerrainBaseFrame(material, 12, 9)).toBe(pickTerrainBaseFrame(material, 12, 9));
    expect(new Set(Array.from({ length: 100 }, (_, x) => pickTerrainBaseFrame(material, x, 7))).size).toBeGreaterThan(3);
  });

  it("anchors broad mowing bands to world-space route distance", () => {
    const axes = [{ ax: 0, ay: 8, dx: 36, dy: 0, len2: 36 * 36 }];
    const shades = Array.from({ length: 36 }, (_, x) => mowingShadeAt(x, 8, axes));
    expect(new Set(shades)).toEqual(new Set([0.98, 1.035]));
    expect(shades[0]).toBe(shades[1]);
    expect(shades[4]).not.toBe(shades[1]);
    // Crossing the renderer's 16-tile chunk boundary follows the same world
    // phase calculation rather than restarting a local pattern.
    expect(shades.slice(14, 19)).toEqual(
      [14, 15, 16, 17, 18].map((x) => mowingShadeAt(x, 8, axes)),
    );
    expect(mowingShadeAt(12, 8, axes)).toBe(mowingShadeAt(12, 8, axes));
  });

  it("assigns terrain-pair seams to one semantic edge owner", () => {
    const cases = [
      ["water", "green", "water", "shore"],
      ["wetland", "rough", "wetland", "shore"],
      ["sand", "fairway", "sand", "bunker-lip"],
      ["path", "rough", "path", "path-shoulder"],
      ["green", "rough", "green", "fringe"],
      ["fairway", "deep_rough", "fairway", "fringe"],
      ["deep_rough", "rough", "deep_rough", "natural-feather"],
    ] as const;
    for (const [a, b, owner, role] of cases) {
      expect(terrainBoundaryFor(a, b)).toEqual({ owner, role });
      expect(terrainBoundaryFor(b, a)).toEqual({ owner, role });
    }
    expect(terrainBoundaryFor("green", "green")).toBeNull();
  });

  it("keeps animated water phase coherent between neighboring tiles", () => {
    const phase = waterShimmerPhase(12, 9);
    expect(waterShimmerPhase(12, 9)).toBe(phase);
    expect(Math.abs(waterShimmerPhase(13, 9) - phase)).toBeLessThan(0.5);
    expect(Math.abs(waterShimmerPhase(12, 10) - phase)).toBeLessThan(0.5);
  });
});

describe("8-neighbor autotiling", () => {
  it("normalizes all 256 masks without duplicate frames", () => {
    for (let mask = 0; mask < 256; mask++) {
      const frames = autotileFeatures(mask).map((feature) => `${feature.kind}_${feature.direction}`);
      expect(new Set(frames).size).toBe(frames.length);
    }
  });

  it("rotates every mask reversibly through all four camera rotations", () => {
    for (let mask = 0; mask < 256; mask++) {
      let rotated = mask;
      for (let rotation = 0; rotation < 4; rotation++) rotated = rotateAutotileMask(rotated, 90);
      expect(rotated).toBe(mask);
      for (const rotation of [0, 90, 180, 270] as const) {
        expect(rotateAutotileMask(mask, rotation)).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("keeps every single direction represented after rotation", () => {
    for (let index = 0; index < AUTOTILE_DIRECTIONS.length; index++) {
      const rotated = rotateAutotileMask(1 << index, 90);
      expect(rotated).not.toBe(0);
      expect(rotated & (rotated - 1)).toBe(0);
    }
  });

  it("distinguishes convex tips from concave corners", () => {
    expect(autotileFeatures(1 << 1)).toContainEqual({ kind: "outer", direction: "ne" });
    expect(autotileFeatures((1 << 0) | (1 << 2))).toContainEqual({ kind: "inner", direction: "ne" });
  });
});
