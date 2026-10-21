import { describe, expect, it } from "vitest";
import type { ObstacleType } from "../models/types";
import {
  MAX_FLIGHT_CURVE_TILES,
  isValidAuthoritativeFlightGeometryV1,
  resolveObstacleCollision,
  sampleAuthoritativeFlightGeometry,
  sampleAuthoritativeFlightPath,
} from "./obstacleCollision";

function resolve(args: Partial<Parameters<typeof resolveObstacleCollision>[0]> = {}) {
  return resolveObstacleCollision({
    from: { x: 1, y: 5 },
    to: { x: 11, y: 5 },
    flight: { profile: "standard", apexHeightYards: 4 },
    width: 16,
    height: 12,
    yardsPerTile: 10,
    elevations: new Array(16 * 12).fill(0),
    tiles: new Array(16 * 12).fill("fairway"),
    obstacles: [],
    ...args,
  });
}

describe("authoritative obstacle flight collision", () => {
  it("keeps a clear flight unchanged and explains the route around an obstacle", () => {
    const result = resolve({ obstacles: [{ type: "tree", x: 6, y: 8 }] });

    expect(result.collision).toEqual({ kind: "none" });
    expect(result.clearance).toMatchObject([{
      obstacleType: "tree",
      relationship: "around",
      horizontalClearanceYards: 21,
    }]);
  });

  it("intersects both the tree trunk and elevated canopy volumes", () => {
    const trunk = resolve({ obstacles: [{ type: "tree", x: 6, y: 5 }] });
    const canopy = resolve({
      flight: { profile: "high", apexHeightYards: 14 },
      obstacles: [{ type: "tree", x: 6, y: 5 }],
    });

    expect(trunk.collision).toMatchObject({
      kind: "obstacle",
      obstacleType: "tree",
      clearance: { relationship: "through", requiredHeightYards: 8 },
    });
    expect(canopy.collision).toMatchObject({
      kind: "obstacle",
      obstacleType: "tree",
      clearance: { relationship: "through", requiredHeightYards: 24 },
    });
  });

  it("intersects low dense bushes and solid rocks", () => {
    const bush = resolve({
      flight: { profile: "low", apexHeightYards: 2 },
      obstacles: [{ type: "bush", x: 6, y: 5 }],
    });
    const rock = resolve({
      flight: { profile: "low", apexHeightYards: 1.5 },
      obstacles: [{ type: "rock", x: 6, y: 5 }],
    });

    expect(bush.collision).toMatchObject({ kind: "obstacle", obstacleType: "bush" });
    expect(rock.collision).toMatchObject({ kind: "obstacle", obstacleType: "rock" });
  });

  it("records under-canopy and over-canopy clearance without a collision", () => {
    const obstacle = { type: "tree" as const, x: 6, y: 5.7 };
    const under = resolve({
      flight: { profile: "low", apexHeightYards: 5 },
      obstacles: [obstacle],
    });
    const over = resolve({
      flight: { profile: "high", apexHeightYards: 30 },
      obstacles: [obstacle],
    });

    expect(under.collision).toEqual({ kind: "none" });
    expect(under.clearance[0]).toMatchObject({ relationship: "under", requiredHeightYards: 24 });
    expect(over.collision).toEqual({ kind: "none" });
    expect(over.clearance[0]).toMatchObject({ relationship: "over", requiredHeightYards: 24 });
    expect(over.clearance[0]?.clearanceYards).toBeGreaterThan(0);
  });

  it("samples elevated terrain as part of the same path", () => {
    const elevations = new Array(16 * 12).fill(0);
    elevations[5 * 16 + 6] = 3;
    const result = resolve({
      flight: { profile: "low", apexHeightYards: 4 },
      elevations,
    });

    expect(result.collision).toMatchObject({ kind: "terrain", terrain: "fairway" });
  });

  it("uses stable obstacle ordering and is byte-stable on repeated calculations", () => {
    const input = {
      flight: { profile: "low" as const, apexHeightYards: 2 },
      obstacles: [
        { type: "rock" as const, x: 6, y: 5 },
        { type: "bush" as const, x: 6, y: 5 },
      ],
    };
    const first = resolve(input);
    const second = resolve({ ...input, obstacles: input.obstacles.slice().reverse() });
    const third = resolve(input);

    expect(first.collision).toMatchObject({ kind: "obstacle", obstacleType: "bush" });
    expect(second).toEqual(first);
    expect(third).toEqual(first);
  });

  it("keeps exact nearby collision checks while bounding distant evidence work", () => {
    const distant: Array<{ type: ObstacleType; x: number; y: number }> = Array.from({ length: 540 }, (_, index) => ({
      type: index % 3 === 0 ? "tree" : index % 3 === 1 ? "bush" : "rock",
      x: 2 + (index % 99),
      y: index % 2 === 0 ? 2 : 58,
    }));
    const result = resolve({
      width: 120,
      height: 60,
      from: { x: 1, y: 30 },
      to: { x: 100, y: 30 },
      flight: { profile: "low", apexHeightYards: 1 },
      obstacles: [...distant, { type: "rock", x: 40, y: 30 }],
    });

    expect(result.clearance).toHaveLength(541);
    expect(result.collision).toMatchObject({ kind: "obstacle", obstacleType: "rock" });
    expect(result.clearance.some((item) => item.relationship === "around")).toBe(true);
  });

  it("preserves every legacy straight sample exactly when curve geometry is absent", () => {
    const input = {
      from: { x: 1.1234567, y: 2.7654321 }, to: { x: 9.4567891, y: 7.3456789 },
      flight: { profile: "standard" as const, apexHeightYards: 7.1234567 },
      width: 16, height: 12, yardsPerTile: 10, obstacles: [],
      elevations: Array.from({ length: 16 * 12 }, (_, index) => index % 4),
    };
    const round = (number: number) => Number(number.toFixed(6));
    const terrain = (point: { x: number; y: number }) => input.elevations[
      Math.max(0, Math.min(11, Math.round(point.y))) * 16 + Math.max(0, Math.min(15, Math.round(point.x)))
    ]! * 2.5;
    const count = Math.max(1, Math.ceil(Math.hypot(input.to.x - input.from.x, input.to.y - input.from.y) / .05));
    const oldSamples = Array.from({ length: count + 1 }, (_, index) => {
      const t = index / count;
      const point = { x: round(input.from.x + (input.to.x - input.from.x) * t), y: round(input.from.y + (input.to.y - input.from.y) * t) };
      const baseHeight = terrain(input.from) + (terrain(input.to) - terrain(input.from)) * t;
      return { point, t: round(t), pathHeightYards: round(baseHeight + input.flight.apexHeightYards * 4 * t * (1 - t)), terrainHeightYards: round(terrain(point)) };
    });
    expect(sampleAuthoritativeFlightPath(input)).toEqual(oldSamples);
    expect(Object.keys(resolveObstacleCollision(input))).toEqual(["samples", "collision", "clearance"]);
  });

  it("checks mirrored draw/fade geometry against obstacles beyond the straight chord broadphase", () => {
    for (const sign of [-1, 1]) {
      const result = resolve({
        flight: { profile: "low", apexHeightYards: 1, curve: { kind: "lateral_quadratic_v1", lateralOffsetTiles: sign * 2 } },
        obstacles: [{ type: "rock", x: 6, y: 5 + sign * 2 }],
        retainGeometry: true,
      });
      expect(result.collision).toMatchObject({ kind: "obstacle", obstacleType: "rock" });
      const retained = result.retained!;
      expect(retained.obstacle).toEqual({ type: "rock", x: 6, y: 5 + sign * 2 });
      const exact = sampleAuthoritativeFlightGeometry(retained.geometry, retained.endSampleIndex / retained.sampleDivisions);
      expect(exact).toEqual({
        point: result.samples[retained.endSampleIndex]!.point,
        t: result.samples[retained.endSampleIndex]!.t,
        pathHeightYards: result.samples[retained.endSampleIndex]!.pathHeightYards,
      });
      expect(result.collision.kind !== "none" && result.collision.point).toEqual(exact.point);
    }
    const draw = resolve({ flight: { profile: "low", apexHeightYards: 1, curve: { kind: "lateral_quadratic_v1", lateralOffsetTiles: -2 } } });
    const fade = resolve({ flight: { profile: "low", apexHeightYards: 1, curve: { kind: "lateral_quadratic_v1", lateralOffsetTiles: 2 } } });
    expect(draw.samples.map((sample) => sample.point.x)).toEqual(fade.samples.map((sample) => sample.point.x));
    draw.samples.forEach((sample, index) => expect(sample.point.y + fade.samples[index]!.point.y).toBeCloseTo(10, 6));
  });

  it("finds the actual nearest curved sample for clearance evidence", () => {
    const obstacle = { type: "rock" as const, x: 3, y: 11 };
    const result = resolve({
      flight: { profile: "high", apexHeightYards: 40, curve: { kind: "lateral_quadratic_v1", lateralOffsetTiles: 4 } },
      obstacles: [obstacle],
    });
    const nearest = [...result.samples].sort((a, b) => Math.hypot(a.point.x - obstacle.x, a.point.y - obstacle.y)
      - Math.hypot(b.point.x - obstacle.x, b.point.y - obstacle.y))[0]!;
    expect(result.clearance[0]!.point).toEqual(nearest.point);
    expect(result.clearance[0]!.relationship).toBe("around");
  });

  it("retains absolute endpoint heights and rejects nonfinite or oversized new geometry", () => {
    const elevations = new Array(16 * 12).fill(2);
    const result = resolve({ elevations, retainGeometry: true });
    expect(result.retained!.geometry).toMatchObject({ startHeightYards: 5, endHeightYards: 5 });
    expect(isValidAuthoritativeFlightGeometryV1(result.retained!.geometry)).toBe(true);
    expect(isValidAuthoritativeFlightGeometryV1({ ...result.retained!.geometry, apexHeightYards: Infinity })).toBe(false);
    for (const lateralOffsetTiles of [NaN, Infinity, MAX_FLIGHT_CURVE_TILES + .01]) {
      expect(() => resolve({ flight: { profile: "low", apexHeightYards: 1, curve: { kind: "lateral_quadratic_v1", lateralOffsetTiles } } })).toThrow(RangeError);
    }
    expect(() => resolve({ to: { x: 100_000, y: 5 }, retainGeometry: true })).toThrow(RangeError);
    expect(result.samples.length).toBeLessThanOrEqual(32769);
  });

  it("freezes explicitly sampled physical endpoint heights while keeping coarse terrain checks", () => {
    const result = resolve({ retainGeometry: true, endpointHeightsYards: { from: 1.125, to: 2.375 } });
    expect(result.samples[0]).toMatchObject({ pathHeightYards: 1.125, terrainHeightYards: 0 });
    expect(result.samples.at(-1)).toMatchObject({ pathHeightYards: 2.375, terrainHeightYards: 0 });
    expect(result.retained!.geometry).toMatchObject({ startHeightYards: 1.125, endHeightYards: 2.375 });
    expect(() => resolve({ endpointHeightsYards: { from: NaN, to: 0 } })).toThrow(RangeError);
  });
});


