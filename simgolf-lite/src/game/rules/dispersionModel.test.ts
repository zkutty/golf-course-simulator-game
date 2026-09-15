import { describe, expect, it } from "vitest";
import { calculateShotEffects } from "./shotEffects";
import { BIVARIATE_DISPERSION_PROFILES, DISPERSION_CLUBS } from "./dispersionRegistry";
import {
  BIVARIATE_DISPERSION_CENTRAL_68_RADIUS,
  BIVARIATE_DISPERSION_MAX_STANDARD_RADIUS,
  isValidBivariateDispersionModel,
  resolveBivariateDispersion,
  sampleBivariateDispersion,
  type BivariateDispersionInput,
} from "./dispersionModel";
import {
  resolveBivariateDispersionRuntime,
  resolveBivariateDispersionShot,
  sampleBivariateDispersionRuntime,
} from "./dispersionRuntime";

const appliedWind = {
  version: 1 as const,
  sourceMode: "directional" as const,
  headwindMph: 8,
  crosswindMph: -12,
  carryMultiplier: .96,
  lateralCenterlineTiles: -.42,
};

function resolve(overrides: Partial<Parameters<typeof resolveBivariateDispersion>[0]> = {}) {
  return resolveBivariateDispersion({
    clubId: "driver",
    effectiveDispersionTiles: 3.7,
    accuracy: 50,
    consistency: 50,
    ...overrides,
  });
}

function model(overrides: Partial<Parameters<typeof resolveBivariateDispersion>[0]> = {}) {
  const result = resolve(overrides);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.reason);
  return result.value;
}

function declaredEllipseSquared(
  value: { longitudinalTiles: number; lateralTiles: number },
  current: ReturnType<typeof model>,
  tail = false,
): number {
  const geometry = tail ? current.outerTail : current.central68;
  const cosine = Math.cos(geometry.orientationRadians);
  const sine = Math.sin(geometry.orientationRadians);
  const majorCoordinate = cosine * value.longitudinalTiles + sine * value.lateralTiles;
  const minorCoordinate = -sine * value.longitudinalTiles + cosine * value.lateralTiles;
  return majorCoordinate ** 2 / geometry.principalSemiAxisMajorTiles ** 2
    + minorCoordinate ** 2 / geometry.principalSemiAxisMinorTiles ** 2;
}

