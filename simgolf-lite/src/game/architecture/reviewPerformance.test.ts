import { describe, expect, it } from "vitest";
import { hashCanonicalValue } from "../../utils/canonical";
import { createRenderPerfLiveState } from "../live/simulation";
import { DEFAULT_WORLD } from "../models/defaults";
import { buildM62FullEstateCourse, M62_CERTIFICATION_SEED } from "../testing/m62Certification";
import { ARCHITECTURE_REVIEW_INTERACTIVE_BUDGET_MS, buildArchitectureReview, defaultArchitectureFilters } from "./review";
import { clearStrategicEvaluationCache } from "./strategic";

describe("ZK-698 release-scale Architecture Review performance", () => {
  it("builds the deterministic 220x140 / 36-hole base review within the interactive budget", () => {
    const course = buildM62FullEstateCourse();
    const live = createRenderPerfLiveState(course, {
      ...structuredClone(DEFAULT_WORLD),
      runSeed: M62_CERTIFICATION_SEED,
    });
    const filters = {
      ...defaultArchitectureFilters(course),
      kind: "green-rollout" as const,
      holeId: course.holes[0]!.id!,
      teeSet: "member" as const,
      pinRotation: "all" as const,
      cohortId: "all" as const,
    };
    clearStrategicEvaluationCache();
    const started = performance.now();
    const review = buildArchitectureReview(course, DEFAULT_WORLD, filters);
    const elapsedMs = performance.now() - started;
    const repeated = buildArchitectureReview(course, DEFAULT_WORLD, filters);

    expect(course).toMatchObject({ width: 220, height: 140 });
    expect(course.holes).toHaveLength(36);
    expect(live.golfers).toHaveLength(100);
    const findingsHash = hashCanonicalValue({
      geometry: review.currentGeometryVersion,
      status: review.status,
      strategic: review.strategic,
      recommendations: review.recommendations,
      rules: review.rules,
      overlay: review.overlay,
    });
    console.info("ZK-698 release-scale base review", { elapsedMs, findingsHash });
    expect(findingsHash).toBe("f7ff4b96");
    expect(hashCanonicalValue({
      geometry: repeated.currentGeometryVersion,
      status: repeated.status,
      strategic: repeated.strategic,
      recommendations: repeated.recommendations,
      rules: repeated.rules,
      overlay: repeated.overlay,
    })).toBe(findingsHash);
    expect(review.strategic.evaluation.holes).toHaveLength(108);
    expect(new Set(review.strategic.evaluation.holes.map((hole) => hole.holeId)).size).toBe(36);
    expect(review.strategic.evaluation.samplesPerOption).toBe(8);
    expect(review.strategic.evaluation.holes.every((hole) => hole.sampleCount === 8)).toBe(true);
    expect(review.greenStrategy).toBeNull();
    expect(review.overlay).toEqual({ kind: "green-rollout", traces: [], cells: [], points: [] });
    expect(elapsedMs).toBeLessThan(ARCHITECTURE_REVIEW_INTERACTIVE_BUDGET_MS);
  }, 120_000);
});
