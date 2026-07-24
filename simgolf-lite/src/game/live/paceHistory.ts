import { BALANCE } from "../balance/balanceConfig";
import { activeCourseLayout, courseLayouts, layoutById } from "../models/courseLayouts";
import type {
  Course,
  CoursePaceHistory,
  PaceCohort,
  PaceCohortHistory,
  PaceHistorySample,
  PaceOperationsState,
  World,
} from "../models/types";
import type { CoursePaceDayMetrics, PaceDayMetrics } from "./types";
import { courseOperations, normalizedStaff } from "./pace";

const COHORTS: PaceCohort[] = ["skilled_impatient", "novice_social", "general"];

function finite(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function nonNegative(value: unknown, fallback = 0): number {
  return Math.max(0, finite(value, fallback));
}

function average(values: readonly number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function percentile(values: readonly number[], percentileValue: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.ceil(percentileValue * sorted.length) - 1));
  return sorted[index];
}

function emptyCohortHistory(): PaceCohortHistory {
  return {
    samples: 0,
    averageDurationMinutes: 0,
    averageTimeParVarianceMinutes: 0,
    averageWaitMinutes: 0,
    pickupRate: 0,
    abandonmentRate: 0,
    averageSatisfaction: 0,
  };
}

function normalizeCohortHistory(value: unknown): PaceCohortHistory {
  if (!value || typeof value !== "object") return emptyCohortHistory();
  const raw = value as Partial<PaceCohortHistory>;
  return {
    samples: Math.min(1_000, Math.floor(nonNegative(raw.samples))),
    averageDurationMinutes: Math.min(1_500, nonNegative(raw.averageDurationMinutes)),
    averageTimeParVarianceMinutes: Math.max(-1_500, Math.min(1_500, finite(raw.averageTimeParVarianceMinutes))),
    averageWaitMinutes: Math.min(1_500, nonNegative(raw.averageWaitMinutes)),
    pickupRate: Math.max(0, Math.min(1, finite(raw.pickupRate))),
    abandonmentRate: Math.max(0, Math.min(1, finite(raw.abandonmentRate))),
    averageSatisfaction: Math.max(0, Math.min(100, finite(raw.averageSatisfaction))),
  };
}

function normalizeHistorySample(value: unknown): PaceHistorySample | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<PaceHistorySample>;
  if (typeof raw.id !== "string" || typeof raw.courseId !== "string") return null;
  if (raw.preset !== "relaxed" && raw.preset !== "balanced" && raw.preset !== "brisk") return null;
  const holes = Array.isArray(raw.holes) ? raw.holes.filter((hole) =>
    !!hole && typeof hole.holeId === "string"
  ).slice(0, 36).map((hole) => ({
    holeId: hole.holeId,
    queueMinutes: Math.min(100_000, nonNegative(hole.queueMinutes)),
    occupancyMinutes: Math.min(100_000, nonNegative(hole.occupancyMinutes)),
    recoveryDelayMinutes: Math.min(100_000, nonNegative(hole.recoveryDelayMinutes)),
    visits: Math.min(10_000, Math.floor(nonNegative(hole.visits))),
  })) : [];
  return {
    id: raw.id,
    week: Math.max(1, Math.floor(nonNegative(raw.week, 1))),
    day: Math.max(0, Math.min(6, Math.floor(nonNegative(raw.day)))),
    courseId: raw.courseId,
    preset: raw.preset,
    staffing: typeof raw.staffing === "string" ? raw.staffing.slice(0, 200) : "none",
    groupsStarted: Math.floor(nonNegative(raw.groupsStarted)),
    groupsFinished: Math.floor(nonNegative(raw.groupsFinished)),
    roundsCompleted: Math.floor(nonNegative(raw.roundsCompleted)),
    roundsIncomplete: Math.floor(nonNegative(raw.roundsIncomplete)),
    averageDurationMinutes: nonNegative(raw.averageDurationMinutes),
    p50DurationMinutes: nonNegative(raw.p50DurationMinutes),
    p90DurationMinutes: nonNegative(raw.p90DurationMinutes),
    averageWaitMinutes: nonNegative(raw.averageWaitMinutes),
    pickups: Math.floor(nonNegative(raw.pickups)),
    incidents: Math.floor(nonNegative(raw.incidents)),
    refunds: nonNegative(raw.refunds),
    credits: nonNegative(raw.credits),
    goodwillVouchers: nonNegative(raw.goodwillVouchers),
    overtimeCost: nonNegative(raw.overtimeCost),
    compensationCost: nonNegative(raw.compensationCost),
    greenFeeRevenue: nonNegative(raw.greenFeeRevenue),
    beverageRevenue: nonNegative(raw.beverageRevenue),
    occupiedTeeHours: nonNegative(raw.occupiedTeeHours),
    averageSatisfaction: Math.max(0, Math.min(100, finite(raw.averageSatisfaction))),
    cohorts: Object.fromEntries(COHORTS.map((cohort) => [cohort, normalizeCohortHistory(raw.cohorts?.[cohort])])) as Record<PaceCohort, PaceCohortHistory>,
    holes,
  };
}