describe("ZK-772 bivariate dispersion foundation", () => {
  it("creates a rotated principal 68% ellipse, positive covariance, and separate bias/wind centerline", () => {
    const current = model({
      centerlineLongitudinalTiles: .25,
      centerlineLateralTiles: -.3,
      directionalBiasLateralTiles: .1,
      correlation: .4,
      appliedWind,
    });

    expect(current).toMatchObject({
      version: 1,
      clubId: "driver",
      provenance: "CourseCraft balance assumption",
      resolvedFrom: { effectiveDispersionTiles: 3.7, accuracy: 50, consistency: 50 },
      centerline: { longitudinalTiles: .25, lateralTiles: -.62 },
      directionalBiasLateralTiles: .1,
      appliedWindLateralTiles: -.42,
      correlation: .4,
      outerTail: { probability: .06525, scale: 1.88125 },
    });
    expect(current.covariance.determinant).toBeGreaterThan(0);
    expect(current.covariance.covariance).toBeGreaterThan(0);
    expect(current.central68.principalSemiAxisMajorTiles).toBeGreaterThan(current.central68.principalSemiAxisMinorTiles);
    expect(Math.abs(current.central68.orientationRadians)).toBeGreaterThan(0);
    expect(current.outerTail.orientationRadians).toBe(current.central68.orientationRadians);
    expect(current.outerTail.maxMahalanobisRadius).toBeCloseTo(BIVARIATE_DISPERSION_MAX_STANDARD_RADIUS * 1.88125, 9);
  });

  it("has exact deterministic fixtures and bounded reproducible tail samples", () => {
    const current = model({ correlation: -.25, directionalBiasLateralTiles: .2 });
    const first = sampleBivariateDispersion(current, 91_337);
    const second = sampleBivariateDispersion(current, 91_337);
    const differentSeed = sampleBivariateDispersion(current, 91_338);
    expect(first).toEqual(second);
    expect(differentSeed).not.toEqual(first);
    expect(first).toEqual({
      ok: true,
      value: {
        seed: 91337,
        isTail: false,
        mahalanobisRadius: 2.410324276,
        offset: { longitudinalTiles: -1.881748543, lateralTiles: 1.652947517 },
        landing: { longitudinalTiles: -1.881748543, lateralTiles: 1.852947517 },
      },
    });

    const tail = Array.from({ length: 400 }, (_, seed) => sampleBivariateDispersion(current, seed))
      .find((result) => result.ok && result.value.isTail);
    expect(tail).toEqual({
      ok: true,
      value: {
        seed: 7,
        isTail: true,
        mahalanobisRadius: 4.665161323,
        offset: { longitudinalTiles: 3.618013432, lateralTiles: -3.291933176 },
        landing: { longitudinalTiles: 3.618013432, lateralTiles: -3.091933176 },
      },
    });
    if (!tail || !tail.ok) return;
    expect(sampleBivariateDispersion(current, tail.value.seed)).toEqual(tail);
    expect(tail.value.mahalanobisRadius).toBeLessThanOrEqual(current.outerTail.maxMahalanobisRadius);
    expect(declaredEllipseSquared(tail.value.offset, current, true)).toBeLessThanOrEqual(1.000001);
  });

  it("quantizes the effective input once before covariance and JSON replay", () => {
    const current = model({ effectiveDispersionTiles: 1.28456789123, centerlineLongitudinalTiles: .069736442 });
    expect(current.resolvedFrom.effectiveDispersionTiles).toBe(1.284567891);
    const first = sampleBivariateDispersion(current, 1);
    const restored = JSON.parse(JSON.stringify(current));
    const replay = sampleBivariateDispersion(restored, 1);
    expect(replay).toEqual(first);
    expect(first).toMatchObject({ ok: true, value: { landing: { longitudinalTiles: -0.898605534 } } });
  });

  it("keeps the compact gameplay path byte-identical to the analytical model", () => {
    const inputs: BivariateDispersionInput[] = [
      { clubId: "driver", effectiveDispersionTiles: 1.28456789123, accuracy: 50, consistency: 50, centerlineLongitudinalTiles: .069736442 },
      { clubId: "putter", effectiveDispersionTiles: .05, accuracy: 100, consistency: 100, correlation: .92, centerlineLateralTiles: -8 },
      { clubId: "driver", effectiveDispersionTiles: 16, accuracy: 0, consistency: 0, correlation: -.92, centerlineLongitudinalTiles: 8, centerlineLateralTiles: 8, directionalBiasLateralTiles: 8, appliedWind: { ...appliedWind, lateralCenterlineTiles: 8 } },
      ...DISPERSION_CLUBS.flatMap((club) => [
        { clubId: club.id, effectiveDispersionTiles: .05, accuracy: 0, consistency: 0, centerlineLongitudinalTiles: -8, centerlineLateralTiles: -8, appliedWind: { ...appliedWind, lateralCenterlineTiles: -8 } },
        { clubId: club.id, effectiveDispersionTiles: 16, accuracy: 100, consistency: 100, centerlineLongitudinalTiles: 8, centerlineLateralTiles: 8, appliedWind: { ...appliedWind, lateralCenterlineTiles: 8 } },
      ]),
    ];
    for (const input of inputs) {
      const analytical = resolveBivariateDispersion(input);
      const runtime = resolveBivariateDispersionRuntime(input);
      expect(analytical.ok).toBe(true);
      expect(runtime.ok).toBe(true);
      if (!analytical.ok || !runtime.ok) continue;
      expect(runtime.value).toEqual({
        version: analytical.value.version,
        clubId: analytical.value.clubId,
        resolvedFrom: analytical.value.resolvedFrom,
        centerline: analytical.value.centerline,
        directionalBiasLateralTiles: analytical.value.directionalBiasLateralTiles,
        appliedWindLateralTiles: analytical.value.appliedWindLateralTiles,
        skillMultiplier: analytical.value.skillMultiplier,
        correlation: analytical.value.correlation,
        covariance: analytical.value.covariance,
        outerTail: {
          probability: analytical.value.outerTail.probability,
          scale: analytical.value.outerTail.scale,
          maxMahalanobisRadius: analytical.value.outerTail.maxMahalanobisRadius,
        },
      });
      for (const seed of [1, 7, 42, 91_337, 4_294_926_741]) {
        const analyticalSample = sampleBivariateDispersion(analytical.value, seed);
        expect(sampleBivariateDispersionRuntime(runtime.value, seed)).toEqual(analyticalSample);
        const { correlation: _analyticalCorrelation, directionalBiasLateralTiles: _analyticalBias, ...shotInput } = input;
        const shotAnalytical = resolveBivariateDispersion(shotInput);
        const shot = resolveBivariateDispersionShot(shotInput, seed);
        expect(shotAnalytical.ok).toBe(true);
        expect(shot).not.toBeNull();
        if (!shotAnalytical.ok || !shot) continue;
        const shotAnalyticalSample = sampleBivariateDispersion(shotAnalytical.value, seed);
        expect(shotAnalyticalSample.ok).toBe(true);
        if (!shotAnalyticalSample.ok) continue;
        const { seed: _ownedSeed, ...sample } = shotAnalyticalSample.value;
        expect(shot).toMatchObject({
          resolvedFrom: {
            effectiveDispersionTiles: shotAnalytical.value.resolvedFrom.effectiveDispersionTiles,
            accuracy: shotAnalytical.value.resolvedFrom.accuracy,
            consistency: shotAnalytical.value.resolvedFrom.consistency,
            centerlineLateralTiles: shotAnalytical.value.resolvedFrom.centerlineLateralTiles,
          },
          centerline: shotAnalytical.value.centerline,
          appliedWindLateralTiles: shotAnalytical.value.appliedWindLateralTiles,
          sample,
        });
      }
    }
    expect(Object.values(BIVARIATE_DISPERSION_PROFILES).every((profile) => profile.defaultCorrelation === 0)).toBe(true);
  });

  it("canonicalizes every persisted input before central, tail, and wind replay math", () => {
    const centralInput = {
      clubId: "driver", effectiveDispersionTiles: 1.28456789123,
      accuracy: 50.1234568013, consistency: 45.987654330699996,
      centerlineLongitudinalTiles: .0697364423, centerlineLateralTiles: .3456789123,
    };
    const tailInput = { ...centralInput, accuracy: 50.1234567996, consistency: 45.987654329399994 };
    const windInput = {
      clubId: "driver", effectiveDispersionTiles: 1.2, accuracy: 50, consistency: 50,
      centerlineLongitudinalTiles: .0697364423, centerlineLateralTiles: .1234568115,
      appliedWind,
    };
    const cases = [
      { input: centralInput, seed: 129, field: "longitudinalTiles" as const, expected: -.468320333 },
      { input: tailInput, seed: 6_507, field: "lateralTiles" as const, expected: .935909218 },
      { input: windInput, seed: 1, field: null, expected: -.296543189 },
    ];
    for (const current of cases) {
      const resolved = resolveBivariateDispersionShot(current.input, current.seed);
      expect(resolved).not.toBeNull();
      if (!resolved) continue;
      if (current.field) expect(resolved.sample.offset[current.field]).toBe(current.expected);
      else expect(resolved.centerline.lateralTiles).toBe(current.expected);
      const replay = resolveBivariateDispersionShot({
        clubId: current.input.clubId,
        effectiveDispersionTiles: resolved.resolvedFrom.effectiveDispersionTiles,
        accuracy: resolved.resolvedFrom.accuracy,
        consistency: resolved.resolvedFrom.consistency,
        centerlineLongitudinalTiles: resolved.centerline.longitudinalTiles,
        centerlineLateralTiles: resolved.resolvedFrom.centerlineLateralTiles,
        ...("appliedWind" in current.input ? { appliedWind: current.input.appliedWind } : {}),
      }, current.seed);
      expect(replay).toEqual(resolved);
    }
  });

  it("rejects analytical-only overrides at the compact type and runtime boundaries", () => {
    const input = { clubId: "driver", effectiveDispersionTiles: 2, accuracy: 50, consistency: 50 };
    // @ts-expect-error correlation is deliberately absent from the compact authority.
    expect(resolveBivariateDispersionShot({ ...input, correlation: .92 }, 1)).toBeNull();
    // Optional-never permits undefined without exactOptionalPropertyTypes;
    // the runtime boundary still rejects property presence.
    expect(resolveBivariateDispersionShot({ ...input, correlation: undefined }, 1)).toBeNull();
    // @ts-expect-error directional bias belongs only to the analytical authority.
    expect(resolveBivariateDispersionShot({ ...input, directionalBiasLateralTiles: 1.5 }, 1)).toBeNull();
    const analytical = resolveBivariateDispersion({ ...input, correlation: .92, directionalBiasLateralTiles: 1.5 });
    expect(analytical).toMatchObject({ ok: true, value: { correlation: .92, directionalBiasLateralTiles: 1.5 } });
  });

  it("keeps controlled club envelopes monotonic and skill tightening bounded by explicit floors", () => {
    const neutral = DISPERSION_CLUBS.map((club) => model({ clubId: club.id, effectiveDispersionTiles: club.dispersionTiles, accuracy: 0, consistency: 0 }));
    for (let index = 1; index < neutral.length; index++) {
      expect(neutral[index - 1].central68.principalSemiAxisMajorTiles).toBeGreaterThan(neutral[index].central68.principalSemiAxisMajorTiles);
      expect(neutral[index - 1].central68.principalSemiAxisMinorTiles).toBeGreaterThan(neutral[index].central68.principalSemiAxisMinorTiles);
    }
    const unskilled = model({ accuracy: 0, consistency: 0 });
    const skilled = model({ accuracy: 100, consistency: 100 });
    expect(skilled.central68.principalSemiAxisMajorTiles).toBeLessThan(unskilled.central68.principalSemiAxisMajorTiles);
    expect(skilled.central68.principalSemiAxisMinorTiles).toBeLessThan(unskilled.central68.principalSemiAxisMinorTiles);
    expect(skilled.skillMultiplier).toBe(.56);
    expect(skilled.outerTail.probability).toBeLessThan(unskilled.outerTail.probability);
    expect(skilled.outerTail.scale).toBeLessThan(unskilled.outerTail.scale);
  });

  it("consumes the existing effective effect scalar exactly once without changing shot effects", () => {
    const normal = calculateShotEffects({ clubId: "seven_iron", lie: "fairway", recoverySkill: 0, technique: "normal", flightProfile: "standard" });
    const roughHigh = calculateShotEffects({ clubId: "seven_iron", lie: "rough", recoverySkill: 0, technique: "normal", flightProfile: "high" });
    expect(normal.ok).toBe(true);
    expect(roughHigh.ok).toBe(true);
    if (!normal.ok || !roughHigh.ok) return;
    const clear = model({ clubId: normal.value.clubId, effectiveDispersionTiles: normal.value.dispersionTiles, accuracy: 50, consistency: 50 });
    const shaped = model({ clubId: roughHigh.value.clubId, effectiveDispersionTiles: roughHigh.value.dispersionTiles, accuracy: 50, consistency: 50 });
    expect(shaped.central68.principalSemiAxisMajorTiles).toBeGreaterThan(clear.central68.principalSemiAxisMajorTiles);
    expect(shaped.central68.principalSemiAxisMinorTiles).toBeGreaterThan(clear.central68.principalSemiAxisMinorTiles);
  });

  it("rejects hostile input and rejects every incoherent restored model", () => {
    expect(resolveBivariateDispersion(null as unknown as Parameters<typeof resolveBivariateDispersion>[0])).toEqual({ ok: false, reason: "invalid_input" });
    expect(resolveBivariateDispersion(undefined as unknown as Parameters<typeof resolveBivariateDispersion>[0])).toEqual({ ok: false, reason: "invalid_input" });
    expect(resolve({ clubId: "__proto__" })).toEqual({ ok: false, reason: "unknown_club" });
    expect(resolve({ effectiveDispersionTiles: Number.NaN })).toEqual({ ok: false, reason: "invalid_input" });
    expect(resolve({ accuracy: Infinity })).toEqual({ ok: false, reason: "invalid_input" });
    expect(resolve({ correlation: .99 })).toEqual({ ok: false, reason: "invalid_input" });
    expect(resolve({ appliedWind: { ...appliedWind, crosswindMph: 99 } })).toEqual({ ok: false, reason: "invalid_applied_wind" });
    expect(sampleBivariateDispersion(model(), Number.NaN)).toEqual({ ok: false, reason: "invalid_seed" });

    const current = model();
    const incoherent = [
      { ...current, correlation: .9 },
      { ...current, covariance: { ...current.covariance, determinant: 0 } },
      { ...current, central68: { ...current.central68, principalSemiAxisMajorTiles: 99 } },
      { ...current, outerTail: { ...current.outerTail, principalSemiAxisMinorTiles: Number.NaN } },
      { ...current, skillMultiplier: .55 },
    ];
    for (const invalid of incoherent) {
      expect(isValidBivariateDispersionModel(invalid)).toBe(false);
      expect(sampleBivariateDispersion(invalid, 1)).toEqual({ ok: false, reason: "invalid_model" });
    }
  });

  it("is closed across max shift, bias, validated wind, and tiny high-correlation models", () => {
    const maximumWind = { ...appliedWind, lateralCenterlineTiles: 8 };
    const boundaryInputs = (["driver", "putter"] as const).flatMap((clubId) =>
      [.05, 16].flatMap((effectiveDispersionTiles) =>
        [0, 100].flatMap((accuracy) =>
          [0, 100].flatMap((consistency) =>
            [-.92, .92].map((correlation) => {
              const extreme = correlation > 0 ? 8 : -8;
              return {
                clubId,
                effectiveDispersionTiles,
                accuracy,
                consistency,
                correlation,
                centerlineLongitudinalTiles: extreme,
                centerlineLateralTiles: extreme,
                directionalBiasLateralTiles: extreme,
                appliedWind: { ...maximumWind, lateralCenterlineTiles: extreme },
              };
            }),
          ),
        ),
      ),
    );
    for (const input of boundaryInputs) {
      const result = resolveBivariateDispersion(input);
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(isValidBivariateDispersionModel(result.value)).toBe(true);
      expect(sampleBivariateDispersion(result.value, 42).ok).toBe(true);
      expect(result.value.covariance.determinant).toBeGreaterThan(0);
    }
    const maximum = resolveBivariateDispersion({
      clubId: "driver",
      effectiveDispersionTiles: 16,
      accuracy: 0,
      consistency: 0,
      correlation: .92,
      centerlineLongitudinalTiles: 8,
      centerlineLateralTiles: 8,
      directionalBiasLateralTiles: 8,
      appliedWind: maximumWind,
    });
    expect(maximum).toMatchObject({ ok: true, value: { centerline: { longitudinalTiles: 8, lateralTiles: 24 } } });
  });

  it("uses the declared rotated nonzero-correlation ellipse for the fixed-seed 68% coverage gate", () => {
    const current = model({ correlation: .92 });
    expect(current.central68.principalSemiAxisMajorTiles).toBeGreaterThan(current.central68.principalSemiAxisMinorTiles);
    expect(current.central68.orientationRadians).not.toBe(0);
    let centralSamples = 0;
    let insideDeclaredCentral68 = 0;
    for (let seed = 0; seed < 30_000; seed++) {
      const sample = sampleBivariateDispersion(current, seed);
      expect(sample.ok).toBe(true);
      if (!sample.ok || sample.value.isTail) continue;
      centralSamples++;
      if (declaredEllipseSquared(sample.value.offset, current) <= 1) insideDeclaredCentral68++;
      expect(sample.value.mahalanobisRadius).toBeLessThanOrEqual(BIVARIATE_DISPERSION_MAX_STANDARD_RADIUS);
    }
    const coverage = insideDeclaredCentral68 / centralSamples;
    // Predeclared deterministic Monte Carlo tolerance: ±1.5 percentage points.
    expect(coverage).toBeGreaterThanOrEqual(.665);
    expect(coverage).toBeLessThanOrEqual(.695);
    expect(current.central68.mahalanobisRadius).toBeCloseTo(BIVARIATE_DISPERSION_CENTRAL_68_RADIUS, 9);
  });
});
