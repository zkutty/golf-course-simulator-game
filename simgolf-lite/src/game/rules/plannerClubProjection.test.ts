import { describe, expect, it } from "vitest";
import { getGolferProfile } from "../sim/golferProfiles";
import { freezeProfileCalibration } from "./profileCalibration";
import { createShotModelSnapshotV1 } from "./shotModelSnapshot";
import { plannerDistanceProfile, projectPlannerClubCarries } from "./plannerClubProjection";

const skills = { power: 40, driving: 75, irons: 70, shortGame: 60, putting: 65, recovery: 60 };
describe("ZK1396 frozen carry projection for actual-golfer planning", () => {
  it("projects canonical carries without changing dispersion, names or multipliers", () => {
    const frozen = freezeProfileCalibration(skills);
    const base = getGolferProfile("SCRATCH");
    const original = structuredClone(base);
    const projected = projectPlannerClubCarries(frozen, base.clubs);
    expect(projected.map((club) => club.carryYards)).toEqual([
      frozen.clubCarryYards.driver, frozen.clubCarryYards.three_wood, frozen.clubCarryYards.five_iron,
      frozen.clubCarryYards.seven_iron, frozen.clubCarryYards.pitching_wedge,
    ]);
    expect(projected.map((club) => club.name)).toEqual(base.clubs.map((club) => club.name));
    expect(projected.map((club) => club.dispersionTilesBase)).toEqual(base.clubs.map((club) => club.dispersionTilesBase));
    expect(base).toEqual(original);
    expect(getGolferProfile("SCRATCH").clubs[0].carryYards).toBe(280);
    expect(getGolferProfile("BOGEY").clubs[0].carryYards).toBe(220);
  });
  it("keeps putting stroke budget separate from zero airborne carry", () => {
    const frozen = freezeProfileCalibration(skills);
    const clubs = projectPlannerClubCarries(frozen, [
      { name: "Sand Wedge", carryYards: 78 }, { name: "Chip", carryYards: 38 }, { name: "Putter", carryYards: 28 },
    ]);
    expect(clubs.map((club) => club.carryYards)).toEqual([frozen.clubCarryYards.sand_wedge, frozen.clubCarryYards.chip, 28]);
  });
  it("gates on model presence and fails closed on malformed modern facts", () => {
    const distanceProfile = freezeProfileCalibration(skills);
    expect(plannerDistanceProfile()).toBeNull();
    expect(plannerDistanceProfile({ distanceProfile })).toBeNull();
    expect(plannerDistanceProfile({ shotModel: createShotModelSnapshotV1(), distanceProfile })).toBe(distanceProfile);
    expect(() => plannerDistanceProfile({ shotModel: createShotModelSnapshotV1() })).toThrow(RangeError);
    expect(() => projectPlannerClubCarries({ ...distanceProfile, version: 2 } as never, [])).toThrow(RangeError);
    expect(() => projectPlannerClubCarries(distanceProfile, [{ name: "Unknown", carryYards: 123 }])).toThrow(RangeError);
  });
});
