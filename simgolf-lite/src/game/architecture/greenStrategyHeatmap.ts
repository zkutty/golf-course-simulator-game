import type { Course, Hole, PinRotation, Point, TeeSet } from "../models/types";
import { getPinPosition, getTeeBox, holeForCourseSetup } from "../models/courseSetup";
import { courseForLayout } from "../models/courseLayouts";
import { courseWithEffectiveSurfaces } from "../conditions/surfaceCare";
import { planGreenLandingZones, type GreenLandingCandidate } from "../live/greenLandingStrategy";
import { liveCourseSnapshot } from "../live/livePhysics";
import type { Personality } from "../live/personality";
import { m48Cohorts } from "./strategic";
import type { M48CohortDefinition, M48CohortId } from "./m48Types";
import type { ArchitectureShotEvidence } from "../livingClub/types";
import type {
  ArchitectureOverlayCell,
  ArchitectureOverlayPoint,
  ArchitectureOverlayRender,
  ArchitectureOverlayTrace,
  GreenStrategyOverlayKind,
} from "./reviewTypes";
import type { ArchitectureReviewFilters } from "./review";

export const GREEN_STRATEGY_VERSION = 1 as const;
export const GREEN_STRATEGY_MAX_OVERLAY_ITEMS = 320 as const;

export interface GreenStrategyFilters {
  kind: GreenStrategyOverlayKind;
  holeId: string | "all";
  teeSet: TeeSet;
  pinRotation: PinRotation | "all";
  cohortId: M48CohortId | "all";
}

export interface GreenStrategyLegendItem {
  id: "forecast" | "observed-current" | "observed-historical" | "risk";
  label: string;
  pattern: NonNullable<ArchitectureOverlayPoint["pattern"]>;
  meaning: string;
}

export interface GreenStrategyReport {
  attackExpectedPutts: number | null;
  safeExpectedPutts: number | null;
  approachAdvantage: number;
  shortSidePunishment: number;
  rotationVariety: number;
  cohortSeparation: number;
  unfairness: number;
  preferredTargets: number;
  observedShots: number;
}

export interface GreenStrategyRecommendation {
  id: string;
  kind: "open-safe-zone" | "soften-short-side" | "contain-rolloff" | "separate-rotations" | "reward-cohorts";
  holeId: string;
  location: Point;
  severity: "advice" | "warning";
  titleKey: string;
  detailKey: string;
  metric: number;
}

export interface GreenStrategyHeatmap {
  version: typeof GREEN_STRATEGY_VERSION;
  evidenceSource: "forecast-and-observed";
  forecastGeometryVersion: string;
  observedGeometryVersions: Array<{ geometryVersion: string; current: boolean; shots: number }>;
  maintenanceProgram: string;
  selectedCohorts: M48CohortId[];
  selectedPins: PinRotation[];
  predictiveSamples: number;
  observedCurrent: number;
  observedHistorical: number;
  overlay: ArchitectureOverlayRender;
  report: GreenStrategyReport;
  recommendations: GreenStrategyRecommendation[];
  legend: GreenStrategyLegendItem[];
  textSummary: string;
  reducedMotionSafe: true;
}

interface CandidateEvidence {
  holeId: string;
  pinRotation: PinRotation;
  cohortId: M48CohortId;
  pin: Point;
  candidate: GreenLandingCandidate;
  rank: number;
  yardsPerTile: number;
}

const clamp = (value: number, minimum = 0, maximum = 1) => Math.max(minimum, Math.min(maximum, value));
const round = (value: number, places = 2) => Number(value.toFixed(places));
const distance = (left: Point, right: Point) => Math.hypot(left.x - right.x, left.y - right.y);

function bounded<T extends { id: string }>(values: T[], max: number = GREEN_STRATEGY_MAX_OVERLAY_ITEMS): T[] {
  if (values.length <= max) return values;
  const ordered = values.slice().sort((left, right) => left.id.localeCompare(right.id));
  const stride = ordered.length / max;
  return Array.from({ length: max }, (_, index) => ordered[Math.floor(index * stride)]);
}

function personalityFor(cohort: M48CohortDefinition): Personality {
  const skill = (cohort.capabilities.power + cohort.capabilities.accuracy + cohort.capabilities.irons + cohort.capabilities.shortGame) / 400;
  const difficulty = cohort.capabilities.riskStyle === "aggressive"
    ? .72
    : cohort.capabilities.riskStyle === "conservative" ? -.72 : 0;
  return {
    skill: clamp(skill),
    consistency: clamp(cohort.capabilities.consistency / 100),
    patience: difficulty < 0 ? .78 : .5,
    spendPropensity: .5,
    prefs: { difficulty, scenery: cohort.capabilities.sceneryAffinity * 2 - 1, price: 0 },
  };
}

