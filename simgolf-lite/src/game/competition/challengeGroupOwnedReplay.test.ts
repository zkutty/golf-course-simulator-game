import { afterEach, describe, expect, it, vi } from "vitest";
import * as green from "../greens/greenRollout";
import { createGreenRoundSnapshot, normalizeGreenSurfaceV1 } from "../greens/greenSurface";
import type { PlayerPlayableRound, PlayerProSkills, PlayerRoundCourseSnapshot } from "../models/playerProTypes";
import * as player from "../playerPro/playerPro";
import { freezeProfileCalibration } from "../rules/profileCalibration";
import { createShotModelSnapshotV1 } from "../rules/shotModelSnapshot";
import {
  challengeGroupPlayerRound,
  challengeGroupPlayerSkills,
  commitChallengeGroupPlayerShot,
  decodeChallengeGroupRound,
  encodeChallengeGroupRound,
  replayChallengeGroupPlayerShots,
  simulateChallengeGroupOwnBallScores,
  startChallengeGroupOwnedReplayRound,
  startChallengeGroupRound,
  withdrawChallengeGroupGolfer,
  type ChallengeGroupRound,
  type StartChallengeGroupRoundArgs,
} from "./challengeGroupRound";
import { normalizePerformanceLoadoutSnapshot } from "./equipmentRuntime";

const skills: PlayerProSkills = { power: 72, driving: 70, irons: 68, shortGame: 75, putting: 74, recovery: 67 };
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

function args(): StartChallengeGroupRoundArgs {
  const width = 18;
  const height = 8;
  const course: PlayerRoundCourseSnapshot = {
    courseId: "owned-replay-course",
    courseName: "Owned replay",
    geometryVersion: "owned-replay-v1",
    theme: "parkland",
    width,
    height,
    yardsPerTile: 10,
    tiles: Array<string>(width * height).fill("green"),
    elevations: Array.from({ length: width * height }, (_, index) => index % width * .01),
    obstacles: [{ type: "tree", x: 5, y: 4.5 }],
    holes: Array.from({ length: 9 }, (_, index) => ({
      id: `hole-${index + 1}`, name: `Hole ${index + 1}`, par: 3,
      tee: { x: 2, y: 3 }, pin: { x: 9, y: 3 }, waypoints: [],
      strokeIndex: index + 1, teeSet: "member", pinRotation: "A",
    })),
    rating: { courseRating: 27, slope: 113 },
    weather: { kind: "clear", temperatureF: 72, windMph: 0, rainInches: 0, carryMultiplier: 1, dispersionMultiplier: 1, paceMultiplier: 1 },
    shotModel: createShotModelSnapshotV1(),
    distanceProfile: freezeProfileCalibration(skills),
  };
  course.greenSnapshot = createGreenRoundSnapshot({
    ...course,
    greenSurface: normalizeGreenSurfaceV1({ tiles: [{ x: 9, y: 3, offsets: Array.from({ length: 16 }, (_, index) => index * 7) }] }, course),
  });
  return {
    id: "owned-replay", course, teeSet: "member", pinRotation: "A",
    participants: ["player", "a", "b", "c"].map((id, index) => ({
      id, name: id, controller: index === 0 ? "player" : "ai",
      skills: { ...skills, power: skills.power - index }, handicapIndex: 4 + index, handicapAllowance: .85,
    })),
    individualFormat: "net-stroke", rngSeed: 734_413, startedWeek: 1, startedDay: 0,
  };
}

function recommendation(round: ChallengeGroupRound): player.PlayerShotSelection {
  const view = challengeGroupPlayerRound(round);
  if (!view || round.phase !== "awaiting_player") throw new Error("Expected an active player turn.");
  return player.caddieRecommendation(view, challengeGroupPlayerSkills(round));
}

function publicCompletion(initial: ChallengeGroupRound) {
  let round = initial;
  const selections: player.PlayerShotSelection[] = [];
  for (let guard = 0; round.phase !== "complete" && guard < 480; guard++) {
    const selection = recommendation(round);
    selections.push(selection);
    round = commitChallengeGroupPlayerShot(round, round.playerGolferId, selection);
  }
  expect(round.phase).toBe("complete");
  return { round, selections };
}

