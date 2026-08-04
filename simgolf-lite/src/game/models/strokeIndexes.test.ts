import { describe, expect, it } from "vitest";
import {
  normalizeCourseLayouts,
  publishLayout,
} from "./courseLayouts";
import { strokeIndexesForModeledGaps, validateStrokeIndexes } from "./strokeIndexes";
import type { Course } from "./types";
import { createTournamentStandardsCourse } from "../testing/referenceCourse";

function scorecard(indexes: Array<number | undefined>): Course {
  const holes = indexes.map((holeIndex, index) => ({
    id: `hole-${index + 1}`,
    name: `Hole ${index + 1}`,
    tee: { x: 1, y: index },
    green: { x: 8, y: index },
    parMode: "MANUAL" as const,
    parManual: 4 as const,
    ...(holeIndex == null ? {} : { holeIndex }),
  }));
  return {
    width: 10, height: Math.max(10, holes.length + 1),
    tiles: Array.from({ length: 10 * Math.max(10, holes.length + 1) }, () => "rough" as const),
    elevations: Array(10 * Math.max(10, holes.length + 1)).fill(0),
    holes, obstacles: [], buildings: [], yardsPerTile: 10, name: "Index fixture", baseGreenFee: 0, condition: 1,
  };
}

describe("ZK-717 stroke-index contract", () => {
  it.each([
    ["nine holes ranks the largest modeled gap first", Array.from({ length: 9 }, (_, index) => ({ id: `h${index}`, gap: index })), [9, 8, 7, 6, 5, 4, 3, 2, 1]],
    ["ties use stable hole identity", [{ id: "z", gap: 2 }, { id: "a", gap: 2 }, ...Array.from({ length: 7 }, (_, index) => ({ id: `m${index}`, gap: 0 }))], [2, 1, 3, 4, 5, 6, 7, 8, 9]],
    ["eighteen holes allocate the top nine to odd indexes", Array.from({ length: 18 }, (_, index) => ({ id: `h${index}`, gap: 18 - index })), [1, 3, 5, 7, 9, 11, 13, 15, 17, 2, 4, 6, 8, 10, 12, 14, 16, 18]],
  ])("%s", (_name, gaps, expected) => {
    expect(strokeIndexesForModeledGaps(gaps)).toEqual(expected);
  });

  it("reports exact holes and indexes needing repair without blocking gross-only callers", () => {
    const invalid = scorecard([1, 1, undefined, 4, 5, 6, 7, 8, 9]);
    expect(validateStrokeIndexes(invalid)).toEqual({
      valid: false,
      reasons: [
        "Assign a stroke index to Hole 3.",
        "Stroke index 1 is duplicated on Hole 1, Hole 2.",
        "Assign missing stroke indexes: 2, 3.",
      ],
    });
  });

  it("recalculates automatic indexes on publish without replacing a manual index", () => {
    const initial = normalizeCourseLayouts(createTournamentStandardsCourse());
    const layout = initial.layouts![0];
    const manualId = layout.draftHoleIds[0];
    const course = {
      ...initial,
      holes: initial.holes.map((hole) => hole.id === manualId
        ? { ...hole, holeIndex: 18, holeIndexSource: "manual" as const }
        : hole),
    };
    const published = publishLayout(course, layout.id);
    expect(published.reasons).toEqual([]);
    const indexes = published.course.layouts![0].publishedHoleIds.map((id) => published.course.holes.find((hole) => hole.id === id)!);
    expect(indexes[0]).toMatchObject({ holeIndex: 18, holeIndexSource: "manual" });
    expect(validateStrokeIndexes({ ...published.course, holes: indexes }).valid).toBe(true);
    const republished = publishLayout({ ...published.course, name: "Unrelated edit" }, layout.id);
    expect(republished.course.holes.find((hole) => hole.id === manualId)).toMatchObject({ holeIndex: 18, holeIndexSource: "manual" });
  }, 30_000);
});
