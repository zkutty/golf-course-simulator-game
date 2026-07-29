import { beforeEach, describe, expect, it } from "vitest";
import {
  m35TelemetrySnapshot,
  recordM35Metric,
  resetM35Telemetry,
} from "./m35Telemetry";

describe("M35 renderer telemetry", () => {
  beforeEach(resetM35Telemetry);

  it("reports a nearest-rank p95 and bounded maximum", () => {
    for (let value = 1; value <= 100; value++) {
      recordM35Metric("surfacePreview", value);
    }
    expect(m35TelemetrySnapshot().surfacePreview).toEqual({
      count: 100,
      meanMs: 50.5,
      p95Ms: 95,
      maxMs: 100,
    });
  });

  it("retains only the most recent bounded sample window", () => {
    for (let value = 1; value <= 300; value++) {
      recordM35Metric("chunkRebuild", value);
    }
    const summary = m35TelemetrySnapshot().chunkRebuild;
    expect(summary.count).toBe(240);
    expect(summary.maxMs).toBe(300);
    expect(summary.meanMs).toBeGreaterThan(60);
  });

  it("ignores invalid timing samples", () => {
    recordM35Metric("surfaceCommit", Number.NaN);
    recordM35Metric("surfaceCommit", -1);
    expect(m35TelemetrySnapshot().surfaceCommit.count).toBe(0);
  });
});
