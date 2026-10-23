import { describe, expect, it } from "vitest";
import { consumeClock } from "./clock";
import {
  MAX_SHOT_PACING_FRAME_MS,
  advanceShotPacingCursor,
  createShotPacingCursor,
  createShotPacingPlan,
  isShotPacingCursor,
  shotPacingDurationMs,
  shotPacingEventProgress,
  shotPacingFrame,
  type CreateShotPacingPlanInput,
  type ShotPacingCursorV1,
} from "./shotPacing";
import { createRetainedShotMotion, sampleRetainedShotMotion, type ShotMotionIdentityV1 } from "../rules/shotMotion";
import { resolveObstacleCollision } from "../rules/obstacleCollision";

function source(putt = false, identity: Partial<ShotMotionIdentityV1> = {}): CreateShotPacingPlanInput {
  const position = (x: number) => ({ point: { x, y: 1 }, heightYards: 0 });
  const motion = createRetainedShotMotion({
    identity: { shotId: "shot-1", holeId: "hole-1", shotNumber: 1, seed: 123, club: putt ? "Putter" : "7 Iron",
      style: "normal", modelVersion: "physical_shot_v1", ...identity },
    yardsPerTile: 10, from: position(1), landing: position(putt ? 1 : 11), physicalRest: position(12),
    flight: putt ? null : resolveObstacleCollision({
      from: { x: 1, y: 1 }, to: { x: 11, y: 1 }, flight: { profile: "standard", apexHeightYards: 4 },
      width: 16, height: 16, yardsPerTile: 10, elevations: new Array(256).fill(0), obstacles: [], retainGeometry: true,
    }).retained!,
    rollPath: [position(putt ? 1 : 11), position(12)], holed: false,
  });
  expect(motion).not.toBeNull();
  return { scopeId: "live:w3:d2:s123:e0", actorId: "golfer:1", motion: motion!, distanceYards: putt ? 12 : 110 };
}

function plan(putt = false) {
  const result = createShotPacingPlan(source(putt));
  expect(result).not.toBeNull();
  return result!;
}

