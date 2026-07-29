import type { Course, PinRotation, TeeSet } from "../models/types";
import { courseForLayout } from "../models/courseLayouts";
import { hashCanonicalValue } from "../../utils/stateHash";
import { evaluateStrategicArchitecture, strategicGeometryVersion, strategicHoleForSetup } from "./strategic";
import type { M48CohortId, M48DesignComparison, M48DesignTestSession } from "./m48Types";

const clamp = (value: number, min = 0, max = 100) => Math.max(min, Math.min(max, value));
const round = (value: number, digits = 1) => Number(value.toFixed(digits));

export function createM48DesignTestSession(args: {
  course: Course;
  courseId?: string;
  holeId: string;
  teeSet?: TeeSet;
  pinRotation?: PinRotation;
  week: number;
  seed?: number;
}): M48DesignTestSession | null {
  const course = courseForLayout(args.course, args.courseId ?? args.course.activeCourseId);
  const teeSet = args.teeSet ?? "member";
  const pinRotation = args.pinRotation ?? "A";
  const evaluation = evaluateStrategicArchitecture(course, { courseId: course.activeCourseId, seed: args.seed });
  const before = strategicHoleForSetup(evaluation, args.holeId, teeSet, pinRotation);
  if (!before || before.status !== "complete") return null;
  const geometryVersion = strategicGeometryVersion(course);
  const seed = args.seed ?? Number.parseInt(hashCanonicalValue({ geometryVersion, holeId: args.holeId, teeSet, pinRotation }).slice(0, 8), 16);
  return {
    version: 1,
    id: `m48-test-${hashCanonicalValue({ courseId: course.activeCourseId, holeId: args.holeId, teeSet, pinRotation, geometryVersion, seed })}`,
    courseId: course.activeCourseId ?? "course-primary",
    holeId: args.holeId,
    teeSet,
    pinRotation,
    geometryVersion,
    conditionKey: Math.round(clamp(course.condition, 0, 1) * 100),
    startedWeek: Math.max(1, Math.floor(args.week)),
    seed: seed >>> 0,
    noEconomy: true,
    stage: "designed",
    selectedCohortId: null,
    selectedShotId: null,
    before,
  };
}

export function normalizeM48DesignTestSession(raw: unknown): M48DesignTestSession | null {
  if (!raw || typeof raw !== "object") return null;
  const candidate = raw as Partial<M48DesignTestSession>;
  if (candidate.version !== 1 || typeof candidate.id !== "string" || typeof candidate.courseId !== "string" || typeof candidate.holeId !== "string" || typeof candidate.geometryVersion !== "string") return null;
  if (candidate.teeSet !== "forward" && candidate.teeSet !== "member" && candidate.teeSet !== "championship") return null;
  if (candidate.pinRotation !== "A" && candidate.pinRotation !== "B" && candidate.pinRotation !== "C") return null;
  const stage = candidate.stage === "watched" || candidate.stage === "played" || candidate.stage === "returned" || candidate.stage === "compared" ? candidate.stage : "designed";
  return {
    version: 1,
    id: candidate.id,
    courseId: candidate.courseId,
    holeId: candidate.holeId,
    teeSet: candidate.teeSet,
    pinRotation: candidate.pinRotation,
    geometryVersion: candidate.geometryVersion,
    conditionKey: typeof candidate.conditionKey === "number" ? Math.max(0, Math.min(100, Math.round(candidate.conditionKey))) : 0,
    startedWeek: typeof candidate.startedWeek === "number" ? Math.max(1, Math.floor(candidate.startedWeek)) : 1,
    seed: typeof candidate.seed === "number" ? candidate.seed >>> 0 : 0,
    noEconomy: true,
    stage,
    selectedCohortId: candidate.selectedCohortId ?? null,
    selectedShotId: candidate.selectedShotId ?? null,
    before: candidate.before,
    after: candidate.after,
  };
}

export function advanceM48DesignTestSession(session: M48DesignTestSession, stage: M48DesignTestSession["stage"], selection: { cohortId?: M48CohortId | null; shotId?: string | null } = {}): M48DesignTestSession {
  return { ...session, stage, selectedCohortId: selection.cohortId === undefined ? session.selectedCohortId : selection.cohortId, selectedShotId: selection.shotId === undefined ? session.selectedShotId : selection.shotId };
}

export function refreshM48DesignTestSession(args: { course: Course; session: M48DesignTestSession }): M48DesignTestSession {
  const evaluation = evaluateStrategicArchitecture(args.course, { courseId: args.session.courseId, seed: args.session.seed });
  const after = strategicHoleForSetup(evaluation, args.session.holeId, args.session.teeSet, args.session.pinRotation);
  return { ...args.session, after, stage: after ? "returned" : args.session.stage };
}

export function compareM48DesignTest(session: M48DesignTestSession): M48DesignComparison | null {
  if (!session.before || !session.after) return null;
  const before = session.before;
  const after = session.after;
  const target = session.selectedCohortId;
  const beforeTarget = target ? before.cohorts.find((cohort) => cohort.cohortId === target) : undefined;
  const afterTarget = target ? after.cohorts.find((cohort) => cohort.cohortId === target) : undefined;
  const excludedCohorts = after.cohorts.filter((cohort) => {
    const prior = before.cohorts.find((candidate) => candidate.cohortId === cohort.cohortId);
    return !!prior && cohort.viability < prior.viability - 10;
  }).map((cohort) => cohort.cohortId);
  const expectedDelta = beforeTarget && afterTarget ? round(afterTarget.expectedStrokes - beforeTarget.expectedStrokes, 2) : null;
  const fairnessDelta = round(after.fairnessFloor - before.fairnessFloor);
  const optionDelta = after.optionCount - before.optionCount;
  const safeDelta = round(after.safeRouteViability - before.safeRouteViability);
  const separationDelta = round(after.strategicSeparation - before.strategicSeparation);
  return {
    beforeGeometryVersion: before.geometryVersion,
    afterGeometryVersion: after.geometryVersion,
    changed: before.geometryVersion !== after.geometryVersion,
    targetCohort: target,
    targetExpectedStrokesDelta: expectedDelta,
    fairnessFloorDelta: fairnessDelta,
    optionCountDelta: optionDelta,
    safeRouteViabilityDelta: safeDelta,
    strategicSeparationDelta: separationDelta,
    excludedCohorts,
    evidenceLabel: session.stage === "compared" ? "current" : "provisional",
    explanation: excludedCohorts.length
      ? `${excludedCohorts.join(", ")} lost viability after the revision; inspect the bailout before committing the change.`
      : target && expectedDelta !== null
        ? `${target} moved ${expectedDelta > 0 ? "+" : ""}${expectedDelta.toFixed(2)} expected strokes with a ${fairnessDelta > 0 ? "+" : ""}${fairnessDelta.toFixed(1)} fairness-floor change.`
        : `The revision changed ${optionDelta >= 0 ? "+" : ""}${optionDelta} meaningful option${Math.abs(optionDelta) === 1 ? "" : "s"} and ${safeDelta >= 0 ? "+" : ""}${safeDelta.toFixed(1)} safe-route viability.`,
  };
}

export function markM48Comparison(session: M48DesignTestSession): M48DesignTestSession {
  return session.after ? { ...session, stage: "compared" } : session;
}
