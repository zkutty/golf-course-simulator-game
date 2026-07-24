import type { CourseOperations, PacePreset } from "./types";

export const PACE_PRESETS: Record<PacePreset, CourseOperations> = {
  relaxed: { preset: "relaxed", teeIntervalMinutes: 12, maxGroupSize: 4, starterGapEveryGroups: 0, timeParStyle: "relaxed", teeGuidance: "open", enforcement: "advisory", lastTeeMinute: 600, daylightPolicy: "finish_started", compensationPolicy: "goodwill", beverage: { menu: "refreshments", passes: 2, alcoholLimit: 2, price: 8 } },
  balanced: { preset: "balanced", teeIntervalMinutes: 10, maxGroupSize: 4, starterGapEveryGroups: 10, timeParStyle: "standard", teeGuidance: "recommended", enforcement: "active", lastTeeMinute: 600, daylightPolicy: "finish_started", compensationPolicy: "credit", beverage: { menu: "refreshments", passes: 2, alcoholLimit: 2, price: 9 } },
  brisk: { preset: "brisk", teeIntervalMinutes: 12, maxGroupSize: 3, starterGapEveryGroups: 8, timeParStyle: "brisk", teeGuidance: "required", enforcement: "strict", lastTeeMinute: 570, daylightPolicy: "strict_sunset", compensationPolicy: "refund", beverage: { menu: "off", passes: 0, alcoholLimit: 1, price: 9 } },
};

export function normalizeOperations(raw?: Partial<CourseOperations>): CourseOperations {
  const preset: PacePreset = raw?.preset === "relaxed" || raw?.preset === "brisk" ? raw.preset : "balanced";
  const base = PACE_PRESETS[preset];
  const maxGroupSize = raw?.maxGroupSize === 2 || raw?.maxGroupSize === 3 ? raw.maxGroupSize : 4;
  const passes = raw?.beverage?.passes === 0 || raw?.beverage?.passes === 1 || raw?.beverage?.passes === 3 ? raw.beverage.passes : 2;
  const alcoholLimit = raw?.beverage?.alcoholLimit === 1 || raw?.beverage?.alcoholLimit === 3 || raw?.beverage?.alcoholLimit === 4 ? raw.beverage.alcoholLimit : 2;
  const daylightPolicy = raw?.daylightPolicy === "strict_sunset" || raw?.daylightPolicy === "finish_started"
    ? raw.daylightPolicy
    : base.daylightPolicy;
  const compensationPolicy = raw?.compensationPolicy === "refund" || raw?.compensationPolicy === "credit" || raw?.compensationPolicy === "goodwill"
    ? raw.compensationPolicy
    : base.compensationPolicy;
  return {
    ...base,
    ...raw,
    preset,
    teeIntervalMinutes: Math.max(7, Math.min(15, Math.round(raw?.teeIntervalMinutes ?? base.teeIntervalMinutes))),
    maxGroupSize,
    starterGapEveryGroups: Math.max(0, Math.min(12, Math.round(raw?.starterGapEveryGroups ?? base.starterGapEveryGroups))),
    lastTeeMinute: Math.max(240, Math.min(720, Math.round(raw?.lastTeeMinute ?? base.lastTeeMinute))),
    daylightPolicy,
    compensationPolicy,
    beverage: { ...base.beverage, ...raw?.beverage, passes, alcoholLimit, price: Math.max(1, Math.round(raw?.beverage?.price ?? base.beverage.price)) },
  };
}
