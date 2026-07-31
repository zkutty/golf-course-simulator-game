import { describe, expect, it } from "vitest";
import { DEFAULT_COURSE } from "./defaults";
import type { Course, Terrain } from "./types";
import type { GolferProfile } from "../sim/golferProfiles";
import {
  analyzeShotSlope,
  elevationAtFrozenPoint,
  normalizeShotSlopeContext,
  normalizeShotSlopeCarrier,
  serializeShotSlopeContext,
} from "./shotSlope";
import { evalShotBase } from "../sim/shots/shotEval";

function courseWithElevation(width: number, height: number, elevation: (x: number, y: number) => number): Course {
  return {
    ...DEFAULT_COURSE,
    width,
    height,
    tiles: Array.from({ length: width * height }, () => "fairway" as Terrain),
    elevations: Array.from({ length: width * height }, (_, index) => elevation(index % width, Math.floor(index / width))),
    holes: [],
    obstacles: [],
  };
}

const golfer = {
  name: "Slope test",
  yardsPerTile: 10,
  clubs: [],
} as unknown as GolferProfile;

const club = { name: "iron", carryYards: 160, dispersionTilesBase: 1 };

describe("shot slope context", () => {
  it("reports endpoint distance, target rise, plays-like distance, and line-relative grade", () => {
    const course = courseWithElevation(7, 5, (x) => x);
    const context = analyzeShotSlope({
      course,
      from: { x: 1, y: 2 },
      to: { x: 5, y: 2 },
      yardsPerTile: 10,
    });

    expect(context.flatDistanceYards).toBe(40);
    expect(context.targetElevationDelta).toBe(4);
    expect(context.playsLikeDistanceYards).toBe(50);
    expect(context.localGradient).toEqual({ alongTargetLine: 1, crossTargetLine: 0 });
    expect(context).toMatchObject({ handedness: "right", sidehill: "flat", naturalCurveBiasTiles: 0 });
    expect(Object.isFrozen(context)).toBe(true);
    expect(Object.isFrozen(context.localGradient)).toBe(true);
  });

  it("classifies a cross-slope relative to handedness while retaining target-line curve direction", () => {
    const course = courseWithElevation(7, 7, (_x, y) => y * 8);
    const right = analyzeShotSlope({
      course,
      from: { x: 3, y: 3 },
      to: { x: 6, y: 3 },
      yardsPerTile: 10,
      handedness: "right",
    });
    const left = analyzeShotSlope({
      course,
      from: { x: 3, y: 3 },
      to: { x: 6, y: 3 },
      yardsPerTile: 10,
      handedness: "left",
    });

    expect(right.localGradient.crossTargetLine).toBe(8);
    expect(right.sidehill).toBe("ball_above_feet");
    expect(left.sidehill).toBe("ball_below_feet");
    expect(right.naturalCurveBiasTiles).toBe(-0.35);
    expect(left.naturalCurveBiasTiles).toBe(-0.35);
  });

  it("is bounded, deterministic, and does not invent an edge gradient", () => {
    const course = courseWithElevation(3, 3, (_x, _y) => 0);
    const args = { course, from: { x: 0, y: 0 }, to: { x: 2, y: 0 }, yardsPerTile: 10 };
    const first = analyzeShotSlope(args);
    const second = analyzeShotSlope(JSON.parse(JSON.stringify(args)));

    expect(second).toEqual(first);
    expect(first.localGradient).toEqual({ alongTargetLine: 0, crossTargetLine: 0 });
    const steep = analyzeShotSlope({
      course: courseWithElevation(3, 3, (_x, y) => y * 15),
      from: { x: 1, y: 1 },
      to: { x: 2, y: 1 },
      yardsPerTile: 10,
    });
    expect(Math.abs(steep.naturalCurveBiasTiles)).toBeLessThanOrEqual(0.35);
  });

  it("rounds fractional ball positions and clamps map edges without changing the captured facts", () => {
    const course = courseWithElevation(3, 3, (x, y) => x + y * 10);
    expect(elevationAtFrozenPoint(course, { x: 0.49, y: 1.51 })).toBe(20);
    expect(elevationAtFrozenPoint(course, { x: -100.1, y: 99.9 })).toBe(20);

    const context = analyzeShotSlope({
      course,
      from: { x: 0.49, y: 0.49 },
      to: { x: 2.49, y: 0.49 },
      yardsPerTile: 10,
    });
    expect(context).toMatchObject({
      flatDistanceYards: 20,
      targetElevationDelta: 2,
      playsLikeDistanceYards: 25,
      localGradient: { alongTargetLine: 1, crossTargetLine: 10 },
    });
  });

  it("fails safely for malformed elevation snapshots and a zero-length aim", () => {
    const malformed = {
      width: 3,
      height: 3,
      elevations: [0, Number.NaN, Number.POSITIVE_INFINITY] as number[],
    };
    const context = analyzeShotSlope({
      course: malformed,
      from: { x: Number.NaN, y: Number.NEGATIVE_INFINITY },
      to: { x: Number.POSITIVE_INFINITY, y: 0 },
      yardsPerTile: Number.NaN,
    });
    expect(context).toMatchObject({
      flatDistanceYards: 0,
      targetElevationDelta: 0,
      playsLikeDistanceYards: 0,
    });

    const zeroAim = analyzeShotSlope({
      course: courseWithElevation(3, 3, (_x, y) => y * 20),
      from: { x: 1.5, y: 1.5 },
      to: { x: 1.5, y: 1.5 },
      yardsPerTile: 10,
    });
    const values = [
      zeroAim.flatDistanceYards,
      zeroAim.targetElevationDelta,
      zeroAim.playsLikeDistanceYards,
      zeroAim.localGradient.alongTargetLine,
      zeroAim.localGradient.crossTargetLine,
      zeroAim.naturalCurveBiasTiles,
    ];
    expect(values.every(Number.isFinite)).toBe(true);
    expect(Math.abs(zeroAim.naturalCurveBiasTiles)).toBeLessThanOrEqual(0.35);
  });

  it("keeps every finite fractional-position matrix case serializable and bounded", () => {
    const course = courseWithElevation(4, 4, (x, y) => x * 7 - y * 5);
    const coordinates = [-3.4, -0.51, 0, 0.49, 1.5, 3.49, 8.2];
    for (const fromX of coordinates) {
      for (const fromY of coordinates) {
        for (const toX of coordinates) {
          const context = analyzeShotSlope({
            course,
            from: { x: fromX, y: fromY },
            to: { x: toX, y: fromY + 0.51 },
            yardsPerTile: 10,
            handedness: toX < fromX ? "left" : "right",
          });
          expect(serializeShotSlopeContext(context)).toEqual(context);
          expect(Math.abs(context.naturalCurveBiasTiles)).toBeLessThanOrEqual(0.35);
        }
      }
    }
  });

  it("round-trips a canonical context and ignores malformed optional payloads", () => {
    const context = analyzeShotSlope({
      course: courseWithElevation(5, 5, (x) => x),
      from: { x: 1, y: 2 },
      to: { x: 4, y: 2 },
      yardsPerTile: 10,
    });
    const serialized = serializeShotSlopeContext(context);
    const restored = normalizeShotSlopeContext(JSON.parse(JSON.stringify(serialized)));

    expect(restored).toEqual(context);
    expect(normalizeShotSlopeContext({ ...serialized, version: 99 })).toBeUndefined();
    expect(normalizeShotSlopeContext({ ...serialized, naturalCurveBiasTiles: Infinity })).toBeUndefined();

    const historical = { id: "shot-before-zk-631", seed: 17 };
    expect(normalizeShotSlopeCarrier(historical)).toBe(historical);
    expect(normalizeShotSlopeCarrier({ ...historical, slopeContext: serialized })).toEqual({
      ...historical,
      shotSlope: serialized,
    });
    expect(normalizeShotSlopeCarrier({ ...historical, shotSlope: { version: 99 } })).toEqual(historical);
  });

  it("keeps a completed evaluation tied to its captured context after terrain changes", () => {
    const flat = courseWithElevation(8, 4, () => 0);
    const from = { x: 1, y: 2 };
    const to = { x: 6, y: 2 };
    const captured = analyzeShotSlope({ course: flat, from, to, yardsPerTile: 10 });
    const sculpted = courseWithElevation(8, 4, (x) => x * 3);

    const replay = evalShotBase({ from, to, golfer, club, course: sculpted, shotSlope: captured });
    const fresh = evalShotBase({ from, to, golfer, club, course: sculpted });
    expect(replay.distanceYards).toBe(50);
    expect(fresh.distanceYards).toBe(87.5);
    expect(replay.shotSlope).toEqual(captured);
  });
});
