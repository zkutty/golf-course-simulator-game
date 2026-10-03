import { afterEach, describe, expect, it } from "vitest";
import { hashCanonicalValue } from "../../../utils/canonical";
import { BALANCE } from "../../balance/balanceConfig";
import { DEFAULT_COURSE } from "../../models/defaults";
import type { Course, Terrain } from "../../models/types";
import { createM27ReleaseReferenceCourse } from "../../testing/referenceCourse";
import { getGolferProfile, type GolferProfile } from "../golferProfiles";
import { withScoringTileReads } from "../scoringTileReads";
import { solveShotsToGreen } from "./solveShotsToGreen";

const plain = (terrain: Terrain): Course => ({
  ...DEFAULT_COURSE, width: 16, height: 12, yardsPerTile: 10,
  tiles: Array<Terrain>(192).fill(terrain), elevations: Array<number>(192).fill(0),
  holes: [], obstacles: [], surfaceCare: undefined,
});
const player: GolferProfile = {
  ...getGolferProfile("SCRATCH"), yardsPerTile: 10,
  clubs: [{ name: "first", carryYards: 55, dispersionTilesBase: 1 }, { name: "second", carryYards: 55, dispersionTilesBase: 1 }],
};
const restores: Array<() => void> = [];
function change(values: Record<string, number>, key: string, value: number) {
  const previous = values[key];
  restores.push(() => { values[key] = previous; });
  values[key] = value;
}
afterEach(() => { while (restores.length) restores.pop()!(); });

describe("global Dijkstra stroke-floor stop", () => {
  it("retains every original heavy-hole plan, cost, slope and debug field", () => {
    // Captured from bc751b6's original solver and independently recaptured.
    const course = createM27ReleaseReferenceCourse();
    for (const [index, profile, hash, cost, club] of [
      [15, "SCRATCH", "fb32befc", 2.6416939626011104, "5I"],
      [15, "BOGEY", "ada274a6", 2.6356019222010536, "PW"],
      [17, "SCRATCH", "722609c1", 3.1102314744531236, "PW"],
      [17, "BOGEY", "34c38613", 3.118219874599797, "3W"],
    ] as const) {
      const hole = course.holes[index];
      const result = solveShotsToGreen({ course, tee: hole.tee!, green: hole.green!, golfer: getGolferProfile(profile, course) });
      expect(hashCanonicalValue(result)).toBe(hash);
      expect(result.expectedShotsToGreen).toBe(cost);
      expect(result.plan).toHaveLength(1);
      expect(result.plan[0]).toMatchObject({ from: hole.tee, to: hole.green, club });
    }
  }, 30_000);

  it("retains original equal-club ordering and unreachable search outcomes", () => {
    for (const [terrain, hash] of [["fairway", "48b77171"], ["rough", "5ca858f4"], ["sand", "f125b7b3"], ["wetland", "9ad7bbf4"]] as const) {
      const result = solveShotsToGreen({ course: plain(terrain), tee: { x: 2, y: 6 }, green: { x: 13, y: 6 }, golfer: player });
      expect(hashCanonicalValue(result)).toBe(hash);
      if (result.reachable) expect(result.plan[0].club).toBe("first");
    }
    const course = createM27ReleaseReferenceCourse();
    const hole = course.holes[15];
    const profile = getGolferProfile("SCRATCH", course);
    const tied = { ...profile, clubs: [{ ...profile.clubs[0], name: "first" }, { ...profile.clubs[0], name: "second" }] };
    const result = solveShotsToGreen({ course, tee: hole.tee!, green: hole.green!, golfer: tied });
    expect(result.expectedShotsToGreen).toBeGreaterThanOrEqual(2);
    expect(hashCanonicalValue(result)).toBe("1680a788");
  }, 30_000);

  it("uses the original searched bound for negative or nonfinite balance terms", () => {
    const course = createM27ReleaseReferenceCourse();
    const hole = course.holes[15];
    for (const [values, key, value, count, hash] of [
      [BALANCE.shots.landing.penaltyStrokes, "path", -1, 21162, "9c02360d"],
      [BALANCE.shots.water, "shortMissMaxProb", -0.2, 22565, "0764dc40"],
      [BALANCE.shots.water, "waterPenaltyStrokes", -1, 21195, "195feefe"],
      [BALANCE.themes.parkland, "deepRoughPenaltyMult", -1, 21162, "4bea5295"],
      [BALANCE.shots.water, "shortMissUtilStart", NaN, 21162, "7995fcf5"],
      [BALANCE.shots.water, "waterPenaltyStrokes", Infinity, 21162, "7995fcf5"],
    ] as const) {
      change(values, key, value);
      const dependencies = new Map<number, Terrain>();
      const result = withScoringTileReads(course.tiles, dependencies, () => solveShotsToGreen({ course, tee: hole.tee!, green: hole.green!, golfer: getGolferProfile("SCRATCH", course) }));
      expect(hashCanonicalValue(result)).toBe("fb32befc");
      expect(result.expectedShotsToGreen).toBeGreaterThanOrEqual(2);
      // Original ordered footprint proves fallback actually searched the old
      // frontier instead of merely taking the existing direct <2 shortcut.
      expect(dependencies.size).toBe(count);
      expect(hashCanonicalValue([...dependencies])).toBe(hash);
      restores.pop()!();
    }
  }, 30_000);

  it("preserves used negative landing costs and nonfinite legacy behavior", () => {
    change(BALANCE.shots.landing.penaltyStrokes, "wetland", -0.2);
    const searched = solveShotsToGreen({ course: plain("wetland"), tee: { x: 2, y: 6 }, green: { x: 13, y: 6 }, golfer: player });
    expect(hashCanonicalValue(searched)).toBe("df6069bd");
    expect(searched.plan.length).toBeGreaterThan(1);
    restores.pop()!();
    for (const [value, hash] of [[-0.2, "d19370f5"], [NaN, "bcd1dc3e"], [Infinity, "bcd1dc3e"]] as const) {
      change(BALANCE.shots.landing.penaltyStrokes, "rough", value);
      const result = solveShotsToGreen({ course: plain("rough"), tee: { x: 2, y: 6 }, green: { x: 13, y: 6 }, golfer: player });
      expect(hashCanonicalValue(result)).toBe(hash);
      restores.pop()!();
    }
  });
});
