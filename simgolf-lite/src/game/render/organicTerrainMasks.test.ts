import { describe, expect, it } from "vitest";
import type { Terrain } from "../models/types";
import { buildLandscapeComponents } from "./landscapeGeometry";
import { buildOrganicTerrainMaskRings, usesOrganicTerrainMask } from "./organicTerrainMasks";

describe("organic small-material presentation masks", () => {
  it("keeps singleton and small deep rough/waste patches deterministic and inside their authoritative cells", () => {
    const width = 5;
    const tiles: Terrain[] = [
      "rough", "rough", "rough", "rough", "rough",
      "rough", "deep_rough", "rough", "waste_area", "rough",
      "rough", "deep_rough", "rough", "waste_area", "rough",
      "rough", "rough", "rough", "rough", "rough",
      "rough", "rough", "deep_rough", "rough", "rough",
    ];
    const components = buildLandscapeComponents(tiles, width, 5).filter((component) =>
      usesOrganicTerrainMask(component.terrain, component.cells.length),
    );
    expect(components).toHaveLength(3);
    for (const component of components) {
      const first = buildOrganicTerrainMaskRings(component.rings, component.cells, width, component.topologyKey);
      const second = buildOrganicTerrainMaskRings(component.rings, component.cells, width, component.topologyKey);
      expect(second).toEqual(first);
      expect(first.length).toBeGreaterThan(0);
      const owned = new Set(component.cells);
      for (const point of first.flat()) {
        expect(owned.has(Math.floor(point.y + 1e-7) * width + Math.floor(point.x + 1e-7))).toBe(true);
      }
      const xs = first.flat().map((point) => point.x);
      const ys = first.flat().map((point) => point.y);
      expect(Math.max(...xs) - Math.min(...xs)).not.toBeCloseTo(Math.max(...ys) - Math.min(...ys), 4);
    }
  });

  it("does not apply the presentation treatment to large or unrelated material components", () => {
    expect(usesOrganicTerrainMask("deep_rough", 5)).toBe(false);
    expect(usesOrganicTerrainMask("waste_area", 5)).toBe(false);
    expect(usesOrganicTerrainMask("sand", 1)).toBe(false);
    expect(usesOrganicTerrainMask("path", 1)).toBe(false);
  });
});
