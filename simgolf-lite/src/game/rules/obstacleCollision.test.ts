import { describe, expect, it } from "vitest";
import { resolveObstacleCollision } from "./obstacleCollision";

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
});