export function emptyPaceOperationsState(): PaceOperationsState {
  return { version: 1, courses: {} };
}

export function normalizePaceOperationsState(value: unknown): PaceOperationsState {
  if (!value || typeof value !== "object") return emptyPaceOperationsState();
  const raw = value as Partial<PaceOperationsState>;
  if (raw.version !== 1 || !raw.courses || typeof raw.courses !== "object" || Array.isArray(raw.courses)) {
    return emptyPaceOperationsState();
  }
  const courses: Record<string, CoursePaceHistory> = {};
  for (const [courseId, value] of Object.entries(raw.courses).slice(0, 8)) {
    if (!value || typeof value !== "object") continue;
    const candidate = value as Partial<CoursePaceHistory>;
    const samples = Array.isArray(candidate.samples)
      ? candidate.samples.map(normalizeHistorySample).filter((sample): sample is PaceHistorySample => !!sample && sample.courseId === courseId).slice(-BALANCE.paceOperations.historyDays)
      : [];
    courses[courseId] = { courseId, samples };
  }
  return { version: 1, courses };
}

export function paceCohortFor(skill: number, patience: number): PaceCohort {
  if (skill >= 0.65 || patience <= 0.35) return "skilled_impatient";
  if (skill <= 0.45 || patience >= 0.7) return "novice_social";
  return "general";
}

function cohortHistory(metrics: CoursePaceDayMetrics, cohort: PaceCohort): PaceCohortHistory {
  const current = metrics.cohorts[cohort];
  const samples = current.samples;
  if (!samples) return emptyCohortHistory();
  return {
    samples,
    averageDurationMinutes: current.durationMinutes / samples,
    averageTimeParVarianceMinutes: current.timeParVarianceMinutes / samples,
    averageWaitMinutes: current.waitMinutes / samples,
    pickupRate: current.pickups / samples,
    abandonmentRate: current.abandonments / samples,
    averageSatisfaction: current.satisfaction / samples,
  };
}

function staffSignature(world: World, course: Course, courseId: string): string {
  const counts = new Map<string, number>();
  for (const staff of normalizedStaff(world, course)) {
    if (staff.courseId && staff.courseId !== courseId) continue;
    counts.set(staff.role, (counts.get(staff.role) ?? 0) + 1);
  }
  return [...counts.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([role, count]) => `${role}:${count}`).join("|") || "none";
}

function sampleFromMetrics(
  world: World,
  course: Course,
  day: number,
  metrics: CoursePaceDayMetrics,
): PaceHistorySample {
  const operations = courseOperations(course, metrics.courseId);
  const durations = metrics.roundDurations.filter(Number.isFinite).slice(-BALANCE.paceOperations.maxDurationSamplesPerDay);
  const totalRounds = metrics.roundsCompleted + metrics.roundsIncomplete;
  return {
    id: `pace-${world.week}-${day}-${metrics.courseId}`,
    week: world.week,
    day,
    courseId: metrics.courseId,
    preset: operations.preset,
    staffing: staffSignature(world, course, metrics.courseId),
    groupsStarted: metrics.groupsStarted,
    groupsFinished: metrics.groupsFinished,
    roundsCompleted: metrics.roundsCompleted,
    roundsIncomplete: metrics.roundsIncomplete,
    averageDurationMinutes: average(durations),
    p50DurationMinutes: percentile(durations, 0.5),
    p90DurationMinutes: percentile(durations, 0.9),
    averageWaitMinutes: totalRounds ? metrics.totalWaitMinutes / totalRounds : 0,
    pickups: metrics.pickups,
    incidents: metrics.incidents,
    refunds: metrics.refunds,
    credits: metrics.credits,
    goodwillVouchers: metrics.goodwillVouchers,
    overtimeCost: metrics.overtimeCost,
    compensationCost: metrics.compensationCost,
    greenFeeRevenue: metrics.greenFeeRevenue,
    beverageRevenue: metrics.beverageRevenue,
    occupiedTeeHours: metrics.occupiedTeeMinutes / 60,
    averageSatisfaction: metrics.roundsCompleted ? metrics.satisfaction / metrics.roundsCompleted : 0,
    cohorts: Object.fromEntries(COHORTS.map((cohort) => [cohort, cohortHistory(metrics, cohort)])) as Record<PaceCohort, PaceCohortHistory>,
    holes: Object.values(metrics.holes).map((hole) => ({ ...hole })).sort((left, right) => left.holeId.localeCompare(right.holeId)),
  };
}

