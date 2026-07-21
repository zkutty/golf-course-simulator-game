import { describe, expect, it } from "vitest";
import { DEFAULT_WORLD } from "./models/defaults";
import { analyzeArchitecture } from "./architecture/architecture";
import { createM27ReleaseReferenceCourse } from "./testing/referenceCourse";
import { normalizeLoadedSaveResult } from "../utils/save";
import { achievementProgress, ACHIEVEMENTS } from "./retention/achievements";
import { emptyCourseRecords } from "./retention/records";
import { developedOwnedTileCount } from "./estate/estate";

describe("M27 36-hole release certification", () => {
  it("round-trips the full estate and two uniquely assigned eighteens within the save budget", () => {
    const course = createM27ReleaseReferenceCourse();
    expect(course).toMatchObject({ width: 220, height: 140 });
    expect(course.holes).toHaveLength(36);
    expect(course.layouts?.map((layout) => layout.publishedHoleIds.length)).toEqual([18, 18]);
    expect(new Set(course.layouts?.flatMap((layout) => layout.publishedHoleIds)).size).toBe(36);
    expect(course.estate?.ownedParcelIds).toHaveLength(9);
    const raw = JSON.stringify({ schemaVersion: 9, savedAt: 1, course, world: DEFAULT_WORLD });
    expect(new TextEncoder().encode(raw).byteLength).toBeLessThan(4_000_000);
    const parsed = normalizeLoadedSaveResult(JSON.parse(raw));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.payload.course.holes).toHaveLength(36);
      expect(parsed.payload.course.layouts?.map((layout) => layout.publishedHoleIds.length)).toEqual([18, 18]);
    }
  }, 20_000);

  it("scores architecture deterministically and unlocks persistent expansion achievements", () => {
    const course = createM27ReleaseReferenceCourse();
    const report = analyzeArchitecture(course);
    expect(analyzeArchitecture(course)).toBe(report);
    expect(report.generatedFor.holeIds).toHaveLength(36);
    expect(Object.keys(report.components)).toEqual(["routing", "naturalFit", "variety", "safety", "walkability"]);
    const context = { course, world: DEFAULT_WORLD, records: emptyCourseRecords(36), rating: 72, tutorialCompleted: true, profitStreak: 0, sculpted: false, recoveredDistress: false, perfectMood: false };
    expect(achievementProgress(ACHIEVEMENTS.find((item) => item.id === "second-course")!, context)).toBe(2);
    expect(achievementProgress(ACHIEVEMENTS.find((item) => item.id === "thirty-six-holes")!, context)).toBe(36);
    expect(developedOwnedTileCount(course)).toBeGreaterThan(1_000);
  }, 30_000);
});
