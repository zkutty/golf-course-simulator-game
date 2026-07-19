import type { Course, WeekResult, World } from "../models/types";
import type { AdvisorFrequency } from "../onboarding/profile";
import { scoreCourseHoles } from "../sim/holes";
import type { Translator } from "../../i18n/context";
import { translate } from "../../i18n/core";
import { formatCurrency, formatNumber } from "../../i18n/format";

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
  t: Translator = (key, params) => translate("en", key, params),
): AdvisorMessage[] {
  const messages: AdvisorMessage[] = [];
  const holes = scoreCourseHoles(course);
  const valid = holes.holes.filter((hole) => hole.isComplete && hole.isValid);
  const weeklyExpenses = Math.max(1, last?.costs ?? world.maintenanceBudget + world.staffLevel * 500);

  if (world.cash < weeklyExpenses * 2) {
    messages.push({
      id: `cash-runway-${world.week}`,
      title: t("advisor.cash.title"), body: t("advisor.cash.body"),
      expression: "worried",
      priority: "warning",
    });
  }
  if (course.condition < 0.55) {
    messages.push({
      id: `condition-${world.week}`,
      title: t("advisor.condition.title"), body: t("advisor.condition.body"),
      expression: "worried",
      priority: "warning",
    });
  }
  if ((last?.profit ?? 0) > 0 && (previous?.profit ?? 0) <= 0) {
    messages.push({
      id: `first-profit-${world.week}`,
      title: t("advisor.profit.title"), body: t("advisor.profit.body", { profit: formatCurrency(last!.profit) }),
      expression: "excited",
      priority: "celebration",
    });
  }
  if ((last?.turnaways ?? 0) > 0) {
    messages.push({
      id: `turnaways-${world.week}`,
      title: t("advisor.turnaways.title"), body: t("advisor.turnaways.body", { count: formatNumber(last!.turnaways!) }),
      expression: "pleased",
      priority: "info",
    });
  }
  const worst = valid.slice().sort((a, b) => a.overallHoleScore - b.overallHoleScore)[0];
  if (worst && worst.overallHoleScore < 55) {
    const holeIndex = holes.holes.indexOf(worst);
    messages.push({
      id: `weak-hole-${holeIndex}-${world.week}`,
      title: t("advisor.weakHole.title", { hole: formatNumber(holeIndex + 1) }), body: t("advisor.weakHole.body"),
      expression: "worried",
      priority: "info",
      holeIndex,
    });
  }
  if (!last && valid.length < 9) {
    messages.push({
      id: `finish-course-${valid.length}`,
      title: t("advisor.finish.title"), body: t("advisor.finish.body", { count: formatNumber(valid.length) }),
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
