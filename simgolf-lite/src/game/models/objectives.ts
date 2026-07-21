// Objective engine (ZKU-163): goals are DATA, not code. Every metric here is
// an existing sim output; scenarios (ZKU-164), the tutorial (M14), and
// achievements (ZKU-180) reuse this same condition vocabulary.
import type { MessageKey } from "../../i18n/catalog";

export type GoalMetric =
  | "cash" // world.cash, dollars
  | "reputation" // world.reputation, 0..100
  | "courseRating" // computeCourseRatingAndSlope().courseRating
  | "holesBuilt" // complete + valid holes
  | "publishedHoles" // unique complete holes in published routings
  | "publishedCourses" // complete 9/18-hole published layouts
  | "weeklyProfit" // most recent completed week's profit
  | "profitStreak" // consecutive profitable weeks
  | "totalRounds" // cumulative rounds played this run
  | "condition" // course.condition as a 0..100 percentage
  | "tournamentPlacement"; // future M6 hook — evaluates as never-met until wired

export type GoalComparator = ">=" | "<=";

export interface GoalCondition {
  metric: GoalMetric;
  comparator: GoalComparator;
  target: number;
}

export interface GoalDefinition {
  id: string;
  label: string;
  description?: string;
  labelKey?: MessageKey;
  descriptionKey?: MessageKey;
  /** How conditions combine: "all" (default) or "any". */
  match?: "all" | "any";
  conditions: GoalCondition[];
  /** Goal must be met by the END of this week, else the run is lost. */
  deadlineWeek?: number;
}

export interface ConditionProgress {
  metric: GoalMetric;
  comparator: GoalComparator;
  target: number;
  /** Latest observed metric value. */
  value: number;
  met: boolean;
}

export interface GoalProgress {
  goalId: string;
  conditions: ConditionProgress[];
  met: boolean;
  /** Week the goal was first satisfied (sticky — goals don't un-complete). */
  completedWeek?: number;
}

export type RunOutcome = "OPEN" | "WON" | "LOST";
export type DefeatReason = "BANKRUPT" | "DEADLINE";

export interface ObjectiveState {
  goals: GoalDefinition[];
  progress: GoalProgress[];
  outcome: RunOutcome;
  wonWeek?: number;
  lostWeek?: number;
  lostReason?: DefeatReason;
  // Accumulators the metrics need (persisted so save/load restores exactly).
  totalRounds: number;
  profitStreak: number;
  /** Running profit of the in-progress week (live daily commits only). */
  weekProfitAccum: number;
}

export function createObjectiveState(goals: GoalDefinition[]): ObjectiveState {
  return {
    goals,
    progress: goals.map((g) => ({
      goalId: g.id,
      conditions: g.conditions.map((c) => ({ ...c, value: 0, met: false })),
      met: false,
    })),
    outcome: "OPEN",
    totalRounds: 0,
    profitStreak: 0,
    weekProfitAccum: 0,
  };
}
