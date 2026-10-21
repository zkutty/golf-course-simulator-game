import { describe, expect, it } from "vitest";
import {
  ARCCOS_2026_SOURCE_METADATA,
  DISTANCE_BENCHMARK_CORPUS_VERSION,
  DISTANCE_BENCHMARK_OBSERVATIONS,
  DISTANCE_BENCHMARK_SOURCES,
  isDistanceBenchmarkObservation,
  isDistanceBenchmarkSource,
} from "./distanceBenchmarks";

describe("public distance benchmark corpus", () => {
  it("keeps the versioned source registry valid, unique, and distinct from 2026 metadata", () => {
    expect(DISTANCE_BENCHMARK_CORPUS_VERSION).toBe(1);
    expect(DISTANCE_BENCHMARK_SOURCES.every(isDistanceBenchmarkSource)).toBe(true);
    expect(new Set(DISTANCE_BENCHMARK_SOURCES.map(({ id }) => id)).size).toBe(DISTANCE_BENCHMARK_SOURCES.length);
    expect(ARCCOS_2026_SOURCE_METADATA.dataPeriod).toBe("2025 play");
    expect(DISTANCE_BENCHMARK_SOURCES.some(({ id }) => id.includes("2026"))).toBe(false);
  });

  it("reproduces all cited Arccos median anchors with unknown carry retained", () => {
    const arccos = DISTANCE_BENCHMARK_OBSERVATIONS.filter(({ sourceId }) => sourceId === "arccos-2020-smart-distance");
    expect(arccos.map(({ club, handicapValue, value, metric, carryStatus }) => [club, handicapValue, value, metric, carryStatus])).toEqual([
      ["7-iron", 0, 159, "median", "unspecified"], ["7-iron", 10, 148, "median", "unspecified"], ["7-iron", 20, 140, "median", "unspecified"],
      ["pitching wedge", 0, 122, "median", "unspecified"], ["pitching wedge", 10, 114, "median", "unspecified"], ["pitching wedge", 20, 104, "median", "unspecified"],
    ]);
  });

  it("reproduces Shot Scope P-Avg anchors without inferring publication date or carry", () => {
    const shotScope = DISTANCE_BENCHMARK_OBSERVATIONS.filter(({ sourceId }) => sourceId === "shotscope-data-booklet");
    expect(shotScope.map(({ handicapValue, value, metric, carryStatus }) => [handicapValue, value, metric, carryStatus])).toEqual([
      [0, 285, "performance_average", "unspecified"], [5, 259, "performance_average", "unspecified"], [10, 256, "performance_average", "unspecified"],
      [15, 238, "performance_average", "unspecified"], [20, 225, "performance_average", "unspecified"], [25, 204, "performance_average", "unspecified"],
    ]);
    expect(DISTANCE_BENCHMARK_SOURCES[1].publicationDate).toBeNull();
    expect(shotScope.every((observation) => observation.club === null)).toBe(true);
  });

  it("validates strict schema, source-specific metric, units, and nonnegative values", () => {
    const record = DISTANCE_BENCHMARK_OBSERVATIONS[0];
    expect(isDistanceBenchmarkObservation(record)).toBe(true);
    expect(isDistanceBenchmarkObservation({ ...record, extra: true })).toBe(false);
    expect(isDistanceBenchmarkObservation({ ...record, value: -1 })).toBe(false);
    expect(isDistanceBenchmarkObservation({ ...record, unit: "m" })).toBe(false);
    expect(isDistanceBenchmarkObservation({ ...record, metric: "mean" })).toBe(false);
    expect(isDistanceBenchmarkObservation({ ...record, metric: "performance_average" })).toBe(false);
    expect(isDistanceBenchmarkObservation({ ...record, carryStatus: "carry" })).toBe(false);
    expect(isDistanceBenchmarkObservation({ ...record, sampleSize: 0 })).toBe(false);
    expect(isDistanceBenchmarkObservation({ ...record, handicapValue: -2 })).toBe(false);
    expect(isDistanceBenchmarkObservation({ ...record, handicapBand: [8, 4] })).toBe(false);
    expect(isDistanceBenchmarkSource({ ...DISTANCE_BENCHMARK_SOURCES[0], unexpected: "field" })).toBe(false);
  });
});
