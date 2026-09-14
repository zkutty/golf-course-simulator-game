import { mulberry32 } from "../../utils/rng";
import { isValidAppliedShotWindV1 } from "./contracts";
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

/**
 * Principal-axis geometry for a covariance ellipse. `orientationRadians` is
 * measured from the target-aligned longitudinal axis toward the lateral axis.
 * This is deliberately not a pair of target-aligned coordinate scales: when
 * correlation is nonzero the confidence ellipse is rotated.
 */
export interface PrincipalEllipseGeometry {
  principalSemiAxisMajorTiles: number;
  principalSemiAxisMinorTiles: number;
  orientationRadians: number;
}

export interface BivariateDispersionInput {
  clubId: string;
  /**
   * The already-effective scalar from the existing shot-effects authority.
   * This is the sole lie/flight/technique scaling input; callers must not also
   * pass a modifier, which prevents the historical effect from applying twice.
   */
  effectiveDispersionTiles: number;
  accuracy: number;
  consistency: number;
  /** Future curve/elevation owners may shift the expected centerline directly. */
  centerlineLongitudinalTiles?: number;
  centerlineLateralTiles?: number;
  /** A persistent golfer tendency. Zero is valid and is the default. */
  directionalBiasLateralTiles?: number;
  /** A supplied covariance orientation; omitted uses the club's neutral value. */
  correlation?: number;
  /** Already-validated stored evidence only; this model never projects wind. */
  appliedWind?: AppliedShotWindV1 | null;
}

export interface BivariateDispersionModel {
  version: typeof BIVARIATE_DISPERSION_MODEL_VERSION;
  clubId: ShotClubId;
  provenance: "CourseCraft balance assumption";
  /** Inputs retained so restored models can be verified against this version's profile. */
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
  /** Symmetric positive-definite covariance in target-aligned tile units. */
  covariance: {
    longitudinalVariance: number;
    lateralVariance: number;
    covariance: number;
    determinant: number;
  };
  /** Actual rotated 68%-confidence ellipse for the central component. */
  central68: PrincipalEllipseGeometry & { mahalanobisRadius: number };
  /** Bounded rare-mishit mixture, with its own actual rotated outer geometry. */
  outerTail: PrincipalEllipseGeometry & {
    probability: number;
    scale: number;
    maxMahalanobisRadius: number;
  };
}

export interface BivariateDispersionSample {
  seed: number;
  isTail: boolean;
  mahalanobisRadius: number;
  offset: TargetAlignedDispersionPoint;
  landing: TargetAlignedDispersionPoint;
}

export type BivariateDispersionResult =
  | { ok: true; value: BivariateDispersionModel }
  | { ok: false; reason: "unknown_club" | "invalid_input" | "invalid_applied_wind" };

export type BivariateDispersionSampleResult =
  | { ok: true; value: BivariateDispersionSample }
  | { ok: false; reason: "invalid_seed" | "invalid_model" };

function rounded(value: number): number {
  return Number(value.toFixed(9));
}

/** Covariance certificates retain enough precision that a valid tiny model is never rounded to zero. */
function covarianceCertificate(value: number): number {
  return Number(value.toPrecision(15));
}

function bounded(value: number | undefined, fallback: number, minimum: number, maximum: number): number | null {
  const resolved = value ?? fallback;
  return Number.isFinite(resolved) && resolved >= minimum && resolved <= maximum ? resolved : null;
}

function nearlyEqual(actual: number, expected: number, relativeTolerance = 2e-6): boolean {
  return Number.isFinite(actual) && Number.isFinite(expected)
    && Math.abs(actual - expected) <= Math.max(1e-9, Math.abs(expected) * relativeTolerance);
}

