import type { Course, World } from "../models/types";
import type { PlayerProCareer } from "../models/playerProTypes";
import { startEquippedPlayableRound } from "../competition/equipmentMentor";
import { startChallengeGroupRound } from "../competition/challengeGroupRound";

/** E2E-only mixed-setup fixture, kept outside the initial game bundle. */
export function createZk758BrowserChallengeGroup(course: Course, world: World, layoutId: string, playerPro: PlayerProCareer, groupSize: 2 | 3 | 4 = 4) {
  const playableSetups = [
    ["member", "A"],
    ["forward", "B"],
    ["championship", "C"],
  ] as const;
  const rounds = playableSetups.map(([teeSet, pinRotation]) => startEquippedPlayableRound({ course, world, layoutId, teeSet, pinRotation }));
  const failure = rounds.find((candidate) => !candidate.ok);
  if (failure && !failure.ok) throw new Error(`ChallengeGroupRound fixture could not start: ${failure.reason}`);
  const [member, forward, championship] = rounds.map((candidate) => candidate.ok ? candidate.round : null);
  if (!member || !forward || !championship) throw new Error("ChallengeGroupRound fixture setup is incomplete.");
  const setup = (round: typeof member) => ({ course: round.course, teeSet: round.teeSet, pinRotation: round.pinRotation });
  const participants = [
    { id: "rival-alex", name: "Alex Rivers", controller: "ai" as const, skills: { ...playerPro.skills, power: 47 }, handicapIndex: 12.4, setup: setup(forward) },
    { id: playerPro.identity.id, name: playerPro.identity.name, controller: "player" as const, handedness: playerPro.identity.handedness, skills: playerPro.skills, confidenceSnapshot: playerPro.confidence, handicapIndex: playerPro.handicapProfile.handicapIndex, setup: setup(member), equipment: { loadout: playerPro.equipmentLoadout, items: playerPro.inventory.items } },
    { id: "rival-blair", name: "Blair Stone", controller: "ai" as const, handedness: "left" as const, skills: { ...playerPro.skills, putting: 52 }, handicapIndex: 9.6, setup: setup(championship) },
    { id: "rival-devon", name: "Devon Park", controller: "ai" as const, skills: { ...playerPro.skills, irons: 50 }, handicapIndex: 7.8, setup: setup(forward) },
  ].slice(0, groupSize);
  return startChallengeGroupRound({
    id: "zk726-browser-group",
    course: member.course,
    rulesSnapshot: member.rulesSnapshot,
    teeSet: member.teeSet,
    pinRotation: member.pinRotation,
    participants,
    scoringMode: "net-match",
    individualFormat: "net-match",
    sideBets: [],
    rngSeed: 726_001,
    startedWeek: world.week,
    startedDay: 0,
  });
}
