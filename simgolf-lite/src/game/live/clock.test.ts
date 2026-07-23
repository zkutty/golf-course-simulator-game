import { describe, expect, it } from "vitest";
import { consumeClock, FIXED_GAME_STEP_MINUTES } from "./clock";

describe("live clock", () => {
  it("uses literal 1x, 2x, and 4x ratios", () => {
    const one = consumeClock(1_000, "1x");
    const two = consumeClock(1_000, "2x");
    const four = consumeClock(1_000, "4x");
    expect(two.steps).toBe(one.steps * 2);
    expect(four.steps).toBe(one.steps * 4);
  });

  it("is independent of wall-frame chunking", () => {
    const whole = consumeClock(1_000, "1x");
    let steps = 0;
    let remainder = 0;
    for (let frame = 0; frame < 10; frame++) {
      const next = consumeClock(100, "1x", remainder);
      steps += next.steps;
      remainder = next.remainderMinutes;
    }
    expect(steps).toBe(whole.steps);
    expect(remainder).toBeCloseTo(whole.remainderMinutes, 8);
    expect(steps * FIXED_GAME_STEP_MINUTES + remainder).toBeCloseTo(2.8, 8);
  });

  it("preserves the accumulator while paused", () => {
    expect(consumeClock(10_000, "paused", 0.025)).toEqual({ steps: 0, remainderMinutes: 0.025 });
  });
});
