import { afterEach, describe, expect, it, vi } from "vitest";
import type { PlayerProSkills, PlayerRoundCourseSnapshot } from "../models/playerProTypes";
import * as player from "../playerPro/playerPro";
import {
  challengeGroupPlayerRound,
  challengeGroupPlayerSkills,
  commitChallengeGroupPlayerShot,
  simulateChallengeGroupOwnBallScores,
  startChallengeGroupRound,
  type StartChallengeGroupRoundArgs,
} from "./challengeGroupRound";

const skills: PlayerProSkills = {
  power: 72,
  driving: 70,
  irons: 68,
  shortGame: 75,
  putting: 74,
  recovery: 67,
};

function course(terrain: "green" | "water" = "green"): PlayerRoundCourseSnapshot {
  const width = 18;
  const height = 8;
  const holes = Array.from({ length: 9 }, (_, index) => ({
    id: `hole-${index + 1}`,
    name: `Hole ${index + 1}`,
    par: 3,
    tee: { x: 2, y: 3 },
    pin: { x: 9, y: 3 },
    waypoints: [],
    strokeIndex: index + 1,
    teeSet: "member" as const,
    pinRotation: "A" as const,
  }));
  return {
    courseId: "challenge-course",
    courseName: "Challenge Course",
    geometryVersion: "zk726-fixture-v1",
    theme: "parkland",
    width,
    height,
    yardsPerTile: 10,
    tiles: Array<string>(width * height).fill(terrain),
    elevations: Array<number>(width * height).fill(0),
    obstacles: [],
    holes,
    rating: { courseRating: 27, slope: 113 },
    weather: {
      kind: "clear",
      temperatureF: 72,
      windMph: 0,
      rainInches: 0,
      carryMultiplier: 1,
      dispersionMultiplier: 1,
      paceMultiplier: 1,
    },
  };
}

function args(): StartChallengeGroupRoundArgs {
  const snapshot = course();
  snapshot.elevations[0] = -0;
  snapshot.holes[0].tee.x = -0;
  snapshot.shotModel = undefined;
  return {
    id: "score-only-owned", course: snapshot, teeSet: "member", pinRotation: "A",
    participants: ["player", "a", "b", "c"].map((id, index) => ({
      id, name: id, controller: index === 0 ? "player" : "ai",
      skills: { ...skills }, handicapIndex: 4 + index, handicapAllowance: .85,
    })),
    individualFormat: "net-stroke", rngSeed: 734_413, startedWeek: 1, startedDay: 0,
  };
}

// Independent public path retains the existing per-turn normalization boundary.
function publicScores(input: StartChallengeGroupRoundArgs) {
  let round = startChallengeGroupRound(input);
  let guard = 0;
  while (round.phase !== "complete" && guard++ < 480) {
    const view = challengeGroupPlayerRound(round);
    if (!view || round.phase !== "awaiting_player") return null;
    round = commitChallengeGroupPlayerShot(round, round.playerGolferId,
      player.caddieRecommendation(view, challengeGroupPlayerSkills(round)));
    round = { ...round, golfers: round.golfers.map(golfer => ({ ...golfer, shots: [] })), turnEvidence: [] };
  }
  return round.phase !== "complete" ? null
    : JSON.parse(JSON.stringify(round.golfers.map(({ id, handicap, scorecard }) => ({ id, handicap, scorecard }))));
}

function recursivelyFrozen(value: unknown): boolean {
  return value === null || typeof value !== "object"
    || Object.isFrozen(value) && Object.values(value).every(recursivelyFrozen);
}

afterEach(() => vi.restoreAllMocks());

