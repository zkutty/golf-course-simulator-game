import { computeCourseRatingAndSlope, computeRatingsByTee } from "../game/sim/courseRating";
import { evaluateTournamentCourseQualification } from "../game/tournaments/eligibility";
import { surfaceCareConditionSummary, observedSurfaceCareEvidence } from "../game/conditions/surfaceCare";
import { greenKeepingOverview } from "../game/greens/greenMaintenance";
import { surfaceCarePresentationSummary } from "../game/render/surfaceCarePresentation";
import type { GameState } from "../game/gameState";
import type { Course } from "../game/models/types";
import type { GameSession } from "../game/session";
import type { SurfaceCareVisualQuality } from "../game/render/surfaceCarePresentation";
export interface CourseTextCaptureV1 {
  session: Pick<GameSession, "getState" | "revision">;
  capturedState: GameState;
  persistedCourse: Course;
  capturedWorld: GameState["world"];
  activeOperatingCourse: Course;
  operatingLayoutId: string;
  selectedTeeSet: string;
  activePinRotation: string;
  outputMode: "normal" | "validate-hole";
  quality: SurfaceCareVisualQuality;
  presentationSeed: number;
  presentationReducedMotion: boolean;
}
function ratingPart({ persistedCourse: course, activeOperatingCourse }: CourseTextCaptureV1) {
  const hasExpandedSetup = course.holes.some((hole) => hole.teeBoxes?.forward || hole.teeBoxes?.championship || hole.pinPositions?.B || hole.pinPositions?.C);
  const textMemberRating = computeCourseRatingAndSlope(activeOperatingCourse);
  const tournamentReadiness = Object.fromEntries((["local", "regional", "championship"] as const).map((tier) => {
    const result = evaluateTournamentCourseQualification(activeOperatingCourse, tier);
    return [tier, { eligible: result.eligible, teeSet: result.teeSet, pinRotation: result.pinRotation, rating: result.rating, slope: result.slope, completeRotations: result.completeRotations, blockers: result.requirements.filter((item) => !item.passed).map((item) => ({ id: item.id, current: item.current, required: item.required })) }];
  }));
  const textTeeRatings = hasExpandedSetup
    ? computeRatingsByTee(activeOperatingCourse)
    : {
      forward: { courseRating: 0, slope: 55, effectiveYardage: 0, setupComplete: false, rotationDeltas: {} },
      member: { courseRating: textMemberRating.courseRating, slope: textMemberRating.slope, effectiveYardage: 0, setupComplete: false, rotationDeltas: {} },
      championship: { courseRating: 0, slope: 55, effectiveYardage: 0, setupComplete: false, rotationDeltas: {} },
    };
  return { teeRatings: Object.fromEntries(Object.entries(textTeeRatings).map(([teeSet, summary]) => [teeSet, { rating: summary.courseRating, slope: summary.slope, yardage: summary.effectiveYardage, complete: summary.setupComplete, deltas: summary.rotationDeltas }])), tournamentReadiness };
}
function carePart({ persistedCourse: course, capturedWorld: world, quality, presentationSeed, presentationReducedMotion: reducedMotion }: CourseTextCaptureV1) {
  const textSurfaceCareSummary = surfaceCareConditionSummary(course);
  const textGreenKeeping = greenKeepingOverview(course, world);
  const textSurfaceCareEvidence = observedSurfaceCareEvidence(course);
  const textSurfaceCarePresentation = surfaceCarePresentationSummary({
    course,
    quality: quality,
    seed: presentationSeed,
    reducedMotion: reducedMotion,
  });
  return { condition: textSurfaceCareSummary, presentation: textSurfaceCarePresentation, evidence: textSurfaceCareEvidence.map((zone) => ({
      key: zone.key,
      surfaceId: zone.surfaceId,
      cell: [zone.cellX, zone.cellY],
      terrain: zone.terrain,
      tiles: zone.tiles,
      effectiveTerrain: zone.effectiveTerrain,
      turfHealth: zone.turfHealth,
      mowingQuality: zone.mowingQuality,
      moisture: zone.moisture,
      wear: zone.wear,
      serviceRatio: zone.serviceRatio,
      repairRequired: zone.repairRequired,
      action: zone.action,
    })), greenKeeping: { explicitAdvancedControls: textGreenKeeping.explicitAdvancedControls,
      realized: {
        speedFeet: textGreenKeeping.realizedSpeedFeet,
        firmness: textGreenKeeping.realizedFirmness,
        health: textGreenKeeping.averageHealth,
        moisture: textGreenKeeping.averageMoisture,
        compaction: textGreenKeeping.averageCompaction,
        wear: textGreenKeeping.averageWear,
      },
      delivery: {
        requiredWeeklyBudget: textGreenKeeping.requiredWeeklyBudget,
        allocatedDailyBudget: textGreenKeeping.allocatedDailyBudget,
        requiredDailyBudget: textGreenKeeping.requiredDailyBudget,
        staffCoverage: textGreenKeeping.staffCoverage,
      },
      tradeoffs: {
        paceMinutesDelta: textGreenKeeping.paceMinutesDelta,
        satisfactionDelta: textGreenKeeping.satisfactionDelta,
      },
    } };
}
export interface CourseTextReportV1 {
  readonly ratings: ReturnType<typeof ratingPart>;
  readonly care: ReturnType<typeof carePart>;
}
// Copy only the thin, plain-data projection. Preserve sparse arrays, undefined,
// non-finite numbers and key order until the existing final JSON.stringify.
function detached<T>(value: T): T {
  if (value === null || typeof value !== "object")
    return value;
  const copy = (Array.isArray(value) ? new Array(value.length) : {}) as T;
  for (const key of Object.keys(value)) {
    Object.defineProperty(copy, key, {
      value: detached((value as Record<string, unknown>)[key]),
      enumerable: true, writable: true, configurable: true,
    });
  }
  return Object.freeze(copy);
}
type PrimitiveKey = readonly (string | number | boolean)[];
function key(capture: CourseTextCaptureV1, revision: number): PrimitiveKey {
  return [revision, capture.operatingLayoutId, capture.selectedTeeSet,
    capture.activePinRotation, capture.outputMode, capture.quality,
    capture.presentationSeed, capture.presentationReducedMotion];
}
function coherent(capture: CourseTextCaptureV1, revision: number): boolean {
  return capture.session.revision === revision &&
    capture.session.getState() === capture.capturedState &&
    capture.persistedCourse === capture.capturedState.course &&
    capture.capturedWorld === capture.capturedState.world;
}
/** One App/session-owned completed projection; transactions never become owners. */
export class CourseTextReportOwner {
  private latest: {
    key: PrimitiveKey;
    report: CourseTextReportV1;
  } | undefined;
  private generation = 0;
  private readonly session: CourseTextCaptureV1["session"];
  constructor(session: CourseTextCaptureV1["session"]) {
    this.session = session;
  }
  clear = (): void => {
    this.latest = undefined;
    this.generation++;
  };
  prepareRatingPart(capture: CourseTextCaptureV1) {
    const revision = capture.session.revision;
    const generation = this.generation;
    const candidateKey = key(capture, revision);
    const fresh = capture.session === this.session && coherent(capture, revision);
    const hit = fresh && this.latest?.key.every((value, index) => Object.is(value, candidateKey[index]))
      ? this.latest.report : undefined;
    const ratings = hit?.ratings ?? detached(ratingPart(capture));
    let completed: CourseTextReportV1 | undefined;
    return {
      ratings,
      // App must still capture fresh live telemetry between these two stages.
      finishCarePart: (): CourseTextReportV1 => {
        if (completed)
          return completed;
        completed = hit ?? Object.freeze({ ratings, care: detached(carePart(capture)) });
        if (fresh && generation === this.generation && coherent(capture, revision)) {
          this.latest = { key: candidateKey, report: completed };
        }
        return completed;
      },
    };
  }
}
