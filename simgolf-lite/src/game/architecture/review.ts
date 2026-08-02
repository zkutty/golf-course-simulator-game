import type { Course, Terrain, World } from "../models/types";
import { courseForLayout } from "../models/courseLayouts";
import { analyzeArchitecture } from "./architecture";
import type {
  ArchitectureOverlayCell,
  ArchitectureOverlayKind,
  ArchitectureOverlayPoint,
  ArchitectureOverlayRender,
  ArchitectureOverlayTrace,
  ArchitectureMobilityOverlay,
  ArchitectureRulesReview,
} from "./reviewTypes";
import { buildArchitectureMobilityOverlay } from "../m51/architectureOverlay";
import type { MobilityMode } from "../m51/types";
import { courseGeometryVersion, normalizeLivingClub } from "../livingClub/livingClub";
import type { ArchitectureRevisionSummary, ArchitectureShotEvidence } from "../livingClub/types";
import { buildStrategicPortfolio } from "./portfolio";
import { buildStrategicRecommendations } from "./recommendations";
import type { M48DesignComparison, M48StrategicHoleEvaluation, M48StrategicPortfolio } from "./m48Types";
import { buildArchitectureRulesReview } from "./rulesEvidence";
import { terrainCostMult } from "../balance/difficulty";
import { courseWithEffectiveSurfaces } from "../conditions/surfaceCare";

export interface ArchitectureReviewFilters {
  kind: ArchitectureOverlayKind;
  courseId: string;
  holeId: string | "all";
  teeSet: "all" | "forward" | "member" | "championship";
  sourceSegment: "all" | string;
  recency: "all" | "recent" | "current" | "historical";
  pinRotation: "all" | "A" | "B" | "C";
  mobilityMode: "all" | MobilityMode;
}

export interface ArchitectureReviewData {
  currentGeometryVersion: string;
  filters: ArchitectureReviewFilters;
  evidence: ArchitectureShotEvidence[];
  currentEvidence: number;
  historicalEvidence: number;
  status: "empty" | "sparse" | "ready" | "stale-only";
  explanation: string;
  overlay: ArchitectureOverlayRender;
  revisions: ArchitectureRevisionSummary[];
  scoring: Array<{ teeSet: string; rounds: number; averageToPar: number }>;
  sourceSegments: string[];
  selectedTraceId: string | null;
  strategic: M48StrategicPortfolio;
  recommendations: ReturnType<typeof buildStrategicRecommendations>;
  selectedStrategicHole: M48StrategicHoleEvaluation | null;
  comparison: M48DesignComparison | null;
  rules: ArchitectureRulesReview;
  mobility: ArchitectureMobilityOverlay | null;
}

const HAZARDS = new Set<Terrain>(["sand", "waste_area", "water", "wetland", "deep_rough"]);

function bounded<T>(values: T[], max: number): T[] {
  if (values.length <= max) return values;
  const stride = values.length / max;
  return Array.from({ length: max }, (_, index) => values[Math.floor(index * stride)]);
}

function evidenceFilters(
  evidence: ArchitectureShotEvidence,
  filters: ArchitectureReviewFilters,
  currentGeometryVersion: string,
  currentWeek: number,
): boolean {
  if (evidence.courseId !== filters.courseId) return false;
  if (filters.holeId !== "all" && evidence.holeId !== filters.holeId) return false;
  if (filters.teeSet !== "all" && evidence.teeSet !== filters.teeSet) return false;
  if (filters.sourceSegment !== "all" && evidence.sourceSegment !== filters.sourceSegment) return false;
  if (filters.recency === "recent" && evidence.week < currentWeek - 4) return false;
  if (filters.recency === "current" && evidence.geometryVersion !== currentGeometryVersion) return false;
  if (filters.recency === "historical" && evidence.geometryVersion === currentGeometryVersion) return false;
  return true;
}

