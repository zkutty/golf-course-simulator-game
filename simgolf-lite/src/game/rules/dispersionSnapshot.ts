import { BIVARIATE_DISPERSION_MODEL_VERSION } from "./dispersionRegistry";

/**
 * Immutable authority for the dispersion resolver used by one playable
 * round. This intentionally lives beside, rather than inside, the controlled
 * rules snapshot: changing a flight model must never rewrite map/ruling facts.
 */
export interface DispersionRoundSnapshotV1 {
  version: 1;
  mode: "legacy_scalar" | "bivariate_v1";
  /** Present only for a released bivariate resolver. */
  modelVersion?: typeof BIVARIATE_DISPERSION_MODEL_VERSION;
}

export type DispersionRoundSnapshotResult =
  | { ok: true; value: DispersionRoundSnapshotV1; normalizedLegacy: boolean }
  | { ok: false; reason: "invalid-shape" | "unsupported-version" | "invalid-mode" | "invalid-model-version" };

export function createBivariateDispersionRoundSnapshotV1(): DispersionRoundSnapshotV1 {
  return { version: 1, mode: "bivariate_v1", modelVersion: BIVARIATE_DISPERSION_MODEL_VERSION };
}

/**
 * Missing carriers are historical scalar rounds, not an invitation to adopt
 * whatever model happens to be current at reload time.
 */
export function decodeDispersionRoundSnapshotV1(value: unknown): DispersionRoundSnapshotResult {
  if (value === undefined) return { ok: true, value: { version: 1, mode: "legacy_scalar" }, normalizedLegacy: true };
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, reason: "invalid-shape" };
  const candidate = value as Partial<DispersionRoundSnapshotV1>;
  if (candidate.version !== 1) return { ok: false, reason: "unsupported-version" };
  if (candidate.mode === "legacy_scalar") {
    return candidate.modelVersion == null
      ? { ok: true, value: { version: 1, mode: "legacy_scalar" }, normalizedLegacy: false }
      : { ok: false, reason: "invalid-model-version" };
  }
  if (candidate.mode !== "bivariate_v1") return { ok: false, reason: "invalid-mode" };
  return candidate.modelVersion === BIVARIATE_DISPERSION_MODEL_VERSION
    ? { ok: true, value: createBivariateDispersionRoundSnapshotV1(), normalizedLegacy: false }
    : { ok: false, reason: "invalid-model-version" };
}
