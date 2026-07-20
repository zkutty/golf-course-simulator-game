import { describe, expect, it } from "vitest";
import { DEFAULT_WORLD } from "../models/defaults";
import { createRenderPerfCourse } from "../testing/referenceCourse";
import { createLiveState, stepLive } from "../live/simulation";
import { restoreLiveSimulation, snapshotLiveSimulation } from "../live/persistence";
import {
  completeTournament,
  createTournamentEvent,
  gameDateAfter,
  scheduleTournament,
  sortedStandings,
  tournamentCalendar,
} from "./tournaments";

describe("M6 tournaments", () => {
  const course = createRenderPerfCourse();
  const host = { ...DEFAULT_WORLD, cash: 100_000, reputation: 80, runSeed: 6060 };

  it("books a deterministic tier-appropriate field on a future game date", () => {
    const first = createTournamentEvent({ course, world: host, tier: "regional", currentDay: 5, daysAhead: 3 });
    const second = createTournamentEvent({ course, world: host, tier: "regional", currentDay: 5, daysAhead: 3 });
    expect(first.ok).toBe(true);
    expect(second).toEqual(first);
    if (!first.ok) return;
    expect({ week: first.event.scheduledWeek, day: first.event.scheduledDay }).toEqual(gameDateAfter(host.week, 5, 3));
    expect(first.event.field).toHaveLength(12);
    expect(first.event.field.every((entrant) => entrant.skill >= .62 && entrant.skill <= .88)).toBe(true);
    const scheduled = scheduleTournament(host, first.event);
    expect(scheduled.cash).toBe(host.cash - 3_500);
    expect(tournamentCalendar(scheduled).events).toHaveLength(1);
    expect(scheduleTournament(scheduled, first.event)).toBe(scheduled);
  });

  it("blocks dates, tiers, and courses that do not meet hosting requirements", () => {
    const weak = createTournamentEvent({ course, world: { ...host, reputation: 20 }, tier: "regional", currentDay: 0, daysAhead: 1 });
    expect(weak).toEqual({ ok: false, reason: "Regional Invitational requires 45 reputation." });
    const unfinished = createTournamentEvent({ course: { ...course, holes: course.holes.map((hole) => ({ ...hole, tee: null })) }, world: host, tier: "local", currentDay: 0, daysAhead: 1 });
    expect(unfinished.ok).toBe(false);
    const booked = createTournamentEvent({ course, world: host, tier: "local", currentDay: 0, daysAhead: 1 });
    if (!booked.ok) throw new Error(booked.reason);
    const duplicate = createTournamentEvent({ course, world: scheduleTournament(host, booked.event), tier: "local", currentDay: 0, daysAhead: 1 });
    expect(duplicate.ok).toBe(false);
  });

  it("runs the field through the live simulation and settles ordered results", () => {
    const created = createTournamentEvent({ course, world: host, tier: "local", currentDay: 0, daysAhead: 1 });
    if (!created.ok) throw new Error(created.reason);
    const scheduled = scheduleTournament(host, { ...created.event, scheduledWeek: host.week, scheduledDay: 1 });
    const live = createLiveState(course, scheduled, 1);
    expect(live.tournament?.standings).toHaveLength(8);
    expect(live.arrivals.every((arrival) => arrival.tournament?.eventId === created.event.id)).toBe(true);
    stepLive(live, course, 40);
    const restored = restoreLiveSimulation(snapshotLiveSimulation({ state: live, pendingCash: 0, speed: "3x", selectedGolferId: null }));
    expect(restored?.state.tournament).toEqual(live.tournament);

    let guard = 0;
    while (!live.dayOver && guard++ < 5_000) stepLive(live, course, 5);
    expect(live.dayOver).toBe(true);
    expect(live.roundsFinished).toBe(8);
    expect(live.greenFeeCollected).toBe(0);
    expect(live.tournament?.standings.every((row) => row.finished)).toBe(true);

    const settlement = completeTournament(scheduled, live);
    expect(settlement.revenue).toBe(6_000);
    expect(settlement.reputation).toBe(2);
    expect(settlement.event?.status).toBe("completed");
    expect(settlement.event?.winnerName).toBe(sortedStandings(live.tournament!.standings)[0].name);
    expect(tournamentCalendar(settlement.world).events[0].results).toHaveLength(8);
  });
});