function recursivelyFrozen(value: unknown): boolean {
  return value === null || typeof value !== "object"
    || Object.isFrozen(value) && Object.values(value).every(recursivelyFrozen);
}

function outcome(run: () => unknown) {
  try { return { value: JSON.stringify(run()) }; }
  catch (error) { return { error: { name: (error as Error).name, message: (error as Error).message } }; }
}

afterEach(() => vi.restoreAllMocks());

describe("internally owned ChallengeGroup replay planning", () => {
  it("retains complete modern transcript bytes and RNG across multiple player/AI bursts", () => {
    const input = args();
    const originalInput = JSON.stringify(input);
    const publicStart = startChallengeGroupRound(clone(input));
    const ownedStart = startChallengeGroupOwnedReplayRound(input);
    const originalOwnedStart = JSON.stringify(ownedStart);
    expect(originalOwnedStart).toBe(JSON.stringify(publicStart));
    expect(ownedStart.course.greenSnapshot!.surface.tiles.length).toBeGreaterThan(0);
    const raw = vi.spyOn(player, "caddieRecommendation");
    const owned = vi.spyOn(player, "ownedCaddieRecommendation");
    const expected = publicCompletion(publicStart);
    expect(expected.selections.length).toBeGreaterThan(1);
    expect(raw.mock.calls.length).toBeGreaterThan(0);
    expect(owned).not.toHaveBeenCalled();
    vi.clearAllMocks();
    const unmarkedReplay = replayChallengeGroupPlayerShots(publicStart, publicStart.playerGolferId, expected.selections);
    expect(raw.mock.calls.length).toBeGreaterThan(0);
    expect(owned).not.toHaveBeenCalled();
    vi.clearAllMocks();
    const replayed = replayChallengeGroupPlayerShots(ownedStart, ownedStart.playerGolferId, expected.selections);
    expect(replayed).not.toBeNull();
    expect(JSON.stringify(replayed)).toBe(JSON.stringify(expected.round));
    expect(JSON.stringify(replayed)).toBe(JSON.stringify(unmarkedReplay));
    expect(replayed!.rngCursor).toBe(expected.round.rngCursor);
    expect(replayed!.rngCursor).toBeGreaterThan(expected.selections.length);
    expect(replayed!.golfers.every(golfer => golfer.shots.length > 0 && golfer.scorecard.length === 9)).toBe(true);
    expect(replayed!.turnEvidence.some(turn => turn.controller === "ai")).toBe(true);
    expect(replayed!.reactions).toHaveLength(4 * 9);
    expect(replayed!.honorsOrder).toHaveLength(4);
    expect(replayed!.match.concessions).toEqual(expected.round.match.concessions);
    expect(recursivelyFrozen(replayed)).toBe(true);
    expect(owned.mock.calls.length).toBeGreaterThan(1);
    expect(owned.mock.calls.every(([view]) => view.autoPlay)).toBe(true);
    expect(raw).not.toHaveBeenCalled();
    expect(JSON.stringify(ownedStart)).toBe(originalOwnedStart);
    expect(JSON.stringify(input)).toBe(originalInput);
    expect(Object.isFrozen(input.course)).toBe(false);
    const replayedBytes = JSON.stringify(replayed);
    input.course.tiles[0] = "water";
    input.participants[0].skills.power = 0;
    expected.selections[0].aim.x = -999;
    expect(JSON.stringify(ownedStart)).toBe(originalOwnedStart);
    expect(JSON.stringify(replayed)).toBe(replayedBytes);
  }, 60_000);

  it("keeps public commits and raw, cloned, decoded, frozen and proxy carriers on the public route", () => {
    const ownedStart = startChallengeGroupOwnedReplayRound(args());
    const selection = recommendation(ownedStart);
    const raw = vi.spyOn(player, "caddieRecommendation");
    const owned = vi.spyOn(player, "ownedCaddieRecommendation");
    const committed = commitChallengeGroupPlayerShot(ownedStart, ownedStart.playerGolferId, selection);
    expect(raw.mock.calls.length).toBeGreaterThan(0);
    expect(owned).not.toHaveBeenCalled();
    const decoded = decodeChallengeGroupRound(encodeChallengeGroupRound(ownedStart));
    if (!decoded.ok) throw new Error(decoded.error);
    const frozenAccessor = { ...ownedStart };
    let courseReads = 0;
    Object.defineProperty(frozenAccessor, "course", { enumerable: true, get() { courseReads++; return ownedStart.course; } });
    Object.freeze(frozenAccessor);
    const carriers = [
      startChallengeGroupRound(args()), clone(ownedStart), { ...ownedStart }, decoded.round,
      Object.freeze(clone(ownedStart)), frozenAccessor, new Proxy(ownedStart, {}),
    ];
    for (const carrier of carriers) {
      vi.clearAllMocks();
      const result = replayChallengeGroupPlayerShots(carrier, carrier.playerGolferId, [selection]);
      expect(JSON.stringify(result)).toBe(JSON.stringify(committed));
      expect(raw.mock.calls.length).toBeGreaterThan(0);
      expect(owned).not.toHaveBeenCalled();
    }
    expect(courseReads).toBeGreaterThan(0);
    vi.clearAllMocks();
    const firstReplay = replayChallengeGroupPlayerShots(ownedStart, ownedStart.playerGolferId, [selection])!;
    expect(owned.mock.calls.length).toBeGreaterThan(0);
    const nextSelection = recommendation(firstReplay);
    vi.clearAllMocks();
    replayChallengeGroupPlayerShots(firstReplay, firstReplay.playerGolferId, [nextSelection]);
    expect(raw.mock.calls.length).toBeGreaterThan(0);
    expect(owned).not.toHaveBeenCalled();
  }, 60_000);

  it("does not propagate ownership through withdrawals or change segmented replay bytes", () => {
    const publicStart = startChallengeGroupRound(args());
    const ownedStart = startChallengeGroupOwnedReplayRound(args());
    const firstSelection = recommendation(publicStart);
    let expected = commitChallengeGroupPlayerShot(publicStart, publicStart.playerGolferId, firstSelection);
    expected = withdrawChallengeGroupGolfer(expected, "c", "Replay boundary.");
    const afterWithdrawal = recommendation(expected);
    expected = commitChallengeGroupPlayerShot(expected, expected.playerGolferId, afterWithdrawal);
    const firstReplay = replayChallengeGroupPlayerShots(ownedStart, ownedStart.playerGolferId, [firstSelection])!;
    const withdrawn = withdrawChallengeGroupGolfer(firstReplay, "c", "Replay boundary.");
    const raw = vi.spyOn(player, "caddieRecommendation");
    const owned = vi.spyOn(player, "ownedCaddieRecommendation");
    const replayed = replayChallengeGroupPlayerShots(withdrawn, withdrawn.playerGolferId, [afterWithdrawal]);
    expect(JSON.stringify(replayed)).toBe(JSON.stringify(expected));
    expect(raw.mock.calls.length).toBeGreaterThan(0);
    expect(owned).not.toHaveBeenCalled();
    const directlyWithdrawn = withdrawChallengeGroupGolfer(ownedStart, "c", "Direct boundary.");
    const directSelection = recommendation(directlyWithdrawn);
    vi.clearAllMocks();
    replayChallengeGroupPlayerShots(directlyWithdrawn, directlyWithdrawn.playerGolferId, [directSelection]);
    expect(raw.mock.calls.length).toBeGreaterThan(0);
    expect(owned).not.toHaveBeenCalled();
  }, 60_000);

  it("preserves startup observable reads, raw initial AI, reentry and original failures", () => {
    const run = (start: typeof startChallengeGroupRound) => {
      const input = args();
      input.participants = [input.participants[1], input.participants[0], ...input.participants.slice(2)];
      const events: string[] = [];
      const course = input.course;
      const courseValue = clone(course);
      Object.defineProperty(input, "course", { enumerable: true, get() { events.push("get:course"); return course; } });
      Object.defineProperty(course, "toJSON", { get() {
        events.push("get:course.toJSON");
        return () => { events.push("call:course.toJSON"); return courseValue; };
      } });
      const firstSkills = input.participants[0].skills;
      const power = firstSkills.power;
      Object.defineProperty(firstSkills, "power", { enumerable: true, get() {
        events.push("get:power");
        const nested = outcome(() => startChallengeGroupRound({ ...args(), id: "" }));
        events.push(JSON.stringify(nested));
        return power;
      } });
      return { events, result: outcome(() => start(input)) };
    };
    const raw = vi.spyOn(player, "caddieRecommendation");
    const owned = vi.spyOn(player, "ownedCaddieRecommendation");
    const original = run(startChallengeGroupRound);
    expect(raw.mock.calls.length).toBeGreaterThan(0);
    expect(owned).not.toHaveBeenCalled();
    vi.clearAllMocks();
    expect(run(startChallengeGroupOwnedReplayRound)).toEqual(original);
    expect(raw.mock.calls.length).toBeGreaterThan(0);
    expect(owned).not.toHaveBeenCalled();
    for (const mutate of [
      (input: StartChallengeGroupRoundArgs) => { input.id = ""; },
      (input: StartChallengeGroupRoundArgs) => { input.course.tiles = []; },
      (input: StartChallengeGroupRoundArgs) => { input.course.rating!.slope = -1; },
      (input: StartChallengeGroupRoundArgs) => { Object.defineProperty(input.course, "toJSON", { get() { throw new Error("raw toJSON getter"); } }); },
      (input: StartChallengeGroupRoundArgs) => { Object.defineProperty(input.course, "toJSON", { value() { throw new Error("raw toJSON call"); } }); },
      (input: StartChallengeGroupRoundArgs) => { Object.defineProperty(input.participants[0].skills, "power", { get() { throw new Error("raw skill getter"); } }); },
    ]) {
      const originalInput = args();
      const ownedInput = args();
      mutate(originalInput);
      mutate(ownedInput);
      const expected = outcome(() => startChallengeGroupRound(originalInput));
      expect(expected).toHaveProperty("error");
      expect(outcome(() => startChallengeGroupOwnedReplayRound(ownedInput))).toEqual(expected);
    }
  }, 60_000);

  it("returns unsupported authority unchanged and unmarked instead of adding a failure", () => {
    const raw = vi.spyOn(player, "caddieRecommendation");
    const owned = vi.spyOn(player, "ownedCaddieRecommendation");
    for (const mutate of [
      (input: StartChallengeGroupRoundArgs) => { input.individualFormat = "gross-stroke"; },
      (input: StartChallengeGroupRoundArgs) => { input.individualContests = [{ id: "skins", kind: "skins" }]; },
      (input: StartChallengeGroupRoundArgs) => { input.sideBets = [{ id: "skins", kind: "skins", stake: 5, carry: 0, status: "active", settlements: [], evidence: [] }]; },
      (input: StartChallengeGroupRoundArgs) => {
        input.individualFormat = undefined;
        input.teamFormat = "four-ball";
        input.participants = input.participants.map((golfer, index) => ({ ...golfer, teamId: index < 2 ? "one" : "two" }));
      },
    ]) {
      const input = args();
      mutate(input);
      const publicStart = startChallengeGroupRound(clone(input));
      const unsupported = startChallengeGroupOwnedReplayRound(input);
      expect(JSON.stringify(unsupported)).toBe(JSON.stringify(publicStart));
      const selection = recommendation(publicStart);
      const expected = replayChallengeGroupPlayerShots(publicStart, publicStart.playerGolferId, [selection]);
      vi.clearAllMocks();
      const replayed = replayChallengeGroupPlayerShots(unsupported, unsupported.playerGolferId, [selection]);
      expect(JSON.stringify(replayed)).toBe(JSON.stringify(expected));
      expect(raw.mock.calls.length).toBeGreaterThan(0);
      expect(owned).not.toHaveBeenCalled();
    }
  }, 60_000);

  it("preserves raw selection getters, toJSON reentry and throwing action normalization", () => {
    const run = (start: typeof startChallengeGroupRound, throws: boolean) => {
      const initial = start(args());
      const plain = recommendation(initial);
      const selection = clone(plain);
      const events: string[] = [];
      Object.defineProperty(selection, "power", { enumerable: true, get() {
        events.push("get:power");
        return plain.power;
      } });
      Object.defineProperty(selection, "toJSON", { get() {
        events.push("get:selection.toJSON");
        return () => {
          events.push("call:selection.toJSON");
          events.push(`reentry:${replayChallengeGroupPlayerShots(initial, initial.playerGolferId, []) === initial}`);
          if (throws) throw new Error("raw selection toJSON");
          return plain;
        };
      } });
      return { events, result: outcome(() => replayChallengeGroupPlayerShots(initial, initial.playerGolferId, [selection])) };
    };
    for (const throws of [false, true]) {
      const expected = run(startChallengeGroupRound, throws);
      expect(expected.events).toContain("get:power");
      expect(expected.events).toContain("get:selection.toJSON");
      expect(expected.events).toContain("call:selection.toJSON");
      expect(expected.events).toContain("reentry:true");
      if (throws) expect(expected.result).toEqual({ error: { name: "Error", message: "raw selection toJSON" } });
      else expect(expected.result).toHaveProperty("value");
      expect(run(startChallengeGroupOwnedReplayRound, throws)).toEqual(expected);
    }
  }, 60_000);

  it("preserves legacy results and raw fallback for missing waypoints and poisoned JSON tiles", () => {
    const raw = vi.spyOn(player, "caddieRecommendation");
    const owned = vi.spyOn(player, "ownedCaddieRecommendation");
    const preparation = vi.spyOn(player, "createOwnedCaddiePlanningContext");
    for (const kind of ["legacy", "missing-waypoints", "poisoned-tile"] as const) {
      const input = args();
      if (kind === "legacy") { delete input.course.shotModel; delete input.course.distanceProfile; }
      else if (kind === "missing-waypoints") Reflect.deleteProperty(input.course.holes[0], "waypoints");
      else Reflect.set(input.course.tiles, 3 * input.course.width + 1, { toString: null, valueOf: null });
      const publicStart = startChallengeGroupRound(clone(input));
      const ownedStart = startChallengeGroupOwnedReplayRound(input);
      const selection: player.PlayerShotSelection = { club: "Pitching Wedge", aim: { x: 9, y: 3 }, power: .63, technique: "normal" };
      const expected = outcome(() => replayChallengeGroupPlayerShots(publicStart, publicStart.playerGolferId, [selection]));
      if (kind === "poisoned-tile") expect(expected).toEqual({ error: { name: "TypeError", message: "Cannot convert object to primitive value" } });
      vi.clearAllMocks();
      expect(outcome(() => replayChallengeGroupPlayerShots(ownedStart, ownedStart.playerGolferId, [selection]))).toEqual(expected);
      if (kind === "legacy") expect(owned.mock.calls.length).toBeGreaterThan(0);
      else {
        expect(owned).not.toHaveBeenCalled();
        expect(preparation).not.toHaveBeenCalled();
      }
      if (kind === "missing-waypoints") expect(raw.mock.calls.length).toBeGreaterThan(0);
    }
  }, 60_000);

  it("keeps empty, unavailable and wrong-player/turn control flow unchanged", () => {
    const round = startChallengeGroupOwnedReplayRound(args());
    const unreadable = new Proxy(round, { get() { throw new Error("empty replay read a round property"); } });
    expect(replayChallengeGroupPlayerShots(unreadable, "player", [])).toBe(unreadable);
    expect(replayChallengeGroupPlayerShots(round, round.playerGolferId, [])).toBe(round);
    const unavailable: player.PlayerShotSelection = { club: "Putter", aim: { x: 9, y: 3 }, power: .5, technique: "normal" };
    expect(replayChallengeGroupPlayerShots(round, round.playerGolferId, [unavailable])).toBeNull();
    expect(() => replayChallengeGroupPlayerShots(round, "a", [unavailable])).toThrow("Only the player-controlled golfer accepts player shot input.");
    const wrongTurn = { ...round, activeGolferId: "a" };
    expect(() => replayChallengeGroupPlayerShots(wrongTurn, wrongTurn.playerGolferId, [unavailable])).toThrow("The player-controlled golfer does not own the current turn.");
  });

  it("prepares each participant's distinct physical setup once per private invocation across holes", () => {
    const input = args();
    input.participants = input.participants.map((golfer, golferIndex) => {
      const course = clone(input.course);
      course.holes = course.holes.map((hole, holeIndex) => ({
        ...hole,
        tee: { x: 2 + golferIndex * .2, y: 3 + holeIndex % 2 * .2 },
        pin: { x: 8.5 + golferIndex * .3 + holeIndex % 3 * .4, y: 2.8 + holeIndex % 2 * .4 },
      }));
      return { ...golfer, setup: { course, teeSet: golferIndex % 2 ? "forward" as const : "member" as const, pinRotation: "A" as const } };
    });
    const publicStart = startChallengeGroupRound(clone(input));
    const ownedStart = startChallengeGroupOwnedReplayRound(clone(input));
    const expected = publicCompletion(publicStart);
    expect(new Set(expected.round.turnEvidence.map(turn => turn.holeId)).size).toBe(9);
    const factory = vi.spyOn(player, "createOwnedCaddiePlanningContext");
    const height = vi.spyOn(green, "createGreenRolloutHeightSampler");
    const context = vi.spyOn(green, "createGreenRolloutContext");
    const assertPlanningPreparations = (count: number) => {
      expect(factory).toHaveBeenCalledTimes(count);
      expect(context).toHaveBeenCalledTimes(count);
      const courses = new Set(context.mock.calls.map(([course]) => course));
      expect(courses.size).toBe(count);
      // Actual shot resolution also creates height samplers. Only planning
      // passes its prepared course to createGreenRolloutContext; the factory
      // must create exactly one height sampler for each of those same objects.
      const planningHeights = height.mock.calls.filter(([course]) => courses.has(course));
      expect(planningHeights).toHaveLength(count);
      for (const course of courses) expect(planningHeights.filter(([source]) => source === course)).toHaveLength(1);
      return [...courses];
    };
    const first = replayChallengeGroupPlayerShots(ownedStart, ownedStart.playerGolferId, expected.selections);
    expect(JSON.stringify(first)).toBe(JSON.stringify(expected.round));
    expect(first!.rngCursor).toBe(expected.round.rngCursor);
    const planningCourses = assertPlanningPreparations(3);
    expect(new Set(planningCourses.map(course => JSON.stringify(course.holes))).size).toBe(3);
    const second = replayChallengeGroupPlayerShots(ownedStart, ownedStart.playerGolferId, expected.selections);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    assertPlanningPreparations(6);
    vi.clearAllMocks();
    const expectedCards = expected.round.golfers.map(({ id, handicap, scorecard }) => ({ id, handicap, scorecard }));
    const scoreOnly = simulateChallengeGroupOwnBallScores(clone(input));
    expect(JSON.stringify(scoreOnly)).toBe(JSON.stringify(expectedCards));
    assertPlanningPreparations(4);
    const scoreOnlyAgain = simulateChallengeGroupOwnBallScores(clone(input));
    expect(JSON.stringify(scoreOnlyAgain)).toBe(JSON.stringify(scoreOnly));
    assertPlanningPreparations(8);
  }, 60_000);

  it("keeps current ball, lie, hole, skills, loadout, weather and drainage out of physical preparation", () => {
    const initial = startChallengeGroupOwnedReplayRound(args());
    const base = challengeGroupPlayerRound(initial)!;
    const planning = player.createOwnedCaddiePlanningContext(base.course);
    const originalContext = green.createGreenRolloutContext;
    type RolloutInput = Parameters<ReturnType<typeof green.createGreenRolloutContext>["resolve"]>[0];
    const observed: RolloutInput[] = [];
    const preparation = vi.spyOn(green, "createGreenRolloutContext").mockImplementation(course => {
      const context = originalContext(course);
      return { ...context, resolve: (input: RolloutInput) => {
        observed.push(input);
        return context.resolve(input);
      } };
    });
    const loadout = normalizePerformanceLoadoutSnapshot({
      version: 1, frozenWeek: 1, frozenDay: 0, itemIds: ["dynamic-club"],
      modifiers: [{ channel: "carry", multiplier: 1.1, sourceKind: "equipment", sourceId: "dynamic-club" }],
    })!;
    const variants: Array<{ view: PlayerPlayableRound; skills: PlayerProSkills }> = [
      { view: base, skills },
      { view: { ...base, ball: { x: 9.4, y: 3.2 }, lie: "green", currentHoleIndex: 1,
        course: { ...base.course, weather: { ...base.course.weather!, rainInches: 1, windMph: 15, carryMultiplier: .9 }, greenDrainageLevel: 3 } }, skills: { ...skills, putting: 43 } },
      { view: { ...base, ball: { x: 4.5, y: 3.4 }, lie: "rough", currentHoleIndex: 2, handedness: "left", performanceLoadout: loadout,
        course: { ...base.course, weather: { ...base.course.weather!, rainInches: .2, windMph: 5, carryMultiplier: 1.05 }, greenDrainageLevel: 1 } }, skills: { ...skills, power: 44, recovery: 55 } },
    ];
    const selectedClubs: string[] = [];
    for (const { view, skills: currentSkills } of variants) {
      const before = JSON.stringify(view);
      const expected = player.caddieRecommendation(view, currentSkills);
      const offset = observed.length;
      const actual = player.ownedCaddieRecommendation(view, currentSkills, planning);
      expect(JSON.stringify(actual)).toBe(JSON.stringify(expected));
      expect(JSON.stringify(view)).toBe(before);
      selectedClubs.push(actual.club);
      const calls = observed.slice(offset);
      expect(calls.length).toBeGreaterThan(0);
      for (const call of calls) {
        expect(call.holeId).toBe(view.course.holes[view.currentHoleIndex].id);
        expect(call.sourceLie).toBe(view.lie);
        expect(call.weather).toBe(view.course.weather);
        expect(call.drainageLevel).toBe(view.course.greenDrainageLevel);
      }
    }
    expect(new Set(selectedClubs).size).toBeGreaterThan(1);
    expect(preparation).toHaveBeenCalledTimes(1);
  }, 60_000);

  it("does not prepare physical inputs during factory creation, no-club, legacy or public recommendations", () => {
    const base = challengeGroupPlayerRound(startChallengeGroupOwnedReplayRound(args()))!;
    let physicalReads = 0;
    const unreadable = new Proxy(base.course, { get() {
      physicalReads++;
      throw new Error("unused physical preparation");
    } });
    const planning = player.createOwnedCaddiePlanningContext(unreadable);
    expect(physicalReads).toBe(0);
    const noClub = { ...base, lie: "unknown" };
    expect(player.ownedCaddieRecommendation(noClub, skills, planning)).toEqual(player.caddieRecommendation(noClub, skills));
    const legacy = { ...base, course: { ...base.course, shotModel: undefined, distanceProfile: undefined } };
    expect(player.ownedCaddieRecommendation(legacy, skills, planning)).toEqual(player.caddieRecommendation(legacy, skills));
    expect(Reflect.apply(player.caddieRecommendation, undefined, [base, skills, planning])).toEqual(player.caddieRecommendation(base, skills));
    expect(physicalReads).toBe(0);
  });
});
