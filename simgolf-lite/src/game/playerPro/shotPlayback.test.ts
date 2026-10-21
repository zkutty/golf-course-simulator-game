import { describe, expect, it } from "vitest";
import { advancePlayerShotPresentation, isPlayerShotPresentation, playerShotPlaybackFrame, playerShotDurationMs, type PlayerShotPresentationV1 } from "./shotPlayback";

describe("Player Pro presentation cursor", () => {
  it("keeps address/contact separate from retained motion", () => {
    expect(playerShotPlaybackFrame("s1", .1)).toMatchObject({ addressing: true, motionProgress: 0 });
    expect(playerShotPlaybackFrame("s1", .18)).toMatchObject({ addressing: false, motionProgress: 0 });
    expect(playerShotPlaybackFrame("s1", 1)).toMatchObject({ complete: true, motionProgress: 1 });
  });
  it("gives all display sampling rates the same motion/end for the same elapsed time", () => {
    const duration = playerShotDurationMs("Driver", 250);
    for (const hz of [30, 60, 120]) {
      let cursor: PlayerShotPresentationV1 = { version: 1, shotId: "s1", progress: 0 };
      for (let i = 0; i < hz * 6; i++) cursor = advancePlayerShotPresentation(cursor, 1000 / hz, duration);
      expect(cursor.progress).toBe(1);
    }
  });
  it("pauses, bounds background gaps, and resumes a JSON cursor without replaying address", () => {
    const cursor: PlayerShotPresentationV1 = { version: 1, shotId: "s1", progress: .65 };
    expect(advancePlayerShotPresentation(cursor, 60_000, 3000, true)).toBe(cursor);
    expect(advancePlayerShotPresentation(cursor, 60_000, 3000).progress).toBeCloseTo(.65 + 1 / 30);
    const restored = JSON.parse(JSON.stringify(cursor));
    expect(isPlayerShotPresentation(restored, "s1")).toBe(true);
    expect(playerShotPlaybackFrame(restored.shotId, restored.progress).addressing).toBe(false);
    for (const invalid of [{ ...cursor, progress: NaN }, { ...cursor, progress: 1.01 }, { ...cursor, version: 2 }, { ...cursor, score: 2 }]) {
      expect(isPlayerShotPresentation(invalid, "s1")).toBe(false);
    }
    expect(isPlayerShotPresentation(cursor, "other")).toBe(false);
  });
});