describe("shared real-time shot presentation", () => {
  it("bounds every full shot at 6–10 seconds and putts at 2.4–4.2 seconds", () => {
    expect([0, 100, 400, 1e12].map((yards) => shotPacingDurationMs("swing", yards))).toEqual([6000, 7000, 10000, 10000]);
    expect([0, 10, 40, 1e12].map((yards) => shotPacingDurationMs("putt", yards))).toEqual([2400, 2850, 4200, 4200]);
    expect(plan(true).durationMs).toBeLessThan(plan().durationMs);
  });

  it("finishes at the same real-time duration at 1x, 2x and 4x while those clocks advance differently", () => {
    const value = plan();
    const result = (["1x", "2x", "4x"] as const).map((speed) => {
      let cursor = createShotPacingCursor(value);
      let realMs = 0;
      let steps = 0;
      let remainderMinutes = 0;
      while (!shotPacingFrame(value, cursor)!.complete) {
        const delta = Math.min(100, value.durationMs - cursor.elapsedMs);
        cursor = advanceShotPacingCursor(value, cursor, delta)!;
        realMs += delta;
        const clock = consumeClock(delta, speed, remainderMinutes);
        steps += clock.steps;
        remainderMinutes = clock.remainderMinutes;
      }
      return { realMs, steps, frame: shotPacingFrame(value, cursor) };
    });
    expect(result.map((item) => item.realMs)).toEqual([value.durationMs, value.durationMs, value.durationMs]);
    expect(result[1].steps).toBeGreaterThan(result[0].steps);
    expect(result[2].steps).toBeGreaterThan(result[1].steps);
    expect(result[0].frame).toEqual(result[1].frame);
    expect(result[1].frame).toEqual(result[2].frame);
  });

  it.each([1000 / 120, 1000 / 60, 1000 / 30, 100])("uses elapsed milliseconds consistently at %f ms frame intervals", (interval) => {
    const value = plan();
    let cursor = createShotPacingCursor(value);
    let frames = 0;
    while (cursor.elapsedMs < value.durationMs && frames++ < 2000) {
      cursor = advanceShotPacingCursor(value, cursor, Math.min(interval, value.durationMs - cursor.elapsedMs))!;
    }
    expect(cursor.elapsedMs).toBe(value.durationMs);
    expect(shotPacingFrame(value, cursor)).toMatchObject({ progress: 1, motionProgress: 1, complete: true });
  });

  it("exposes address, contact, exact retained flight/contact/roll, rest and completion", () => {
    const input = source();
    const value = createShotPacingPlan(input)!;
    const at = (elapsedMs: number) => shotPacingFrame(value, { version: 1, key: value.key, elapsedMs })!;
    const motionStartMs = value.addressMs + value.contactMs;
    const motionEndMs = value.durationMs - value.restMs;
    expect(at(0)).toMatchObject({ phase: "address", motionProgress: 0, addressing: true });
    expect(at(value.addressMs)).toMatchObject({ phase: "contact", motionProgress: 0, addressing: true });
    expect(at(motionStartMs)).toMatchObject({ phase: "flight", motionProgress: 0, addressing: false });
    const firstContactMs = shotPacingEventProgress(value, value.firstContactT)! * value.durationMs;
    const contact = at(firstContactMs);
    expect(contact.motionProgress).toBeCloseTo(input.motion.groundPath[0]!.time);
    expect(sampleRetainedShotMotion(input.motion, contact.motionProgress)!.point).toEqual(input.motion.landing.point);
    expect(at(firstContactMs + .01).phase).toBe("roll");
    expect(at(motionEndMs)).toMatchObject({ phase: "rest", motionProgress: 1, complete: false });
    expect(at(value.durationMs)).toMatchObject({ phase: "complete", motionProgress: 1, complete: true });
  });

  it("starts ground-only putts at roll and preserves retained event ratios without a synthetic flight", () => {
    const value = plan(true);
    expect(value.firstContactT).toBe(0);
    const atLaunch = { version: 1 as const, key: value.key, elapsedMs: value.addressMs + value.contactMs };
    expect(shotPacingFrame(value, atLaunch)).toMatchObject({ phase: "roll", motionProgress: 0 });
    expect(shotPacingEventProgress(value, 0)).toBe(atLaunch.elapsedMs / value.durationMs);
    expect(shotPacingEventProgress(value, 1)).toBe((value.durationMs - value.restMs) / value.durationMs);
  });

  it("holds pause/hidden frames and caps a resumed or stalled wall-time delta", () => {
    const value = plan();
    const cursor = createShotPacingCursor(value);
    expect(advanceShotPacingCursor(value, cursor, 500, { paused: true })).toBe(cursor);
    expect(advanceShotPacingCursor(value, cursor, 500, { hidden: true })).toBe(cursor);
    expect(advanceShotPacingCursor(value, cursor, 60000)!.elapsedMs).toBe(MAX_SHOT_PACING_FRAME_MS);
    expect(advanceShotPacingCursor(value, cursor, 1000, { hidden: true, skip: true })).toBe(cursor);
  });

  it("allows explicit visible skip during pause, stays complete, and never changes identity", () => {
    const value = plan();
    const cursor = createShotPacingCursor(value);
    const skipped = advanceShotPacingCursor(value, cursor, 0, { paused: true, skip: true })!;
    expect(skipped).toEqual({ ...cursor, elapsedMs: value.durationMs });
    expect(shotPacingFrame(value, skipped)).toMatchObject({ key: value.key, shotId: value.identity.shotId, complete: true });
    expect(advanceShotPacingCursor(value, skipped, 50)).toBe(skipped);
  });

  it("saves only its bounded cursor and restores it without replay or mutation", () => {
    const value = plan();
    const saved = { version: 1, key: value.key, elapsedMs: 3456 };
    const before = structuredClone(saved);
    const restored = createShotPacingCursor(value, JSON.parse(JSON.stringify(saved)));
    expect(restored).toEqual(saved);
    expect(Object.isFrozen(restored)).toBe(true);
    expect(saved).toEqual(before);
    const finished = createShotPacingCursor(value, { ...saved, elapsedMs: value.durationMs });
    expect(shotPacingFrame(value, finished)!.complete).toBe(true);
  });

  it("keys every retained identity field, actor and day/round/reconciliation scope", () => {
    const input = source();
    const value = createShotPacingPlan(input)!;
    const variants: CreateShotPacingPlanInput[] = [
      { ...input, scopeId: "live:w3:d3:s123:e0" }, { ...input, scopeId: "live:w3:d2:s123:e1" },
      { ...input, actorId: "golfer:2" },
      ...[{ shotId: "shot-2" }, { holeId: "hole-2" }, { shotNumber: 2 }, { seed: 124 },
        { club: "Driver" }, { style: "fade" }, { modelVersion: "physical_shot_v2" }].map((identity) => source(false, identity)),
    ];
    const saved = advanceShotPacingCursor(value, createShotPacingCursor(value), 100)!;
    for (const variant of variants) {
      const next = createShotPacingPlan(variant)!;
      expect(next.key).not.toBe(value.key);
      expect(isShotPacingCursor(saved, next)).toBe(false);
      expect(createShotPacingCursor(next, saved).elapsedMs).toBe(0);
      expect(advanceShotPacingCursor(next, saved, 16)).toBeNull();
      expect(shotPacingFrame(next, saved)).toBeNull();
    }
    expect(createShotPacingPlan({ ...input, scopeId: "a:b", actorId: "c" })!.key)
      .not.toBe(createShotPacingPlan({ ...input, scopeId: "a", actorId: "b:c" })!.key);
  });

  it("rejects absent retained paths, malformed timing/distance and invalid owner labels", () => {
    const input = source();
    for (const distanceYards of [NaN, Infinity, -Infinity, -1]) {
      expect(createShotPacingPlan({ ...input, distanceYards })).toBeNull();
      expect(shotPacingDurationMs("swing", distanceYards)).toBeNull();
      expect(shotPacingDurationMs("putt", distanceYards)).toBeNull();
    }
    expect(createShotPacingPlan(null as unknown as CreateShotPacingPlanInput)).toBeNull();
    expect(createShotPacingPlan({ ...input, motion: undefined as unknown as typeof input.motion })).toBeNull();
    expect(createShotPacingPlan({ ...input, motion: { ...input.motion, groundPath: [] } })).toBeNull();
    expect(createShotPacingPlan({ ...input, scopeId: "" })).toBeNull();
    expect(createShotPacingPlan({ ...input, actorId: "x\ny" })).toBeNull();
    expect(createShotPacingPlan({ ...input, scopeId: "a".repeat(257) })).toBeNull();
  });

  it("rejects malformed saved cursors and event times; invalid deltas are harmless", () => {
    const value = plan();
    const cursor = createShotPacingCursor(value);
    const invalid: unknown[] = [undefined, null, [], "cursor", { ...cursor, extra: true }, { ...cursor, version: 2 },
      { ...cursor, key: "another-shot" }, ...[NaN, Infinity, -Infinity, -1, value.durationMs + 1, "0"].map((elapsedMs) => ({ ...cursor, elapsedMs })),
      Object.assign(Object.create(cursor), { a: 1, b: 2, c: 3 })];
    for (const saved of invalid) {
      expect(isShotPacingCursor(saved, value)).toBe(false);
      expect(createShotPacingCursor(value, saved)).toEqual(cursor);
      expect(shotPacingFrame(value, saved as ShotPacingCursorV1)).toBeNull();
    }
    for (const delta of [NaN, Infinity, -Infinity, 0, -1]) expect(advanceShotPacingCursor(value, cursor, delta)).toBe(cursor);
    for (const time of [NaN, Infinity, -Infinity, -.1, 1.1]) expect(shotPacingEventProgress(value, time)).toBeNull();
  });

  it("leaves retained geometry, outcome identity and inputs unchanged", () => {
    const input = source();
    const before = structuredClone(input);
    const value = createShotPacingPlan(input)!;
    expect(Object.isFrozen(value)).toBe(true);
    expect(Object.isFrozen(value.identity)).toBe(true);
    const cursor = createShotPacingCursor(value);
    shotPacingFrame(value, advanceShotPacingCursor(value, cursor, 100)!);
    expect(input).toEqual(before);
    expect(cursor.elapsedMs).toBe(0);
    expect(value.identity).not.toBe(input.motion.identity);
  });
});
