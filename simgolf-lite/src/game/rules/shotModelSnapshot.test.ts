import { describe, expect, it } from "vitest";
import { createShotModelSnapshotV1, isValidShotModelSnapshot, usesClubShotModel } from "./shotModelSnapshot";

describe("frozen shot model authority", () => {
  it("keeps absent old rounds historical and new rounds JSON-stable", () => {
    expect(usesClubShotModel(undefined)).toBe(false);
    const snapshot = createShotModelSnapshotV1();
    expect(isValidShotModelSnapshot(JSON.parse(JSON.stringify(snapshot)))).toBe(true);
    expect(snapshot).toEqual({ version: 1, mode: "club_styles_v1", calibrationVersion: 1 });
  });
  it("rejects unsupported models and forged future fields", () => {
    for (const value of [null, [], {}, { ...createShotModelSnapshotV1(), version: 2 },
      { ...createShotModelSnapshotV1(), calibrationVersion: 2 },
      { ...createShotModelSnapshotV1(), carryMultiplier: 5 }]) {
      expect(isValidShotModelSnapshot(value)).toBe(false);
    }
  });
});
