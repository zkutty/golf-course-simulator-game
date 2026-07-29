import { describe, expect, it } from "vitest";
import type { ShotFlightProfile, ShotLie } from "./contracts";
import {
  SHOT_CLUBS,
  SHOT_EFFECTS_VERSION,
  availableShotClubs,
  calculateLieEffect,
  calculateShotEffects,
  type CalculatedShotEffects,
  type ShotClubId,
} from "./shotEffects";

const PLAYABLE_LIES: readonly ShotLie[] = [
  "tee",
  "fairway",
  "rough",
  "deep_rough",
  "waste_area",
  "sand",
  "green",
];

const UNPLAYABLE_LIES: readonly ShotLie[] = [
  "path",
  "water",
  "wetland",
  "out_of_bounds",
];

function calculate(overrides: Partial<{
  clubId: string;
  lie: ShotLie;
  recoverySkill: number;
  technique: string;
  flightProfile: string;
}> = {}): CalculatedShotEffects {
  const result = calculateShotEffects({
    clubId: "seven_iron",
    lie: "fairway",
    recoverySkill: 0,
    technique: "normal",
    flightProfile: "standard",
    ...overrides,
  });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.blocker.message);
  return result.value;
}

describe("M50 pure shot effects", () => {
  it("defines a stable, complete eight-club bag", () => {
    expect(SHOT_CLUBS.map((club) => club.id)).toEqual([
      "driver",
      "three_wood",
      "five_iron",
      "seven_iron",
      "pitching_wedge",
      "sand_wedge",
      "chip",
      "putter",
    ]);
    expect(new Set(SHOT_CLUBS.map((club) => club.id)).size).toBe(8);
    expect(new Set(SHOT_CLUBS.map((club) => club.family))).toEqual(
      new Set(["wood", "iron", "wedge", "specialty", "putter"]),
    );

    for (const club of SHOT_CLUBS) {
      expect(club.loftDegrees).toBeGreaterThan(0);
      expect(club.carryYards).toBeGreaterThan(0);
      expect(club.dispersionTiles).toBeGreaterThan(0);
      expect(Number.isFinite(club.nativeLaunchAngleDegrees)).toBe(true);
      expect(Number.isFinite(club.nativeApexHeightYards)).toBe(true);
      expect(Number.isFinite(club.rolloutYards)).toBe(true);
      expect(club.allowedLies.length).toBeGreaterThan(0);
      expect(club.allowedTechniques).toContain("normal");
      expect(club.allowedFlightProfiles).toContain("standard");
    }
  });

  it("preserves exact ordinary tee and fairway behavior without penalty strokes", () => {
    for (const lie of ["tee", "fairway"] as const) {
      const lieEffect = calculateLieEffect(lie, 100);
      expect(lieEffect).toEqual({
        sourceLie: lie,
        effectiveLie: lie,
        carryMultiplier: 1,
        dispersionMultiplier: 1,
        rollMultiplier: 1,
      });

      const shot = calculate({ lie });
      expect(shot.lieEffect).toEqual(lieEffect);
      expect(shot.penaltyStrokes).toBe(0);
      expect(shot.modifiers).toEqual({
        carryMultiplier: 1,
        dispersionMultiplier: 1,
        rollMultiplier: 1,
      });
    }
  });

  it("applies the specified deterministic lie defaults", () => {
    expect(calculateLieEffect("rough", 0)).toMatchObject({
      carryMultiplier: 0.9,
      dispersionMultiplier: 1.15,
    });
    expect(calculateLieEffect("deep_rough", 0)).toMatchObject({
      carryMultiplier: 0.7,
      dispersionMultiplier: 1.45,
    });
    expect(calculateLieEffect("waste_area", 0)).toMatchObject({
      carryMultiplier: 0.92,
      dispersionMultiplier: 1.2,
    });
    expect(calculateLieEffect("sand", 0)).toMatchObject({
      carryMultiplier: 0.65,
      dispersionMultiplier: 1.35,
    });
  });

  it("makes recovery skill monotonic, bounded, and worth half each lie penalty at 100", () => {
    for (const lie of ["rough", "deep_rough", "waste_area", "sand"] as const) {
      const skill0 = calculateLieEffect(lie, 0);
      const skill50 = calculateLieEffect(lie, 50);
      const skill100 = calculateLieEffect(lie, 100);

      expect(skill0.carryMultiplier).toBeLessThan(skill50.carryMultiplier);
      expect(skill50.carryMultiplier).toBeLessThan(skill100.carryMultiplier);
      expect(skill0.dispersionMultiplier).toBeGreaterThan(skill50.dispersionMultiplier);
      expect(skill50.dispersionMultiplier).toBeGreaterThan(skill100.dispersionMultiplier);
      expect(skill100.carryMultiplier).toBeLessThanOrEqual(1);
      expect(skill100.dispersionMultiplier).toBeGreaterThanOrEqual(1);
      expect(skill100.carryMultiplier).toBeCloseTo(
        skill0.carryMultiplier + (1 - skill0.carryMultiplier) / 2,
      );
      expect(skill100.dispersionMultiplier).toBeCloseTo(
        skill0.dispersionMultiplier - (skill0.dispersionMultiplier - 1) / 2,
      );
    }
  });

  it("clamps hostile recovery values and all emitted modifiers", () => {
    expect(calculateLieEffect("sand", Number.NaN)).toEqual(calculateLieEffect("sand", 0));
    expect(calculateLieEffect("sand", -500)).toEqual(calculateLieEffect("sand", 0));
    expect(calculateLieEffect("sand", 500)).toEqual(calculateLieEffect("sand", 100));

    for (const lie of PLAYABLE_LIES) {
      const clubs = availableShotClubs(lie);
      for (const club of clubs) {
        const result = calculateShotEffects({
          clubId: club.id,
          lie,
          recoverySkill: 100,
          technique: "normal",
          flightProfile: "standard",
        });
        expect(result.ok).toBe(true);
        if (!result.ok) continue;
        expect(result.value.modifiers.carryMultiplier).toBeGreaterThanOrEqual(0.25);
        expect(result.value.modifiers.carryMultiplier).toBeLessThanOrEqual(1);
        expect(result.value.modifiers.dispersionMultiplier).toBeGreaterThanOrEqual(0.5);
        expect(result.value.modifiers.dispersionMultiplier).toBeLessThanOrEqual(2);
        expect(result.value.modifiers.rollMultiplier).toBeGreaterThanOrEqual(0.1);
        expect(result.value.modifiers.rollMultiplier).toBeLessThanOrEqual(2);
      }
    }
  });

  it("exposes the correct club availability for every supported lie", () => {
    const ids = (lie: ShotLie): ShotClubId[] => availableShotClubs(lie).map((club) => club.id);

    expect(ids("tee")).toEqual([
      "driver",
      "three_wood",
      "five_iron",
      "seven_iron",
      "pitching_wedge",
    ]);
    expect(ids("fairway")).toEqual([
      "driver",
      "three_wood",
      "five_iron",
      "seven_iron",
      "pitching_wedge",
      "sand_wedge",
      "chip",
      "putter",
    ]);
    expect(ids("rough")).toEqual([
      "three_wood",
      "five_iron",
      "seven_iron",
      "pitching_wedge",
      "sand_wedge",
      "chip",
    ]);
    expect(ids("deep_rough")).toEqual(["pitching_wedge", "sand_wedge", "chip"]);
    expect(ids("waste_area")).toEqual([
      "five_iron",
      "seven_iron",
      "pitching_wedge",
      "sand_wedge",
      "chip",
    ]);
    expect(ids("sand")).toEqual(["seven_iron", "pitching_wedge", "sand_wedge", "chip"]);
    expect(ids("green")).toEqual(["chip", "putter"]);
    for (const lie of UNPLAYABLE_LIES) expect(ids(lie)).toEqual([]);
  });

  it("creates distinct low, standard, and high flight outcomes", () => {
    const byFlight = Object.fromEntries(
      (["low", "standard", "high"] as const).map((flightProfile) => [
        flightProfile,
        calculate({ flightProfile }),
      ]),
    ) as Record<ShotFlightProfile, CalculatedShotEffects>;

    expect(byFlight.low.carryYards).toBeLessThan(byFlight.standard.carryYards);
    expect(byFlight.high.carryYards).toBeLessThan(byFlight.standard.carryYards);
    expect(byFlight.low.flight.apexHeightYards).toBeLessThan(byFlight.standard.flight.apexHeightYards);
    expect(byFlight.standard.flight.apexHeightYards).toBeLessThan(byFlight.high.flight.apexHeightYards);
    expect(byFlight.low.dispersionTiles).toBeLessThan(byFlight.standard.dispersionTiles);
    expect(byFlight.standard.dispersionTiles).toBeLessThan(byFlight.high.dispersionTiles);
    expect(byFlight.low.rolloutYards).toBeGreaterThan(byFlight.standard.rolloutYards);
    expect(byFlight.standard.rolloutYards).toBeGreaterThan(byFlight.high.rolloutYards);
    expect(byFlight.low.flight.effectiveLoftDegrees).toBeLessThan(
      byFlight.standard.flight.effectiveLoftDegrees,
    );
    expect(byFlight.standard.flight.effectiveLoftDegrees).toBeLessThan(
      byFlight.high.flight.effectiveLoftDegrees,
    );
    expect(byFlight.low.modifiers).toEqual({
      carryMultiplier: 0.9,
      dispersionMultiplier: 0.85,
      rollMultiplier: 1.45,
    });
    expect(byFlight.high.modifiers).toEqual({
      carryMultiplier: 0.92,
      dispersionMultiplier: 1.15,
      rollMultiplier: 0.35,
    });
  });

  it("covers every club family with finite standard-flight output", () => {
    const representativeLie: Record<ShotClubId, ShotLie> = {
      driver: "tee",
      three_wood: "rough",
      five_iron: "waste_area",
      seven_iron: "sand",
      pitching_wedge: "deep_rough",
      sand_wedge: "sand",
      chip: "green",
      putter: "green",
    };

    for (const club of SHOT_CLUBS) {
      const shot = calculate({
        clubId: club.id,
        lie: representativeLie[club.id],
        recoverySkill: 50,
      });
      expect(shot.version).toBe(SHOT_EFFECTS_VERSION);
      expect(shot.clubId).toBe(club.id);
      expect(shot.penaltyStrokes).toBe(0);
      expect(Number.isFinite(shot.carryYards)).toBe(true);
      expect(Number.isFinite(shot.dispersionTiles)).toBe(true);
      expect(Number.isFinite(shot.rolloutYards)).toBe(true);
      expect(Number.isFinite(shot.flight.effectiveLoftDegrees)).toBe(true);
      expect(Number.isFinite(shot.flight.launchAngleDegrees)).toBe(true);
      expect(Number.isFinite(shot.flight.apexHeightYards)).toBe(true);
    }
  });

  it("blocks invalid club, lie, technique, and flight combinations with readable reasons", () => {
    const cases = [
      {
        selection: { clubId: "laser", lie: "fairway" as const, technique: "normal", flightProfile: "standard" },
        code: "unknown_club",
      },
      {
        selection: { clubId: "driver", lie: "water" as const, technique: "normal", flightProfile: "standard" },
        code: "unplayable_lie",
      },
      {
        selection: { clubId: "driver", lie: "rough" as const, technique: "normal", flightProfile: "standard" },
        code: "club_lie_mismatch",
      },
      {
        selection: { clubId: "sand_wedge", lie: "sand" as const, technique: "draw", flightProfile: "standard" },
        code: "unsupported_technique",
      },
      {
        selection: { clubId: "putter", lie: "green" as const, technique: "normal", flightProfile: "high" },
        code: "unsupported_flight",
      },
      {
        selection: { clubId: "seven_iron", lie: "fairway" as const, technique: "punch", flightProfile: "standard" },
        code: "technique_requires_low_flight",
      },
      {
        selection: { clubId: "pitching_wedge", lie: "fairway" as const, technique: "flop", flightProfile: "standard" },
        code: "technique_requires_high_flight",
      },
    ] as const;

    for (const testCase of cases) {
      const result = calculateShotEffects({
        ...testCase.selection,
        recoverySkill: 0,
      });
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.blocker.code).toBe(testCase.code);
      expect(result.blocker.message.length).toBeGreaterThan(10);
    }
  });

  it("forces punch low and flop high while retaining compatible shaped shots", () => {
    expect(calculate({ technique: "punch", flightProfile: "low" })).toMatchObject({
      technique: "punch",
      flightProfile: "low",
      flight: { profile: "low" },
    });
    expect(calculate({
      clubId: "pitching_wedge",
      technique: "flop",
      flightProfile: "high",
    })).toMatchObject({
      technique: "flop",
      flightProfile: "high",
      flight: { profile: "high" },
    });
    expect(calculate({ technique: "backspin" }).rolloutYards).toBeLessThan(
      calculate({ technique: "normal" }).rolloutYards,
    );
  });

  it("is deterministic and JSON serialization friendly", () => {
    const selection = {
      clubId: "sand_wedge",
      lie: "deep_rough" as const,
      recoverySkill: 73.25,
      technique: "flop",
      flightProfile: "high",
    };
    const first = calculateShotEffects(selection);
    const second = calculateShotEffects({ ...selection });

    expect(first).toEqual(second);
    expect(JSON.parse(JSON.stringify(first))).toEqual(first);
  });
});
