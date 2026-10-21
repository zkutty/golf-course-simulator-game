import { describe, expect, it } from "vitest";
import { resolveObstacleCollision, sampleAuthoritativeFlightGeometry, type ObstacleCollisionInput } from "./obstacleCollision";
import {
  MAX_SHOT_MOTION_PATH_POINTS,
  createRetainedShotMotion,
  isValidRetainedFlightResolutionV1,
  isValidRetainedShotMotionV1,
  sampleRetainedShotMotion,
  type CreateRetainedShotMotionInput,
  type RetainedShotMotionV1,
  type ShotMotionPositionV1,
} from "./shotMotion";

const position = (x: number, y: number, heightYards = 0): ShotMotionPositionV1 => ({ point: { x, y }, heightYards });

function flight(overrides: Partial<ObstacleCollisionInput> = {}) {
  return resolveObstacleCollision({
    from: { x: 1, y: 5 }, to: { x: 11, y: 5 },
    flight: { profile: "standard", apexHeightYards: 4 },
    width: 16, height: 16, yardsPerTile: 10,
    elevations: new Array(16 * 16).fill(0), obstacles: [], retainGeometry: true,
    ...overrides,
  }).retained!;
}

function input(overrides: Partial<CreateRetainedShotMotionInput> = {}): CreateRetainedShotMotionInput {
  return {
    identity: { shotId: "shot-hole-1-1", holeId: "hole-1", shotNumber: 1, seed: 123, club: "7 Iron", style: "normal", modelVersion: "physical_shot_v1" },
    yardsPerTile: 10,
    from: position(1, 5), landing: position(11, 5), physicalRest: position(12, 6),
    flight: flight(), rollPath: [position(11, 5), position(12, 5), position(12, 6)], holed: false,
    facts: { launchAngleDegrees: 24, landingAngleDegrees: 36, spin: "neutral" },
    ...overrides,
  };
}

function motion(overrides: Partial<CreateRetainedShotMotionInput> = {}): RetainedShotMotionV1 {
  const result = createRetainedShotMotion(input(overrides));
  expect(result).not.toBeNull();
  return result!;
}