function gaussian(rng: () => number): number {
  const u = Math.max(1e-12, rng());
  const v = Math.max(1e-12, rng());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function boundedPair(rng: () => number): { longitudinal: number; lateral: number; radius: number } {
  let longitudinal = gaussian(rng);
  let lateral = gaussian(rng);
  let radius = Math.hypot(longitudinal, lateral);
  if (radius > BIVARIATE_DISPERSION_MAX_STANDARD_RADIUS) {
    const scale = BIVARIATE_DISPERSION_MAX_STANDARD_RADIUS / radius;
    longitudinal *= scale;
    lateral *= scale;
    radius = BIVARIATE_DISPERSION_MAX_STANDARD_RADIUS;
  }
  return { longitudinal, lateral, radius };
}

function principalGeometry(
  longitudinalVariance: number,
  lateralVariance: number,
  covariance: number,
  radius: number,
): PrincipalEllipseGeometry {
  const discriminant = Math.hypot(longitudinalVariance - lateralVariance, 2 * covariance);
  const majorVariance = (longitudinalVariance + lateralVariance + discriminant) / 2;
  const minorVariance = (longitudinalVariance + lateralVariance - discriminant) / 2;
  return {
    principalSemiAxisMajorTiles: rounded(radius * Math.sqrt(majorVariance)),
    principalSemiAxisMinorTiles: rounded(radius * Math.sqrt(minorVariance)),
    // Rounding pi/2 upward would make a mathematically valid axis-aligned
    // ellipse fail its own closed orientation bound.
    orientationRadians: Math.max(-Math.PI / 2, Math.min(Math.PI / 2, rounded(.5 * Math.atan2(2 * covariance, longitudinalVariance - lateralVariance)))),
  };
}

function skillMultiplierFor(profile: typeof BIVARIATE_DISPERSION_PROFILES[ShotClubId], accuracy: number, consistency: number): number {
  return Math.max(profile.skillFloorMultiplier, (1 - accuracy * .0031) * (1 - consistency * .0027));
}

/**
 * Resolves a fail-closed model only. It consumes the existing already-
 * effective lie/flight/technique scalar plus caller-owned curve and stored-
 * wind facts; no gameplay path consumes this foundation until the separately
 * scoped resolver cutover.
 */
export function resolveBivariateDispersion(input: BivariateDispersionInput): BivariateDispersionResult {
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
  if (
    base === null || accuracy === null || consistency === null || longitudinalShift === null
    || lateralShift === null || directionalBias === null || correlation === null
  ) return { ok: false, reason: "invalid_input" };
  if (candidate.appliedWind != null && !isValidAppliedShotWindV1(candidate.appliedWind)) {
    return { ok: false, reason: "invalid_applied_wind" };
  }

  const skillMultiplier = skillMultiplierFor(profile, accuracy, consistency);
  const centralLongitudinal = base * profile.central68LongitudinalScale * skillMultiplier;
  const centralLateral = base * profile.central68LateralScale * skillMultiplier;
  const sigmaLongitudinal = centralLongitudinal / BIVARIATE_DISPERSION_CENTRAL_68_RADIUS;
  const sigmaLateral = centralLateral / BIVARIATE_DISPERSION_CENTRAL_68_RADIUS;
  const covariance = correlation * sigmaLongitudinal * sigmaLateral;
  const determinant = sigmaLongitudinal ** 2 * sigmaLateral ** 2 - covariance ** 2;
  const roundedDeterminant = covarianceCertificate(determinant);
  // Both raw and stored determinants must remain positive: a rounded zero can
  // never be emitted as a valid covariance certificate.
  if (!Number.isFinite(determinant) || determinant <= 1e-12 || roundedDeterminant <= 0) return { ok: false, reason: "invalid_input" };

  const appliedWindLateralTiles = candidate.appliedWind?.lateralCenterlineTiles ?? 0;
  const tailProbability = profile.tailProbability * (1 - consistency / 100 * .55);
  const tailScale = Math.max(1.25, profile.tailScale * (1 - consistency / 100 * .25));
  const longitudinalVariance = sigmaLongitudinal ** 2;
  const lateralVariance = sigmaLateral ** 2;
  const central68 = principalGeometry(
    longitudinalVariance,
    lateralVariance,
    covariance,
    BIVARIATE_DISPERSION_CENTRAL_68_RADIUS,
  );
  const outerTail = principalGeometry(
    longitudinalVariance,
    lateralVariance,
    covariance,
    BIVARIATE_DISPERSION_MAX_STANDARD_RADIUS * tailScale,
  );
  const value: BivariateDispersionModel = {
    version: BIVARIATE_DISPERSION_MODEL_VERSION,
    clubId: club.id,
    provenance: profile.provenance,
    resolvedFrom: {
      effectiveDispersionTiles: rounded(base),
      accuracy: rounded(accuracy),
      consistency: rounded(consistency),
      centerlineLongitudinalTiles: rounded(longitudinalShift),
      centerlineLateralTiles: rounded(lateralShift),
    },
    centerline: {
      longitudinalTiles: rounded(longitudinalShift),
      lateralTiles: rounded(lateralShift + directionalBias + appliedWindLateralTiles),
    },
    directionalBiasLateralTiles: rounded(directionalBias),
    appliedWindLateralTiles: rounded(appliedWindLateralTiles),
    skillMultiplier: rounded(skillMultiplier),
    correlation: rounded(correlation),
    covariance: {
      longitudinalVariance: covarianceCertificate(longitudinalVariance),
      lateralVariance: covarianceCertificate(lateralVariance),
      covariance: covarianceCertificate(covariance),
      determinant: roundedDeterminant,
    },
    central68: { ...central68, mahalanobisRadius: rounded(BIVARIATE_DISPERSION_CENTRAL_68_RADIUS) },
    outerTail: {
      probability: rounded(tailProbability),
      scale: rounded(tailScale),
      maxMahalanobisRadius: rounded(BIVARIATE_DISPERSION_MAX_STANDARD_RADIUS * tailScale),
      ...outerTail,
    },
  };
  // Resolver and sampler have one strict contract. This should be unreachable
  // for bounded inputs, but fails closed if a future edit breaks that closure.
  return isValidBivariateDispersionModel(value)
    ? { ok: true, value }
    : { ok: false, reason: "invalid_input" };
}

/** Samples one bounded outcome from a previously resolved immutable model. */
export function sampleBivariateDispersion(model: BivariateDispersionModel, seed: number): BivariateDispersionSampleResult {
  if (!Number.isSafeInteger(seed)) return { ok: false, reason: "invalid_seed" };
  if (!isValidBivariateDispersionModel(model)) return { ok: false, reason: "invalid_model" };
  const rng = mulberry32(seed >>> 0);
  const isTail = rng() < model.outerTail.probability;
  const pair = boundedPair(rng);
  const componentScale = isTail ? model.outerTail.scale : 1;
  const sigmaLongitudinal = Math.sqrt(model.covariance.longitudinalVariance);
  const sigmaLateral = Math.sqrt(model.covariance.lateralVariance);
  const independentLateral = Math.sqrt(1 - model.correlation ** 2);
  const longitudinal = pair.longitudinal * sigmaLongitudinal * componentScale;
  const lateral = (model.correlation * pair.longitudinal + independentLateral * pair.lateral) * sigmaLateral * componentScale;
  const offset = { longitudinalTiles: rounded(longitudinal), lateralTiles: rounded(lateral) };
  return {
    ok: true,
    value: {
      seed: seed >>> 0,
      isTail,
      mahalanobisRadius: rounded(pair.radius * componentScale),
      offset,
      landing: {
        longitudinalTiles: rounded(model.centerline.longitudinalTiles + offset.longitudinalTiles),
        lateralTiles: rounded(model.centerline.lateralTiles + offset.lateralTiles),
      },
    },
  };
}

/** Strict structural guard for models restored from an untrusted save or tool. */
export function isValidBivariateDispersionModel(value: unknown): value is BivariateDispersionModel {
  if (!value || typeof value !== "object") return false;
  const model = value as BivariateDispersionModel;
  const club = dispersionClub(model.clubId);
  if (!club || model.version !== BIVARIATE_DISPERSION_MODEL_VERSION || model.provenance !== "CourseCraft balance assumption") return false;
  const profile = BIVARIATE_DISPERSION_PROFILES[club.id];
  const finite = (item: unknown, minimum: number, maximum: number) => typeof item === "number" && Number.isFinite(item) && item >= minimum && item <= maximum;
  if (
    !finite(model.resolvedFrom?.effectiveDispersionTiles, .05, 16)
    || !finite(model.resolvedFrom?.accuracy, 0, 100)
    || !finite(model.resolvedFrom?.consistency, 0, 100)
    || !finite(model.resolvedFrom?.centerlineLongitudinalTiles, -8, 8)
    || !finite(model.resolvedFrom?.centerlineLateralTiles, -8, 8)
    || !finite(model.centerline?.longitudinalTiles, -8, 8)
    || !finite(model.centerline?.lateralTiles, -24, 24)
    || !finite(model.directionalBiasLateralTiles, -8, 8)
    || !finite(model.appliedWindLateralTiles, -8, 8)
    || !finite(model.skillMultiplier, profile.skillFloorMultiplier, 1)
    || !finite(model.correlation, -.92, .92)
    || !finite(model.covariance?.longitudinalVariance, 1e-12, 256)
    || !finite(model.covariance?.lateralVariance, 1e-12, 256)
    || !finite(model.covariance?.covariance, -256, 256)
    || !finite(model.covariance?.determinant, 1e-12, 65_536)
    || !finite(model.central68?.mahalanobisRadius, 1, 2)
    || !finite(model.central68?.principalSemiAxisMajorTiles, .001, 32)
    || !finite(model.central68?.principalSemiAxisMinorTiles, .001, 32)
    || !finite(model.central68?.orientationRadians, -Math.PI / 2, Math.PI / 2)
    || !finite(model.outerTail?.probability, 0, .1)
    || !finite(model.outerTail?.scale, 1.25, 2.2)
    || !finite(model.outerTail?.maxMahalanobisRadius, BIVARIATE_DISPERSION_MAX_STANDARD_RADIUS * 1.25, BIVARIATE_DISPERSION_MAX_STANDARD_RADIUS * 2.2)
    || !finite(model.outerTail?.principalSemiAxisMajorTiles, .001, 80)
    || !finite(model.outerTail?.principalSemiAxisMinorTiles, .001, 80)
    || !finite(model.outerTail?.orientationRadians, -Math.PI / 2, Math.PI / 2)
  ) return false;

  const expectedSkillMultiplier = skillMultiplierFor(profile, model.resolvedFrom.accuracy, model.resolvedFrom.consistency);
  const expectedCentralLongitudinal = model.resolvedFrom.effectiveDispersionTiles * profile.central68LongitudinalScale * expectedSkillMultiplier;
  const expectedCentralLateral = model.resolvedFrom.effectiveDispersionTiles * profile.central68LateralScale * expectedSkillMultiplier;
  const expectedLongitudinalVariance = (expectedCentralLongitudinal / BIVARIATE_DISPERSION_CENTRAL_68_RADIUS) ** 2;
  const expectedLateralVariance = (expectedCentralLateral / BIVARIATE_DISPERSION_CENTRAL_68_RADIUS) ** 2;
  const expectedCovariance = model.correlation * Math.sqrt(expectedLongitudinalVariance * expectedLateralVariance);
  const determinant = model.covariance.longitudinalVariance * model.covariance.lateralVariance - model.covariance.covariance ** 2;
  const expectedDeterminant = expectedLongitudinalVariance * expectedLateralVariance - expectedCovariance ** 2;
  const expectedCenterlineLateral = model.resolvedFrom.centerlineLateralTiles + model.directionalBiasLateralTiles + model.appliedWindLateralTiles;
  const expectedCentralGeometry = principalGeometry(model.covariance.longitudinalVariance, model.covariance.lateralVariance, model.covariance.covariance, BIVARIATE_DISPERSION_CENTRAL_68_RADIUS);
  const expectedTailGeometry = principalGeometry(model.covariance.longitudinalVariance, model.covariance.lateralVariance, model.covariance.covariance, BIVARIATE_DISPERSION_MAX_STANDARD_RADIUS * model.outerTail.scale);
  const expectedTailProbability = profile.tailProbability * (1 - model.resolvedFrom.consistency / 100 * .55);
  const expectedTailScale = Math.max(1.25, profile.tailScale * (1 - model.resolvedFrom.consistency / 100 * .25));
  const expectedTailRadius = BIVARIATE_DISPERSION_MAX_STANDARD_RADIUS * model.outerTail.scale;
  return determinant > 1e-12
    && nearlyEqual(model.skillMultiplier, expectedSkillMultiplier)
    && nearlyEqual(model.covariance.longitudinalVariance, expectedLongitudinalVariance)
    && nearlyEqual(model.covariance.lateralVariance, expectedLateralVariance)
    && nearlyEqual(model.covariance.covariance, expectedCovariance)
    && nearlyEqual(model.covariance.determinant, determinant)
    && nearlyEqual(model.covariance.determinant, expectedDeterminant)
    && nearlyEqual(model.correlation, model.covariance.covariance / Math.sqrt(model.covariance.longitudinalVariance * model.covariance.lateralVariance))
    && nearlyEqual(model.centerline.longitudinalTiles, model.resolvedFrom.centerlineLongitudinalTiles)
    && nearlyEqual(model.centerline.lateralTiles, expectedCenterlineLateral)
    && nearlyEqual(model.central68.mahalanobisRadius, BIVARIATE_DISPERSION_CENTRAL_68_RADIUS)
    && nearlyEqual(model.central68.principalSemiAxisMajorTiles, expectedCentralGeometry.principalSemiAxisMajorTiles)
    && nearlyEqual(model.central68.principalSemiAxisMinorTiles, expectedCentralGeometry.principalSemiAxisMinorTiles)
    && nearlyEqual(model.central68.orientationRadians, expectedCentralGeometry.orientationRadians)
    && nearlyEqual(model.outerTail.probability, expectedTailProbability)
    && nearlyEqual(model.outerTail.scale, expectedTailScale)
    && nearlyEqual(model.outerTail.maxMahalanobisRadius, expectedTailRadius)
    && nearlyEqual(model.outerTail.principalSemiAxisMajorTiles, expectedTailGeometry.principalSemiAxisMajorTiles)
    && nearlyEqual(model.outerTail.principalSemiAxisMinorTiles, expectedTailGeometry.principalSemiAxisMinorTiles)
    && nearlyEqual(model.outerTail.orientationRadians, expectedTailGeometry.orientationRadians);
}
