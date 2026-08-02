import { describe, expect, it } from "vitest";
import { DEFAULT_COURSE } from "../models/defaults";
import type { Course, Terrain } from "../models/types";
import {
  GREEN_SURFACE_FIXED_POINT_SCALE,
  createGreenProgram,
  normalizeGreenLocalState,
  normalizeGreenSurfaceV1,
} from "./greenSurface";
import {
  GREEN_ROLLOUT_MAX_PATH_POINTS,
  GREEN_ROLLOUT_MAX_STEPS,
  isValidGreenRollout,
  resolveGreenRollout,
  sampleGreenRolloutSurface,
} from "./greenRollout";

function course(terrains: Terrain[][] = [
  ["green", "green", "green", "green", "green", "green", "green", "green"],
  ["green", "green", "green", "green", "green", "green", "green", "green"],
  ["green", "green", "green", "green", "green", "green", "green", "green"],
]): Course {
  const height = terrains.length;
  const width = terrains[0].length;
  const result: Course = {
    ...DEFAULT_COURSE,
    width,
    height,
    tiles: terrains.flat(),
    elevations: new Array(width * height).fill(0),
    holes: [{ ...DEFAULT_COURSE.holes[0], id: "roll-hole", green: { x: width - 1.5, y: 1.5 } }],
    obstacles: [],
    buildings: [],
    decorations: [],
    yardsPerTile: 10,
    greenSurface: undefined,
    greenProgram: createGreenProgram("balanced"),
  };
  result.greenLocalState = normalizeGreenLocalState(undefined, result);
  return result;
}

function sloped(value: Course, gradientX: number, gradientY: number): Course {
  const elevations = value.elevations.map((_, index) => {
    const x = index % value.width;
    const y = Math.floor(index / value.width);
    return x * gradientX + y * gradientY;
  });
  const tiles = [];
  for (let y = 0; y < value.height; y++) for (let x = 0; x < value.width; x++) {
    if (value.tiles[y * value.width + x] !== "green") continue;
    const offsets = Array.from({ length: 16 }, (_, index) => {
      const sampleX = index % 4;
      const sampleY = Math.floor(index / 4);
      return Math.round((sampleX / 3 * gradientX + sampleY / 3 * gradientY) * GREEN_SURFACE_FIXED_POINT_SCALE);
    });
    tiles.push({ x, y, offsets: offsets.map((offset) => Math.max(-2_048, Math.min(2_048, offset))) });
  }
  const carrier = { ...value, elevations };
  return { ...carrier, greenSurface: normalizeGreenSurfaceV1({ tiles }, carrier) };
}

function resolve(value: Course, overrides: Partial<Parameters<typeof resolveGreenRollout>[0]> = {}) {
  return resolveGreenRollout({
    course: value,
    holeId: "roll-hole",
    landing: { x: 1.25, y: 1.5 },
    direction: { x: 1, y: 0 },
    requestedRollYards: 38,
    yardsPerTile: 10,
    club: "Putter",
    sourceLie: "green",
    launchAngleDegrees: 0,
    landingAngleDegrees: 0,
    trajectory: "standard",
    spin: "neutral",
    weather: { kind: "clear", rainInches: 0 },
    drainageLevel: 1,
    seed: 639,
    ...overrides,
  });
}