function traces(
  evidence: ArchitectureShotEvidence[],
  currentGeometryVersion: string,
  selectedTraceId: string | null,
  recoveryOnly = false,
): ArchitectureOverlayTrace[] {
  return bounded(evidence
    .filter((item) => !recoveryOnly || item.shotType === "recovery")
    .flatMap((item) => {
      const rolloutPoints = item.greenRollout?.path?.length
        ? [item.from, item.greenRollout.landing, ...item.greenRollout.path.slice(1)]
        : [item.from, item.rest];
      const physicalRest = rolloutPoints.at(-1);
      const points = physicalRest && (physicalRest.x !== item.rest.x || physicalRest.y !== item.rest.y)
        ? [...rolloutPoints, item.rest]
        : rolloutPoints;
      return points.slice(1).map((to, index) => ({
        id: `${item.id}-${index}`,
        from: points[index],
        to,
        current: item.geometryVersion === currentGeometryVersion,
        emphasized: item.id === selectedTraceId,
      }));
    }), 320);
}

function landingCells(
  evidence: ArchitectureShotEvidence[],
  currentGeometryVersion: string,
): ArchitectureOverlayCell[] {
  const map = new Map<string, ArchitectureOverlayCell>();
  for (const item of evidence) {
    const x = Math.round(item.landing.x);
    const y = Math.round(item.landing.y);
    const current = item.geometryVersion === currentGeometryVersion;
    const key = `${x}:${y}:${current ? "current" : "historical"}`;
    const prior = map.get(key);
    if (prior) prior.value++;
    else map.set(key, { id: key, x, y, value: 1, current });
  }
  return bounded([...map.values()].sort((a, b) => b.value - a.value || a.id.localeCompare(b.id)), 180);
}

function dispersionPoints(
  evidence: ArchitectureShotEvidence[],
  currentGeometryVersion: string,
): ArchitectureOverlayPoint[] {
  return bounded(evidence.map((item) => ({
    id: item.id,
    x: item.landing.x,
    y: item.landing.y,
    value: Math.hypot(item.landing.x - item.rest.x, item.landing.y - item.rest.y),
    current: item.geometryVersion === currentGeometryVersion,
  })), 240);
}

function hazardCells(course: Course): ArchitectureOverlayCell[] {
  const cells: ArchitectureOverlayCell[] = [];
  for (let index = 0; index < course.tiles.length; index++) {
    if (!HAZARDS.has(course.tiles[index])) continue;
    cells.push({
      id: `hazard-${index}`,
      x: index % course.width,
      y: Math.floor(index / course.width),
      value: course.tiles[index] === "water" || course.tiles[index] === "wetland" ? 2 : 1,
      current: true,
    });
  }
  return bounded(cells, 300);
}

function walkingTraces(course: Course): ArchitectureOverlayTrace[] {
  return analyzeArchitecture(course).warnings.flatMap((warning) => {
    const points = warning.geometry ?? [];
    return points.slice(1).map((point, index) => ({
      id: `walking-${warning.id}-${index}`,
      from: points[index],
      to: point,
      current: true,
    }));
  });
}

function scoringPoints(course: Course, evidence: ArchitectureShotEvidence[], currentGeometryVersion: string): ArchitectureOverlayPoint[] {
  return course.holes.flatMap((hole) => {
    const point = hole.green ?? hole.tee;
    if (!hole.id || !point) return [];
    const relevant = evidence.filter((item) => item.holeId === hole.id);
    if (!relevant.length) return [];
    const average = relevant.reduce((sum, item) => sum + item.scoreToPar, 0) / relevant.length;
    return [{
      id: `score-${hole.id}`,
      x: point.x,
      y: point.y,
      value: average,
      current: relevant.some((item) => item.geometryVersion === currentGeometryVersion),
      label: `${average > 0 ? "+" : ""}${average.toFixed(1)}`,
    }];
  });
}

function congestionPoints(evidence: ArchitectureShotEvidence[], currentGeometryVersion: string): ArchitectureOverlayPoint[] {
  const byRound = new Map<string, ArchitectureShotEvidence>();
  for (const item of evidence) {
    const prior = byRound.get(item.roundId);
    if (!prior || item.waitMinutes > prior.waitMinutes) byRound.set(item.roundId, item);
  }
  return bounded([...byRound.values()].filter((item) => item.waitMinutes > 0).map((item) => ({
    id: `congestion-${item.roundId}`,
    x: item.from.x,
    y: item.from.y,
    value: item.waitMinutes,
    current: item.geometryVersion === currentGeometryVersion,
    label: `${Math.round(item.waitMinutes)}m`,
  })), 120);
}