function approachFrom(course: Course, hole: Hole, pin: Point): Point | null {
  const origin = hole.waypoints?.at(-1) ?? getTeeBox(hole, "member") ?? hole.tee;
  if (!origin) return null;
  const length = Math.max(.001, distance(origin, pin));
  // Architecture Review evaluates the final approach, even on a long hole.
  // The direction comes from authored routing; the bounded distance keeps the
  // shared green planner in the same reachable context as live approach play.
  const approachTiles = Math.min(length, Math.max(9, 155 / Math.max(1, course.yardsPerTile)));
  return {
    x: pin.x - (pin.x - origin.x) / length * approachTiles,
    y: pin.y - (pin.y - origin.y) / length * approachTiles,
  };
}

function pinsFor(hole: Hole, selected: PinRotation | "all"): PinRotation[] {
  const rotations: PinRotation[] = selected === "all" ? ["A", "B", "C"] : [selected];
  return rotations.filter((rotation) => getPinPosition(hole, rotation) != null);
}

function predictiveEvidence(course: Course, filters: GreenStrategyFilters): CandidateEvidence[] {
  const cohorts = m48Cohorts().filter((cohort) => filters.cohortId === "all" || cohort.id === filters.cohortId);
  const holes = course.holes.filter((hole, index) => {
    const holeId = hole.id ?? `hole-${index + 1}`;
    return filters.holeId === "all" || holeId === filters.holeId;
  });
  const rows: CandidateEvidence[] = [];
  for (const hole of holes) for (const pinRotation of pinsFor(hole, filters.pinRotation)) {
    const resolvedHole = holeForCourseSetup(hole, filters.teeSet, pinRotation);
    const pin = resolvedHole.green;
    if (!pin) continue;
    const from = approachFrom(course, resolvedHole, pin);
    if (!from) continue;
    const snapshot = liveCourseSnapshot({ course, teeSet: filters.teeSet, pinRotation });
    for (const cohort of cohorts) {
      const candidates = planGreenLandingZones({
        course,
        hole: resolvedHole,
        from,
        lie: "fairway",
        capabilities: cohort.capabilities,
        personality: personalityFor(cohort),
        snapshot,
      });
      candidates.forEach((candidate, rank) => rows.push({
        holeId: resolvedHole.id ?? "hole",
        pinRotation,
        cohortId: cohort.id,
        pin,
        candidate,
        rank,
        yardsPerTile: course.yardsPerTile,
      }));
    }
  }
  return rows;
}

function observedForGreen(evidence: readonly ArchitectureShotEvidence[]): ArchitectureShotEvidence[] {
  return evidence.filter((item) => item.shotType === "approach" || item.shotType === "recovery" || item.shotType === "putt" || item.greenRollout != null);
}

function observedCells(evidence: readonly ArchitectureShotEvidence[], currentGeometryVersion: string, useRest: boolean): ArchitectureOverlayCell[] {
  const cells = new Map<string, ArchitectureOverlayCell>();
  for (const item of observedForGreen(evidence)) {
    const point = useRest ? item.physicalRest ?? item.rest : item.landing;
    const x = Math.floor(point.x);
    const y = Math.floor(point.y);
    const current = item.geometryVersion === currentGeometryVersion;
    const key = `${x}:${y}:${current ? "current" : item.geometryVersion}`;
    const prior = cells.get(key);
    if (prior) prior.value++;
    else cells.set(key, {
      id: `observed-${key}`,
      x,
      y,
      value: 1,
      current,
      source: "observed",
      pattern: current ? "cross" : "diagonal",
      label: current ? "Observed on current geometry" : `Observed on frozen geometry ${item.geometryVersion}`,
    });
  }
  return [...cells.values()];
}

function observedPoints(evidence: readonly ArchitectureShotEvidence[], currentGeometryVersion: string): ArchitectureOverlayPoint[] {
  return observedForGreen(evidence).map((item) => {
    const rest = item.physicalRest ?? item.rest;
    const current = item.geometryVersion === currentGeometryVersion;
    return {
      id: `observed-leave-${item.id}`,
      x: rest.x,
      y: rest.y,
      value: Math.max(.1, distance(item.landing, rest)),
      current,
      source: "observed",
      pattern: current ? "cross" : "diagonal",
      label: current ? "Observed leave · current geometry" : `Observed leave · frozen geometry ${item.geometryVersion}`,
    };
  });
}