describe("ZK-639 authoritative green rollout", () => {
  it("bilinearly samples the fine 4x4 surface and resolves byte-stable level paths", () => {
    const value = course();
    value.greenSurface = normalizeGreenSurfaceV1({ tiles: [{
      x: 1,
      y: 1,
      offsets: Array.from({ length: 16 }, (_, index) => (index % 4) * 96 + Math.floor(index / 4) * 48),
    }] }, value);
    const sample = sampleGreenRolloutSurface(value, value.greenSurface, { x: 1.5, y: 1.5 });
    expect(sample.height).toBeCloseTo(216 / GREEN_SURFACE_FIXED_POINT_SCALE, 6);
    expect(sample.gradient.x).toBeGreaterThan(0);
    expect(sample.gradient.y).toBeGreaterThan(0);

    const first = resolve(course());
    const second = resolve(course());
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.breakTiles).toBe(0);
    expect(first.path[0]).toEqual(first.landing);
    expect(first.path.at(-1)).toEqual(first.rest);
    expect(isValidGreenRollout(first)).toBe(true);
  });

  it("honors uphill, downhill, sidehill, tier, and false-front fine contours", () => {
    const flat = resolve(course());
    const uphill = resolve(sloped(course(), 0.24, 0));
    const downhill = resolve(sloped(course(), -0.24, 0));
    const sidehill = resolve(sloped(course(), 0, 0.22));
    expect(uphill.rollYards).toBeLessThan(flat.rollYards);
    expect(downhill.rollYards).toBeGreaterThan(flat.rollYards);
    expect(sidehill.breakTiles).toBeLessThan(-0.05);

    const tier = course();
    tier.elevations = tier.elevations.map((height, index) => index % tier.width >= 4 ? height + 1 : height);
    const tierResult = resolve(tier, { requestedRollYards: 75 });
    expect(tierResult.rest.x).toBeLessThan(resolve(course(), { requestedRollYards: 75 }).rest.x);

    const falseFront = sloped(course(), 0.45, 0);
    const falseFrontResult = resolve(falseFront, { landing: { x: 3.2, y: 1.5 }, direction: { x: -1, y: 0 }, requestedRollYards: 18 });
    expect(falseFrontResult.downhillTiles).toBeGreaterThan(0);
  });

  it("uses frozen program, local moisture, weather, and drainage for wet-slow and dry-fast outcomes", () => {
    const wet = course();
    wet.greenProgram = createGreenProgram("receptive");
    wet.greenLocalState = normalizeGreenLocalState({ holes: [{
      holeId: "roll-hole",
      health: 0.72,
      moisture: 0.86,
      compaction: 0.05,
      wear: 0.24,
      zones: [
        { zone: "landing", health: 0.72, moisture: 0.86, compaction: 0.05, wear: 0.24, traffic: 0.3 },
        { zone: "pin", health: 0.72, moisture: 0.86, compaction: 0.05, wear: 0.24, traffic: 0.3 },
      ],
    }] }, wet);
    const dry = course();
    dry.greenProgram = createGreenProgram("championship");
    dry.greenLocalState = normalizeGreenLocalState({ holes: [{
      holeId: "roll-hole",
      health: 1,
      moisture: 0.26,
      compaction: 0.72,
      wear: 0.02,
      zones: [
        { zone: "landing", health: 1, moisture: 0.26, compaction: 0.72, wear: 0.02, traffic: 0.1 },
        { zone: "pin", health: 1, moisture: 0.26, compaction: 0.72, wear: 0.02, traffic: 0.1 },
      ],
    }] }, dry);
    const slow = resolve(wet, { weather: { kind: "heavy_rain", rainInches: 1.2 }, drainageLevel: 0 });
    const fast = resolve(dry, { weather: { kind: "drought", rainInches: 0 }, drainageLevel: 3 });
    expect(slow.pace).toBe("slow");
    expect(fast.pace).toBe("fast");
    expect(fast.rollYards).toBeGreaterThan(slow.rollYards);
    expect(fast.evidence.realizedFirmness).toBeGreaterThan(slow.evidence.realizedFirmness);
    expect(fast.evidence.effectiveMoisture).toBeLessThan(slow.evidence.effectiveMoisture);
  });

  it("continues across green boundaries, can re-enter, and remains workload bounded", () => {
    const striped = course([
      ["green", "green", "rough", "green", "green", "green", "green", "green"],
      ["green", "green", "rough", "green", "green", "green", "green", "green"],
      ["green", "green", "rough", "green", "green", "green", "green", "green"],
    ]);
    const result = resolve(striped, { landing: { x: 0.8, y: 1.5 }, requestedRollYards: 120 });
    expect(result.transitions.map((transition) => `${transition.from}->${transition.to}`)).toEqual(expect.arrayContaining([
      "green->rough",
      "rough->green",
    ]));
    expect(result.rest.x).toBeGreaterThan(3);
    expect(result.path.length).toBeLessThanOrEqual(GREEN_ROLLOUT_MAX_PATH_POINTS);
    expect(result.evidence.steps).toBeLessThanOrEqual(GREEN_ROLLOUT_MAX_STEPS);

    const extreme = resolve(sloped(course(), -1.5, 1.2), { requestedRollYards: 240 });
    expect(extreme.path.length).toBeLessThanOrEqual(GREEN_ROLLOUT_MAX_PATH_POINTS);
    expect(extreme.evidence.steps).toBeLessThanOrEqual(GREEN_ROLLOUT_MAX_STEPS);
    expect(isValidGreenRollout(extreme)).toBe(true);
  });

  it("captures landing angle and spin as bounded physical inputs", () => {
    const value = course();
    const low = resolve(value, { club: "5 Iron", launchAngleDegrees: 12, landingAngleDegrees: 22, trajectory: "low", spin: "neutral", requestedRollYards: 28 });
    const high = resolve(value, { club: "5 Iron", launchAngleDegrees: 42, landingAngleDegrees: 52, trajectory: "high", spin: "neutral", requestedRollYards: 28 });
    const checked = resolve(value, { club: "Pitching Wedge", launchAngleDegrees: 28, landingAngleDegrees: 39, spin: "backspin", requestedRollYards: 28 });
    expect(low.rollYards).toBeGreaterThan(high.rollYards);
    expect(high.rollYards).toBeGreaterThan(checked.rollYards);
    expect(checked.evidence.spin).toBe("backspin");
  });
});