describe("bounded retained committed shot motion", () => {
  it("samples the exact collision authority geometry at every source flight sample", () => {
    const retained = flight({ flight: { profile: "standard", apexHeightYards: 4, curve: { kind: "lateral_quadratic_v1", lateralOffsetTiles: 2 } } });
    const value = motion({ flight: retained });
    for (let index = 0; index <= retained.endSampleIndex; index += 1) {
      const progress = index / retained.endSampleIndex * value.flight!.endTime;
      const actual = sampleRetainedShotMotion(value, progress)!;
      const expected = sampleAuthoritativeFlightGeometry(retained.geometry, index / retained.sampleDivisions);
      expect(actual.point).toEqual(expected.point);
      expect(actual.heightYards).toBe(expected.pathHeightYards);
    }
    expect(sampleRetainedShotMotion(value, .36)!.point.y).toBe(7);
  });

  it("agrees at every contact, source vertex and rest boundary without relief motion", () => {
    const value = motion({ reliefPosition: { x: 1, y: 1 } });
    for (const event of value.events) {
      const pose = sampleRetainedShotMotion(value, event.time)!;
      expect(pose.point).toEqual(event.point);
      expect(pose.heightYards).toEqual(event.heightYards);
    }
    for (const vertex of value.groundPath) expect(sampleRetainedShotMotion(value, vertex.time)!.point).toEqual(vertex.point);
    expect(sampleRetainedShotMotion(value, 0)).toMatchObject({ phase: "launch", point: value.from.point });
    expect(sampleRetainedShotMotion(value, value.groundPath[0]!.time)).toMatchObject({ phase: "first_contact", point: value.landing.point });
    expect(sampleRetainedShotMotion(value, 1)).toMatchObject({ phase: "rest", point: value.physicalRest.point, reliefPosition: { x: 1, y: 1 } });
    expect(value.events.map((event) => event.kind)).toEqual(["launch", "first_contact", "rest"]);
    expect(value.events.at(-1)).toMatchObject({ source: "ground", sourceIndex: 2 });
  });

  it("requires explicit elevated collision response and retains a caller-authorized stop/drop", () => {
    const retained = flight({
      flight: { profile: "high", apexHeightYards: 14 },
      obstacles: [{ type: "tree", x: 6, y: 5 }],
    });
    expect(retained.collision.kind).toBe("obstacle");
    const impactSample = sampleAuthoritativeFlightGeometry(retained.geometry, retained.endSampleIndex / retained.sampleDivisions);
    const impact = { point: impactSample.point, heightYards: impactSample.pathHeightYards };
    const landing = { point: { ...impact.point }, heightYards: 0 };
    expect(impact.heightYards).toBeGreaterThan(8);
    const args = input({ flight: retained, landing, physicalRest: landing, rollPath: [landing] });
    expect(createRetainedShotMotion(args)).toBeNull();
    const value = createRetainedShotMotion({ ...args, postCollisionPath: [impact, landing] })!;
    expect(isValidRetainedShotMotionV1(value)).toBe(true);
    expect(value.events.map((event) => event.kind)).toEqual(["launch", "collision", "first_contact", "rest"]);
    expect(sampleRetainedShotMotion(value, .6)).toMatchObject({ phase: "collision", point: impact.point, heightYards: impact.heightYards });
    const drop = sampleRetainedShotMotion(value, .66)!;
    expect(drop.phase).toBe("post_collision");
    expect(drop.point).toEqual(impact.point);
    expect(drop.heightYards).toBeCloseTo(impact.heightYards / 2);
    expect(sampleRetainedShotMotion(value, .72)).toMatchObject({ phase: "first_contact", heightYards: 0 });
    expect(value.flight!.obstacle).toEqual({ type: "tree", x: 6, y: 5 });
  });

  it("keeps JSON replay exact and independent from edited source terrain or frame order", () => {
    const elevations = new Array(256).fill(2);
    const retained = flight({ elevations });
    const source = input({
      flight: retained, from: position(1, 5, 5), landing: position(11, 5, 5), physicalRest: position(12, 6, 5),
      rollPath: [position(11, 5, 5), position(12, 5, 5), position(12, 6, 5)],
    });
    const before = structuredClone(source);
    const value = createRetainedShotMotion(source)!;
    expect(source).toEqual(before);
    const saved = JSON.parse(JSON.stringify(value));
    expect(isValidRetainedShotMotionV1(saved)).toBe(true);
    const progress = [1, .87, .01, .72, .14, 0, .5, .87];
    const original = progress.map((time) => sampleRetainedShotMotion(value, time));
    elevations.fill(1000);
    source.rollPath[1]!.point.x = 99;
    retained.geometry.apexHeightYards = 999;
    expect(progress.map((time) => sampleRetainedShotMotion(saved, time))).toEqual(original);
    expect(progress.map((time) => sampleRetainedShotMotion(value, time))).toEqual(original);
  });

  it("clamps progress and returns unavailable for malformed or absent historical paths", () => {
    const value = motion();
    for (const time of [-Infinity, -1, NaN, undefined as unknown as number]) {
      expect(sampleRetainedShotMotion(value, time)).toEqual(sampleRetainedShotMotion(value, 0));
    }
    for (const time of [Infinity, 2]) expect(sampleRetainedShotMotion(value, time)).toEqual(sampleRetainedShotMotion(value, 1));
    expect(sampleRetainedShotMotion(undefined, .5)).toBeNull();
    expect(sampleRetainedShotMotion({ legacy: true, from: value.from.point, rest: value.physicalRest.point }, .5)).toBeNull();
    expect(createRetainedShotMotion(input({ flight: null, from: position(1, 5), landing: position(1, 5), rollPath: [] }))).toBeNull();
  });

  it("retains manual putt geometry and hole-out without inventing automatic per-putt motion", () => {
    const args = input({
      flight: null, landing: position(1, 5), physicalRest: position(2, 6),
      rollPath: [position(1, 5), position(2, 5), position(2, 6)], holed: true,
      identity: { ...input().identity, club: "Putter" },
    });
    const value = createRetainedShotMotion(args)!;
    expect(value.flight).toBeNull();
    expect(sampleRetainedShotMotion(value, 0)!.phase).toBe("launch");
    expect(sampleRetainedShotMotion(value, .5)).toMatchObject({ phase: "rollout", point: { x: 2, y: 5 }, heightYards: 0 });
    expect(sampleRetainedShotMotion(value, 1)).toMatchObject({ phase: "hole_out", point: { x: 2, y: 6 } });
    // An automatic aggregate is not a recorded manual stroke path.
    expect(createRetainedShotMotion({ ...args, rollPath: [] })).toBeNull();
  });

  it("retains dead-stop and duplicate source vertices with bounded strictly increasing times", () => {
    const landing = position(11, 5);
    const stopped = motion({ physicalRest: landing, rollPath: [landing] });
    expect(stopped.groundPath).toHaveLength(2);
    expect(sampleRetainedShotMotion(stopped, .8)!.point).toEqual(landing.point);
    const value = motion({ rollPath: [position(11, 5), position(11, 5), position(12, 5), position(12, 6)] });
    expect(value.groundPath).toHaveLength(4);
    value.groundPath.slice(1).forEach((point, index) => expect(point.time).toBeGreaterThan(value.groundPath[index]!.time));
    expect(JSON.stringify(value).length).toBeLessThan(4096);
  });

  it("fails closed on hostile numbers, chronology, identity, continuity, source association and counts", () => {
    const value = motion();
    const corruptions: Array<(copy: RetainedShotMotionV1) => void> = [
      (copy) => { copy.from.point.x = Infinity; },
      (copy) => { copy.identity.seed = -1; },
      (copy) => { copy.identity.modelVersion = ""; },
      (copy) => { copy.units.yardsPerTile = 0; },
      (copy) => { copy.flight!.geometry.apexHeightYards = NaN; },
      (copy) => { copy.flight!.endSampleIndex -= 1; },
      (copy) => { copy.groundPath[0]!.point.x += 1; },
      (copy) => { copy.groundPath[1]!.time = copy.groundPath[0]!.time; },
      (copy) => { copy.physicalRest.point.y += 1; },
      (copy) => { copy.events[0]!.sourceIndex = 100; },
      (copy) => { copy.events[0]!.point.x += 1; },
      (copy) => { (copy.events as unknown[])[copy.events.length - 1] = null; },
      (copy) => { delete (copy.events as unknown[])[0]; },
      (copy) => { delete (copy.groundPath as unknown[])[0]; },
      (copy) => { (copy as unknown as { extra: unknown }).extra = copy; },
    ];
    for (const corrupt of corruptions) {
      const copy = structuredClone(value);
      corrupt(copy);
      expect(isValidRetainedShotMotionV1(copy)).toBe(false);
      expect(sampleRetainedShotMotion(copy, .5)).toBeNull();
    }
    expect(createRetainedShotMotion(input({ rollPath: new Array(MAX_SHOT_MOTION_PATH_POINTS + 1).fill(position(11, 5)) }))).toBeNull();
    expect(isValidRetainedFlightResolutionV1({ ...flight(), sampleDivisions: 1 })).toBe(false);
    expect(createRetainedShotMotion(null as unknown as CreateRetainedShotMotionInput)).toBeNull();
    expect(createRetainedShotMotion(input({ rollPath: new Array(2) }))).toBeNull();
  });
});
