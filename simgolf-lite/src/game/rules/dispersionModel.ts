import {
  BIVARIATE_DISPERSION_MODEL_VERSION,
  BIVARIATE_DISPERSION_PROFILES,
  dispersionClub,
} from "./dispersionRegistry";
import {
  BIVARIATE_DISPERSION_CENTRAL_68_RADIUS,
  BIVARIATE_DISPERSION_MAX_STANDARD_RADIUS,
  resolveBivariateDispersionRuntime,
  roundBivariateValue,
  sampleBivariateDispersionRuntime,
  skillMultiplierForBivariateProfile,
  type BivariateDispersionInput,
  type BivariateDispersionRuntime,
  type BivariateDispersionSample,
} from "./dispersionRuntime";

export {
  BIVARIATE_DISPERSION_CENTRAL_68_RADIUS,
  BIVARIATE_DISPERSION_MAX_STANDARD_RADIUS,
  isValidAppliedShotWindV1,
} from "./dispersionRuntime";
export type {
  BivariateDispersionInput,
  BivariateDispersionSample,
  TargetAlignedDispersionPoint,
} from "./dispersionRuntime";

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

export interface BivariateDispersionModel extends Omit<BivariateDispersionRuntime, "outerTail"> {
  provenance: "CourseCraft balance assumption";
  /** Actual rotated 68%-confidence ellipse for the central component. */
  central68: PrincipalEllipseGeometry & { mahalanobisRadius: number };
  /** Bounded rare-mishit mixture, with its own actual rotated outer geometry. */
  outerTail: PrincipalEllipseGeometry & {
    probability: number;
    scale: number;
    maxMahalanobisRadius: number;
  };
}

export type BivariateDispersionResult =
  | { ok: true; value: BivariateDispersionModel }
  | { ok: false; reason: "unknown_club" | "invalid_input" | "invalid_applied_wind" };

export type BivariateDispersionSampleResult =
  | { ok: true; value: BivariateDispersionSample }
  | { ok: false; reason: "invalid_seed" | "invalid_model" };

const rounded = roundBivariateValue;

function nearlyEqual(actual: number, expected: number, relativeTolerance = 2e-6): boolean {
  return Number.isFinite(actual) && Number.isFinite(expected)
    && Math.abs(actual - expected) <= Math.max(1e-9, Math.abs(expected) * relativeTolerance);
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

const skillMultiplierFor = skillMultiplierForBivariateProfile;

/**
 * Resolves a fail-closed model only. It consumes the existing already-
 * effective lie/flight/technique scalar plus caller-owned curve and stored-
 * wind facts; no gameplay path consumes this foundation until the separately
 * scoped resolver cutover.
 */
export function resolveBivariateDispersion(input: BivariateDispersionInput): BivariateDispersionResult {
  const runtime = resolveBivariateDispersionRuntime(input);
  if (!runtime.ok) return runtime;
  const profile = BIVARIATE_DISPERSION_PROFILES[runtime.value.clubId];
  const { covariance, outerTail } = runtime.value;
  const central68 = principalGeometry(
    covariance.longitudinalVariance,
    covariance.lateralVariance,
    covariance.covariance,
    BIVARIATE_DISPERSION_CENTRAL_68_RADIUS,
  );
  const outerTailGeometry = principalGeometry(
    covariance.longitudinalVariance,
    covariance.lateralVariance,
    covariance.covariance,
    BIVARIATE_DISPERSION_MAX_STANDARD_RADIUS * outerTail.scale,
  );
  const value: BivariateDispersionModel = {
    ...runtime.value,
    provenance: profile.provenance,
    central68: { ...central68, mahalanobisRadius: rounded(BIVARIATE_DISPERSION_CENTRAL_68_RADIUS) },
    outerTail: {
      ...outerTail,
      ...outerTailGeometry,
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
  return sampleBivariateDispersionRuntime(model, seed);
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
