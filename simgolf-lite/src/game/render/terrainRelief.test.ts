import { describe, expect, it } from "vitest";
import { hillReliefStrength, terrainReliefStyle, terrainSurfaceInsetPx } from "./terrainRelief";

describe("terrain relief presentation", () => {
  it("recesses hazards without changing maintained ground", () => {
    expect(terrainSurfaceInsetPx("water")).toBeGreaterThan(terrainSurfaceInsetPx("wetland"));
    expect(terrainSurfaceInsetPx("wetland")).toBeGreaterThan(terrainSurfaceInsetPx("sand"));
    expect(terrainSurfaceInsetPx("sand")).toBeGreaterThan(terrainSurfaceInsetPx("fairway"));
    expect(terrainSurfaceInsetPx("rough")).toBe(0);
  });

  it("provides biome-specific bank colors for every recessed surface", () => {
    for (const theme of ["parkland", "links", "desert"] as const) {
      for (const terrain of ["sand", "wetland", "water"] as const) {
        const style = terrainReliefStyle(theme, terrain);
        expect(style?.surfaceInsetPx).toBeGreaterThan(0);
        expect(style?.bankDark).not.toBe(style?.bankLight);
      }
    }
  });

  it("makes rolling relief strongest on Links terrain", () => {
    expect(hillReliefStrength("links")).toBeGreaterThan(hillReliefStrength("parkland"));
    expect(hillReliefStrength("parkland")).toBeGreaterThan(hillReliefStrength("desert"));
  });
});
