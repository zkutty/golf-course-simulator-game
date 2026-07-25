import { describe, expect, it } from "vitest";
import {
  corridorFeature,
  normalizeSurfaceIntent,
  rasterizeSurfaceFeature,
  rasterizeSurfaceFeatureDetailed,
  regionFeature,
  sampleCorridor,
  simplifySurfacePoints,
} from "./surfaceIntent";

function componentCount(points: Array<{ x: number; y: number }>, width: number): number {
  const remaining = new Set(points.map((point) => point.y * width + point.x));
  let components = 0;
  while (remaining.size > 0) {
    components++;
    const seed = remaining.values().next().value as number;
    const queue = [seed];
    remaining.delete(seed);
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const index = queue[cursor];
      const x = index % width;
      const y = Math.floor(index / width);
      for (const neighbor of [index - 1, index + 1, index - width, index + width]) {
        const nx = neighbor % width;
        const ny = Math.floor(neighbor / width);
        if (Math.abs(nx - x) + Math.abs(ny - y) !== 1 || !remaining.delete(neighbor)) continue;
        queue.push(neighbor);
      }
    }
  }
  return components;
}

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

  it("fills an imperfect Area loop as one connected region", () => {
    const feature = regionFeature(
      { width: 12 },
      "green",
      [
        { x: 2.1, y: 2.2 },
        { x: 8.2, y: 2.4 },
        { x: 8.5, y: 7.8 },
        { x: 5.2, y: 8.6 },
        { x: 2.0, y: 7.5 },
        { x: 2.5, y: 2.6 },
      ],
    );
    const result = rasterizeSurfaceFeatureDetailed(feature, 12, 12);
    expect(result.tiles).toContainEqual({ x: 5, y: 5 });
    expect(componentCount(result.tiles, 12)).toBe(1);
    expect(result.rings.length).toBeGreaterThan(0);
  });

  it("fills both pockets of self-crossing Area input instead of applying alternating winding holes", () => {
    const feature = regionFeature(
      { width: 14 },
      "sand",
      [
        { x: 2, y: 2 },
        { x: 11, y: 8 },
        { x: 11, y: 2 },
        { x: 2, y: 8 },
      ],
    );
    const result = rasterizeSurfaceFeatureDetailed(feature, 14, 11);
    expect(result.tiles).toContainEqual({ x: 3, y: 3 });
    expect(result.tiles).toContainEqual({ x: 9, y: 6 });
    expect(componentCount(result.tiles, 14)).toBe(1);
  });

  it("keeps a deliberate large Curve loop open while repairing diagonal connectivity", () => {
    const feature = corridorFeature(
      { width: 14 },
      "fairway",
      [
        { x: 2, y: 2 },
        { x: 10, y: 2 },
        { x: 10, y: 9 },
        { x: 2, y: 9 },
        { x: 2, y: 2.5 },
      ],
      1,
    );
    const result = rasterizeSurfaceFeatureDetailed(feature, 14, 12);
    expect(result.tiles).not.toContainEqual({ x: 6, y: 5 });
    expect(componentCount(result.tiles, 14)).toBe(1);
  });

  it("clips both committed cells and visual rings to accepted coverage", () => {
    const feature = corridorFeature(
      { width: 12 },
      "water",
      [{ x: 2.5, y: 5.5 }, { x: 9.5, y: 5.5 }],
      3,
    );
    const allowed = new Set<number>();
    for (let y = 0; y < 12; y++) for (let x = 0; x < 6; x++) allowed.add(y * 12 + x);
    const result = rasterizeSurfaceFeatureDetailed(feature, 12, 12, allowed);
    expect(result.tiles.every((point) => point.x < 6)).toBe(true);
    expect(result.rings.flat().every((point) => point.x <= 6)).toBe(true);
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
        renderRings: [[{ x: -1, y: 1 }, { x: 4, y: 1 }, { x: 4, y: 4 }]],
      }],
    }, 10, 8, ["fairway", "rough"]);
    expect(normalized?.features[0].coverage).toEqual([0]);
    expect(normalized?.features[0].geometry).toMatchObject({ kind: "corridor", width: 24 });
    expect(normalized?.features[0].renderRings?.[0][0]).toEqual({ x: 0, y: 1 });
  });
});