function observedTraces(evidence: readonly ArchitectureShotEvidence[], currentGeometryVersion: string): ArchitectureOverlayTrace[] {
  return observedForGreen(evidence).flatMap((item) => {
    const current = item.geometryVersion === currentGeometryVersion;
    const points = item.greenRollout?.path?.length
      ? [item.greenRollout.landing, ...item.greenRollout.path.slice(1)]
      : [item.landing, item.physicalRest ?? item.rest];
    return points.slice(1).map((to, index) => ({
      id: `observed-roll-${item.id}-${index}`,
      from: points[index],
      to,
      current,
      source: "observed" as const,
      pattern: current ? "cross" as const : "diagonal" as const,
      label: current ? "Observed rollout · current geometry" : `Observed rollout · frozen geometry ${item.geometryVersion}`,
    }));
  });
}

function predictiveCells(rows: CandidateEvidence[], preferredOnly: boolean): ArchitectureOverlayCell[] {
  return rows.filter((row) => !preferredOnly || row.rank === 0).map((row) => ({
    id: `forecast-${row.holeId}-${row.pinRotation}-${row.cohortId}-${row.candidate.id}`,
    x: Math.floor(row.candidate.target.x),
    y: Math.floor(row.candidate.target.y),
    value: preferredOnly ? 4 : Math.max(.1, 1 - row.candidate.variance),
    current: true,
    source: "predicted",
    pattern: row.rank === 0 ? "dots" : "solid",
    label: `Forecast · Pin ${row.pinRotation} · ${row.cohortId} · ${row.candidate.role}`,
  }));
}

function predictivePoints(rows: CandidateEvidence[], metric: "putts" | "leave" | "miss" | "risk"): ArchitectureOverlayPoint[] {
  return rows.map((row) => {
    const candidate = row.candidate;
    const point = metric === "leave" ? candidate.predictedRest : candidate.target;
    const value = metric === "putts" ? candidate.expectedPutts
      : metric === "leave" ? distance(candidate.predictedRest, row.pin) * Math.max(1, row.yardsPerTile)
        : metric === "miss" ? candidate.variance
          : Math.max(candidate.shortSidedRisk, candidate.rollOffRisk);
    return {
      id: `forecast-${metric}-${row.holeId}-${row.pinRotation}-${row.cohortId}-${candidate.id}`,
      x: point.x,
      y: point.y,
      value,
      current: true,
      source: "predicted",
      pattern: metric === "risk" && value >= .5 ? "diagonal" : "dots",
      label: `Forecast · Pin ${row.pinRotation} · ${row.cohortId} · ${metric} ${round(value)}`,
    };
  });
}

function predictiveTraces(rows: CandidateEvidence[]): ArchitectureOverlayTrace[] {
  return rows.filter((row) => row.rank < 3).map((row) => ({
    id: `forecast-roll-${row.holeId}-${row.pinRotation}-${row.cohortId}-${row.candidate.id}`,
    from: row.candidate.target,
    to: row.candidate.predictedRest,
    current: true,
    emphasized: row.rank === 0,
    source: "predicted",
    pattern: "dots",
    label: `Forecast rollout · Pin ${row.pinRotation} · ${row.cohortId}`,
  }));
}

function buildOverlay(
  kind: GreenStrategyOverlayKind,
  rows: CandidateEvidence[],
  evidence: readonly ArchitectureShotEvidence[],
  currentGeometryVersion: string,
): ArchitectureOverlayRender {
  const overlay: ArchitectureOverlayRender = { kind, traces: [], cells: [], points: [] };
  if (kind === "green-preferred") {
    overlay.cells = bounded([...predictiveCells(rows, true), ...observedCells(evidence, currentGeometryVersion, false)], 240);
  } else if (kind === "green-putts") {
    overlay.points = bounded(predictivePoints(rows, "putts"), 240);
  } else if (kind === "green-leaves") {
    overlay.points = bounded([...predictivePoints(rows, "leave"), ...observedPoints(evidence, currentGeometryVersion)], 240);
  } else if (kind === "green-misses") {
    overlay.cells = bounded([...predictiveCells(rows, false), ...observedCells(evidence, currentGeometryVersion, true)], 240);
    overlay.points = bounded(predictivePoints(rows, "miss"), 180);
  } else if (kind === "green-rollout") {
    overlay.traces = bounded([...predictiveTraces(rows), ...observedTraces(evidence, currentGeometryVersion)]);
  } else {
    overlay.points = bounded(predictivePoints(rows, "risk"), 240);
    overlay.cells = bounded(observedCells(evidence.filter((item) => item.lieAfter != null && item.lieAfter !== "green" && item.lieAfter !== "cup"), currentGeometryVersion, true), 120);
  }
  return overlay;
}