export function defaultArchitectureFilters(course: Course): ArchitectureReviewFilters {
  return {
    kind: "traces",
    courseId: course.activeCourseId ?? course.layouts?.[0]?.id ?? "course-primary",
    holeId: "all",
    teeSet: "all",
    sourceSegment: "all",
    recency: "current",
    pinRotation: "A",
    mobilityMode: "all",
  };
}

export function buildArchitectureReview(
  course: Course,
  world: World,
  filters: ArchitectureReviewFilters,
): ArchitectureReviewData {
  const living = normalizeLivingClub(world.livingClub);
  const selectedCourse = courseForLayout(course, filters.courseId);
  const effectiveSelectedCourse = courseWithEffectiveSurfaces(selectedCourse);
  const currentGeometryVersion = courseGeometryVersion(selectedCourse);
  const strategic = buildStrategicPortfolio(selectedCourse, { courseId: filters.courseId });
  const selectedTee = filters.teeSet === "all" ? "member" : filters.teeSet;
  const selectedPin = filters.pinRotation === "all" ? "A" : filters.pinRotation;
  const selectedStrategicHole = filters.holeId === "all"
    ? null
    : strategic.evaluation.holes.find((hole) => hole.holeId === filters.holeId && hole.setup.teeSet === selectedTee && hole.setup.pinRotation === selectedPin) ?? null;
  const selectedTraceId = living.architecture.returnContext?.shotId
    ? living.architecture.evidence.find((item) =>
        item.roundId === living.architecture.returnContext!.roundId &&
        item.id.endsWith(living.architecture.returnContext!.shotId!)
      )?.id ?? null
    : null;
  const evidence = living.architecture.evidence.filter((item) => evidenceFilters(item, filters, currentGeometryVersion, world.week));
  const currentEvidence = evidence.filter((item) => item.geometryVersion === currentGeometryVersion).length;
  const historicalEvidence = evidence.length - currentEvidence;
  const status: ArchitectureReviewData["status"] = evidence.length === 0
    ? living.architecture.evidence.some((item) => item.courseId === filters.courseId) ? "stale-only" : "empty"
    : currentEvidence === 0 ? "stale-only"
      : evidence.length < 8 ? "sparse" : "ready";
  const explanation = status === "empty"
    ? "Play a round on this routing to collect factual shot and scoring evidence."
    : status === "sparse"
      ? "Early evidence is shown, but more rounds will make the pattern more reliable."
      : status === "stale-only"
        ? "Available evidence belongs to an older geometry revision and is never labeled current."
        : "The overlay is backed by retained round evidence for the selected filters.";
  const overlay: ArchitectureOverlayRender = { kind: filters.kind, traces: [], cells: [], points: [] };
  if (filters.kind === "traces") overlay.traces = traces(evidence, currentGeometryVersion, selectedTraceId);
  else if (filters.kind === "dispersion") overlay.points = dispersionPoints(evidence, currentGeometryVersion);
  else if (filters.kind === "heatmap") overlay.cells = landingCells(evidence, currentGeometryVersion);
  else if (filters.kind === "recovery") overlay.traces = traces(evidence, currentGeometryVersion, selectedTraceId, true);
  else if (filters.kind === "scoring") overlay.points = scoringPoints(selectedCourse, evidence, currentGeometryVersion);
  else if (filters.kind === "hazards") overlay.cells = hazardCells(effectiveSelectedCourse);
  else if (filters.kind === "walking") overlay.traces = walkingTraces(selectedCourse);
  else if (filters.kind === "congestion") overlay.points = congestionPoints(evidence, currentGeometryVersion);

  if (filters.kind === "options" || filters.kind === "advantage" || filters.kind === "bailouts" || filters.kind === "carries" || filters.kind === "misses") {
    const selected = selectedStrategicHole
      ? [selectedStrategicHole]
      : strategic.evaluation.holes.filter((hole) => hole.setup.teeSet === selectedTee && hole.setup.pinRotation === selectedPin);
    if (filters.kind === "options") {
      overlay.traces = bounded(selected.flatMap((hole) => hole.options.flatMap((option) => option.geometry.slice(1).map((point, index) => ({ id: `${option.id}-${index}`, from: option.geometry[index], to: point, current: hole.geometryVersion === currentGeometryVersion, emphasized: option.kind === "hero" })) )), 320);
    } else if (filters.kind === "advantage") {
      overlay.points = bounded(selected.flatMap((hole) => hole.cohorts.map((cohort) => ({ id: `${hole.id}-${cohort.cohortId}`, x: hole.options[0]?.location.x ?? 0, y: hole.options[0]?.location.y ?? 0, value: cohort.skillAdvantageDelta, current: true, label: `${cohort.cohortId} ${cohort.skillAdvantageDelta > 0 ? "+" : ""}${cohort.skillAdvantageDelta.toFixed(1)}` }))), 180);
    } else if (filters.kind === "bailouts") {
      overlay.points = bounded(selected.flatMap((hole) => hole.options.filter((option) => option.kind === "safe" || option.kind === "recovery").map((option) => ({ id: option.id, x: option.location.x, y: option.location.y, value: option.bailoutQuality, current: true, label: `${Math.round(option.bailoutQuality * 100)}%` }))), 180);
    } else if (filters.kind === "carries") {
      overlay.points = bounded(selected.flatMap((hole) => hole.options.filter((option) => option.kind === "hero").map((option) => ({ id: option.id, x: option.location.x, y: option.location.y, value: option.forcedCarryBurden, current: true, label: `${Math.round(option.forcedCarryBurden * 100)}%` }))), 180);
    } else {
      overlay.points = bounded(selected.flatMap((hole) => hole.cohorts.map((cohort) => ({ id: `${hole.id}-miss-${cohort.cohortId}`, x: hole.options[0]?.location.x ?? 0, y: hole.options[0]?.location.y ?? 0, value: cohort.recoveryBurden, current: true, label: `${cohort.cohortId} ${Math.round(cohort.recoveryBurden * 100)}%` }))), 180);
    }
  }
  const mobility = filters.kind === "mobility"
    ? buildArchitectureMobilityOverlay({ course: selectedCourse, world, courseId: filters.courseId, modes: filters.mobilityMode === "all" ? ["walk", "pushcart", "riding_cart"] : [filters.mobilityMode] })
    : null;
  if (mobility) Object.assign(overlay, mobility.render);

  const byTee = new Map<string, { total: number; roundIds: Set<string> }>();
  for (const item of evidence) {
    const current = byTee.get(item.teeSet) ?? { total: 0, roundIds: new Set<string>() };
    if (!current.roundIds.has(item.roundId)) current.total += item.scoreToPar;
    current.roundIds.add(item.roundId);
    byTee.set(item.teeSet, current);
  }
  const scoring = [...byTee.entries()].map(([teeSet, item]) => ({
    teeSet,
    rounds: item.roundIds.size,
    averageToPar: item.roundIds.size ? Number((item.total / item.roundIds.size).toFixed(2)) : 0,
  }));
  const rules = buildArchitectureRulesReview({
    course: effectiveSelectedCourse,
    world,
    evidence,
    currentGeometryVersion,
    strategicHoles: selectedStrategicHole ? [selectedStrategicHole] : strategic.evaluation.holes,
  });
  return {
    currentGeometryVersion,
    filters,
    evidence,
    currentEvidence,
    historicalEvidence,
    status,
    explanation,
    overlay,
    revisions: living.architecture.revisions
      .filter((item) => item.courseId === filters.courseId)
      .sort((a, b) => b.lastWeek - a.lastWeek || a.geometryVersion.localeCompare(b.geometryVersion)),
    scoring,
    sourceSegments: [...new Set(living.architecture.evidence.filter((item) => item.courseId === filters.courseId).map((item) => item.sourceSegment))].sort(),
    selectedTraceId,
    strategic,
    recommendations: buildStrategicRecommendations(
      selectedCourse,
      strategic,
      terrainCostMult(world.difficulty),
    ),
    selectedStrategicHole,
    comparison: living.architecture.comparison ?? null,
    rules,
    mobility: mobility?.mobility ?? null,
  };
}