export function recordPaceDay(
  world: World,
  course: Course,
  day: number,
  pace?: PaceDayMetrics,
): World {
  if (!pace) return world;
  const current = normalizePaceOperationsState(world.paceOperations);
  const courses = { ...current.courses };
  for (const metrics of Object.values(pace.perCourse)) {
    const sample = sampleFromMetrics(world, course, day, metrics);
    const history = courses[metrics.courseId] ?? { courseId: metrics.courseId, samples: [] };
    courses[metrics.courseId] = {
      courseId: metrics.courseId,
      samples: [...history.samples.filter((entry) => entry.id !== sample.id), sample]
        .sort((left, right) => left.week - right.week || left.day - right.day)
        .slice(-BALANCE.paceOperations.historyDays),
    };
  }
  return { ...world, paceOperations: { version: 1, courses } };
}

function samplePaceScore(sample: PaceHistorySample, cohort?: PaceCohort): number {
  const variance = cohort ? sample.cohorts[cohort].averageTimeParVarianceMinutes : average(COHORTS.flatMap((name) => {
    const metrics = sample.cohorts[name];
    return metrics.samples ? [metrics.averageTimeParVarianceMinutes] : [];
  }));
  const wait = cohort ? sample.cohorts[cohort].averageWaitMinutes : sample.averageWaitMinutes;
  return Math.max(0, Math.min(1, 0.56 - variance / 180 - wait / 240 - sample.roundsIncomplete * 0.015));
}

export interface PaceIdentitySummary {
  score: number;
  label: "relaxed" | "balanced" | "brisk";
  samples: number;
  cohorts: Record<PaceCohort, number>;
}

function labelFor(score: number): PaceIdentitySummary["label"] {
  return score < 0.4 ? "relaxed" : score > 0.62 ? "brisk" : "balanced";
}

export function paceIdentity(world: World, courseId: string, fallback = 0.5): PaceIdentitySummary {
  const samples = normalizePaceOperationsState(world.paceOperations).courses[courseId]?.samples ?? [];
  const priorWeight = BALANCE.paceOperations.identityPriorDays;
  const weighted = (cohort?: PaceCohort) => {
    let total = fallback * priorWeight;
    let weight = priorWeight;
    samples.forEach((sample, index) => {
      const recency = 1 + (index / Math.max(1, samples.length - 1)) * (BALANCE.paceOperations.identityRecentWeight - 1);
      const count = cohort ? sample.cohorts[cohort].samples : Math.max(1, sample.roundsCompleted);
      if (cohort && count === 0) return;
      const sampleWeight = recency * Math.min(4, Math.max(1, count / 4));
      total += samplePaceScore(sample, cohort) * sampleWeight;
      weight += sampleWeight;
    });
    return total / weight;
  };
  const score = weighted();
  return {
    score,
    label: labelFor(score),
    samples: samples.length,
    cohorts: Object.fromEntries(COHORTS.map((cohort) => [cohort, weighted(cohort)])) as Record<PaceCohort, number>,
  };
}

