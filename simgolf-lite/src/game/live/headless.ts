import type { Course, World } from "../models/types";
import { commitDay } from "./commitDay";
import { createLiveState, roundReactions, stepLive } from "./simulation";
import type { DayResult, LiveState } from "./types";

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

  for (let day = 0; day < args.days; day++) {
    const dayIndex = day % 7;
    live = createLiveState(course, world, dayIndex);
    let guard = 0;
    while (!live.dayOver) {
      stepLive(live, course, args.stepMinutes ?? 2);
      if (++guard > 100_000) throw new Error(`Live day ${day + 1} did not terminate`);
    }
    rounds += live.roundsFinished;
    // commitDay expects green fees to have already reached world.cash.
    const withRevenue = { ...world, cash: world.cash + live.greenFeeCollected };
    const committed = commitDay({
      course,
      world: withRevenue,
      revenue: live.greenFeeCollected,
      reactions: roundReactions(live),
      dayIndex,
    });
    course = committed.course;
    world = {
      ...committed.world,
      week: dayIndex === 6 ? committed.world.week + 1 : committed.world.week,
    };
    results.push({ ...committed.result, dayIndex });
  }

  const nextDayIndex = args.days % 7;
  live = createLiveState(course, world, nextDayIndex);
  return { course, world, live, days: results, rounds };
}
