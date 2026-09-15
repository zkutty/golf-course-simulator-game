import { mulberry32 } from "../../utils/rng";
import {
  BIVARIATE_DISPERSION_MODEL_VERSION,
  BIVARIATE_DISPERSION_PROFILES,
  dispersionClub,
  type ShotClubId,
} from "./dispersionRegistry";
import type { AppliedShotWindV1 } from "./shotEnvironment";

/** A bivariate standard normal contains 68% of its mass inside this radius. */
export const BIVARIATE_DISPERSION_CENTRAL_68_RADIUS = Math.sqrt(-2 * Math.log(.32));
export const BIVARIATE_DISPERSION_MAX_STANDARD_RADIUS = 3.5;

export interface TargetAlignedDispersionPoint {
  longitudinalTiles: number;
  lateralTiles: number;
}

export interface BivariateDispersionInput {
  clubId: string;
  effectiveDispersionTiles: number;
  accuracy: number;
  consistency: number;
  centerlineLongitudinalTiles?: number;
  centerlineLateralTiles?: number;
  directionalBiasLateralTiles?: number;
  correlation?: number;
  appliedWind?: AppliedShotWindV1 | null;
}

export interface BivariateDispersionSample {
  seed: number;
  isTail: boolean;
  mahalanobisRadius: number;
  offset: TargetAlignedDispersionPoint;
  landing: TargetAlignedDispersionPoint;
}

/** Compact resolved state consumed by gameplay and replay validation. */
export interface BivariateDispersionRuntime {
  version: typeof BIVARIATE_DISPERSION_MODEL_VERSION;
  clubId: ShotClubId;
  resolvedFrom: {
    effectiveDispersionTiles: number;
    accuracy: number;
    consistency: number;
    centerlineLongitudinalTiles: number;
    centerlineLateralTiles: number;
  };
  centerline: TargetAlignedDispersionPoint;
  directionalBiasLateralTiles: number;
  appliedWindLateralTiles: number;
  skillMultiplier: number;
  correlation: number;
  covariance: {
    longitudinalVariance: number;
    lateralVariance: number;
    covariance: number;
    determinant: number;
  };
  outerTail: {
    probability: number;
    scale: number;
    maxMahalanobisRadius: number;
  };
}

export type BivariateDispersionRuntimeResult =
  | { ok: true; value: BivariateDispersionRuntime }
  | { ok: false; reason: "unknown_club" | "invalid_input" | "invalid_applied_wind" };

export type BivariateDispersionRuntimeSampleResult =
  | { ok: true; value: BivariateDispersionSample }
  | { ok: false; reason: "invalid_seed" };

export interface ResolvedBivariateDispersionShot {
  resolvedFrom: Pick<BivariateDispersionRuntime["resolvedFrom"],
    "effectiveDispersionTiles" | "accuracy" | "consistency" | "centerlineLateralTiles">;
  centerline: TargetAlignedDispersionPoint;
  appliedWindLateralTiles: number;
  sample: Omit<BivariateDispersionSample, "seed">;
}

export type BivariateDispersionShotInput = Omit<BivariateDispersionInput, "directionalBiasLateralTiles" | "correlation"> & {
  directionalBiasLateralTiles?: never;
  correlation?: never;
};

export function roundBivariateValue(value: number): number {
  return Number(value.toFixed(9));
}

export function covarianceCertificate(value: number): number {
  return Number(value.toPrecision(15));
}

function bounded(value: number | undefined, fallback: number, minimum: number, maximum: number): number | null {
  const resolved = value ?? fallback;
  return Number.isFinite(resolved) && resolved >= minimum && resolved <= maximum ? resolved : null;
}

