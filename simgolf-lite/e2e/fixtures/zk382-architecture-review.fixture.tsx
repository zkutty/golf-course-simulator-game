import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { I18nProvider } from "../../src/i18n/I18nProvider";
import { ArchitectureReviewPanel } from "../../src/ui/ArchitectureReviewPanel";
import type { ArchitectureReviewData, ArchitectureReviewFilters } from "../../src/game/architecture/review";
import type { M48StrategicHoleEvaluation } from "../../src/game/architecture/m48Types";
import { createM26MultiCourseReferenceCourse } from "../../src/game/testing/referenceCourse";
import "../../src/index.css";

export type ReviewMode = "empty" | "current" | "historical" | "reference-absent" | "reference-selected" | "green-loading" | "green-ready" | "mobility";
export type ReviewCall = { type: "filters"; filters: ArchitectureReviewFilters } | { type: "jump"; point: { x: number; y: number }; holeId?: string } | { type: "practice"; courseId: string } | { type: "close" };
export interface ReviewFixture { state: () => ArchitectureReviewData; calls: () => ReviewCall[]; reset: (mode: ReviewMode) => ArchitectureReviewData; practiceReason: (reason: string | null) => void }
declare global { interface Window { __architectureFixture: ReviewFixture } }
const longName = "Willow_Creek_Championship_Course_With_An_Extraordinarily_Long_Authored_Name";
const baseCourse = createM26MultiCourseReferenceCourse();
const course = { ...baseCourse, holes: baseCourse.holes.map(hole => ({ ...hole, name: longName })), layouts: baseCourse.layouts!.map(layout => ({ ...layout, name: longName })) };
const holeId = course.holes[0].id!;
const overlay = { kind: "traces" as const, cells: [], traces: [], points: [] };
const strategicHole: M48StrategicHoleEvaluation = {
  version: 1, id: "strategic-hole", holeId, holeIndex: 0, setup: { teeSet: "member", pinRotation: "A", usedTeeFallback: false, usedPinFallback: false }, geometryVersion: "current-geometry", status: "complete", sampleCount: 8,
  safeRouteViability: 76, optionCount: 2, forcedCarryBurden: 12, bailoutQuality: 63, heroLineReward: 44, expectedStrokes: 4.23, variance: 0.8, recoveryBurden: 9, visualChallenge: 55, fairnessFloor: 72, strategicSeparation: 31, unavoidablePunishment: 8,
  cohorts: ["power", "accuracy", "shortGame", "recovery", "casual"].map((cohortId, index) => ({ cohortId: cohortId as "power", viability: 75 + index, preferredOption: index === 4 ? null : "safe", expectedStrokes: 4.12 + index / 10, variance: 0.8, recoveryBurden: 12, skillAdvantageDelta: 2, options: [], facts: [] })),
  options: [{ id: "safe-option", kind: "safe", label: "Authored safe option", geometry: [], location: { x: 23, y: 31 }, viable: true, safeSurface: 76, hazardRisk: 12, forcedCarryBurden: 12, bailoutQuality: 63, heroLineReward: 44, expectedStrokes: 4.23, variance: 0.8, recoveryBurden: 9, sampleCount: 8, sampleStatus: "simulated", facts: [] }], warnings: [],
};
function data(mode: ReviewMode): ArchitectureReviewData {
  const empty = mode === "empty";
  const historical = mode === "historical";
  const kind = mode.startsWith("reference") ? "reference" : mode.startsWith("green") ? "green-preferred" : mode === "mobility" ? "mobility" : "traces";
  const filters: ArchitectureReviewFilters = { kind, courseId: "north", holeId: mode === "reference-absent" ? "all" : holeId, teeSet: "member", pinRotation: "A", sourceSegment: "all", recency: "current", cohortId: "all", mobilityMode: "all" };
  const evidence = empty ? [] : Array.from({ length: 7 }, (_, index) => ({ id: `evidence-${index}`, source: "regular" as const, sourceSegment: "Long_Authored_Practice_Segment_With_Extra_Detail", golferId: `golfer-${index}`, golferName: longName, roundId: "round-exact", week: 10, day: 2, courseId: "north", courseName: longName, holeId, teeSet: "member" as const, pinRotation: "A" as const, geometryVersion: historical || index === 5 ? "old-geometry" : "current-geometry", shotType: "approach" as const, shotNumber: 2, from: { x: 2, y: 3 }, landing: { x: 11, y: 14 }, rest: { x: 20 + index, y: 30 + index }, scoreToPar: 2, waitMinutes: 3 }));
  const revisions = empty ? [] : ["current-geometry", "old-geometry", "older-geometry"].map((geometryVersion, index) => ({ id: `revision-${index}`, geometryVersion, courseId: "north", courseName: longName, firstWeek: 3, lastWeek: 12 - index, rounds: 10 + index, shots: 53 + index, averageToPar: index === 0 ? -1.5 : 2.75 + index, architectureScore: 72, holeIds: [holeId] }));
  const review: ArchitectureReviewData = {
    currentGeometryVersion: "current-geometry", filters, evidence, currentEvidence: empty || historical ? 0 : 6, historicalEvidence: empty ? 0 : historical ? 7 : 1, status: empty ? "empty" : historical ? "stale-only" : "ready", explanation: "Authored explanation: every measured value and qualifier must remain reachable, including retained historical geometry and current evidence scope.", overlay, revisions, scoring: empty ? [] : [{ teeSet: longName, rounds: 23, averageToPar: 2.75 }], sourceSegments: ["Long_Authored_Practice_Segment_With_Extra_Detail", "members"], selectedTraceId: "evidence-6",
    strategic: { evaluation: { version: 1, geometryVersion: "current-geometry", courseId: "north", conditionKey: 1, samplesPerOption: 8, holes: [strategicHole], cohorts: [] }, holes: [], summary: { total: 74, fairnessFloor: 72, strategicSeparation: 31, genuineChoice: 66, spectacleWithMercy: 56, opportunityRotation: 81, penalties: { funnelGreens: 0, fakeChoices: 0, mandatoryCarries: 0, hazardSpam: 0, repetitiveStrategy: 0, oneCohortDominance: 0 }, favoredCohorts: { power: 1, accuracy: 2, shortGame: 3, recovery: 4, casual: 5 }, holeCount: 18 } },
    selectedStrategicHole: empty ? null : strategicHole, recommendations: empty ? [] : [{ id: "recommendation-exact", kind: "widen-bailout", holeId, titleKey: "architecture.recommendation.widenBailout.title", detailKey: "architecture.recommendation.widenBailout.body", location: { x: 41, y: 42 }, affectedCohorts: ["casual"], failingMetric: "safeRouteViability", currentValue: 45, expectedDirection: "up", constructionCost: 123, upkeepDelta: 4.5, confidence: 0.86, sampleStatus: "simulated" }],
    comparison: empty ? null : { beforeGeometryVersion: "old-geometry", afterGeometryVersion: "current-geometry", changed: true, targetCohort: "casual", targetExpectedStrokesDelta: -0.4, fairnessFloorDelta: 12, optionCountDelta: 1, safeRouteViabilityDelta: 8, strategicSeparationDelta: -3, excludedCohorts: ["power", "recovery"], evidenceLabel: historical ? "historical" : "current", explanation: "Generated comparison explanation with exact retained before and after values, exclusions, and provisional qualifications." },
    rules: { evidence: [], currentEvidence: 6, historicalEvidence: 1, penaltyCount: 3, obstacleCollisionCount: 2, recoveryAttemptCount: 4, reliefResolvedCount: 2, feedback: empty ? [] : [{ id: "rule-warning", level: "warning", message: "Authored warning: retained penalty area requires relief; geometry was historical." }, { id: "rule-advice", level: "advice", message: "Authored advice: recovery attempts and resolved relief retain all qualifiers." }] },
    mobility: mode === "mobility" ? { evidence: "predicted", modes: ["walk", "pushcart", "riding_cart"], weather: "cart_path_only", transfers: 17, inaccessibleDestinations: [{ id: "destination", mode: "riding_cart", reason: "unreachable" }], missingLinkWarnings: ["Authored missing link warning with a long destination identifier and complete route reason."], pathUtilization: 0.87 } : null,
    greenStrategy: mode === "green-ready" ? { version: 1, evidenceSource: "forecast-and-observed", forecastGeometryVersion: "current-geometry", observedGeometryVersions: [], maintenanceProgram: longName, selectedCohorts: ["power"], selectedPins: ["A"], predictiveSamples: 83, observedCurrent: 6, observedHistorical: 7, overlay, report: { attackExpectedPutts: 1.82, safeExpectedPutts: null, approachAdvantage: 0.42, shortSidePunishment: 0.37, rotationVariety: 0.81, cohortSeparation: 0.29, unfairness: 0.12, preferredTargets: 3, observedShots: 13 }, recommendations: [{ id: "green-warning", kind: "open-safe-zone", holeId, location: { x: 51, y: 52 }, severity: "warning", titleKey: "architecture.recommendation.widenBailout.title", detailKey: "architecture.recommendation.widenBailout.body", metric: 0.4 }, { id: "green-advice", kind: "reward-cohorts", holeId, location: { x: 61, y: 62 }, severity: "advice", titleKey: "architecture.recommendation.widenBailout.title", detailKey: "architecture.recommendation.widenBailout.body", metric: 0.2 }], legend: ["forecast", "observed-current", "observed-historical", "risk"].map((id, index) => ({ id: id as "forecast", label: id, pattern: ["dots", "cross", "diagonal", "solid"][index] as "dots", meaning: id })), textSummary: "Generated complete green summary: predictive samples, retained historical observations, safe-zone putts unavailable, and cohort separation remain intact.", reducedMotionSafe: true } : null,
    referencePlans: [], selectedReferencePlan: null, referenceSummary: null,
    returnToDesign: empty ? null : { roundId: "return-round", shotId: "return-shot", holeId, courseId: "north", geometryVersion: historical ? "old-geometry" : "current-geometry", point: { x: 71, y: 72 }, openedWeek: 10 },
  };
  if (mode === "reference-selected") {
    review.selectedReferencePlan = { id: "reference-exact", version: "1", holeId, teeSet: "member", pinRotation: "A", tee: { x: 2, y: 3 }, pin: { x: 40, y: 50 }, capability: { teeSet: "member", teeCarryYards: 237, teeTotalYards: 252, approachCarryYards: 172, dispersionTiles: 3.6, riskTolerance: 0.48 }, status: "complete", selectedPar: 4, recommendedPar: 5, alternativePar: 4, planPar: 5, fullShots: 3, expectedPutts: 2, effectiveYardage: 517, segments: [], landingZones: [], warnings: ["Authored reference warning with complete carry burden and effective-yardage qualification."], explanation: "Generated reference explanation: 3 full shots + 2 expected putts, effective yardage 517 with all original setup assumptions.", corridor: {} as NonNullable<ArchitectureReviewData["selectedReferencePlan"]>["corridor"] };
    review.referencePlans = [review.selectedReferencePlan!];
    review.referenceSummary = { teeSet: "member", pinRotation: "A", architectureScore: 72, safetyScore: 83, courseRating: 73.4, slope: 128, effectiveYardage: 6501 };
  }
  return review;
}
export function Fixture() {
  const [review, setReview] = useState(() => data("current"));
  const [open, setOpen] = useState(true);
  const [generation, setGeneration] = useState(0);
  const calls = useRef<ReviewCall[]>([]);
  const reason = useRef<string | null>(null);
  useEffect(() => { window.__architectureFixture = { state: () => structuredClone(review), calls: () => structuredClone(calls.current), reset: mode => { const next = data(mode); calls.current = []; setReview(next); setOpen(true); setGeneration(value => value + 1); return structuredClone(next); }, practiceReason: value => { reason.current = value; } }; }, [review]);
  return <><button data-testid="outside-before">Outside before</button>{open && <ArchitectureReviewPanel key={generation} course={course} review={review} onFilters={filters => { calls.current.push({ type: "filters", filters: structuredClone(filters) }); setReview(previous => ({ ...previous, filters })); }} onJump={(point, holeId) => { calls.current.push({ type: "jump", point, holeId }); }} onPracticeRound={async courseId => { calls.current.push({ type: "practice", courseId }); return reason.current; }} onClose={() => { calls.current.push({ type: "close" }); setOpen(false); }} />}<button data-testid="outside-after" style={{ position: "fixed", left: 8, bottom: 8 }}>Outside after</button></>;
}
createRoot(document.getElementById("root")!).render(<I18nProvider><Fixture /></I18nProvider>);
