import { beforeAll, describe, expect, it } from "vitest";
import {
  M50_REMAINING_HUMAN_GATES,
  runM50Certification,
  type M50CertificationReport,
} from "./m50Certification";

describe("M50 automated certification slice", () => {
  let report: M50CertificationReport;

  beforeAll(() => {
    report = runM50Certification();
  }, 120_000);

  it("passes every automated correctness, determinism, balance, and contract check", () => {
    expect(report.checks.map((check) => check.id)).toEqual([
      "penalty-relief-invariants",
      "obstacle-flight-matrix",
      "lie-recovery-balance",
      "live-recovery-shapes",
      "live-player-shared-outcome",
      "player-preview-execution-parity",
      "save-v19-v20-history",
      "architecture-evidence",
      "representative-legacy-behavior",
      "finite-legal-fuzz",
      "bounded-36-hole-100-golfer-performance",
    ]);
    expect(report.checks.filter((check) => !check.passed)).toEqual([]);
    expect(report.passed).toBe(true);
    expect(report.determinismHash).toMatch(/^[a-f0-9]+$/);
  });

  it("covers bounded recovery, rulings, fuzzing, architecture, and live-scale fixtures", () => {
    expect(report.metrics.recoveryCandidates).toBeGreaterThanOrEqual(3);
    expect(report.metrics.recoveryShapes).toBe(3);
    expect(report.metrics.penaltyCases).toBe(3);
    expect(report.metrics.fuzzShots).toBe(120);
    expect(report.metrics.architectureEvidence).toBeGreaterThan(0);
    expect(report.metrics.performanceHoles).toBe(36);
    expect(report.metrics.performanceGolfers).toBe(100);
    expect(report.metrics.performanceIterations).toBe(250);
    expect(report.metrics.performanceFixtureMs).toBeLessThanOrEqual(15_000);
    expect(report.metrics.performanceAverageRenderStateMs).toBeLessThanOrEqual(8);
  });

  it("keeps unverified visual, accessibility, audio, hardware, and human gates explicitly open", () => {
    expect(report.remainingHumanGates).toEqual(M50_REMAINING_HUMAN_GATES);
    expect(report.remainingHumanGates).toHaveLength(5);
  });
});