export interface PaceReportSummary {
  courseId: string;
  courseName: string;
  days: number;
  operatingDays: number;
  roundsCompleted: number;
  roundsIncomplete: number;
  averageDurationMinutes: number;
  p90DurationMinutes: number;
  averageWaitMinutes: number;
  pickups: number;
  incidents: number;
  refunds: number;
  overtimeCost: number;
  compensationCost: number;
  greenFeeRevenue: number;
  beverageRevenue: number;
  totalRevenue: number;
  netRevenue: number;
  revenuePerTeeHour: number;
  netRevenuePerTeeHour: number;
  identity: PaceIdentitySummary;
  sparse: boolean;
}

export function paceReport(world: World, course: Course, courseId: string, days: 7 | 28): PaceReportSummary {
  const history = normalizePaceOperationsState(world.paceOperations).courses[courseId]?.samples.slice(-days) ?? [];
  const rounds = history.reduce((sum, sample) => sum + sample.roundsCompleted, 0);
  const incomplete = history.reduce((sum, sample) => sum + sample.roundsIncomplete, 0);
  const durationWeight = history.reduce((sum, sample) => sum + sample.averageDurationMinutes * sample.roundsCompleted, 0);
  const waitWeight = history.reduce((sum, sample) => sum + sample.averageWaitMinutes * (sample.roundsCompleted + sample.roundsIncomplete), 0);
  const teeHours = history.reduce((sum, sample) => sum + sample.occupiedTeeHours, 0);
  const greenFeeRevenue = history.reduce((sum, sample) => sum + sample.greenFeeRevenue, 0);
  const beverageRevenue = history.reduce((sum, sample) => sum + sample.beverageRevenue, 0);
  const overtimeCost = history.reduce((sum, sample) => sum + sample.overtimeCost, 0);
  const compensationCost = history.reduce((sum, sample) => sum + sample.compensationCost, 0);
  const totalRevenue = greenFeeRevenue + beverageRevenue;
  const netRevenue = totalRevenue - overtimeCost - compensationCost;
  const layout = layoutById(course, courseId) ?? activeCourseLayout(course);
  return {
    courseId,
    courseName: layout.name,
    days,
    operatingDays: history.length,
    roundsCompleted: rounds,
    roundsIncomplete: incomplete,
    averageDurationMinutes: rounds ? durationWeight / rounds : 0,
    p90DurationMinutes: history.length ? percentile(history.map((sample) => sample.p90DurationMinutes).filter((value) => value > 0), 0.9) : 0,
    averageWaitMinutes: rounds + incomplete ? waitWeight / (rounds + incomplete) : 0,
    pickups: history.reduce((sum, sample) => sum + sample.pickups, 0),
    incidents: history.reduce((sum, sample) => sum + sample.incidents, 0),
    refunds: history.reduce((sum, sample) => sum + sample.refunds, 0),
    overtimeCost,
    compensationCost,
    greenFeeRevenue,
    beverageRevenue,
    totalRevenue,
    netRevenue,
    revenuePerTeeHour: teeHours ? totalRevenue / teeHours : 0,
    netRevenuePerTeeHour: teeHours ? netRevenue / teeHours : 0,
    identity: paceIdentity(world, courseId),
    sparse: history.length < 3 || rounds < 8,
  };
}

export function paceReports(world: World, course: Course, days: 7 | 28): PaceReportSummary[] {
  return courseLayouts(course).map((layout) => paceReport(world, course, layout.id, days));
}

export interface PaceAdvisorFinding {
  holeId: string;
  holeIndex: number;
  severity: "watch" | "high" | "severe";
  intensity: number;
  reason: string;
  recommendation: string;
  tradeoff: string;
}

