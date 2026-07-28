import { describe, expect, it } from "vitest";
import { DEFAULT_WORLD } from "../models/defaults";
import { createLiveState, stepLive } from "../live/simulation";
import { createTournamentStandardsCourse } from "../testing/referenceCourse";
import { advisorMessages } from "../advisor/advisor";
import {
  evaluateTournamentCourseQualification,
  evaluateTournamentEligibility,
  meetsTournamentRange,
  TOURNAMENT_COURSE_STANDARDS,
} from "./eligibility";
import {
  completeTournament,
  createTournamentEvent,
  normalizeTournamentCalendar,
  prepareTournamentDay,
  revalidateScheduledTournaments,
  scheduleTournament,
  tournamentCalendar,
} from "./tournaments";

describe("M24 tournament course qualification", () => {
  const course = createTournamentStandardsCourse();
  const host = { ...DEFAULT_WORLD, cash: 100_000, reputation: 90, runSeed: 2424 };

  it("selects deterministic prescribed setups and normalized nine-hole ratings", () => {
    expect(evaluateTournamentCourseQualification(course, "local")).toMatchObject({ eligible: true, teeSet: "member" });
    expect(evaluateTournamentCourseQualification(course, "regional")).toMatchObject({ eligible: true, teeSet: "championship" });
    const championship = evaluateTournamentCourseQualification(course, "championship");
    expect(championship).toMatchObject({ eligible: false, teeSet: "championship" });
    expect(championship.blockingReasons[0]).toContain("Course rating");

    const tied = { ...course, holes: course.holes.map((hole) => ({ ...hole, pinPositions: { A: hole.green, B: hole.green, C: hole.green } })) };
    expect(evaluateTournamentCourseQualification(tied, "local").pinRotation).toBe("A");
    expect(evaluateTournamentCourseQualification(tied, "regional").pinRotation).toBe("B");
    expect(evaluateTournamentCourseQualification(tied, "championship").pinRotation).toBe("C");

    const nine = { ...course, holes: course.holes.slice(0, 9) };
    const nineResult = evaluateTournamentCourseQualification(nine, "local");
    expect(nineResult.eligible).toBe(true);
    expect(nineResult.rating).toBeCloseTo(evaluateTournamentCourseQualification(course, "local").rating, 0);
  }, 60_000);

  it("keeps championship selection working without Array.prototype.at", () => {
    const base = createTournamentStandardsCourse();
    const tied = {
      ...base,
      holes: base.holes.map((hole) => ({
        ...hole,
        pinPositions: { A: hole.green, B: hole.green, C: hole.green },
      })),
    };
    const descriptor = Object.getOwnPropertyDescriptor(Array.prototype, "at");
    try {
      Object.defineProperty(Array.prototype, "at", { configurable: true, value: undefined });
      expect(evaluateTournamentCourseQualification(tied, "championship").pinRotation).toBe("C");
    } finally {
      if (descriptor) Object.defineProperty(Array.prototype, "at", descriptor);
    }
  }, 60_000);

  it("treats every configured rating and slope boundary as inclusive", () => {
    for (const standard of Object.values(TOURNAMENT_COURSE_STANDARDS)) {
      for (const bounds of [standard.rating, standard.slope] as const) {
        expect(meetsTournamentRange(bounds[0], bounds)).toBe(true);
        expect(meetsTournamentRange(bounds[1], bounds)).toBe(true);
        expect(meetsTournamentRange(bounds[0] - .1, bounds)).toBe(false);
        expect(meetsTournamentRange(bounds[1] + .1, bounds)).toBe(false);
      }
    }
  });

  it("reports exact setup, route, commercial, and calendar blockers", () => {
    const incomplete = { ...course, holes: course.holes.map((hole) => ({ ...hole, pinPositions: { ...hole.pinPositions, C: null } })) };
    const courseResult = evaluateTournamentCourseQualification(incomplete, "championship");
    expect(courseResult.eligible).toBe(false);
    expect(courseResult.requirements.find((item) => item.id === "rotations")).toMatchObject({ passed: false, current: "2 complete" });

    const booking = evaluateTournamentEligibility({ course, world: { ...host, cash: 0, reputation: 0 }, tier: "local", currentDay: 0, daysAhead: 1, minReputation: 25, bookingCost: 1_500 });
    expect(booking.blockingReasons.join(" ")).toContain("Reputation: 0; requires 25");
    expect(booking.blockingReasons.join(" ")).toContain("Hosting deposit: $0; requires $1,500");
  }, 30_000);

  it("persists setup snapshots, revalidates edits, and forfeits an invalid event", () => {
    const created = createTournamentEvent({ course, world: host, tier: "regional", currentDay: 0, daysAhead: 1 });
    if (!created.ok) throw new Error(created.reason);
    const scheduled = scheduleTournament(host, created.event);
    expect(tournamentCalendar(scheduled).version).toBe(2);
    expect(created.event).toMatchObject({ teeSet: "championship", qualificationSnapshot: { eligible: true } });

    const edited = { ...course, holes: course.holes.map((hole) => ({ ...hole, pinPositions: { ...hole.pinPositions, B: null, C: null } })) };
    const warned = revalidateScheduledTournaments(edited, scheduled);
    expect(tournamentCalendar(warned).events[0].warning).toContain("Pin rotations");
    expect(advisorMessages(edited, warned, undefined, undefined)[0]).toMatchObject({ priority: "warning", title: "Tournament standard lost" });
    const day = prepareTournamentDay(edited, { ...warned, week: created.event.scheduledWeek }, created.event.scheduledDay);
    expect(day.event).toBeUndefined();
    expect(day.cancelled).toMatchObject({ status: "cancelled", depositForfeited: true });
    expect(day.world.cash).toBe(scheduled.cash);
    expect(createLiveState(edited, day.world, created.event.scheduledDay).arrivals).not.toEqual(expect.arrayContaining([expect.objectContaining({ tournament: expect.anything() })]));
  }, 30_000);

  it("uses the prescribed setup for every entrant and settles only completed play", () => {
    const created = createTournamentEvent({ course, world: host, tier: "regional", currentDay: 0, daysAhead: 1 });
    if (!created.ok) throw new Error(created.reason);
    const scheduled = scheduleTournament(host, { ...created.event, scheduledWeek: 1, scheduledDay: 1 });
    const live = createLiveState(course, scheduled, 1);
    expect(live.arrivals.every((arrival) => arrival.tournament?.teeSet === created.event.teeSet && arrival.tournament?.pinRotation === created.event.pinRotation)).toBe(true);
    stepLive(live, course, 40);
    expect(live.golfers.every((golfer) => golfer.teeSet === created.event.teeSet && golfer.pinRotation === created.event.pinRotation)).toBe(true);
    let guard = 0;
    while (!live.dayOver && guard++ < 5_000) stepLive(live, course, 5);
    expect(completeTournament(scheduled, live)).toMatchObject({ revenue: 14_000, reputation: 4, event: { status: "completed" } });
  }, 15_000);

  it("upgrades pre-v2 completed history without rewriting results", () => {
    const legacy = { version: 1, events: [{ id: "legacy", name: "Legacy Open", tier: "local", scheduledWeek: 2, scheduledDay: 3, status: "completed", bookingCost: 100, revenueAward: 200, reputationAward: 1, field: [{ id: "e", name: "A", archetype: "casual", skill: .5 }], results: [{ entrantId: "e", golferId: 1, name: "A", archetype: "casual", holesCompleted: 9, score: 40, scoreToPar: 4, finished: true }], winnerName: "A" }] };
    const migrated = normalizeTournamentCalendar(legacy);
    expect(migrated.version).toBe(2);
    expect(migrated.events[0]).toMatchObject({ status: "completed", winnerName: "A", results: [{ score: 40 }] });
  });
});
