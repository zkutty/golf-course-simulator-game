import { describe, expect, it } from "vitest";
import {
  applyPracticeConfidence,
  applyRoundConfidence,
  confidenceAtDay,
  confidenceDispersionMultiplier,
  confidencePracticeGain,
  createPlayerConfidence,
  normalizePlayerConfidence,
} from "./confidence";

describe("Player Pro confidence", () => {
  it("starts neutral and decays twenty percent of the remaining distance daily", () => {
    const high = { ...createPlayerConfidence(), current: 100 };
    expect(confidenceAtDay(high, 1)).toMatchObject({ current: 90, reason: "daily_decay", trend: "falling" });
    expect(confidenceAtDay(high, 2).current).toBe(82);
    expect(confidenceAtDay({ ...high, current: 0 }, 1).current).toBe(10);
  });

  it("uses exact tier practice gains and clamps all persisted values", () => {
    expect([1, 2, 3].map(confidencePracticeGain)).toEqual([6, 8, 10]);
    expect(applyPracticeConfidence({ ...createPlayerConfidence(), current: 96 }, 3)).toMatchObject({ current: 100, reason: "practice" });
    expect(normalizePlayerConfidence({ current: 130, reason: "not-real", lastUpdatedAbsoluteDay: -2 })).toMatchObject({ current: 100, reason: "neutral", lastUpdatedAbsoluteDay: 0 });
  });

  it("records deterministic round feedback and concessions without changing handicap or carry", () => {
    const neutral = createPlayerConfidence();
    expect(applyRoundConfidence(neutral, { indexBefore: 12, differential: 4, conceded: false })).toMatchObject({ current: 54, reason: "round_feedback", trend: "rising" });
    expect(applyRoundConfidence(neutral, { indexBefore: 4, differential: 24, conceded: false }).current).toBe(44);
    expect(applyRoundConfidence(neutral, { indexBefore: 12, differential: null, conceded: true })).toMatchObject({ current: 46, reason: "concession" });
    expect(confidenceDispersionMultiplier({ ...neutral, current: 0 })).toBe(1.04);
    expect(confidenceDispersionMultiplier(neutral)).toBe(1);
    expect(confidenceDispersionMultiplier({ ...neutral, current: 100 })).toBe(.96);
  });
});
