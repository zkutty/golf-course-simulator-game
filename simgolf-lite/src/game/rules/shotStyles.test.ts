import { describe, expect, it } from "vitest";
import { DISPERSION_CLUBS, type ShotClubId } from "./dispersionRegistry";
import { calculateShotEffects } from "./shotEffects";
import { CLUB_IMPACT_BASELINES, SHOT_STYLES, calculateShotStyleEffects, defaultShotStyle, isClubImpactV1, shotStyleForTechnique, type CalculatedShotStyleEffects, type ShotStyleSelection } from "./shotStyles";

function calculate(overrides: Partial<ShotStyleSelection> = {}): CalculatedShotStyleEffects {
  const result = calculateShotStyleEffects({ clubId: "seven_iron", lie: "fairway", style: "straight_run", power: 1, recoverySkill: 50, shortGameSkill: 100, ...overrides });
  if (!result.ok) throw new Error(result.blocker.message);
  return result.value;
}

describe("versioned club-dependent shot styles", () => {
  it("maps styles through existing technique/flight gate authority", () => {
    expect(SHOT_STYLES.map(({ id, technique, flightProfile }) => [id, technique, flightProfile])).toEqual([
      ["straight_run", "normal", null], ["high_spin", "backspin", "high"], ["pitch", "normal", "standard"],
      ["draw", "draw", null], ["fade", "fade", null], ["chip", "normal", "low"],
      ["punch", "punch", "low"], ["flop", "flop", "high"], ["putt", "normal", "standard"],
    ]);
    expect(defaultShotStyle("putter")).toBe("putt");
    expect(defaultShotStyle("chip")).toBe("chip");
    expect(shotStyleForTechnique("five_iron", "backspin")).toBe("high_spin");
    expect(shotStyleForTechnique("seven_iron", "draw")).toBe("draw");
    expect(calculate({ style: "high_spin" }).effectiveSelection.technique).toBe("backspin");
    expect(calculate({ style: "punch" }).effectiveSelection.flightProfile).toBe("low");
  });

  it("preserves native matched-club descent/stopping/roll differences including High Spin", () => {
    const clubs: ShotClubId[] = ["five_iron", "seven_iron", "pitching_wedge", "sand_wedge"];
    for (const style of ["straight_run", "high_spin"]) {
      const shots = clubs.map((clubId) => calculate({ clubId, style }));
      for (let i = 1; i < shots.length; i += 1) {
        expect(shots[i].impact.stoppingPotential).toBeGreaterThan(shots[i - 1].impact.stoppingPotential);
        expect(shots[i].impact.landingAngleDegrees).toBeGreaterThan(shots[i - 1].impact.landingAngleDegrees);
        expect(shots[i].impact.forwardRollPotentialYards).toBeLessThan(shots[i - 1].impact.forwardRollPotentialYards);
      }
    }
    const highSpinIron = calculate({ clubId: "five_iron", style: "high_spin" });
    const wedge = calculate({ clubId: "pitching_wedge" });
    expect(highSpinIron.impact.stoppingPotential).toBeLessThan(wedge.impact.stoppingPotential);
    expect(highSpinIron.impact.forwardRollPotentialYards).toBeGreaterThan(wedge.impact.forwardRollPotentialYards);
    expect(CLUB_IMPACT_BASELINES.five_iron.stoppingPotential).toBeLessThan(CLUB_IMPACT_BASELINES.sand_wedge.stoppingPotential);
  });

  it("adds stopping relative to the club without a universal roll multiplier", () => {
    const ratios = ["five_iron", "seven_iron", "pitching_wedge", "sand_wedge"].map((clubId) => {
      const ordinary = calculate({ clubId });
      const spin = calculate({ clubId, style: "high_spin" });
      expect(spin.impact.stoppingPotential).toBeGreaterThan(ordinary.impact.stoppingPotential);
      expect(spin.impact.forwardRollPotentialYards).toBeLessThan(ordinary.impact.forwardRollPotentialYards);
      return spin.impact.forwardRollPotentialYards / ordinary.impact.forwardRollPotentialYards;
    });
    expect(new Set(ratios).size).toBe(4);
  });

  it("makes Pitch a controlled partial wedge distinct from chip, flop and full wedge", () => {
    for (const clubId of ["pitching_wedge", "sand_wedge"]) {
      const full = calculate({ clubId });
      const pitch = calculate({ clubId, style: "pitch" });
      const flop = calculate({ clubId, style: "flop" });
      const chip = calculate({ clubId: "chip", style: "chip" });
      expect(pitch.effectiveSelection.clubId).toBe(clubId);
      expect(pitch.effectiveSelection.technique).toBe("normal");
      expect(pitch.effectiveSelection.power).toBe(.55);
      expect(pitch.effects.carryYards * pitch.effectiveSelection.power).toBeLessThan(full.effects.carryYards);
      expect(pitch.effects.flight.apexHeightYards).toBeLessThan(full.effects.flight.apexHeightYards);
      expect(pitch.effects.flight.apexHeightYards).toBeGreaterThan(chip.effects.flight.apexHeightYards);
      expect(pitch.impact.launchAngleDegrees).toBeGreaterThan(chip.impact.launchAngleDegrees);
      expect(pitch.impact.launchAngleDegrees).toBeLessThan(flop.impact.launchAngleDegrees);
      expect(calculate({ clubId, style: "pitch", power: .25 }).effectiveSelection.power).toBe(.25);
      expect(calculate({ clubId, style: "pitch", power: 1.15 }).effectiveSelection.power).toBeCloseTo(.6325);
    }
  });

  it("reduces rough spin control even with recovery, without adding penalty strokes", () => {
    for (const clubId of ["five_iron", "seven_iron", "pitching_wedge", "sand_wedge"]) {
      const fairway = calculate({ clubId, style: "high_spin", recoverySkill: 100 });
      const rough = calculate({ clubId, style: "high_spin", lie: "rough", recoverySkill: 100 });
      const poorRecovery = calculate({ clubId, style: "high_spin", lie: "rough", recoverySkill: 0 });
      expect(rough.impact.spinControl).toBeLessThan(fairway.impact.spinControl);
      expect(rough.impact.stoppingPotential).toBeLessThan(fairway.impact.stoppingPotential);
      expect(rough.impact.forwardRollPotentialYards).toBeGreaterThan(fairway.impact.forwardRollPotentialYards);
      expect(poorRecovery.impact.spinControl).toBeLessThan(rough.impact.spinControl);
      expect(rough.effects.penaltyStrokes).toBe(0);
    }
    expect(calculate({ clubId: "sand_wedge", lie: "deep_rough", style: "high_spin" }).impact.spinControl)
      .toBeLessThan(calculate({ clubId: "sand_wedge", lie: "rough", style: "high_spin" }).impact.spinControl);
  });

  it("accounts for bounded power, strike, skill and frozen equipment contributions", () => {
    const neutral = calculate({ style: "high_spin" });
    for (const input of [{ strikeQuality: .4 }, { shortGameSkill: 0 }, { spinCapabilityMultiplier: .75 }, { power: .4 }]) {
      expect(calculate({ style: "high_spin", ...input }).impact.stoppingPotential).toBeLessThan(neutral.impact.stoppingPotential);
    }
    const rough = { style: "high_spin", lie: "rough" as const, shortGameSkill: 50 };
    expect(calculate({ ...rough, spinCapabilityMultiplier: 1.25 }).impact.stoppingPotential)
      .toBeGreaterThan(calculate({ ...rough, spinCapabilityMultiplier: .75 }).impact.stoppingPotential);
  });

  it.each([
    { clubId: "driver", style: "high_spin", code: "unsupported_technique" },
    { clubId: "five_iron", style: "pitch", code: "style_club_mismatch" },
    { clubId: "chip", style: "pitch", code: "style_club_mismatch" },
    { clubId: "seven_iron", style: "flop", code: "unsupported_technique" },
    { clubId: "putter", style: "straight_run", code: "style_club_mismatch" },
    { clubId: "seven_iron", style: "putt", code: "style_club_mismatch" },
    { clubId: "driver", lie: "rough" as const, code: "club_lie_mismatch" },
    { style: "pitch", clubId: "pitching_wedge", flightProfile: "high" as const, code: "style_requires_flight" },
    { style: "punch", flightProfile: "high" as const, code: "style_requires_flight" },
    { style: "high_spin", flightProfile: "low" as const, code: "style_requires_flight" },
    { lie: "water" as const, code: "unplayable_lie" },
    { style: "invented", code: "unknown_style" },
    { clubId: "eight_iron", code: "unknown_club" },
  ])("explains invalid combinations: %j", ({ code, ...overrides }) => {
    const result = calculateShotStyleEffects({ clubId: "seven_iron", style: "straight_run", lie: "fairway", power: 1, recoverySkill: 0, shortGameSkill: 0, ...overrides });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected blocker");
    expect(result.blocker.code).toBe(code);
    expect(result.blocker.message.length).toBeGreaterThan(12);
  });

  it("leaves legacy calls unchanged and produces a complete single rollout budget", () => {
    const input = { clubId: "seven_iron", lie: "fairway" as const, technique: "backspin", flightProfile: "high", recoverySkill: 50 };
    const before = calculateShotEffects(input);
    const styled = calculate({ style: "high_spin", flightProfile: "high" });
    expect(calculateShotEffects(input)).toEqual(before);
    if (!before.ok) throw new Error("Expected supported legacy shot");
    expect(before.value.rolloutYards).toBe(1.575);
    expect(styled.effects.rolloutYards).toBe(styled.impact.forwardRollPotentialYards);
    expect(styled.effects.rolloutYards).not.toBe(before.value.rolloutYards);
    expect(styled.effects.carryYards).toBe(before.value.carryYards);
  });

  it("is finite/deterministic/stopping-only for all supported club, lie and style combinations", () => {
    for (const club of DISPERSION_CLUBS) for (const lie of club.allowedLies) for (const style of SHOT_STYLES) {
      const input = { clubId: club.id, lie, style: style.id, power: Number.NaN, recoverySkill: Number.POSITIVE_INFINITY, shortGameSkill: -100, strikeQuality: Number.NaN, spinCapabilityMultiplier: Number.POSITIVE_INFINITY };
      const result = calculateShotStyleEffects(input);
      expect(calculateShotStyleEffects(input)).toEqual(result);
      if (!result.ok) continue;
      expect(isClubImpactV1(result.value.impact)).toBe(true);
      expect(JSON.stringify(result)).not.toContain("null");
      expect(result.value.effects.penaltyStrokes).toBe(0);
      expect(result.value.impact.forwardRollPotentialYards).toBeGreaterThanOrEqual(0);
      expect(result.value.impact.rollbackSupported).toBe(false);
    }
  });

  it("rejects malformed retained impact facts without repair", () => {
    const impact = calculate().impact;
    expect(isClubImpactV1(impact)).toBe(true);
    for (const invalid of [null, [], {}, { ...impact, extra: 1 }, { ...impact, version: 2 }, { ...impact, clubId: "eight_iron" }, { ...impact, style: "unknown" }, { ...impact, power: 0 }, { ...impact, landingAngleDegrees: 90 }, { ...impact, spinControl: 1.1 }, { ...impact, stoppingPotential: Number.NaN }, { ...impact, forwardRollPotentialYards: Number.POSITIVE_INFINITY }, { ...impact, rollbackSupported: true }]) expect(isClubImpactV1(invalid)).toBe(false);
  });
});
