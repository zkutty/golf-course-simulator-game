import type { Course, WeekResult, World } from "../models/types";
import { activeCourseLayout } from "../models/courseLayouts";
import { TERRAIN_MAINT_WEIGHT } from "../models/terrainEconomics";
import { buildM49DemandPlan } from "./demand";
import { m49CourseHistory, normalizeM49State } from "./history";
import { strategicIdentity } from "./identity";
import type { M49CourseReport, M49ExperienceCause, M49ReportAlert } from "./types";

const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const round = (value: number, digits = 2) => Number(value.toFixed(digits));

function ledgerRevenue(result: WeekResult): number | undefined {
  const breakdown = result.revenueBreakdown;
  if (!breakdown) return undefined;
  return (
    breakdown.greenFees +
    breakdown.concessions +
    (breakdown.tournaments ?? 0) +
    (breakdown.property ?? 0) +
    (breakdown.paceOvertime ?? 0) +
    (breakdown.paceCompensation ?? 0)
  );
}

function conditionReport(course: Course, world: World, result?: WeekResult): M49CourseReport["condition"] {
  const totalWeight = course.tiles.reduce((sum, terrain) => sum + (TERRAIN_MAINT_WEIGHT[terrain] ?? 1), 0);
  const avgWeight = totalWeight / Math.max(1, course.tiles.length);
  const requiredMaintenance = result?.maintenance?.required ?? Math.round(350 + totalWeight * 0.46);
  const maintenanceBudget = result?.maintenance?.budget ?? world.maintenanceBudget;
  const shortfall = result?.maintenance?.shortfall ?? requiredMaintenance - maintenanceBudget;
  const wearPressure = result?.maintenancePressure?.wear ?? clamp(avgWeight / 3.2 * .18);
  const recoveryHeadroom = (maintenanceBudget - requiredMaintenance) / Math.max(1, requiredMaintenance);
  const projectedRecovery = clamp(course.condition + recoveryHeadroom * .12 - wearPressure * .08);

  const zones = new Map<string, { terrain: string; tiles: number; burden: number }>();
  const halfWidth = Math.max(1, course.width / 2);
  const halfHeight = Math.max(1, course.height / 2);
  course.tiles.forEach((terrain, index) => {
    const x = index % Math.max(1, course.width);
    const y = Math.floor(index / Math.max(1, course.width));
    const zoneId = `${y < halfHeight ? "N" : "S"}${x < halfWidth ? "W" : "E"}`;
    const burden = TERRAIN_MAINT_WEIGHT[terrain] ?? 1;
    const current = zones.get(zoneId) ?? { terrain, tiles: 0, burden: 0 };
    current.tiles += 1;
    current.burden += burden;
    if (burden > (TERRAIN_MAINT_WEIGHT[current.terrain as keyof typeof TERRAIN_MAINT_WEIGHT] ?? 1)) current.terrain = terrain;
    zones.set(zoneId, current);
  });
  const hotSpots = [...zones.entries()]
    .map(([zoneId, zone]) => ({
      zoneId,
      terrain: zone.terrain,
      tiles: zone.tiles,
      burden: round(zone.burden / Math.max(1, zone.tiles), 3),
      action: shortfall > 0 ? "Increase maintenance or reduce wear here" : "Keep this zone on the current care plan",
    }))
    .sort((a, b) => b.burden - a.burden)
    .slice(0, 4);

  return {
    overall: clamp(course.condition),
    maintenanceBudget,
    requiredMaintenance,
    shortfall,
    projectedRecovery,
    wearPressure: clamp(wearPressure),
    hotSpots,
  };
}

function causeReport(world: World, courseId: string): M49ExperienceCause[] {
  const history = m49CourseHistory(world, courseId);
  if (!history) return [];
  const causes = new Map<string, { observations: number; weightedSatisfaction: number; revenueAtRisk: number }>();
  for (const segment of Object.values(history.segments)) {
    if (!segment) continue;
    const willingnessToPay = segment.willingnessToPay;
    for (const hole of Object.values(segment.holeEvidence)) {
      for (const [cause, observations] of Object.entries(hole.causes)) {
        const current = causes.get(cause) ?? { observations: 0, weightedSatisfaction: 0, revenueAtRisk: 0 };
        current.observations += observations;
        current.weightedSatisfaction += (hole.averageSatisfaction - 65) * observations;
        current.revenueAtRisk += Math.max(0, (65 - hole.averageSatisfaction) / 35) * willingnessToPay * observations;
        causes.set(cause, current);
      }
    }
  }
  return [...causes.entries()]
    .map(([cause, value]) => ({
      cause,
      observations: value.observations,
      satisfactionDelta: round(value.weightedSatisfaction / Math.max(1, value.observations)),
      revenueAtRisk: round(value.revenueAtRisk),
    }))
    .sort((a, b) => b.observations - a.observations || b.revenueAtRisk - a.revenueAtRisk)
    .slice(0, 6);
}

