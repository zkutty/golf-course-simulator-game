import { describe, expect, it } from "vitest";
import type { PlayerProSkills, PlayerRoundCourseSnapshot } from "../models/playerProTypes";
import { freezeProfileCalibration } from "../rules/profileCalibration";
import { createShotModelSnapshotV1 } from "../rules/shotModelSnapshot";
import { challengeGroupPlayerRound, startChallengeGroupRound } from "./challengeGroupRound";

function skills(power: number): PlayerProSkills {
  return { power, driving: 75, irons: 75, shortGame: 75, putting: 75, recovery: 75 };
}
function course(modern: boolean): PlayerRoundCourseSnapshot {
  return {
    courseId: "field-profile", courseName: "Field Profile", theme: "parkland", width: 80, height: 8,
    yardsPerTile: 10, tiles: new Array(640).fill("fairway"), elevations: new Array(640).fill(0), obstacles: [],
    holes: Array.from({ length: 9 }, (_, index) => ({ id: `h-${index + 1}`, name: `Hole ${index + 1}`,
      par: 5, tee: { x: 2, y: 3 }, pin: { x: 70, y: 3 }, waypoints: [], strokeIndex: index + 1 })),
    rating: { courseRating: 45, slope: 113 },
    ...(modern ? { shotModel: createShotModelSnapshotV1(),
      distanceProfile: freezeProfileCalibration(skills(40), { driverTotalOffsetYards: -10 }) } : {}),
  };
}
function view(power: number, modern = true) {
  const shared = course(modern);
  const round = startChallengeGroupRound({ id: `power-${power}`, course: shared,
    teeSet: "member", pinRotation: "A", rngSeed: 123, startedWeek: 0, startedDay: 0,
    participants: [
      { id: "a-player", name: "Player", controller: "player", teamId: "a", skills: skills(power), handicapIndex: 10 },
      { id: "b-ai", name: "Opponent", controller: "ai", teamId: "b", skills: skills(80), handicapIndex: 10 },
    ] });
  const player = challengeGroupPlayerRound(round);
  if (!player) throw new Error("Missing player view.");
  return { player, round, shared };
}

describe("ZK1396 participant-owned field distance profiles", () => {
  it("uses each participant's frozen power rather than the host's carry map", () => {
    const short = view(10);
    const long = view(90);
    expect(short.player.course.distanceProfile).toEqual(freezeProfileCalibration(skills(10), { driverTotalOffsetYards: -10 }));
    expect(long.player.course.distanceProfile).toEqual(freezeProfileCalibration(skills(90), { driverTotalOffsetYards: -10 }));
    expect(long.player.course.distanceProfile!.clubCarryYards.driver)
      .toBeGreaterThan(short.player.course.distanceProfile!.clubCarryYards.driver + 60);
    expect(short.shared.distanceProfile?.skills.power).toBe(40);
    expect(long.shared.distanceProfile?.skills.power).toBe(40);
    expect(short.round.course.distanceProfile).toEqual(short.shared.distanceProfile);
    expect(Object.isFrozen(short.round.golfers[0].skills)).toBe(true);
  });

  it("preserves absent historical profile/model carriers", () => {
    const legacy = view(10, false);
    expect(legacy.player.course.shotModel).toBeUndefined();
    expect(legacy.player.course.distanceProfile).toBeUndefined();
  });
});
