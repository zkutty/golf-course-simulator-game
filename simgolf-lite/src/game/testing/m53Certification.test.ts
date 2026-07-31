import { describe, expect, it } from "vitest";
import {
  M53_AUTHORITATIVE_BUDGETS,
  M53_CERTIFICATION_ID,
  M53_HUMAN_VERIFICATION_MATRIX,
  M53_UNRESOLVED_RISKS,
  runM53Certification,
} from "./m53Certification";

describe("M53 / ZK-571 deterministic certification contract", () => {
  it("passes the complete deterministic climate, strategy, and risk contract", () => {
    const first = runM53Certification();
    const second = runM53Certification();
    expect(first.certificationId).toBe(M53_CERTIFICATION_ID);
    expect(first.checks.filter((check) => !check.passed)).toEqual([]);
    expect(first.passed).toBe(true);
    expect(first.determinismHash).toBe(second.determinismHash);
    expect(first.evidence).toEqual(second.evidence);
  });

  it("covers the canonical 144 states and every authoritative weather kind", () => {
    const report = runM53Certification();
    expect(report.evidence).toMatchObject({
      fixtureStates: 144,
      biomes: 3,
      seasons: 4,
      rotations: 4,
      qualities: 3,
    });
    expect(report.evidence.weather.allKinds).toEqual([
      "clear",
      "cloudy",
      "drought",
      "frost",
      "heat",
      "heavy_rain",
      "rain",
      "storm",
    ]);
  });

  it("publishes only the established release budgets", () => {
    const report = runM53Certification();
    expect(report.budgets).toEqual(M53_AUTHORITATIVE_BUDGETS);
    expect(report.budgets).toEqual({
      currentSaveJsonCharacters: 5_000_000,
      releaseSaveBytes: 4_000_000,
      seasonalStateJsonCharacters: 180_000,
      surfaceCareJsonCharacters: 600_000,
      surfaceCareAdvanceMilliseconds: 500,
      hundredGolferSnapshotBytes: 1_000_000,
      rendererWorkMilliseconds: 8,
      coldStartupMilliseconds: 5_000,
      selectedBiomePayloadBytes: 6_291_456,
      initialBundleBytes: 8_388_608,
    });
  });

  it("does not close human, GPU, listening, accessibility, or legacy audio timing risk", () => {
    const report = runM53Certification();
    expect(report.unresolvedRisks).toEqual(M53_UNRESOLVED_RISKS);
    expect(report.humanVerificationMatrix).toEqual(M53_HUMAN_VERIFICATION_MATRIX);
    expect(report.unresolvedRisks.some((risk) =>
      risk.evidence.includes("legacy browser audio suite"))).toBe(true);
    expect(report.unresolvedRisks.some((risk) =>
      risk.evidence.includes("ZK-379")
      && risk.evidence.includes("Linear reconciliation"))).toBe(true);
    expect(report.unresolvedRisks.every((risk) =>
      risk.status === "open" || risk.status === "deferred")).toBe(true);
  });
});
