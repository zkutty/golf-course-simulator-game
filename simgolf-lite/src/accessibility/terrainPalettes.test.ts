import { describe, expect, it } from "vitest";
import { TERRAIN_PALETTES, terrainPattern } from "./terrainPalettes";

describe("accessible terrain palettes", () => {
  it("keeps every terrain distinct in each palette", () => {
    for (const palette of Object.values(TERRAIN_PALETTES)) expect(new Set(Object.values(palette)).size).toBe(8);
  });

  it("adds non-color distinctions to grass tiers", () => {
    expect(new Set([terrainPattern("fairway"), terrainPattern("rough"), terrainPattern("deep_rough")]).size).toBe(3);
  });
});
