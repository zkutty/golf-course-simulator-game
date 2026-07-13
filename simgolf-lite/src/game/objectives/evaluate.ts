import type { Course, World } from "../models/types";
import { computeCourseRatingAndSlope } from "../sim/courseRating";
import { scoreCourseHoles, type CourseHoleSummary } from "../sim/holes";
import type {
  ConditionProgress,
  GoalCondition,
  GoalDefinition,
  GoalMetric,
  GoalProgress,
  ObjectiveState,
} from "../models/objectives";

// Pure, deterministic goal evaluation (ZKU-163). Runs at sim commit points —
// after each tickWeek and after each committed live day — never in the UI.

export interface CommitInfo {
  /** Rounds played in this commit slice (week's visitors or day's rounds). */
  rounds: number;
  /** Profit of this commit slice. */
  profit: number;
  /**
   * Set when this commit closes out a week: the number of the week that just
   * finished. Weekly ticks always close a week; live days only on day 7.
   */
  weekCompleted?: number;
  /** Precomputed hole summary, if the caller already has one (tickWeek does). */
  holeSummary?: CourseHoleSummary;
}

export function conditionMet(c: GoalCondition, value: number): boolean {
  return c.comparator === ">=" ? value >= c.target : value <= c.target;
}

/**
 * Lazy metric reader: hole scoring and course rating are expensive, so they
 * are only computed when a goal actually references them, at most once per
 * commit.
 */
function makeMetricReader(args: {
  course: Course;
  world: World;
  objectives: ObjectiveState;
  weeklyProfit: number;
  holeSummary?: CourseHoleSummary;
}): (metric: GoalMetric) => number {
  const { course, world, objectives, weeklyProfit } = args;
  let holeSummary = args.holeSummary;
  let holesBuilt: number | null = null;
  let courseRating: number | null = null;
  return (metric) => {
    switch (metric) {
      case "cash":
        return world.cash;
      case "reputation":
        return world.reputation;
      case "condition":
        return course.condition * 100;
      case "weeklyProfit":
        return weeklyProfit;
      case "profitStreak":
        return objectives.profitStreak;
      case "totalRounds":
        return objectives.totalRounds;
      case "holesBuilt": {
        if (holesBuilt == null) {
          holeSummary ??= scoreCourseHoles(course);
          holesBuilt = holeSummary.holes.filter((h) => h.isComplete && h.isValid).length;
        }
        return holesBuilt;
      }
      case "courseRating": {
        courseRating ??= computeCourseRatingAndSlope(course).courseRating;
        return courseRating;
      }
      case "tournamentPlacement":
        // Not wired yet (M6): reads as "worst possible placement" so a <= goal
        // (place 3rd or better) stays open and a >= goal is never mis-met.
        return Number.MAX_SAFE_INTEGER;
    }
  };
}

function evaluateGoal(
  goal: GoalDefinition,
  prev: GoalProgress | undefined,
  read: (metric: GoalMetric) => number,
  week: number
): GoalProgress {
  const conditions: ConditionProgress[] = goal.conditions.map((c) => {
    const value = read(c.metric);
    return { ...c, value, met: conditionMet(c, value) };
  });
  const metNow =
    (goal.match ?? "all") === "all"
      ? conditions.every((c) => c.met)
      : conditions.some((c) => c.met);
  // Sticky completion: once a goal is done it stays done (progress bars can
  // still show live values, but the checkmark never regresses).
  const met = metNow || (prev?.met ?? false);
  return {
    goalId: goal.id,
    conditions,
    met,
    completedWeek: prev?.completedWeek ?? (metNow ? week : undefined),
  };
}

/**
 * Evaluate all goals against a commit. `world` is the post-commit world (so
 * bankruptcy is already decided) and `course` the post-commit course.
 *
 * Outcome rules:
 * - bankruptcy → LOST (BANKRUPT); the fail state has ONE source: world.isBankrupt.
 * - every goal met → WON (sticky; play continues).
 * - a week closes past an unmet goal's deadline → LOST (DEADLINE).
 * Win is checked before the deadline so finishing ON the deadline week counts.
 */
export function evaluateObjectives(
  objectives: ObjectiveState,
  course: Course,
  world: World,
  commit: CommitInfo
): ObjectiveState {
  // A LOST run is frozen; a WON run keeps evaluating only for bankruptcy.
  if (objectives.outcome === "LOST") return objectives;

  const closesWeek = commit.weekCompleted != null;
  const totalRounds = objectives.totalRounds + commit.rounds;
  const weekProfitAccum = closesWeek ? 0 : objectives.weekProfitAccum + commit.profit;
  const closedWeekProfit = closesWeek ? objectives.weekProfitAccum + commit.profit : 0;
  const profitStreak = closesWeek
    ? closedWeekProfit > 0
      ? objectives.profitStreak + 1
      : 0
    : objectives.profitStreak;

  const advanced: ObjectiveState = {
    ...objectives,
    totalRounds,
    profitStreak,
    weekProfitAccum,
  };

  const week = commit.weekCompleted ?? world.week;
  const read = makeMetricReader({
    course,
    world,
    objectives: advanced,
    weeklyProfit: closesWeek ? closedWeekProfit : world.lastWeekProfit,
    holeSummary: commit.holeSummary,
  });
  const progress = advanced.goals.map((g) =>
    evaluateGoal(g, objectives.progress.find((p) => p.goalId === g.id), read, week)
  );

  let next: ObjectiveState = { ...advanced, progress };

  if (world.isBankrupt) {
    return { ...next, outcome: "LOST", lostWeek: week, lostReason: "BANKRUPT" };
  }
  if (next.outcome === "WON") return next;

  const allMet = progress.length > 0 && progress.every((p) => p.met);
  if (allMet) {
    return { ...next, outcome: "WON", wonWeek: week };
  }
  if (closesWeek) {
    const missedDeadline = next.goals.some((g, i) => {
      const deadline = g.deadlineWeek;
      return deadline != null && !progress[i].met && week >= deadline;
    });
    if (missedDeadline) {
      next = { ...next, outcome: "LOST", lostWeek: week, lostReason: "DEADLINE" };
    }
  }
  return next;
}

/**
 * Attach evaluated objectives to a post-commit world. The no-goals case
 * (sandbox free play) still tracks bankruptcy through the same pipeline by
 * simply carrying `objectives` as null/undefined — the UI derives defeat from
 * world.isBankrupt either way.
 */
export function withEvaluatedObjectives(course: Course, world: World, commit: CommitInfo): World {
  if (!world.objectives) return world;
  return { ...world, objectives: evaluateObjectives(world.objectives, course, world, commit) };
}