export function diagnosePaceBottlenecks(
  world: World,
  course: Course,
  courseId: string,
  live?: CoursePaceDayMetrics,
  marshalCoverage = 0,
): PaceAdvisorFinding[] {
  const history = normalizePaceOperationsState(world.paceOperations).courses[courseId]?.samples.slice(-7) ?? [];
  const aggregates = new Map<string, { queue: number; recovery: number; visits: number }>();
  const add = (holeId: string, queue: number, recovery: number, visits: number) => {
    const current = aggregates.get(holeId) ?? { queue: 0, recovery: 0, visits: 0 };
    current.queue += queue;
    current.recovery += recovery;
    current.visits += visits;
    aggregates.set(holeId, current);
  };
  for (const sample of history) for (const hole of sample.holes) add(hole.holeId, hole.queueMinutes, hole.recoveryDelayMinutes, hole.visits);
  if (live) for (const hole of Object.values(live.holes)) add(hole.holeId, hole.queueMinutes, hole.recoveryDelayMinutes, hole.visits);

  const layout = layoutById(course, courseId) ?? activeCourseLayout(course);
  const raw = layout.publishedHoleIds.map((holeId, holeIndex) => {
    const metrics = aggregates.get(holeId) ?? { queue: 0, recovery: 0, visits: 0 };
    const divisor = Math.max(1, metrics.visits);
    return {
      holeId,
      holeIndex,
      queue: metrics.queue / divisor,
      recovery: metrics.recovery / divisor,
      intensity: (metrics.queue + metrics.recovery * 0.65) / divisor,
    };
  });
  const localPeaks = raw.filter((entry, index) => {
    if (entry.intensity < BALANCE.paceOperations.bottleneckMinimumMinutes) return false;
    const previous = raw[index - 1]?.intensity ?? 0;
    const next = raw[index + 1]?.intensity ?? 0;
    return entry.intensity >= previous && entry.intensity >= next;
  });
  return localPeaks.sort((left, right) => right.intensity - left.intensity).slice(0, 4).map((entry) => {
    const operations = courseOperations(course, courseId);
    const recoveryLed = entry.recovery > entry.queue;
    const severity: PaceAdvisorFinding["severity"] = entry.intensity >= BALANCE.paceOperations.bottleneckSevereMinutes
      ? "severe"
      : entry.intensity >= BALANCE.paceOperations.bottleneckMinimumMinutes * 2 ? "high" : "watch";
    if (marshalCoverage === 0 && entry.queue >= entry.recovery) return {
      holeId: entry.holeId,
      holeIndex: entry.holeIndex,
      severity,
      intensity: entry.intensity,
      reason: `Measured queues average ${entry.queue.toFixed(1)} minutes here, and no marshal is assigned.`,
      recommendation: "Assign a marshal to this course before tightening enforcement.",
      tradeoff: "Adds payroll, but reduces unmanaged waits and protects later tee times.",
    };
    if (recoveryLed) return {
      holeId: entry.holeId,
      holeIndex: entry.holeIndex,
      severity,
      intensity: entry.intensity,
      reason: `Recovery and search delays average ${entry.recovery.toFixed(1)} minutes per observed group.`,
      recommendation: "Review landing hazards, recovery routes, or tee guidance for this hole.",
      tradeoff: "Easier recovery improves flow but may soften the intended challenge.",
    };
    if (operations.teeIntervalMinutes <= 10) return {
      holeId: entry.holeId,
      holeIndex: entry.holeIndex,
      severity,
      intensity: entry.intensity,
      reason: `This local peak is absorbing ${entry.intensity.toFixed(1)} minutes while groups launch every ${operations.teeIntervalMinutes} minutes.`,
      recommendation: "Increase the tee interval or add a starter gap for upcoming groups.",
      tradeoff: "Lowers theoretical tee volume in exchange for more reliable completions and fewer refunds.",
    };
    return {
      holeId: entry.holeId,
      holeIndex: entry.holeIndex,
      severity,
      intensity: entry.intensity,
      reason: `Measured local delay averages ${entry.intensity.toFixed(1)} minutes after downstream spillback is suppressed.`,
      recommendation: operations.beverage.menu === "off"
        ? "Review the routing transition and marshal coverage."
        : "Shorten beverage dwell here or move service away from the constrained transition.",
      tradeoff: operations.beverage.menu === "off"
        ? "Routing changes cost capital; operational coverage costs payroll."
        : "Faster service may reduce beverage conversion but protects net tee-hour revenue.",
    };
  });
}

export function paceDemandMultiplier(world: World, courseId: string, preference: number): number {
  const identity = paceIdentity(world, courseId, 0.5).score;
  const match = 1 - Math.abs(Math.max(0, Math.min(1, preference)) - identity);
  return 0.9 + match * 0.15;
}

export function paceRepeatIntentModifier(identity: number, preference: number): number {
  const boundedIdentity = Math.max(0, Math.min(1, finite(identity, 0.5)));
  const boundedPreference = Math.max(0, Math.min(1, finite(preference, 0.5)));
  const match = 1 - Math.abs(boundedPreference - boundedIdentity);
  return (match - 0.5) * BALANCE.paceOperations.repeatIntentMatchWeight;
}
