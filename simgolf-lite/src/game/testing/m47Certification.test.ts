import { describe, expect, it } from "vitest";
import { DEFAULT_WORLD } from "../models/defaults";
import { completeTournament, createTournamentEvent, scheduleTournament } from "../tournaments/tournaments";
import { createLiveState, stepLive } from "../live/simulation";
import { restoreLiveSimulation, snapshotLiveSimulation } from "../live/persistence";
import { hashGameState } from "../../utils/stateHash";
import {
  M47_REFERENCE_GOLFERS,
  M47_ROUND_LENGTHS,
  buildM47RoundResult,
  buildM47StrategyMatrix,
  createM47CertificationCourse,
  createM47TournamentCourse,
  hashM47Round,
} from "./m47Certification";

describe("M47 certification fixtures", () => {
  it.each(M47_ROUND_LENGTHS)("builds a deterministic %i-hole plan, physical outcome, and reaction fixture", (holeCount) => {
    const golfer = M47_REFERENCE_GOLFERS.find((candidate) => candidate.id === "balanced")!;
    const first = buildM47RoundResult(holeCount, golfer);
    const second = buildM47RoundResult(holeCount, golfer);
    expect(first.course.holes).toHaveLength(holeCount);
    expect(first.plans).toHaveLength(holeCount);
    expect(first.reactions).toHaveLength(holeCount);
    expect(first.outcomes.length).toBeGreaterThan(holeCount);
    expect(first.outcomes.length).toBeLessThanOrEqual(240);
    expect(first).toEqual(second);
    expect(hashM47Round(first)).toEqual(hashM47Round(second));
  }, 120_000);

  it("covers all reference identities and keeps strategy choices differentiated", () => {
    const matrix = buildM47StrategyMatrix();
    expect(matrix).toHaveLength(10);
    expect(new Set(matrix.map((row) => row.riskStyle))).toEqual(new Set(["aggressive", "conservative", "balanced"]));
    expect(new Set(matrix.map((row) => row.chosen)).size).toBeGreaterThanOrEqual(2);
    expect(matrix.every((row) => row.rejected.length >= 3)).toBe(true);
    expect(matrix.every((row) => row.expectedScore > 0 && row.hazardRisk >= 0 && row.hazardRisk <= 1)).toBe(true);
  });

  it("round-trips a live M47 save without changing evidence or its hash", () => {
    const course = createM47CertificationCourse(9);
    const world = { ...DEFAULT_WORLD, cash: 1_000_000, reputation: 95, runSeed: 470909 };
    const live = createLiveState(course, world, 0);
    let guard = 0;
    while (live.golfers.length === 0 && guard++ < 100) stepLive(live, course, 5);
    expect(live.golfers.length).toBeGreaterThan(0);
    const snapshot = snapshotLiveSimulation({ state: live, pendingCash: 123, speed: "paused", selectedGolferId: live.golfers[0].id });
    const before = hashGameState({ course, world, live: snapshot });
    const restored = restoreLiveSimulation(JSON.parse(JSON.stringify(snapshot)));
    expect(restored).not.toBeNull();
    const restoredSnapshot = snapshotLiveSimulation({
      state: restored!.state,
      pendingCash: restored!.pendingCash,
      speed: restored!.speed,
      selectedGolferId: restored!.selectedGolferId,
      clockRemainderMinutes: restored!.clockRemainderMinutes,
      weekLedger: restored!.weekLedger,
    });
    expect(restoredSnapshot).toEqual(snapshot);
    expect(hashGameState({ course, world, live: restoredSnapshot })).toBe(before);
    expect(restored!.state.golfers[0].capabilities).toEqual(live.golfers[0].capabilities);
    expect(restored!.state.golfers[0].holePlans).toEqual(live.golfers[0].holePlans);
    expect(restored!.state.golfers[0].shotOutcomes).toEqual(live.golfers[0].shotOutcomes);
    expect(restored!.state.golfers[0].holeReactions).toEqual(live.golfers[0].holeReactions);
  }, 120_000);

  it("runs a deterministic tournament field through the same M47 plan/outcome path", () => {
    const course = createM47TournamentCourse();
    const baseWorld = { ...DEFAULT_WORLD, cash: 1_000_000, reputation: 95, runSeed: 470818 };
    const created = createTournamentEvent({ course, world: baseWorld, tier: "regional", currentDay: 0, daysAhead: 1, courseId: "m47-tournament" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const scheduledWorld = scheduleTournament(baseWorld, created.event);
    const live = createLiveState(course, scheduledWorld, created.event.scheduledDay);
    expect(live.tournament?.eventId).toBe(created.event.id);
    expect(live.arrivals).toHaveLength(created.event.field.length);
    let guard = 0;
    while (!live.dayOver && guard++ < 2_000) stepLive(live, course, 5);
    expect(live.dayOver).toBe(true);
    expect(live.roundsFinished).toBe(created.event.field.length);
    expect(live.tournament?.standings.every((standing) => standing.finished && standing.holesCompleted === 18)).toBe(true);
    const settled = completeTournament(scheduledWorld, live);
    expect(settled.event?.status).toBe("completed");
    expect(settled.event?.results).toHaveLength(created.event.field.length);
    expect(settled.event?.winnerName).toBe(settled.event?.results?.[0]?.name);
  }, 120_000);
});
