import { describe, expect, it } from "vitest";
import { worldToIso } from "../game/render/iso";
import { makeMinimapTransform, minimapCanvasPoint, minimapPointToWorld } from "../game/render/minimap";

describe("isometric minimap navigation", () => {
  it("round-trips north-up world points through the minimap transform", () => {
    const transform = makeMinimapTransform({ minX: 0, minY: 0, maxX: 63, maxY: 63 });
    for (const world of [{ x: 0, y: 0 }, { x: 18.25, y: 37.5 }, { x: 63, y: 63 }]) {
      const canvas = minimapCanvasPoint(worldToIso(world.x, world.y), transform);
      const actual = minimapPointToWorld(canvas, transform);
      expect(actual.x).toBeCloseTo(world.x, 5);
      expect(actual.y).toBeCloseTo(world.y, 5);
    }
  });
});