describe("owned own-ball score simulation", () => {
  it("matches public legacy/edge normalization and returns detached immutable results", () => {
    const input = args();
    const before = JSON.stringify(input);
    const expected = publicScores(args());
    const first = simulateChallengeGroupOwnBallScores(input);
    const second = simulateChallengeGroupOwnBallScores(args());
    expect(first).not.toBeNull();
    expect(JSON.stringify(first)).toBe(JSON.stringify(expected));
    expect(JSON.stringify(second)).toBe(JSON.stringify(expected));
    expect(first).not.toBe(second);
    expect(first![0].scorecard).not.toBe(second![0].scorecard);
    expect(recursivelyFrozen(first)).toBe(true);
    expect(Object.isFrozen(input.course)).toBe(false);
    expect(Object.isFrozen(input.course.tiles)).toBe(false);
    expect(Object.is(input.course.elevations[0], -0)).toBe(true);
    expect(JSON.stringify(input)).toBe(before);
    input.course.tiles[0] = "water";
    input.course.holes[0].par = 5;
    input.participants[0].skills.power = 0;
    expect(JSON.stringify(first)).toBe(JSON.stringify(expected));
    expect(Reflect.set(first![0].scorecard[0], "gross", 999)).toBe(false);
    expect(Reflect.set(first![0], "id", "forged")).toBe(false);
  });

  it("preserves startup getter/reentry and throwing JSON-carrier behavior", () => {
    const outcomes = [publicScores, simulateChallengeGroupOwnBallScores].map(run => {
      const input = args();
      const events: string[] = [];
      const power = input.participants[0].skills.power;
      Object.defineProperty(input.participants[0].skills, "power", {
        enumerable: true,
        get() {
          events.push("power");
          try { simulateChallengeGroupOwnBallScores({ ...args(), id: "" }); }
          catch (error) { events.push((error as Error).message); }
          return power;
        },
      });
      const result = run(input);
      const hostile = args();
      Object.defineProperty(hostile.course, "toJSON", { value: () => { throw new Error("hostile course"); } });
      expect(() => run(hostile)).toThrow("hostile course");
      return { events, result: JSON.stringify(result) };
    });
    expect(outcomes[1]).toEqual(outcomes[0]);
  });

  it("keeps canonical startup and rejects team, contest, side-bet and unsupported score formats", () => {
    expect(() => simulateChallengeGroupOwnBallScores({ ...args(), id: "" })).toThrow("stable round ID");
    const badCourse = args();
    badCourse.course.tiles = [];
    expect(() => simulateChallengeGroupOwnBallScores(badCourse)).toThrow("geometry is incomplete");
    const team = args();
    team.individualFormat = undefined;
    team.teamFormat = "four-ball";
    team.participants = team.participants.map((golfer, index) => ({ ...golfer, teamId: index < 2 ? "one" : "two" }));
    const contest = { ...args(), individualContests: [{ id: "skins", kind: "skins" as const }] };
    const sideBet = { ...args(), sideBets: [{ id: "skins", kind: "skins" as const, stake: 5, carry: 0, status: "active" as const, settlements: [], evidence: [] }] };
    for (const input of [team, contest, sideBet, { ...args(), individualFormat: "gross-stroke" as const }]) {
      expect(() => simulateChallengeGroupOwnBallScores(input)).toThrow("Only an own-ball score-only group");
    }
  });

  it("retains unavailable player and AI-concession failure semantics", () => {
    const original = player.caddieRecommendation;
    const unavailable = { club: "unknown", aim: { x: 9, y: 3 }, power: 1, technique: "normal" as const };
    const caddie = vi.spyOn(player, "caddieRecommendation").mockReturnValue(unavailable);
    expect(simulateChallengeGroupOwnBallScores(args())).toBeNull();
    expect(caddie).toHaveBeenCalledTimes(480);
    caddie.mockClear();
    expect(publicScores(args())).toBeNull();
    expect(caddie).toHaveBeenCalledTimes(480);
    caddie.mockImplementation((round, selectedSkills) => round.autoPlay ? unavailable : original(round, selectedSkills));
    const actual = simulateChallengeGroupOwnBallScores(args());
    expect(JSON.stringify(actual)).toBe(JSON.stringify(publicScores(args())));
    expect(actual!.slice(1).every(golfer => golfer.scorecard.every(hole => hole.status === "conceded"))).toBe(true);
  });

  it("copies less deterministic JSON data than the public reference while preserving scores", () => {
    const original = JSON.stringify;
    const measure = (run: typeof simulateChallengeGroupOwnBallScores) => {
      let serializedCharacters = 0;
      let coursePayloads = 0;
      const serialization = vi.spyOn(JSON, "stringify").mockImplementation((...values: Parameters<typeof JSON.stringify>) => {
        const value = values[0];
        if (value && Array.isArray(value.golfers) && Array.isArray(value.course?.tiles)) coursePayloads++;
        const encoded = original(...values);
        serializedCharacters += encoded?.length ?? 0;
        return encoded;
      });
      try { return { result: run(args()), serializedCharacters, coursePayloads }; }
      finally { serialization.mockRestore(); }
    };
    const reference = measure(publicScores);
    const owned = measure(simulateChallengeGroupOwnBallScores);
    expect(JSON.stringify(owned.result)).toBe(JSON.stringify(reference.result));
    expect(owned.coursePayloads).toBeLessThan(reference.coursePayloads);
    expect(owned.serializedCharacters).toBeLessThan(reference.serializedCharacters);
  });
});
