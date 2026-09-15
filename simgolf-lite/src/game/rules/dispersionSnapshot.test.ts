import { describe, expect, it } from "vitest";
import {
  createBivariateDispersionRoundSnapshotV1,
  decodeDispersionRoundSnapshotV1,
} from "./dispersionSnapshot";

describe("ZK-772 dispersion round snapshot", () => {
  it("creates the released bivariate authority and explicitly normalizes missing history to scalar", () => {
    expect(createBivariateDispersionRoundSnapshotV1()).toEqual({ version: 1, mode: "bivariate_v1", modelVersion: 1 });
    expect(decodeDispersionRoundSnapshotV1(undefined)).toEqual({
      ok: true,
      value: { version: 1, mode: "legacy_scalar" },
      normalizedLegacy: true,
    });
    expect(decodeDispersionRoundSnapshotV1(null).ok).toBe(false);
  });

  it("fails closed for unknown versions, modes, and model versions", () => {
    expect(decodeDispersionRoundSnapshotV1({ version: 2, mode: "bivariate_v1", modelVersion: 1 }).ok).toBe(false);
    expect(decodeDispersionRoundSnapshotV1({ version: 1, mode: "future", modelVersion: 1 }).ok).toBe(false);
    expect(decodeDispersionRoundSnapshotV1({ version: 1, mode: "bivariate_v1", modelVersion: 2 }).ok).toBe(false);
    expect(decodeDispersionRoundSnapshotV1({ version: 1, mode: "legacy_scalar", modelVersion: 1 }).ok).toBe(false);
  });
});
