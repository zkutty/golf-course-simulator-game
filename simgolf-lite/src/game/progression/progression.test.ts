import { describe, expect, it } from "vitest";
import {
  isConcessionUnlocked,
  isObstacleUnlocked,
  isTerrainUnlocked,
  nextReputationTier,
  reputationProgress,
  reputationTier,
  unlockedStaffRoles,
} from "./progression";

describe("M7 reputation progression", () => {
  it("selects tiers and computes progress toward the next goal", () => {
    expect(reputationTier(0).id).toBe("municipal");
    expect(reputationTier(40).id).toBe("local");
    expect(reputationTier(85).id).toBe("legendary");
    expect(nextReputationTier(40)?.minReputation).toBe(45);
    expect(reputationProgress(35)).toBeCloseTo(.5);
    expect(reputationProgress(100)).toBe(1);
  });

  it("unlocks content across concessions, staff, terrain, and decor", () => {
    expect(isTerrainUnlocked("water", 24)).toBe(false);
    expect(isTerrainUnlocked("water", 25)).toBe(true);
    expect(isConcessionUnlocked("pro_shop", 44)).toBe(false);
    expect(isConcessionUnlocked("pro_shop", 45)).toBe(true);
    expect(isObstacleUnlocked("rock", 64)).toBe(false);
    expect(unlockedStaffRoles(85)).toHaveLength(5);
  });
});
