import { describe, expect, it } from "vitest";
import type { PlayerProSkills, PlayerRoundCourseSnapshot } from "../models/playerProTypes";
import { freezeProfileCalibration } from "../rules/profileCalibration";
import { createShotModelSnapshotV1 } from "../rules/shotModelSnapshot";
import { createBivariateDispersionRoundSnapshotV1 } from "../rules/dispersionSnapshot";
import { isValidSharedShotOutcome } from "../rules/contracts";
import { resolvePlayableShot } from "../playerPro/playerPro";
import type { EquipmentModifier, InventoryItem } from "./types";
import { challengeGroupPlayerRound, commitChallengeGroupPlayerShot, decodeChallengeGroupRound,
  encodeChallengeGroupRound, startChallengeGroupRound, previewChallengeGroupPlayerShot, challengeGroupPlayerSkills } from "./challengeGroupRound";

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

function equippedFixture(power: number, modifiers: readonly EquipmentModifier[], teamFormat?: "alternate-shot" | "scramble", modern = true) {
  const shared = course(modern);
  if (modern) shared.dispersionSnapshot = createBivariateDispersionRoundSnapshotV1();
  const item: InventoryItem = { id: "selected-club", definitionId: "frozen-club-definition", name: "Test Club", category: "club",
    ownerId: "a-player", custodianId: "a-player", authoredValue: 100, remainingValue: 100, prestige: 1,
    unique: false, confirmationRequired: false, transferable: true, transferHistory: [], modifiers };
  const round = startChallengeGroupRound({ id: "equipment-profile", course: shared,
    teeSet: "member", pinRotation: "A", ...(teamFormat ? { teamFormat, scoringMode: "net-stroke" as const } : {}),
    rngSeed: 123, startedWeek: 2, startedDay: 3,
    participants: Array.from({ length: teamFormat ? 4 : 2 }, (_, index) => ({
      id: index === 0 ? "a-player" : `ai-${index}`, name: `Actor ${index}`, controller: index === 0 ? "player" as const : "ai" as const,
      teamId: teamFormat ? index < 2 ? "a" : "b" : String(index), skills: skills(index === 0 ? power : 75), handicapIndex: 10,
      ...(index === 0 ? { equipment: { loadout: { clubItemIds: [item.id] }, items: [item] } } : {}),
    })) });
  return { round, item };
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

  it("retains the group shot owner while preserving sampled geometry and RNG", () => {
    const fixture = view(90);
    const selection = { club: "Driver", aim: fixture.player.course.holes[0].pin, power: 1, technique: "normal" as const };
    const raw = resolvePlayableShot({ snapshot: fixture.player.course, holeId: "h-1", shotNumber: 1,
      from: fixture.player.ball, lie: fixture.player.lie, skills: skills(90), selection, seed: 123, handedness: "right" });
    const committed = commitChallengeGroupPlayerShot(fixture.round, "a-player", selection);
    const trace = committed.golfers.find((golfer) => golfer.id === "a-player")!.shots[0];
    expect(trace.id).not.toBe(raw.id);
    expect(trace.sharedOutcome?.motion?.identity.shotId).toBe(trace.id);
    expect(trace.seed).toBe(raw.seed);
    expect(trace.landing).toEqual(raw.landing);
    expect(trace.rest).toEqual(raw.rest);
    expect(trace.sharedOutcome).toEqual({ ...raw.sharedOutcome!, motion: {
      ...raw.sharedOutcome!.motion!, identity: { ...raw.sharedOutcome!.motion!.identity, shotId: trace.id },
    } });
    expect(isValidSharedShotOutcome(trace.sharedOutcome)).toBe(true);
    expect(decodeChallengeGroupRound(encodeChallengeGroupRound(committed)).ok).toBe(true);
    for (const changed of ["shotId", "holeId", "shotNumber", "seed", "club", "style"] as const) {
      const hostile = structuredClone(committed);
      const identity = hostile.golfers.find((golfer) => golfer.id === "a-player")!.shots[0].sharedOutcome!.motion!.identity;
      if (changed === "shotNumber" || changed === "seed") identity[changed] += 1;
      else identity[changed] += "-forged";
      expect(decodeChallengeGroupRound(hostile).ok).toBe(false);
    }
  });

  it.each([undefined, "alternate-shot", "scramble"] as const)("applies a frozen 10%% carry bonus once in %s play", (teamFormat) => {
    for (const power of [50, 90]) {
      const selection = { club: "Driver", aim: course(true).holes[0].pin, power: 1, technique: "normal" as const };
      const base = equippedFixture(power, [], teamFormat);
      const equipped = equippedFixture(power, [{ channel: "carry", multiplier: 1.1, context: "wood-from-tee" }], teamFormat);
      const player = challengeGroupPlayerRound(equipped.round)!;
      expect(player.course.distanceProfile!.skills).toEqual(skills(power));
      expect(challengeGroupPlayerSkills(equipped.round)).toEqual(skills(power));
      expect(player.performanceLoadout).toMatchObject({ version: 1, frozenWeek: 2, frozenDay: 3,
        itemIds: ["selected-club"], modifiers: [{ sourceKind: "equipment", sourceId: "frozen-club-definition", multiplier: 1.1 }] });
      expect(Object.isFrozen(player.performanceLoadout)).toBe(true);
      equipped.item.modifiers = [{ channel: "carry", multiplier: .9 }];
      expect(challengeGroupPlayerRound(equipped.round)!.performanceLoadout).toEqual(player.performanceLoadout);
      const basePreview = previewChallengeGroupPlayerShot(base.round, "a-player", selection)!;
      const preview = previewChallengeGroupPlayerShot(equipped.round, "a-player", selection)!;
      expect(preview.carryYards / basePreview.carryYards).toBeCloseTo(1.1, 10);
      const hit = (round: typeof base.round) => commitChallengeGroupPlayerShot(round, "a-player", selection)
        .golfers.find((golfer) => golfer.id === "a-player")!.shots[0];
      expect(hit(equipped.round).sharedOutcome!.requestedCarryYards / hit(base.round).sharedOutcome!.requestedCarryYards)
        .toBeCloseTo(1.1, 10);
      expect(player.course.distanceProfile).toEqual(challengeGroupPlayerRound(equipped.round)!.course.distanceProfile);
    }
  });

  it("applies contextual dispersion and spin once without altering raw skill", () => {
    const hit = (modifiers: readonly EquipmentModifier[], flightProfile: "low" | "standard") => {
      const { round } = equippedFixture(50, modifiers);
      const fairway = structuredClone(round);
      fairway.golfers[0].lie = "fairway";
      const selection = { club: "7 Iron", aim: fairway.course.holes[0].pin, power: 1, technique: "normal" as const, flightProfile };
      return commitChallengeGroupPlayerShot(fairway, "a-player", selection).golfers[0].shots[0];
    };
    const modifiers: EquipmentModifier[] = [
      { channel: "dispersion", multiplier: .9, context: "iron-low-fairway" },
      { channel: "spin", multiplier: .9, context: "iron-low-fairway" },
    ];
    const base = hit([], "low");
    const equipped = hit(modifiers, "low");
    expect(equipped.sharedOutcome!.appliedDispersion!.accuracy).toBe(75);
    expect(equipped.sharedOutcome!.appliedDispersion!.consistency).toBe(75);
    expect(equipped.sharedOutcome!.requestedDispersionTiles / base.sharedOutcome!.requestedDispersionTiles).toBeCloseTo(.9, 5);
    expect(equipped.sharedOutcome!.impact!.spinControl / base.sharedOutcome!.impact!.spinControl).toBeCloseTo(1 / .9, 5);
    expect(hit(modifiers, "standard").sharedOutcome).toEqual(hit([], "standard").sharedOutcome);
  });

  it("retains legacy equipment skill projection and carry behavior", () => {
    const selection = { club: "Driver", aim: course(false).holes[0].pin, power: 1, technique: "normal" as const };
    const base = equippedFixture(50, [], undefined, false);
    const equipped = equippedFixture(50, [{ channel: "carry", multiplier: 1.1 }], undefined, false);
    expect(challengeGroupPlayerRound(equipped.round)!.performanceLoadout).toBeUndefined();
    expect(challengeGroupPlayerSkills(equipped.round).power).toBeGreaterThan(50);
    const hit = (round: typeof base.round) => commitChallengeGroupPlayerShot(round, "a-player", selection).golfers[0].shots[0];
    expect(hit(equipped.round).sharedOutcome!.requestedCarryYards / hit(base.round).sharedOutcome!.requestedCarryYards).toBeCloseTo(1.1, 10);
  });

  it("rejects present malformed course calibration or unsupported model versions on reload", () => {
    const valid = view(90).round;
    expect(decodeChallengeGroupRound(valid).ok).toBe(true);
    const invalidCourses: unknown[] = [
      { ...valid.course, shotModel: null },
      { ...valid.course, shotModel: { ...valid.course.shotModel!, version: 2 } },
      { ...valid.course, shotModel: { ...valid.course.shotModel!, extra: true } },
      { ...valid.course, distanceProfile: undefined },
      { ...valid.course, distanceProfile: null },
      { ...valid.course, distanceProfile: { ...valid.course.distanceProfile!, version: 2 } },
      { ...valid.course, distanceProfile: { ...valid.course.distanceProfile!, clubCarryYards: {
        ...valid.course.distanceProfile!.clubCarryYards, driver: NaN,
      } } },
      { ...valid.course, shotModel: undefined, distanceProfile: { version: 2 } },
    ];
    for (const hostile of invalidCourses) {
      expect(decodeChallengeGroupRound({ ...valid, course: hostile }).ok).toBe(false);
    }
    expect(decodeChallengeGroupRound(view(10, false).round).ok).toBe(true);
  });

  it.each(["alternate-shot", "scramble"] as const)("uses actor power for %s team commits on shared geometry", (teamFormat) => {
    function hit(power: number) {
      const shared = course(true);
      const round = startChallengeGroupRound({ id: `team-power-${power}`, course: shared,
        teeSet: "member", pinRotation: "A", teamFormat, scoringMode: "net-stroke",
        rngSeed: 123, startedWeek: 0, startedDay: 0,
        participants: [10, 90, 50, 70].map((strength, index) => ({
          id: `p${index}`, name: `Player ${index}`, controller: index === 0 ? "player" as const : "ai" as const,
          teamId: index < 2 ? "team-a" : "team-b", skills: skills(index === 0 ? power : strength), handicapIndex: 10,
        })) });
      const committed = commitChallengeGroupPlayerShot(round, "p0", {
        club: "Driver", aim: shared.holes[0].pin, power: 1, technique: "normal",
      });
      const trace = committed.golfers.find((golfer) => golfer.id === "p0")!.shots[0];
      expect(trace.sharedOutcome?.requestedCarryYards).toBeCloseTo(
        freezeProfileCalibration(skills(power), { driverTotalOffsetYards: -10 }).clubCarryYards.driver, 6);
      expect(trace.sharedOutcome?.motion?.identity.shotId).toBe(trace.id);
      expect(committed.course).toEqual(round.course);
      return trace;
    }
    expect(hit(90).sharedOutcome!.requestedCarryYards).toBeGreaterThan(hit(10).sharedOutcome!.requestedCarryYards + 60);
  });
});