function average(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function report(rows: CandidateEvidence[], observedShots: number): GreenStrategyReport {
  const preferred = rows.filter((row) => row.rank === 0);
  const attack = rows.filter((row) => row.candidate.role === "attack").map((row) => row.candidate.expectedPutts);
  const safe = rows.filter((row) => row.candidate.role !== "attack").map((row) => row.candidate.expectedPutts);
  const groups = new Map<string, CandidateEvidence[]>();
  for (const row of preferred) {
    const key = `${row.holeId}:${row.pinRotation}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const approachAdvantage = average([...groups.values()].map((items) => {
    const ordered = items.map((item) => item.candidate.score).sort((left, right) => left - right);
    return ordered.length > 1 ? ordered.at(-1)! - ordered[0] : 0;
  })) ?? 0;
  const byHoleCohort = new Map<string, Set<string>>();
  const byHolePin = new Map<string, Set<string>>();
  for (const row of preferred) {
    const target = `${round(row.candidate.target.x, 1)},${round(row.candidate.target.y, 1)}`;
    const cohortKey = `${row.holeId}:${row.pinRotation}`;
    const pinKey = `${row.holeId}:${row.cohortId}`;
    byHoleCohort.set(cohortKey, new Set([...(byHoleCohort.get(cohortKey) ?? []), target]));
    byHolePin.set(pinKey, new Set([...(byHolePin.get(pinKey) ?? []), target]));
  }
  const separation = average([...byHoleCohort.values()].map((targets) => clamp((targets.size - 1) / 3))) ?? 0;
  const variety = average([...byHolePin.values()].map((targets) => clamp((targets.size - 1) / 2))) ?? 0;
  const unfairness = preferred.length
    ? preferred.filter((row) => row.candidate.rollOffRisk >= .48 || row.candidate.shortSidedRisk >= .55 || row.candidate.expectedPutts >= 2.55).length / preferred.length
    : 0;
  return {
    attackExpectedPutts: attack.length ? round(average(attack)!) : null,
    safeExpectedPutts: safe.length ? round(average(safe)!) : null,
    approachAdvantage: round(approachAdvantage),
    shortSidePunishment: round(average(preferred.map((row) => row.candidate.shortSidedRisk)) ?? 0),
    rotationVariety: round(variety),
    cohortSeparation: round(separation),
    unfairness: round(unfairness),
    preferredTargets: new Set(preferred.map((row) => `${round(row.candidate.target.x, 1)},${round(row.candidate.target.y, 1)}`)).size,
    observedShots,
  };
}

function recommendations(rows: CandidateEvidence[], summary: GreenStrategyReport): GreenStrategyRecommendation[] {
  const preferred = rows.filter((row) => row.rank === 0);
  const riskiest = preferred.slice().sort((left, right) =>
    Math.max(right.candidate.rollOffRisk, right.candidate.shortSidedRisk) - Math.max(left.candidate.rollOffRisk, left.candidate.shortSidedRisk)
    || left.holeId.localeCompare(right.holeId)
  )[0];
  const first = preferred[0];
  if (!first) return [];
  const items: GreenStrategyRecommendation[] = [];
  if (summary.unfairness >= .25) items.push({ id: "green-open-safe", kind: "open-safe-zone", holeId: riskiest?.holeId ?? first.holeId, location: riskiest?.candidate.target ?? first.candidate.target, severity: "warning", titleKey: "architecture.green.recommend.openSafe.title", detailKey: "architecture.green.recommend.openSafe.body", metric: summary.unfairness });
  if (summary.shortSidePunishment >= .35) items.push({ id: "green-soften-short", kind: "soften-short-side", holeId: riskiest?.holeId ?? first.holeId, location: riskiest?.pin ?? first.pin, severity: "warning", titleKey: "architecture.green.recommend.shortSide.title", detailKey: "architecture.green.recommend.shortSide.body", metric: summary.shortSidePunishment });
  if ((riskiest?.candidate.rollOffRisk ?? 0) >= .48) items.push({ id: "green-contain-rolloff", kind: "contain-rolloff", holeId: riskiest!.holeId, location: riskiest!.candidate.predictedRest, severity: "warning", titleKey: "architecture.green.recommend.rolloff.title", detailKey: "architecture.green.recommend.rolloff.body", metric: riskiest!.candidate.rollOffRisk });
  if (summary.rotationVariety < .34) items.push({ id: "green-separate-rotations", kind: "separate-rotations", holeId: first.holeId, location: first.pin, severity: "advice", titleKey: "architecture.green.recommend.rotations.title", detailKey: "architecture.green.recommend.rotations.body", metric: summary.rotationVariety });
  if (summary.cohortSeparation < .25) items.push({ id: "green-reward-cohorts", kind: "reward-cohorts", holeId: first.holeId, location: first.candidate.target, severity: "advice", titleKey: "architecture.green.recommend.cohorts.title", detailKey: "architecture.green.recommend.cohorts.body", metric: summary.cohortSeparation });
  return items.slice(0, 5);
}

export function buildGreenStrategyHeatmap(args: {
  course: Course;
  filters: GreenStrategyFilters;
  evidence: readonly ArchitectureShotEvidence[];
  currentGeometryVersion: string;
}): GreenStrategyHeatmap {
  const rows = predictiveEvidence(args.course, args.filters);
  const observed = observedForGreen(args.evidence);
  const observedCurrent = observed.filter((item) => item.geometryVersion === args.currentGeometryVersion).length;
  const observedHistorical = observed.length - observedCurrent;
  const summary = report(rows, observed.length);
  const versions = new Map<string, number>();
  for (const item of observed) versions.set(item.geometryVersion, (versions.get(item.geometryVersion) ?? 0) + 1);
  const selectedCohorts = [...new Set(rows.map((row) => row.cohortId))];
  const selectedPins = [...new Set(rows.map((row) => row.pinRotation))];
  const maintenanceProgram = args.course.greenProgram?.preset ?? "standard";
  const textSummary = `Forecast on current geometry ${args.currentGeometryVersion}; ${rows.length} bounded planning samples using ${maintenanceProgram} maintenance. Pin and cohort filters scope forecasts; observed shots retain source and geometry without invented tags. Observed evidence: ${observedCurrent} current and ${observedHistorical} frozen historical shots. Attack ${summary.attackExpectedPutts ?? "n/a"} expected putts; safe ${summary.safeExpectedPutts ?? "n/a"}; short-side punishment ${Math.round(summary.shortSidePunishment * 100)}%; rotation variety ${Math.round(summary.rotationVariety * 100)}%; cohort separation ${Math.round(summary.cohortSeparation * 100)}%; unfairness ${Math.round(summary.unfairness * 100)}%.`;
  return {
    version: GREEN_STRATEGY_VERSION,
    evidenceSource: "forecast-and-observed",
    forecastGeometryVersion: args.currentGeometryVersion,
    observedGeometryVersions: [...versions.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([geometryVersion, shots]) => ({ geometryVersion, current: geometryVersion === args.currentGeometryVersion, shots })),
    maintenanceProgram,
    selectedCohorts,
    selectedPins,
    predictiveSamples: rows.length,
    observedCurrent,
    observedHistorical,
    overlay: buildOverlay(args.filters.kind, rows, observed, args.currentGeometryVersion),
    report: summary,
    recommendations: recommendations(rows, summary),
    legend: [
      { id: "forecast", label: "Forecast", pattern: "dots", meaning: "Planning estimate on the current course and maintenance state; not an observed result." },
      { id: "observed-current", label: "Observed · current", pattern: "cross", meaning: "Retained shot or rollout from the current geometry." },
      { id: "observed-historical", label: "Observed · frozen history", pattern: "diagonal", meaning: "Retained shot tied to the geometry version played; never replayed on the current design." },
      { id: "risk", label: "High risk", pattern: "diagonal", meaning: "Short-side or roll-off exposure from the shared live planning model." },
    ],
    textSummary,
    reducedMotionSafe: true,
  };
}

/** Deferred Architecture Review entrypoint; keeps the heavy projection out of initial JS. */
export function buildGreenStrategyHeatmapForReview(args: {
  course: Course;
  filters: ArchitectureReviewFilters;
  evidence: readonly ArchitectureShotEvidence[];
  currentGeometryVersion: string;
}): GreenStrategyHeatmap | null {
  if (!args.filters.kind.startsWith("green-")) return null;
  const selectedCourse = courseWithEffectiveSurfaces(courseForLayout(args.course, args.filters.courseId));
  return buildGreenStrategyHeatmap({
    course: selectedCourse,
    filters: {
      kind: args.filters.kind as GreenStrategyOverlayKind,
      holeId: args.filters.holeId,
      teeSet: args.filters.teeSet === "all" ? "member" : args.filters.teeSet,
      pinRotation: args.filters.pinRotation,
      cohortId: args.filters.cohortId,
    },
    evidence: args.evidence,
    currentGeometryVersion: args.currentGeometryVersion,
  });
}