function buildAlerts(args: {
  world: World;
  demand: ReturnType<typeof buildM49DemandPlan>;
  condition: M49CourseReport["condition"];
  identity: ReturnType<typeof strategicIdentity>;
  observedRounds: number;
}): M49ReportAlert[] {
  const alerts: M49ReportAlert[] = [];
  const add = (alert: M49ReportAlert) => {
    if (!alerts.some((candidate) => candidate.id === alert.id)) alerts.push(alert);
  };
  if (args.condition.overall < .45) {
    add({ id: "condition-critical", severity: "urgent", title: "Course condition is critical", detail: `${Math.round(args.condition.overall * 100)}% condition is suppressing observed value.`, action: "Fund recovery before expanding demand." });
  } else if (args.condition.overall < .6) {
    add({ id: "condition-watch", severity: "warning", title: "Course condition needs attention", detail: `${Math.round(args.condition.overall * 100)}% condition is beginning to tax satisfaction.`, action: "Review maintenance before the next busy week." });
  }
  if (args.condition.shortfall > 0) {
    add({ id: "maintenance-shortfall", severity: args.condition.shortfall > args.condition.requiredMaintenance * .25 ? "urgent" : "warning", title: "Maintenance is underfunded", detail: `$${Math.round(args.condition.shortfall)} is below this period's estimated requirement.`, action: "Raise the maintenance budget or reduce wear pressure." });
  }
  for (const segment of Object.values(args.demand.segments)) {
    if (segment.evidenceRounds > 0 && segment.churnRate > .58) {
      add({ id: `segment-churn-${segment.segment}`, severity: "warning", title: `${segment.segment} golfers are not returning`, detail: `${Math.round(segment.churnRate * 100)}% estimated churn from observed rounds.`, action: "Inspect this segment's causes before buying more reach." });
    }
  }
  for (const promise of normalizeM49State(args.world.m49).marketingPromises ?? []) {
    if (promise.courseId !== args.demand.courseId || promise.disappointmentRisk < .55) continue;
    add({ id: `marketing-promise-${promise.id}`, severity: promise.disappointmentRisk > .75 ? "urgent" : "warning", title: "Marketing promise is missing its audience", detail: `${promise.segment} disappointment risk is ${Math.round(promise.disappointmentRisk * 100)}%.`, action: "Repair the facility or soften the claim before spending more." });
  }
  if (args.identity.tournamentFieldFit.championship < .45) {
    add({ id: "championship-readiness", severity: "info", title: "Championship field fit is limited", detail: "The current strategic identity is stronger in another market lane.", action: "Use local or regional events until the course earns a stronger championship fit." });
  }
  if (!args.observedRounds) {
    add({ id: "evidence-predicted", severity: "info", title: "Demand is still mostly predicted", detail: "No completed observed rounds have been retained for this course.", action: "Run real rounds before making a major price or marketing decision." });
  }
  return alerts;
}

/** Build the compact management view used at week close and by certification. */
export function buildM49CourseReport(args: { course: Course; world: World; result?: WeekResult; generatedAtWeek?: number }): M49CourseReport {
  const layout = activeCourseLayout(args.course);
  const demand = buildM49DemandPlan(args.course, args.world);
  const history = m49CourseHistory(args.world, layout.id);
  const identity = strategicIdentity(args.course, args.world);
  const condition = conditionReport(args.course, args.world, args.result);
  const observedRounds = history?.observedRounds ?? 0;
  const completedRounds = history?.completedRounds ?? 0;
  const revenue = args.result ? ledgerRevenue(args.result) : undefined;
  const ledgerBalanced = !args.result || revenue === undefined || Math.abs(revenue - args.result.revenue) < .01;
  const alerts = buildAlerts({ world: args.world, demand, condition, identity, observedRounds });
  const warnings = alerts.filter((alert) => alert.severity !== "info").map((alert) => alert.detail);
  const segmentCount = demand.supportedSegments.length;
  return {
    courseId: layout.id,
    courseName: layout.name,
    generatedAtWeek: args.generatedAtWeek ?? args.world.week,
    demand,
    observedRounds,
    completedRounds,
    topCauses: causeReport(args.world, layout.id),
    condition,
    alerts,
    reconciliation: {
      ledgerBalanced,
      observedEvidenceRounds: completedRounds,
      authoritativeCondition: args.course.condition,
    },
    headline: segmentCount ? `${segmentCount} segment${segmentCount === 1 ? "" : "s"} currently fit this course.` : "No segment currently has a strong course fit.",
    warnings,
  };
}
