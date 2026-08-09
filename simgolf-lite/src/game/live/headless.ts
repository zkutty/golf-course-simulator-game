import type { Course, World } from "../models/types";
import { commitDay } from "./commitDay";
import { createLiveState, roundReactions, stepLive } from "./simulation";
import type { DayResult, LiveState } from "./types";
import { appendDayToLedger, createWeekLedger, weekResultFromLedger } from "./weeklyLedger";
import { livePropertyShotTraces } from "./safetyEvidence";

export interface HeadlessRunResult {
  course: Course;
  world: World;
  live: LiveState;
  days: DayResult[];
  rounds: number;
}

/** Runs the same live golfer/economy loop without requestAnimationFrame. */
export function runLiveDaysHeadless(args: {
  course: Course;
  world: World;
  days: number;
  stepMinutes?: number;
}): HeadlessRunResult {
  let course = args.course;
  let world = args.world;
  let rounds = 0;
  const results: DayResult[] = [];
  let live = createLiveState(course, world, 0);
  let ledger = createWeekLedger(world.week);

  for (let day = 0; day < args.days; day++) {
    const dayIndex = day % 7;
    live = createLiveState(course, world, dayIndex);
    let guard = 0;
    while (!live.dayOver) {
      stepLive(live, course, args.stepMinutes ?? 2, world);
      if (++guard > 100_000) throw new Error(`Live day ${day + 1} did not terminate`);
    }
    rounds += live.roundsFinished;
    // commitDay expects green fees to have already reached world.cash.
    const revenue = live.greenFeeCollected + live.concessionCollected;
    const withRevenue = { ...world, cash: world.cash + revenue };
    const committed = commitDay({
      course,
      world: withRevenue,
      revenue,
      greenFees: live.greenFeeCollected,
      concessionRevenue: live.concessionCollected,
      concessionByType: live.concessionByType,
      transactions: live.concessionTransactions,
      perCourse: live.perCourse,
      reactions: roundReactions(live),
      dayIndex,
      pace: live.pace,
      mobility: live.m51,
      shotTraces: livePropertyShotTraces(live, course),
    });
    ledger = appendDayToLedger(ledger, { ...committed.result, dayIndex });
    const closesWeek = dayIndex === 6;
    const completedWeek = closesWeek ? weekResultFromLedger(ledger) : null;
    course = committed.course;
    world = {
      ...committed.world,
      week: closesWeek ? committed.world.week + 1 : committed.world.week,
      lastWeekProfit: completedWeek?.profit ?? committed.world.lastWeekProfit,
    };
    if (closesWeek) ledger = createWeekLedger(world.week);
    results.push({ ...committed.result, dayIndex });
  }

  const nextDayIndex = args.days % 7;
  live = createLiveState(course, world, nextDayIndex);
  return { course, world, live, days: results, rounds };
}
