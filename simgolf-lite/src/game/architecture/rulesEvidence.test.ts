import { describe, expect, it } from "vitest";
import type { Course, Terrain, World } from "../models/types";
import { DEFAULT_WORLD } from "../models/defaults";
import { courseGeometryVersion, normalizeLivingClub } from "../livingClub/livingClub";
import type { ArchitectureShotEvidence } from "../livingClub/types";
import { buildArchitectureReview, defaultArchitectureFilters } from "./review";
import { terrainCostMult } from "../balance/difficulty";
import {
  advanceSurfaceCareDay,
  courseWithEffectiveSurfaces,
  normalizeSurfaceCareState,
  surfaceCareTopology,
} from "../conditions/surfaceCare";
import { biomeClimatePhenologyForDay } from "../seasons/seasons";
import { buildArchitectureRulesReview } from "./rulesEvidence";

function course(kind: "safe" | "mandatory" = "safe"): Course {
  const width = 48;
  const height = 22;
  const tiles = new Array<Terrain>(width * height).fill("fairway");
  if (kind === "mandatory") {
    for (let y = 0; y < height; y++) for (let x = 21; x <= 26; x++) tiles[y * width + x] = "water";
  }
  const hole = { id: "rules-hole", name: "Rules hole", tee: { x: 4, y: 11 }, green: { x: 43, y: 11 }, parMode: "MANUAL" as const, parManual: 4 as const };
  return {
    width,
    height,
    tiles,
    elevations: new Array(width * height).fill(0),
    holes: [hole],
    layouts: [{ id: "rules-course", name: "Rules course", draftHoleIds: [hole.id], publishedHoleIds: [hole.id], roundLength: 9, state: "open", greenFee: 65 }],
    activeCourseId: "rules-course",
    obstacles: [],
    buildings: [],
    decorations: [],
    yardsPerTile: 10,
    name: "Rules course",
    baseGreenFee: 65,
    condition: .9,
    theme: "parkland",
  };
}

function evidence(courseValue: Course, id: string, geometryVersion = courseGeometryVersion(courseValue)): ArchitectureShotEvidence {
  return {
    id,
    source: "regular",
    sourceSegment: "test",
    golferId: "golfer",
    golferName: "Rules Tester",
    roundId: `round-${id}`,
    week: 8,
    day: 1,
    courseId: "rules-course",
    courseName: "Rules course",
    holeId: "rules-hole",
    teeSet: "member",
    geometryVersion,
    shotType: "recovery",
    shotNumber: 2,
    from: { x: 14, y: 11 },
    landing: { x: 23, y: 11 },
    rest: { x: 23, y: 11 },
    scoreToPar: 1,
    waitMinutes: 0,
    lieBefore: "rough",
    lieAfter: "water",
  };
}

function world(evidenceItems: ArchitectureShotEvidence[]): World {
  const living = normalizeLivingClub(DEFAULT_WORLD.livingClub);
  return {
    ...DEFAULT_WORLD,
    week: 10,
    livingClub: { ...living, architecture: { ...living.architecture, evidence: evidenceItems } },
  };
}

