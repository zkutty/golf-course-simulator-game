import { beforeEach, describe, expect, it } from "vitest";
import { m35TelemetrySnapshot, recordM35Metric, resetM35Telemetry } from "./m35Telemetry";
import { completePathPreviewCompute, createPathPreviewMeasurement, pathPreviewTelemetrySnapshot, resetPathPreviewTelemetry } from "./pathPreviewTelemetry";

beforeEach(() => { resetM35Telemetry(); resetPathPreviewTelemetry(); });
const resolution = (key = "candidate") => ({ key, keyMs: 2, buildMs: 7, built: true, succeeded: true });

describe("path preview synchronous compute receipts", () => {
  it("retains the real build and first quote across StrictMode-like same-key cache hits, then completes once", () => {
    const owner = createPathPreviewMeasurement(); owner.observe(resolution());
    const receipt = owner.receipt(3)!;
    owner.observe({ ...resolution(), built: false, buildMs: 0 });
    const accumulated = owner.receipt(99)!;
    expect(accumulated).toEqual({ ...receipt, keyMs: 4 });
    expect(completePathPreviewCompute(accumulated, 5, 11)).toBe(true);
    expect(completePathPreviewCompute(receipt, 500, 1100)).toBe(false);
    const diagnostic = pathPreviewTelemetrySnapshot();
    expect(diagnostic).toMatchObject({ resolutionCount: 2, buildCount: 1, failedBuildCount: 0, completedCount: 1 });
    expect(diagnostic.samples).toEqual([{ ...accumulated, clipMs: 5, drawMs: 11, totalMs: 30 }]);
    expect(m35TelemetrySnapshot().surfacePreview).toEqual({ count: 1, meanMs: 30, p95Ms: 30, maxMs: 30 });
  });

  it("reports discarded/failed attempts separately from successfully drawn candidates", () => {
    const owner = createPathPreviewMeasurement(); owner.observe(resolution("discarded")); const discarded = owner.receipt(1)!;
    owner.observe({ ...resolution("failed"), succeeded: false }); expect(owner.receipt(2)).toBeNull();
    owner.observe(resolution("drawn")); const drawn = owner.receipt(3)!;
    expect(completePathPreviewCompute(drawn, 5, 11)).toBe(true);
    expect(completePathPreviewCompute(discarded, 5, 11)).toBe(false);
    expect(pathPreviewTelemetrySnapshot()).toMatchObject({ buildCount: 3, failedBuildCount: 1, completedCount: 1, lastKey: "drawn" });
    expect(pathPreviewTelemetrySnapshot().samples.map((sample) => sample.key)).toEqual(["drawn"]);
  });

  it("invalidates pending receipts on reset and clears the per-resolver owner without retaining geometry", () => {
    const owner = createPathPreviewMeasurement(); owner.observe(resolution()); const stale = owner.receipt(3)!;
    resetM35Telemetry(); resetPathPreviewTelemetry();
    expect(completePathPreviewCompute(stale, 5, 11)).toBe(false);
    expect(pathPreviewTelemetrySnapshot()).toMatchObject({ resolutionCount: 0, buildCount: 0, completedCount: 0, lastKey: null, samples: [] });
    expect(m35TelemetrySnapshot().surfacePreview.count).toBe(0);
    owner.clear(); expect(owner.receipt(3)).toBeNull();
    owner.observe(resolution("fresh")); expect(completePathPreviewCompute(owner.receipt(3)!, 5, 11)).toBe(true);
  });

  it("bounds history at240 copied scalar records while preserving actual total counters", () => {
    const owner = createPathPreviewMeasurement();
    for (let index = 0; index < 260; index++) {
      owner.observe(resolution(`candidate:${index}`));
      const receipt = { ...owner.receipt(3)!, course: { tiles: ["path"] }, graph: { points: [1, 2] } };
      expect(completePathPreviewCompute(receipt, 5, 11)).toBe(true);
    }
    const read = pathPreviewTelemetrySnapshot();
    expect(read.buildCount).toBe(260); expect(read.completedCount).toBe(260); expect(read.samples).toHaveLength(240);
    expect(read.samples[0].key).toBe("candidate:20");
    expect(Object.keys(read.samples[0]).sort()).toEqual(["epoch", "id", "key", "quoteMs", "keyMs", "buildMs", "clipMs", "drawMs", "totalMs"].sort());
    expect(Object.values(read.samples[0]).every((value) => typeof value === "string" || typeof value === "number")).toBe(true);
    read.samples[0] = { ...read.samples[0], key: "reader mutation" }; read.samples.pop();
    expect(pathPreviewTelemetrySnapshot().samples).toHaveLength(240);
    expect(pathPreviewTelemetrySnapshot().samples[0].key).toBe("candidate:20");
    expect(m35TelemetrySnapshot().surfacePreview).toEqual({ count: 240, meanMs: 28, p95Ms: 28, maxMs: 28 });
  });

  it("rejects invalid phases without completing or changing other M35 metrics", () => {
    recordM35Metric("surfaceCommit", 17); recordM35Metric("chunkRebuild", 19);
    const before = m35TelemetrySnapshot(); const owner = createPathPreviewMeasurement(); owner.observe(resolution());
    expect(owner.receipt(undefined)).toBeNull(); expect(owner.receipt(Number.NaN)).toBeNull(); expect(owner.receipt(-1)).toBeNull();
    const receipt = owner.receipt(3)!;
    expect(completePathPreviewCompute(receipt, Number.NaN, 11)).toBe(false);
    expect(completePathPreviewCompute(receipt, 5, -1)).toBe(false);
    expect(pathPreviewTelemetrySnapshot().completedCount).toBe(0);
    expect(m35TelemetrySnapshot()).toEqual(before);
    expect(completePathPreviewCompute(receipt, 5, 11)).toBe(true);
    expect(m35TelemetrySnapshot().surfaceCommit).toEqual(before.surfaceCommit);
    expect(m35TelemetrySnapshot().chunkRebuild).toEqual(before.chunkRebuild);
  });
});
