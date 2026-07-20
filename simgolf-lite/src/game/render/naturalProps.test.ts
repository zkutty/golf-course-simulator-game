import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { LandTheme, ObstacleType } from "../models/types";
import {
  NATURAL_PROP_FRAMES,
  NATURAL_PROP_REGISTRY,
  missingNaturalPropFrames,
  pickNaturalProp,
  shouldFadeTallProp,
} from "./naturalProps";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

describe("M21 natural-prop registry", () => {
  it("is complete for every theme and semantic obstacle type", () => {
    for (const theme of ["parkland", "links", "desert"] as const satisfies readonly LandTheme[]) {
      for (const type of ["tree", "bush", "rock"] as const satisfies readonly ObstacleType[]) {
        const variants = NATURAL_PROP_REGISTRY[theme][type];
        expect(variants.length).toBeGreaterThan(1);
        for (const variant of variants) {
          expect(variant.obstacleType).toBe(type);
          expect(variant.frame.startsWith(`${theme}_${type}_`)).toBe(true);
          expect(variant.scaleRange[0]).toBeLessThanOrEqual(variant.scaleRange[1]);
          expect(variant.shadow.radiusX).toBeGreaterThan(0);
          expect(variant.anchor).toEqual([0.5, 1]);
        }
      }
    }
    expect(new Set(NATURAL_PROP_FRAMES).size).toBe(NATURAL_PROP_FRAMES.length);
  });

  it("matches every registry entry to an authored atlas frame", () => {
    const atlas = JSON.parse(readFileSync(path.join(ROOT, "public/atlases/natural-props.json"), "utf8")) as { frames: Record<string, unknown> };
    expect(missingNaturalPropFrames((frame) => Boolean(atlas.frames[frame]))).toEqual([]);
    expect(Object.keys(atlas.frames).sort()).toEqual([...NATURAL_PROP_FRAMES].sort());
  });

  it("selects visual variants and scale deterministically without mutating obstacle data", () => {
    const obstacle = { x: 17, y: 23, type: "tree" as const };
    const context = { theme: "parkland" as const, runSeed: 210221, obstacle, terrain: "rough" as const, elevation: 2, nearWater: false, cultivated: false };
    const first = pickNaturalProp(context);
    expect(pickNaturalProp(context)).toEqual(first);
    expect(obstacle).toEqual({ x: 17, y: 23, type: "tree" });
    expect(first.scale).toBeGreaterThanOrEqual(first.variant.scaleRange[0]);
    expect(first.scale).toBeLessThanOrEqual(first.variant.scaleRange[1]);
    const frames = new Set(Array.from({ length: 80 }, (_, x) => pickNaturalProp({ ...context, obstacle: { ...obstacle, x } }).variant.frame));
    expect(frames.size).toBeGreaterThan(3);
  });

  it("uses ecological constraints and predictable parkland fallback", () => {
    const base = { runSeed: 9, terrain: "rough" as const, elevation: 1, cultivated: false };
    const find = (theme: LandTheme, type: ObstacleType, nearWater: boolean) =>
      Array.from({ length: 200 }, (_, x) => pickNaturalProp({ ...base, theme, nearWater, obstacle: { x, y: 7, type } }).variant.frame);
    expect(find("desert", "tree", true)).toContain("desert_tree_palm");
    expect(find("desert", "tree", false)).not.toContain("desert_tree_palm");
    expect(find("parkland", "bush", true)).toContain("parkland_bush_reeds");
    expect(find("links", "tree", false).every((frame) => frame.startsWith("links_tree_"))).toBe(true);
  });

  it("marks every tall canopy with a usable follow-selection fade", () => {
    const tall = Object.values(NATURAL_PROP_REGISTRY).flatMap((theme) => Object.values(theme).flat()).filter((variant) => variant.occlusion.tall);
    expect(tall.length).toBeGreaterThan(0);
    expect(tall.every((variant) => variant.occlusion.fadeAlpha > 0 && variant.occlusion.fadeAlpha <= 0.4)).toBe(true);
    expect(shouldFadeTallProp({ tall: true, propX: 100, propY: 120, propWidth: 50, propHeight: 100, focusX: 110, focusY: 90 })).toBe(true);
    expect(shouldFadeTallProp({ tall: true, propX: 100, propY: 70, propWidth: 50, propHeight: 100, focusX: 110, focusY: 90 })).toBe(false);
    expect(shouldFadeTallProp({ tall: false, propX: 100, propY: 120, propWidth: 50, propHeight: 100, focusX: 110, focusY: 90 })).toBe(false);
  });
});