/** Shared wind guard for compact gameplay and persisted rules evidence. */
export function isValidAppliedShotWindV1(value: unknown): value is AppliedShotWindV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<AppliedShotWindV1>;
  return candidate.version === 1 && candidate.sourceMode === "directional"
    && bounded(candidate.headwindMph, Number.NaN, -70, 70) !== null
    && bounded(candidate.crosswindMph, Number.NaN, -70, 70) !== null
    && bounded(candidate.carryMultiplier, Number.NaN, .25, 1.5) !== null
    && bounded(candidate.lateralCenterlineTiles, Number.NaN, -8, 8) !== null;
}

export function skillMultiplierForBivariateProfile(
  profile: typeof BIVARIATE_DISPERSION_PROFILES[ShotClubId],
  accuracy: number,
  consistency: number,
): number {
  return Math.max(profile.skillFloorMultiplier, (1 - accuracy * .0031) * (1 - consistency * .0027));
}

/** Resolve only the state needed to sample a committed shot. */
export function resolveBivariateDispersionRuntime(input: BivariateDispersionInput): BivariateDispersionRuntimeResult {
  if (!input || typeof input !== "object") return { ok: false, reason: "invalid_input" };
  const candidate = input as Partial<BivariateDispersionInput>;
  if (typeof candidate.clubId !== "string") return { ok: false, reason: "invalid_input" };
  const club = dispersionClub(candidate.clubId);
  if (!club) return { ok: false, reason: "unknown_club" };
  const profile = BIVARIATE_DISPERSION_PROFILES[club.id];
  const base = bounded(candidate.effectiveDispersionTiles, 0, .05, 16);
  const accuracy = bounded(candidate.accuracy, 0, 0, 100);
  const consistency = bounded(candidate.consistency, 0, 0, 100);
  const longitudinalShift = bounded(candidate.centerlineLongitudinalTiles, 0, -8, 8);
  const lateralShift = bounded(candidate.centerlineLateralTiles, 0, -8, 8);
  const directionalBias = bounded(candidate.directionalBiasLateralTiles, 0, -8, 8);
  const correlation = bounded(candidate.correlation, profile.defaultCorrelation, -.92, .92);
  if (base === null || accuracy === null || consistency === null || longitudinalShift === null
    || lateralShift === null || directionalBias === null || correlation === null) {
    return { ok: false, reason: "invalid_input" };
  }
  if (candidate.appliedWind != null && !isValidAppliedShotWindV1(candidate.appliedWind)) {
    return { ok: false, reason: "invalid_applied_wind" };
  }

  const canonicalBase = roundBivariateValue(base);
  const canonicalAccuracy = roundBivariateValue(accuracy);
  const canonicalConsistency = roundBivariateValue(consistency);
  const canonicalLongitudinalShift = roundBivariateValue(longitudinalShift);
  const canonicalLateralShift = roundBivariateValue(lateralShift);
  const skillMultiplier = skillMultiplierForBivariateProfile(profile, canonicalAccuracy, canonicalConsistency);
  const centralLongitudinal = canonicalBase * profile.central68LongitudinalScale * skillMultiplier;
  const centralLateral = canonicalBase * profile.central68LateralScale * skillMultiplier;
  const sigmaLongitudinal = centralLongitudinal / BIVARIATE_DISPERSION_CENTRAL_68_RADIUS;
  const sigmaLateral = centralLateral / BIVARIATE_DISPERSION_CENTRAL_68_RADIUS;
  const covariance = correlation * sigmaLongitudinal * sigmaLateral;
  const determinant = sigmaLongitudinal ** 2 * sigmaLateral ** 2 - covariance ** 2;
  const storedDeterminant = covarianceCertificate(determinant);
  if (!Number.isFinite(determinant) || determinant <= 1e-12 || storedDeterminant <= 0) {
    return { ok: false, reason: "invalid_input" };
  }

  const appliedWindLateralTiles = candidate.appliedWind?.lateralCenterlineTiles ?? 0;
  const tailScale = Math.max(1.25, profile.tailScale * (1 - canonicalConsistency / 100 * .25));
  return {
    ok: true,
    value: {
      version: BIVARIATE_DISPERSION_MODEL_VERSION,
      clubId: club.id,
      resolvedFrom: {
        effectiveDispersionTiles: canonicalBase,
        accuracy: canonicalAccuracy,
        consistency: canonicalConsistency,
        centerlineLongitudinalTiles: canonicalLongitudinalShift,
        centerlineLateralTiles: canonicalLateralShift,
      },
      centerline: {
        longitudinalTiles: canonicalLongitudinalShift,
        lateralTiles: roundBivariateValue(canonicalLateralShift + directionalBias + appliedWindLateralTiles),
      },
      directionalBiasLateralTiles: roundBivariateValue(directionalBias),
      appliedWindLateralTiles: roundBivariateValue(appliedWindLateralTiles),
      skillMultiplier: roundBivariateValue(skillMultiplier),
      correlation: roundBivariateValue(correlation),
      covariance: {
        longitudinalVariance: covarianceCertificate(sigmaLongitudinal ** 2),
        lateralVariance: covarianceCertificate(sigmaLateral ** 2),
        covariance: covarianceCertificate(covariance),
        determinant: storedDeterminant,
      },
      outerTail: {
        probability: roundBivariateValue(profile.tailProbability * (1 - canonicalConsistency / 100 * .55)),
        scale: roundBivariateValue(tailScale),
        maxMahalanobisRadius: roundBivariateValue(BIVARIATE_DISPERSION_MAX_STANDARD_RADIUS * tailScale),
      },
    },
  };
}

