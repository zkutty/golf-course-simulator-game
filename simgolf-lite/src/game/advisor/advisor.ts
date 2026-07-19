import type { Course, WeekResult, World } from "../models/types";
import type { AdvisorFrequency } from "../onboarding/profile";
import { scoreCourseHoles } from "../sim/holes";

export type AdvisorExpression = "neutral" | "pleased" | "worried" | "excited";
export type AdvisorPriority = "hint" | "info" | "celebration" | "warning";

export interface AdvisorMessage {
  id: string;
  title: string;
  body: string;
  expression: AdvisorExpression;
  priority: AdvisorPriority;
  holeIndex?: number;
}
const priorityRank: Record<AdvisorPriority, number> = { hint: 0, info: 1, celebration: 2, warning: 3 };

export function advisorMessages(
  course: Course,
  world: World,
  last: WeekResult | undefined,
  previous: WeekResult | undefined,
): AdvisorMessage[] {
  const messages: AdvisorMessage[] = [];
  const holes = scoreCourseHoles(course);
  const valid = holes.holes.filter((hole) => hole.isComplete && hole.isValid);
  const weeklyExpenses = Math.max(1, last?.costs ?? world.maintenanceBudget + world.staffLevel * 500);

  if (world.cash < weeklyExpenses * 2) {
    messages.push({
      id: `cash-runway-${world.week}`,
      title: "The clubhouse till is getting light",
      body: "We have less than two weeks of recent expenses in cash. Trim a budget or raise revenue before the bank starts practicing its swing.",
      expression: "worried",
      priority: "warning",
    });
  }
  if (course.condition < 0.55) {
    messages.push({
      id: `condition-${world.week}`,
      title: "The turf is asking for help",
      body: "Condition has slipped below 55%. A stronger maintenance budget now is cheaper than rebuilding reputation later.",
      expression: "worried",
      priority: "warning",
    });
  }
  if ((last?.profit ?? 0) > 0 && (previous?.profit ?? 0) <= 0) {
    messages.push({
      id: `first-profit-${world.week}`,
      title: "That week finished under par",
      body: `A $${Math.round(last!.profit).toLocaleString()} profit — proof that the course loop is working. Now make it repeatable.`,
      expression: "excited",
      priority: "celebration",
    });
  }
  if ((last?.turnaways ?? 0) > 0) {
    messages.push({
      id: `turnaways-${world.week}`,
      title: "The tee sheet is bursting",
      body: `${last!.turnaways} golfers were turned away. More valid holes add capacity without asking marketing to work any harder.`,
      expression: "pleased",
      priority: "info",
    });
  }
  const worst = valid.slice().sort((a, b) => a.overallHoleScore - b.overallHoleScore)[0];
  if (worst && worst.overallHoleScore < 55) {
    const holeIndex = holes.holes.indexOf(worst);
    messages.push({
      id: `weak-hole-${holeIndex}-${world.week}`,
      title: `Hole ${holeIndex + 1} needs a quiet word`,
      body: "Its overall design score is lagging. Open the inspector and look at corridor safety, aesthetics, and effective distance.",
      expression: "worried",
      priority: "info",
      holeIndex,
    });
  }
  if (!last && valid.length < 9) {
    messages.push({
      id: `finish-course-${valid.length}`,
      title: "One good hole at a time",
      body: `${valid.length}/9 holes are valid. Finish the next cleanly before polishing the whole property.`,
      expression: "neutral",
      priority: "hint",
    });
  }
  return messages.sort((a, b) => priorityRank[b.priority] - priorityRank[a.priority]);
}

export function allowsMessage(frequency: AdvisorFrequency, message: AdvisorMessage): boolean {
  if (frequency === "off") return false;
  if (frequency === "important") return message.priority === "warning" || message.priority === "celebration";
  if (frequency === "normal") return message.priority !== "hint";
  return true;
}
