import { describe, expect, it } from "vitest";
import type { Course, Terrain, World } from "../models/types";
import { DEFAULT_WORLD } from "../models/defaults";
import { courseGeometryVersion, normalizeLivingClub } from "../livingClub/livingClub";
import type { ArchitectureShotEvidence } from "../livingClub/types";
import { buildArchitectureReview, defaultArchitectureFilters } from "./review";

function reviewCourse(): Course {
  const width = 48;
  const height = 22;
  const hole = { id: "review-hole", name: "Review hole", tee: { x: 4, y: 11 }, green: { x: 43, y: 11 }, parMode: "MANUAL" as const, parManual: 4 as const };
  return {
    width,
    height,
    tiles: new Array<Terrain>(width * height).fill("fairway"),
    elevations: new Array(width * height).fill(0),
    holes: [hole],
    layouts: [{ id: "review-course", name: "Review course", draftHoleIds: [hole.id], publishedHoleIds: [hole.id], roundLength: 9, state: "open", greenFee: 65 }],
    activeCourseId: "review-course",
    obstacles: [],
    buildings: [],
    decorations: [],
    yardsPerTile: 10,
    name: "Review course",
    baseGreenFee: 65,
    condition: .9,
    theme: "parkland",
  };
}

function shot(course: Course, id: string, geometryVersion = courseGeometryVersion(course)): ArchitectureShotEvidence {
  return {
    id,
    source: "regular",
    sourceSegment: "review-test",
    golferId: "golfer",
    golferName: "Review Tester",
    roundId: `round-${id}`,
    week: 8,
    day: 1,
    courseId: "review-course",
    courseName: "Review course",
    holeId: "review-hole",
    teeSet: "member",
    pinRotation: "A",
    geometryVersion,
    shotType: "approach",
    shotNumber: 2,
    from: { x: 14, y: 11 },
    landing: { x: 23, y: 11 },
    rest: { x: 23, y: 11 },
    scoreToPar: 1,
    waitMinutes: 0,
  };
}

function reviewWorld(evidence: ArchitectureShotEvidence[]): World {
  const living = normalizeLivingClub(DEFAULT_WORLD.livingClub);
  return {
    ...DEFAULT_WORLD,
    week: 10,
    livingClub: { ...living, architecture: { ...living.architecture, evidence } },
  };
}

describe("architecture review filter scope", () => {
  it("distinguishes filtered-empty scopes from matching historical evidence", () => {
    const course = reviewCourse();
    const current = shot(course, "current");
    const historical = { ...shot(course, "historical", "old-geometry"), week: 1 };
    const allFilters = { ...defaultArchitectureFilters(course), recency: "all" as const };

    const mixed = buildArchitectureReview(course, reviewWorld([current, historical]), allFilters);
    expect(mixed).toMatchObject({ status: "sparse", currentEvidence: 1, historicalEvidence: 1 });

    const currentOnly = buildArchitectureReview(course, reviewWorld([current, historical]), { ...allFilters, recency: "current" });
    expect(currentOnly).toMatchObject({ status: "sparse", currentEvidence: 1, historicalEvidence: 0 });

    const historicalOnly = buildArchitectureReview(course, reviewWorld([current, historical]), { ...allFilters, recency: "historical" });
    expect(historicalOnly).toMatchObject({ status: "stale-only", currentEvidence: 0, historicalEvidence: 1 });

    const recentOnly = buildArchitectureReview(course, reviewWorld([historical]), { ...allFilters, recency: "recent" });
    expect(recentOnly).toMatchObject({ status: "stale-only", currentEvidence: 0, historicalEvidence: 0 });

    const recentMixed = buildArchitectureReview(course, reviewWorld([
      { ...current, week: 1 },
      { ...historical, week: 2 },
    ]), { ...allFilters, recency: "recent" });
    expect(recentMixed).toMatchObject({ status: "empty", currentEvidence: 0, historicalEvidence: 0 });
    expect(recentMixed.explanation).toContain("selected evidence-age filter for this scope");

    const mismatchedScopes = [
      { holeId: "missing-hole" as const },
      { teeSet: "championship" as const },
      { pinRotation: "B" as const },
      { sourceSegment: "missing-source" as const },
    ];
    for (const mismatch of mismatchedScopes) {
      const filtered = buildArchitectureReview(course, reviewWorld([current, historical]), { ...allFilters, ...mismatch });
      expect(filtered.status).toBe("empty");
      expect(filtered.explanation).toContain("selected course, hole, tee, pin, and source filters");
    }
  });

  it("keeps legacy evidence without a pin deterministic and out of pin-specific readiness", () => {
    const course = reviewCourse();
    const { pinRotation: _pinRotation, ...legacy } = shot(course, "legacy");
    const pinSpecific = buildArchitectureReview(course, reviewWorld([legacy]), { ...defaultArchitectureFilters(course), recency: "all", pinRotation: "A" });
    expect(pinSpecific).toMatchObject({ status: "empty", currentEvidence: 0, historicalEvidence: 0 });

    const pinAgnostic = buildArchitectureReview(course, reviewWorld([legacy]), { ...defaultArchitectureFilters(course), recency: "all", pinRotation: "all" });
    expect(pinAgnostic).toMatchObject({ status: "sparse", currentEvidence: 1, historicalEvidence: 0 });
  });
});