function gaussian(rng: () => number): number {
  const u = Math.max(1e-12, rng());
  const v = Math.max(1e-12, rng());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Sample only a runtime produced by the resolver above. */
export function sampleBivariateDispersionRuntime(
  model: BivariateDispersionRuntime,
  seed: number,
): BivariateDispersionRuntimeSampleResult {
  if (!Number.isSafeInteger(seed)) return { ok: false, reason: "invalid_seed" };
  const rng = mulberry32(seed >>> 0);
  const isTail = rng() < model.outerTail.probability;
  let longitudinal = gaussian(rng);
  let lateral = gaussian(rng);
  let radius = Math.hypot(longitudinal, lateral);
  if (radius > BIVARIATE_DISPERSION_MAX_STANDARD_RADIUS) {
    const scale = BIVARIATE_DISPERSION_MAX_STANDARD_RADIUS / radius;
    longitudinal *= scale;
    lateral *= scale;
    radius = BIVARIATE_DISPERSION_MAX_STANDARD_RADIUS;
  }
  const componentScale = isTail ? model.outerTail.scale : 1;
  const sigmaLongitudinal = Math.sqrt(model.covariance.longitudinalVariance);
  const sigmaLateral = Math.sqrt(model.covariance.lateralVariance);
  const independentLateral = Math.sqrt(1 - model.correlation ** 2);
  const offset = {
    longitudinalTiles: roundBivariateValue(longitudinal * sigmaLongitudinal * componentScale),
    lateralTiles: roundBivariateValue((model.correlation * longitudinal + independentLateral * lateral) * sigmaLateral * componentScale),
  };
  return {
    ok: true,
    value: {
      seed: seed >>> 0,
      isTail,
      mahalanobisRadius: roundBivariateValue(radius * componentScale),
      offset,
      landing: {
        longitudinalTiles: roundBivariateValue(model.centerline.longitudinalTiles + offset.longitudinalTiles),
        lateralTiles: roundBivariateValue(model.centerline.lateralTiles + offset.lateralTiles),
      },
    },
  };
}

/** Entry-sized one-shot authority for committed gameplay and certificate replay. */
export function resolveBivariateDispersionShot(
  input: BivariateDispersionShotInput,
  seed: number,
): ResolvedBivariateDispersionShot | null {
  if (!input || typeof input !== "object") return null;
  if ("correlation" in input || "directionalBiasLateralTiles" in input) return null;
  const candidate = input as Partial<BivariateDispersionShotInput>;
  if (typeof candidate.clubId !== "string") return null;
  const club = dispersionClub(candidate.clubId);
  if (!club) return null;
  const profile = BIVARIATE_DISPERSION_PROFILES[club.id];
  if (profile.defaultCorrelation !== 0) return null;
  const base = bounded(candidate.effectiveDispersionTiles, 0, .05, 16);
  const accuracy = bounded(candidate.accuracy, 0, 0, 100);
  const consistency = bounded(candidate.consistency, 0, 0, 100);
  const longitudinalShift = bounded(candidate.centerlineLongitudinalTiles, 0, -8, 8);
  const lateralShift = bounded(candidate.centerlineLateralTiles, 0, -8, 8);
  if (base === null || accuracy === null || consistency === null || longitudinalShift === null
    || lateralShift === null) return null;
  if (candidate.appliedWind != null && !isValidAppliedShotWindV1(candidate.appliedWind)) {
    return null;
  }
  if (!Number.isSafeInteger(seed)) return null;

  const canonicalBase = roundBivariateValue(base);
  const canonicalAccuracy = roundBivariateValue(accuracy);
  const canonicalConsistency = roundBivariateValue(consistency);
  const canonicalLongitudinalShift = roundBivariateValue(longitudinalShift);
  const canonicalLateralShift = roundBivariateValue(lateralShift);
  const skillMultiplier = skillMultiplierForBivariateProfile(profile, canonicalAccuracy, canonicalConsistency);
  const sigmaLongitudinal = canonicalBase * profile.central68LongitudinalScale * skillMultiplier / BIVARIATE_DISPERSION_CENTRAL_68_RADIUS;
  const sigmaLateral = canonicalBase * profile.central68LateralScale * skillMultiplier / BIVARIATE_DISPERSION_CENTRAL_68_RADIUS;
  const appliedWindLateralTiles = candidate.appliedWind?.lateralCenterlineTiles ?? 0;
  const centerline = {
    longitudinalTiles: canonicalLongitudinalShift,
    lateralTiles: roundBivariateValue(canonicalLateralShift + appliedWindLateralTiles),
  };
  const tailProbability = roundBivariateValue(profile.tailProbability * (1 - canonicalConsistency / 100 * .55));
  const tailScale = roundBivariateValue(Math.max(1.25, profile.tailScale * (1 - canonicalConsistency / 100 * .25)));
  const rng = mulberry32(seed >>> 0);
  const isTail = rng() < tailProbability;
  let longitudinal = gaussian(rng);
  let lateral = gaussian(rng);
  let radius = Math.hypot(longitudinal, lateral);
  if (radius > BIVARIATE_DISPERSION_MAX_STANDARD_RADIUS) {
    const scale = BIVARIATE_DISPERSION_MAX_STANDARD_RADIUS / radius;
    longitudinal *= scale;
    lateral *= scale;
    radius = BIVARIATE_DISPERSION_MAX_STANDARD_RADIUS;
  }
  const componentScale = isTail ? tailScale : 1;
  const offset = {
    longitudinalTiles: roundBivariateValue(longitudinal * Math.sqrt(covarianceCertificate(sigmaLongitudinal ** 2)) * componentScale),
    lateralTiles: roundBivariateValue(lateral * Math.sqrt(covarianceCertificate(sigmaLateral ** 2)) * componentScale),
  };
  return {
      resolvedFrom: {
        effectiveDispersionTiles: canonicalBase,
        accuracy: canonicalAccuracy,
        consistency: canonicalConsistency,
        centerlineLateralTiles: canonicalLateralShift,
      },
      centerline,
      appliedWindLateralTiles: roundBivariateValue(appliedWindLateralTiles),
      sample: {
        isTail,
        mahalanobisRadius: roundBivariateValue(radius * componentScale),
        offset,
        landing: {
          longitudinalTiles: roundBivariateValue(centerline.longitudinalTiles + offset.longitudinalTiles),
          lateralTiles: roundBivariateValue(centerline.lateralTiles + offset.lateralTiles),
        },
      },
  };
}
