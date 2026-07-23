import { describe, expect, it } from "vitest";
import { buildIntentUnderlayTiles, buildTerrainContours, smoothClosedContour } from "./surfaceContours";

describe("continuous legacy terrain contours", () => {
  it("merges adjacent cells into one rounded component", () => {
    const contours = buildTerrainContours([
      "rough", "water", "water",
      "rough", "water", "rough",
      "rough", "rough", "rough",
    ], 3, 3);
    const water = contours.filter((contour) => contour.terrain === "water");
    expect(water).toHaveLength(1);
    expect(water[0].points.length).toBeGreaterThan(4);
    expect(water[0].points.some((point) => !Number.isInteger(point.x))).toBe(true);
  });

  it("keeps disconnected terrain islands separate", () => {
    const contours = buildTerrainContours([
      "water", "rough", "water",
      "rough", "rough", "rough",
    ], 3, 2);
    expect(contours.filter((contour) => contour.terrain === "water")).toHaveLength(2);
  });

  it("removes intent coverage from the legacy contour input", () => {
    const tiles = Array(9).fill("rough") as ("rough" | "water")[];
    tiles[4] = "water";
    const underlay = buildIntentUnderlayTiles(tiles, 3, 3, [{
      id: "surface-1",
      terrain: "water",
      order: 1,
      coverage: [4],
      geometry: { kind: "corridor", knots: [{ x: 1, y: 1 }, { x: 2, y: 2 }], width: 1 },
    }]);
    expect(underlay[4]).toBe("rough");
  });

  it("does not mutate source points while smoothing", () => {
    const source = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }];
    smoothClosedContour(source);
    expect(source).toEqual([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }]);
  });
});
