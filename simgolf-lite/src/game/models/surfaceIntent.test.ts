import { describe, expect, it } from "vitest";
import { corridorFeature, normalizeSurfaceIntent, rasterizeSurfaceFeature, sampleCorridor, simplifySurfacePoints } from "./surfaceIntent";

describe("surface intent", () => {
  it("removes pointer stair-steps while preserving the authored bend", () => {
    const simplified = simplifySurfacePoints([
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 3, y: 1 },
      { x: 4, y: 3 },
      { x: 5, y: 5 },
      { x: 6, y: 5 },
      { x: 7, y: 5 },
    ], 0.8);
    expect(simplified[0]).toEqual({ x: 1, y: 1 });
    expect(simplified.at(-1)).toEqual({ x: 7, y: 5 });
    expect(simplified.length).toBeLessThan(7);
    expect(simplified.length).toBeGreaterThan(2);
  });

  it("samples and rasterizes a corridor deterministically", () => {
    const feature = corridorFeature(
      { width: 20 },
      "fairway",
      [{ x: 1.5, y: 1.5 }, { x: 5.5, y: 3.5 }, { x: 10.5, y: 2.5 }],
      1.25,
    );
    const first = rasterizeSurfaceFeature(feature, 20, 10);
    const second = rasterizeSurfaceFeature(feature, 20, 10);
    expect(second).toEqual(first);
    expect(first.length).toBeGreaterThan(8);
    expect(first).toContainEqual({ x: 1, y: 1 });
    expect(first).toContainEqual({ x: 10, y: 2 });
  });

  it("keeps fixed-step spline endpoints", () => {
    const points = sampleCorridor([{ x: 2, y: 3 }, { x: 7, y: 8 }]);
    expect(points[0]).toEqual({ x: 2, y: 3 });
    expect(points.at(-1)).toEqual({ x: 7, y: 8 });
  });

  it("rasterizes a closed region using center or quarter coverage", () => {
    const feature = {
      id: "surface-1",
      order: 1,
      terrain: "water" as const,
      coverage: [],
      geometry: {
        kind: "region" as const,
        ring: [{ x: 2.2, y: 2.2 }, { x: 6.8, y: 2.2 }, { x: 6.8, y: 6.8 }, { x: 2.2, y: 6.8 }],
      },
    };
    const cells = rasterizeSurfaceFeature(feature, 10, 10);
    expect(cells).toContainEqual({ x: 2, y: 2 });
    expect(cells).toContainEqual({ x: 6, y: 6 });
    expect(cells).not.toContainEqual({ x: 1, y: 1 });
  });

  it("sanitizes malformed and out-of-range saved metadata", () => {
    const normalized = normalizeSurfaceIntent({
      version: 1,
      nextId: 3,
      features: [{
        id: "surface-2",
        terrain: "fairway",
        order: 2,
        geometry: { kind: "corridor", knots: [{ x: -5, y: 2 }, { x: 99, y: 4 }], width: 99 },
        coverage: [-1, 0, 0, 999],
      }],
    }, 10, 8, ["fairway", "rough"]);
    expect(normalized?.features[0].coverage).toEqual([0]);
    expect(normalized?.features[0].geometry).toMatchObject({ kind: "corridor", width: 24 });
  });
});
