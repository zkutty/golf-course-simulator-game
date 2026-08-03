import { beforeAll, describe, expect, it } from "vitest";
import {
  M62_FIXTURE_IDS,
  M62_REMAINING_HUMAN_GATES,
  runM62Certification,
  type M62CertificationReport,
} from "./m62Certification";

describe("ZK-645 M62 release certification", () => {
  let report: M62CertificationReport;

  beforeAll(async () => {
    report = await runM62Certification();
  }, 120_000);

  it("passes every automated cross-system release check", () => {
    expect(report.checks.map((check) => check.id)).toEqual([
      "named-green-fixture-matrix",
      "ai-differentiation-no-universal-target",
      "automatic-putting-1-3-and-skill",
      "abc-pin-rating-pace-complaint-tournament-consequences",
      "maintenance-tradeoffs-wear-recovery-and-operations",
      "preview-execution-scorecard-replay-trace-architecture-parity",
      "v23-v24-save-resume-freezing-history-malformed-package",
      "full-estate-36-hole-100-golfer-bounded-snapshots",
      "architecture-accessibility-and-bounded-overlays",
    ]);
    expect(report.checks.filter((check) => !check.passed), JSON.stringify(report.checks, null, 2)).toEqual([]);
    expect(report.passed).toBe(true);
    expect(report.determinismHash).toMatch(/^[a-f0-9]{8}$/);
  });

  it("covers every named fixture and release-scale bound", () => {
    expect(report.fixture.greenFixtures).toEqual(M62_FIXTURE_IDS);
    expect(report.metrics.fixtureCases).toBe(M62_FIXTURE_IDS.length);
    expect(report.metrics.distinctFixtureHashes).toBeGreaterThanOrEqual(8);
    expect(report.metrics.aiCohorts).toBe(100);
    expect(report.metrics.aiPreferredTargets).toBeGreaterThanOrEqual(3);
    expect(report.metrics.aiPreferredRoles).toBeGreaterThanOrEqual(3);
    expect(report.metrics.automaticPuttValues).toEqual([1, 2, 3]);
    expect(report.metrics.pinRotations).toBe(3);
    expect(report.metrics.maintenancePrograms).toBe(3);
    expect(report.fixture).toMatchObject({ width: 220, height: 140, holes: 36, activeGolfers: 100 });
    expect(report.metrics.liveSnapshotBytes).toBeLessThan(1_000_000);
    expect(report.metrics.fullEstateSaveBytes).toBeLessThan(5_000_000);
    expect(report.metrics.architectureOverlayItems).toBeGreaterThan(0);
    expect(report.metrics.architectureBytes).toBeLessThan(256_000);
    expect(report.metrics.fullEstateFixtureMs).toBeLessThan(15_000);
    expect(report.metrics.architectureMs).toBeLessThan(30_000);
    expect(report.metrics.baseArchitectureReviewMs).toBeLessThan(750);
  });

  it("keeps subjective and physical-device evidence explicitly open", () => {
    expect(report.remainingHumanGates).toEqual(M62_REMAINING_HUMAN_GATES);
    expect(report.remainingHumanGates).toHaveLength(5);
    expect(report.remainingHumanGates.every((gate) => /Human|Assistive|Physical|Release-owner/.test(gate))).toBe(true);
  });
});
