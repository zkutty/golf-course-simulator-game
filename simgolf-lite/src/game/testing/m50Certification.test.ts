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

  it("passes every automated correctness, determinism, bounded-configuration, and contract check", () => {
    expect(report.checks.map((check) => check.id)).toEqual([
      "penalty-relief-invariants",
      "obstacle-flight-matrix",
      "lie-recovery-balance",
      "preview-execution-parity-matrix",
      "live-recovery-shapes",
      "live-player-shared-outcome",
      "scorecard-ruling-agreement",
      "save-v19-v20-compatibility",
      "hostile-input-normalization",
      "architecture-evidence",
      "representative-legacy-behavior",
      "finite-legal-fuzz",
      "bounded-player-ai-rounds",
      "full-estate-36-hole-100-golfer-performance",
    ]);
    expect(report.checks.filter((check) => !check.passed)).toEqual([]);
    expect(report.passed).toBe(true);
    expect(report.determinismHash).toMatch(/^[a-f0-9]+$/);
  });

  it("covers bounded recovery, rulings, fuzzing, architecture, and live-scale fixtures", () => {
    expect(report.metrics.recoveryCandidates).toBeGreaterThanOrEqual(3);
    expect(report.metrics.recoveryShapes).toBe(3);
    expect(report.metrics.penaltyCases).toBe(3);
    expect(report.metrics.previewParityCases).toBe(5);
    expect(report.metrics.migrationHistoryRounds).toBe(3);
    expect(report.metrics.hostileNormalizationCases).toBe(6);
    expect(report.metrics.boundedPlayerRounds).toBe(3);
    expect(report.metrics.boundedAiHoles).toBe(36);
    expect(report.metrics.boundedAiOutcomes).toBeGreaterThan(0);
    expect(report.metrics.boundedAiOutcomes).toBeLessThanOrEqual(240);
    expect(report.metrics.fuzzShots).toBe(120);
    expect(report.metrics.architectureEvidence).toBeGreaterThan(0);
    expect(report.metrics.performanceWidth).toBe(220);
    expect(report.metrics.performanceHeight).toBe(140);
    expect(report.metrics.performanceCells).toBe(30_800);
    expect(report.metrics.performanceHoles).toBe(36);
    expect(report.metrics.performanceGolfers).toBe(100);
    expect(report.metrics.performanceIterations).toBe(250);
    expect(report.metrics.performanceAiRoundMs).toBeLessThanOrEqual(30_000);
    expect(report.metrics.performanceFixtureMs).toBeLessThanOrEqual(15_000);
    expect(report.metrics.performanceAverageRenderStateMs).toBeLessThanOrEqual(8);
  });

  it("keeps unverified visual, accessibility, audio, hardware, provider, and release-owner gates explicitly open", () => {
    expect(report.remainingHumanGates).toEqual(M50_REMAINING_HUMAN_GATES);
    expect(report.remainingHumanGates).toHaveLength(7);
  });
});
