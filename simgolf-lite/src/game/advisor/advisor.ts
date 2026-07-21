import type { Course, WeekResult, World } from "../models/types";
import type { AdvisorFrequency } from "../onboarding/profile";
import { scoreCourseHoles } from "../sim/holes";
import type { Translator } from "../../i18n/context";
import { translate } from "../../i18n/core";
import { formatCurrency, formatNumber } from "../../i18n/format";
import { tournamentCalendar } from "../tournaments/tournaments";
import type { TournamentRequirementId } from "../tournaments/types";
import type { MessageKey } from "../../i18n/catalog";
import { analyzeArchitecture } from "../architecture/architecture";
import { courseLayouts } from "../models/courseLayouts";

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
  const invalidEvent = tournamentCalendar(world).events.find((event) => event.status === "scheduled" && event.warning);
  const architecture = course.estate && valid.length >= 9 ? analyzeArchitecture(course) : null;

  if (architecture && architecture.total < 55 && architecture.warnings.length) {
    messages.push({
      id: `architecture-${course.activeCourseId ?? "primary"}`,
      title: t("advisor.architecture.title"),
      body: t("advisor.architecture.body", { course: course.name, score: Math.round(architecture.total) }),
      expression: "worried",
      priority: "info",
      holeIndex: architecture.warnings[0].holeIds[0] ? course.holes.findIndex((hole) => hole.id === architecture.warnings[0].holeIds[0]) : undefined,
    });
  }
  if (course.estate && course.estate.ownedParcelIds.length < course.estate.parcels.length && valid.length >= 9 && courseLayouts(course).length === 1 && world.reputation >= 50 && world.cash >= 45_000) {
    messages.push({ id: "expansion-ready", title: t("advisor.expansion.title"), body: t("advisor.expansion.body"), expression: "pleased", priority: "info" });
  }

  if (invalidEvent) {
    const unmet = invalidEvent.currentQualification?.requirements.find((item) => !item.passed);
    const requirementKey = (id: TournamentRequirementId): MessageKey => `tournament.requirement.${id}` as MessageKey;
    const localizedWarning = unmet
      ? `${t(requirementKey(unmet.id))} — ${t("tournament.currentRequired", { current: unmet.current, required: unmet.required })}`
      : invalidEvent.warning!;
    messages.push({
      id: `tournament-warning-${invalidEvent.id}-${invalidEvent.warning}`,
      title: t("advisor.tournament.title"),
      body: t("advisor.tournament.body", { event: invalidEvent.name, warning: localizedWarning }),
      expression: "worried",
      priority: "warning",
    });
  }

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
  if (worst && Math.round(worst.overallHoleScore) <= 55) {
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