describe("architecture rules evidence", () => {
  it("reconstructs current penalty and relief evidence from the controlled rules snapshot", () => {
    const mandatory = course("mandatory");
    const review = buildArchitectureReview(mandatory, world([evidence(mandatory, "current-a"), evidence(mandatory, "current-b")]), {
      ...defaultArchitectureFilters(mandatory),
      recency: "current",
    });
    expect(review.rules.currentEvidence).toBe(2);
    expect(review.rules.penaltyCount).toBe(2);
    expect(review.rules.recoveryAttemptCount).toBe(2);
    expect(review.rules.evidence.every((item) => item.status === "reconstructed" && item.penalty?.strokes === 1)).toBe(true);
    expect(review.rules.evidence.every((item) => item.relief.status === "resolved" && item.relief.type === "stroke_and_distance")).toBe(true);
    expect(review.rules.feedback.some((item) => item.id === "rules-rules-hole-penalty-pattern")).toBe(true);
  });

  it("keeps stale traces historical instead of deriving rules against edited geometry", () => {
    const safe = course("safe");
    const stale = evidence(safe, "stale", "old-geometry");
    const review = buildArchitectureReview(safe, world([stale]), { ...defaultArchitectureFilters(safe), recency: "all" });
    expect(review.status).toBe("stale-only");
    expect(review.rules.currentEvidence).toBe(0);
    expect(review.rules.historicalEvidence).toBe(1);
    expect(review.rules.evidence[0]).toMatchObject({ geometry: "historical", status: "historical", penalty: null });
  });

  it("labels sparse and absent evidence as advice rather than a design verdict", () => {
    const safe = course("safe");
    const sparse = buildArchitectureReview(safe, world([evidence(safe, "sparse")]), defaultArchitectureFilters(safe));
    const empty = buildArchitectureReview(safe, world([]), defaultArchitectureFilters(safe));
    expect(sparse.status).toBe("sparse");
    expect(sparse.rules.feedback.some((item) => item.id === "rules-sparse-evidence")).toBe(true);
    expect(empty.status).toBe("empty");
    expect(empty.rules.feedback.some((item) => item.id === "rules-no-current-evidence")).toBe(true);
  });

  it("warns only when a strategic forced hazard lacks a safe bailout", () => {
    const safe = buildArchitectureReview(course("safe"), world([]), defaultArchitectureFilters(course("safe")));
    const mandatoryCourse = course("mandatory");
    const mandatory = buildArchitectureReview(mandatoryCourse, world([]), defaultArchitectureFilters(mandatoryCourse));
    expect(safe.rules.feedback.some((item) => item.id.endsWith("-bailout"))).toBe(false);
    expect(mandatory.rules.feedback.some((item) => item.id.endsWith("-bailout"))).toBe(true);
  });

  it("reports recommendation construction costs at the active run difficulty", () => {
    const mandatory = course("mandatory");
    const filters = defaultArchitectureFilters(mandatory);
    const normal = buildArchitectureReview(
      mandatory,
      { ...world([]), difficulty: "normal" },
      filters,
    );
    const hard = buildArchitectureReview(
      mandatory,
      { ...world([]), difficulty: "hard" },
      filters,
    );
    expect(normal.recommendations.length).toBeGreaterThan(0);
    expect(hard.recommendations.map((item) => item.id)).toEqual(
      normal.recommendations.map((item) => item.id),
    );
    for (let index = 0; index < normal.recommendations.length; index += 1) {
      expect(hard.recommendations[index].constructionCost).toBe(
        Math.round(
          normal.recommendations[index].constructionCost
          * terrainCostMult("hard"),
        ),
      );
    }
  });

  it("uses the effective care projection for hazard overlays and the rules review path", () => {
    const authored = course("safe");
    let degraded = advanceSurfaceCareDay({
      course: authored,
      world: DEFAULT_WORLD,
      absoluteDay: 0,
      weather: {
        absoluteDay: 0,
        kind: "clear",
        temperatureF: 72,
        windMph: 6,
        rainInches: 0,
        severity: 0.05,
        theme: "parkland",
        season: "summer",
      },
      climate: biomeClimatePhenologyForDay("parkland", 0),
      turfPriority: "playability",
      waterPolicy: "irrigate",
      drainageLevel: 1,
      rounds: 0,
    }).course;
    const degradedIndex = 11 * degraded.width + 23;
    const zone = surfaceCareTopology(degraded).zones.find(
      (candidate) => candidate.cells.includes(degradedIndex),
    )!;
    const care = normalizeSurfaceCareState(degraded.surfaceCare, degraded)!;
    degraded = {
      ...degraded,
      surfaceCare: {
        ...care,
        records: {
          ...care.records,
          [zone.key]: {
            ...care.records[zone.key],
            turfHealth: 0.08,
            failureDurationDays: 8,
            repairRequired: true,
          },
        },
      },
    };
    const reviewWorld = world([]);
    const review = buildArchitectureReview(degraded, reviewWorld, {
      ...defaultArchitectureFilters(degraded),
      kind: "hazards",
    });
    expect(degraded.tiles[degradedIndex]).toBe("fairway");
    expect(review.overlay.cells).toContainEqual(expect.objectContaining({
      x: degradedIndex % degraded.width,
      y: Math.floor(degradedIndex / degraded.width),
    }));

    const directRules = buildArchitectureRulesReview({
      course: courseWithEffectiveSurfaces(degraded),
      world: reviewWorld,
      evidence: review.evidence,
      currentGeometryVersion: review.currentGeometryVersion,
      strategicHoles: review.strategic.evaluation.holes,
    });
    expect(review.rules).toEqual(directRules);
  });
});
