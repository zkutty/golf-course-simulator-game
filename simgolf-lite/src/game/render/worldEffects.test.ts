import { describe, expect, it } from "vitest";
import {
  MAX_ACTIVE_IMPACTS,
  MAX_ACTIVE_RIPPLES,
  appendBoundedEffect,
} from "./worldEffects";

describe("bounded M35 world feedback", () => {
  it("keeps the newest effects under deterministic hard caps", () => {
    const ripples: number[] = [];
    for (let value = 0; value < MAX_ACTIVE_RIPPLES + 10; value++) {
      appendBoundedEffect(ripples, value, MAX_ACTIVE_RIPPLES);
    }
    expect(ripples).toHaveLength(MAX_ACTIVE_RIPPLES);
    expect(ripples[0]).toBe(10);

    const impacts: number[] = [];
    for (let value = 0; value < MAX_ACTIVE_IMPACTS + 7; value++) {
      appendBoundedEffect(impacts, value, MAX_ACTIVE_IMPACTS);
    }
    expect(impacts).toHaveLength(MAX_ACTIVE_IMPACTS);
    expect(impacts[0]).toBe(7);
  });

  it("rejects invalid caps without growing the collection", () => {
    const effects = [1, 2];
    appendBoundedEffect(effects, 3, 0);
    expect(effects).toEqual([1, 2]);
  });
});