describe("modern physical surface and contact departure", () => {
  it("samples one frozen fine surface for launch and terrain instead of colliding with a coarse tile step", () => {
    const args = { endpointHeightsYards: { from: 10, to: 10 }, elevations: Array(16 * 12).fill(5) };
    expect(resolve(args).collision.kind).toBe("terrain");
    const modern = resolve({ ...args, terrainHeightAtYards: () => 10, retainGeometry: true });
    expect(modern.collision.kind).toBe("none");
    expect(modern.samples[1]!.terrainHeightYards).toBe(10);
  });
  it("permits an outward escape from sampled contact overlap while an inward strike still hits", () => {
    const obstacle = { type: "tree" as const, x: 6, y: 5 };
    const outward = { from: { x: 5.8, y: 5 }, to: { x: 1, y: 5 }, obstacles: [obstacle] };
    expect(resolve(outward).collision.kind).toBe("obstacle");
    expect(resolve({ ...outward, retainGeometry: true }).collision.kind).toBe("none");
    expect(resolve({ ...outward, from: { x: 6, y: 5 }, retainGeometry: true }).collision.kind).toBe("none");
    expect(resolve({ ...outward, to: { x: 11, y: 5 }, retainGeometry: true }).collision.kind).toBe("obstacle");
  });
});
