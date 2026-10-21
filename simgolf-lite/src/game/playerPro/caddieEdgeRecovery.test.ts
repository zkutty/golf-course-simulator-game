import { describe, expect, it } from "vitest";
import { DEFAULT_WORLD } from "../models/defaults";
import type { PlayerPlayableRound, PlayerProSkills } from "../models/playerProTypes";
import { createTournamentStandardsCourse } from "../testing/referenceCourse";
import { createTournamentEvent } from "../tournaments/tournamentScheduling";
import { activateTournament } from "../tournaments/tournamentLifecycle";
import { freezeProfileCalibration } from "../rules/profileCalibration";
import { isValidSharedShotOutcome } from "../rules/contracts";
import { caddieRecommendation, commitPlayerShot, finishPlayerShot, startPlayableRound } from "./playerPro";

/** Exact frozen Pro-Am team-3 entrant742854-9 lie from seed734101. */
function edgeLie() {
  const course = createTournamentStandardsCourse();
  const world = { ...DEFAULT_WORLD, cash: 100_000, reputation: 100, runSeed: 734_001 };
  const event = createTournamentEvent({ course, world, tier: "regional", currentDay: 0, daysAhead: 1, templateId: "four-person-pro-am" });
  if (!event.ok) throw new Error(event.reason);
  const activated = activateTournament({ ...event.event, roundCount: 1 }, course);
  if (!activated.ok) throw new Error(activated.reason);
  const started = startPlayableRound({ course, world: { ...world, week: activated.event.scheduledWeek }, kind: "tournament",
    tournament: { id: activated.event.id, name: activated.event.name, roundNumber: 1 },
    tournamentSnapshot: activated.event.activationSnapshot, day: activated.event.scheduledDay });
  if (!started.ok) throw new Error(started.reason);
  const skills: PlayerProSkills = { power: 84.00000000000001, driving: 84, irons: 84, shortGame: 84, putting: 84, recovery: 84 };
  return { skills, round: { ...started.round, id: "tournament-742854:activation:1:1:pro-am:1:team-3", handedness: "left" as const,
    course: { ...started.round.course, distanceProfile: freezeProfileCalibration(skills) },
    currentHoleIndex: 1, ball: { x: 95.040836, y: .775286 }, lie: "rough", rngSeed: 3501871714, rngCursor: 36 } };
}

describe("bounded unseeded caddie edge recovery", () => {
  it("escapes the exact northern-edge trunk lie instead of repeatedly hitting the source collider", () => {
    const { round, skills } = edgeLie();
    const original = structuredClone(round);
    const selection = caddieRecommendation(round, skills);
    expect(selection.aim.x).toBeGreaterThan(round.ball.x);
    expect(selection.aim.y).toBeCloseTo(round.ball.y, 6);
    const pending = commitPlayerShot(round, skills, selection);
    expect(pending.phase).toBe("flight");
    expect(pending.pendingShot!.sharedOutcome!.collision.kind).toBe("none");
    expect(isValidSharedShotOutcome(pending.pendingShot!.sharedOutcome)).toBe(true);
    const resolved = finishPlayerShot(pending);
    expect(Math.hypot(resolved.ball.x - round.ball.x, resolved.ball.y - round.ball.y)).toBeGreaterThan(1);
    expect(resolved.penalties).toBe(round.penalties);
    expect(round).toEqual(original);
    for (const [rngSeed, rngCursor] of [[1, 0], [42, 100], [-2147483648, 30]]) {
      expect(caddieRecommendation({ ...round, rngSeed, rngCursor }, skills)).toEqual(selection);
    }
  });

  it("makes sustained legal progress along the edge with no transcript-history dependency", () => {
    const { round, skills } = edgeLie();
    let current: PlayerPlayableRound = round;
    for (let turn = 0; turn < 10; turn += 1) {
      const next = finishPlayerShot(commitPlayerShot(current, skills, caddieRecommendation(current, skills)));
      expect(next.phase).not.toBe("flight");
      current = { ...next, shots: [] };
    }
    expect(current.ball.x).toBeLessThan(round.ball.x - 20);
    expect(current.ball.y).toBeGreaterThanOrEqual(0);
    expect(current.penalties - round.penalties).toBeLessThanOrEqual(1);
  });
});
