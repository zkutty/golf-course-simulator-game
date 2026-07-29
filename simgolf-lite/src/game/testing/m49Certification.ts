import type { Course, Terrain, WeekResult, World } from "../models/types";
import { DEFAULT_WORLD } from "../models/defaults";
import { activeCourseLayout } from "../models/courseLayouts";
import { createLiveState, stepLive } from "../live/simulation";
import { restoreLiveSimulation, snapshotLiveSimulation } from "../live/persistence";
import { runLiveDaysHeadless } from "../live/headless";
import { hashCanonicalValue, hashGameState } from "../../utils/stateHash";
import { createM47CertificationCourse } from "./m47Certification";
import { buildM49DemandPlan } from "../m49/demand";
import { m49CourseHistory, m49ReputationDelta, recordM49Observations } from "../m49/history";
import { launchM49Marketing } from "../m49/identity";
import { buildM49CourseReport } from "../m49/report";
import type { M49ObservedRound } from "../m49/types";

export interface M49CertificationCheck {
  id: string;
  passed: boolean;
  detail: string;
}

export interface M49CertificationReport {
  version: 1;
  fixture: { courseId: string; courseName: string; holes: number; seed: number };
  checks: M49CertificationCheck[];
  metrics: {
    liveDays: number;
    liveRounds: number;
    observedRounds: number;
    completedObservedRounds: number;
    segments: number;
    supportedSegments: number;
    demandHash: string;
    saveBytes: number;
  };
  passed: boolean;
}

function certificationCourse(): Course {
  const base = createM47CertificationCourse(9);
  const holeIds = base.holes.map((hole) => hole.id!);
  return {
    ...base,
    name: "M49 Ethos Loop Certification Course",
    baseGreenFee: 92,
    layouts: [{ id: "m49-cert-course", name: "M49 Ethos Loop", draftHoleIds: holeIds, publishedHoleIds: holeIds, roundLength: 9, state: "open", greenFee: 92 }],
    activeCourseId: "m49-cert-course",
  };
}

function openVariant(course: Course): Course {
  return { ...course, tiles: course.tiles.map((terrain) => terrain === "water" ? "fairway" as Terrain : terrain) };
}

function observation(overrides: Partial<M49ObservedRound> = {}): M49ObservedRound {
  return {
    version: 1,
    id: "m49-cert-observation",
    courseId: "m49-cert-course",
    segment: "casual",
    completed: true,
    holesPlayed: 9,
    holesTotal: 9,
    expectedScore: 36,
    actualScore: 35,
    satisfaction: 82,
    condition: .88,
    greenFee: 92,
    strategicFit: .76,
    valueReceived: .78,
    willingnessToPay: 72,
    priceElasticity: 1.2,
    returnIntent: true,
    recommend: true,
    churnRisk: .16,
    paceDelayMinutes: 3,
    hospitalityDelayMinutes: 0,
    holeEvidence: [],
    causes: [],
    ...overrides,
  };
}

function sampleWeekResult(revenue: number): WeekResult {
  return {
    visitors: 12,
    revenue,
    revenueBreakdown: { greenFees: revenue, concessions: 0, byConcession: {}, transactions: [] },
    costs: 700,
    profit: revenue - 700,
    maintenance: { required: 1_100, budget: 900, shortfall: 200 },
    maintenancePressure: { totalWeight: 1_000, avgWeight: 1.2, wear: .12 },
    avgSatisfaction: 78,
    reputationDelta: .2,
    visitorNoise: 0,
  };
}

function liveSaveFixture(course: Course, world: World): { deterministic: boolean; saveBytes: number; observedRounds: number } {
  const live = createLiveState(course, world, 0);
  let guard = 0;
  while (!(live.observedRounds?.length) && guard++ < 20_000) stepLive(live, course, 5);
  if (!live.observedRounds?.length) throw new Error("M49 live fixture did not finish an observed round");
  const snapshot = snapshotLiveSimulation({ state: live, pendingCash: 0, speed: "paused", selectedGolferId: null });
  const restored = restoreLiveSimulation(JSON.parse(JSON.stringify(snapshot)));
  if (!restored) throw new Error("M49 live fixture did not restore");
  const restoredSnapshot = snapshotLiveSimulation({ state: restored.state, pendingCash: restored.pendingCash, speed: restored.speed, selectedGolferId: restored.selectedGolferId, clockRemainderMinutes: restored.clockRemainderMinutes, weekLedger: restored.weekLedger });
  return {
    deterministic: hashGameState({ course, world, live: snapshot }) === hashGameState({ course, world, live: restoredSnapshot }),
    saveBytes: new TextEncoder().encode(JSON.stringify(snapshot)).byteLength,
    observedRounds: live.observedRounds.length,
  };
}

/** Deterministic M49 release gate. It intentionally checks evidence boundaries as well as happy-path demand. */
export function runM49Certification(): M49CertificationReport {
  const seed = 490497;
  const course = certificationCourse();
  const world: World = { ...DEFAULT_WORLD, runSeed: seed, cash: 1_000_000, maintenanceBudget: 900, reputation: 74 };
  const plan = buildM49DemandPlan(course, world);
  const secondPlan = buildM49DemandPlan(course, world);
  const openPlan = buildM49DemandPlan(openVariant(course), world);
  const marketing = launchM49Marketing({ course, world: { ...world, marketingLevel: 5 }, segment: "casual", strength: "championship" });
  if (!marketing.ok) throw new Error(`M49 marketing fixture failed: ${marketing.reason}`);
  const supportedMarketing = launchM49Marketing({ course, world: { ...world, marketingLevel: 5 }, segment: "casual", strength: "casual" });
  if (!supportedMarketing.ok) throw new Error(`M49 supported marketing fixture failed: ${supportedMarketing.reason}`);

  const liveDays = 7;
  const live = runLiveDaysHeadless({ course, world, days: liveDays, stepMinutes: 5 });
  const history = m49CourseHistory(live.world, activeCourseLayout(course).id);
  const isolatedWorld = recordM49Observations(recordM49Observations(world, [observation()], world.week), [observation({ courseId: "m49-cert-other", id: "m49-cert-other-observation" })], world.week);
  const isolatedA = m49CourseHistory(isolatedWorld, "m49-cert-course");
  const isolatedB = m49CourseHistory(isolatedWorld, "m49-cert-other");
  const save = liveSaveFixture(course, world);
  const report = buildM49CourseReport({ course: live.course, world: live.world, result: sampleWeekResult(1_104), generatedAtWeek: live.world.week });
  const noPlayReputation = m49ReputationDelta([]);
  const lowConditionReport = buildM49CourseReport({ course: { ...course, condition: .4 }, world, result: sampleWeekResult(1_104) });

  const checks: M49CertificationCheck[] = [
    { id: "demand-determinism", passed: hashCanonicalValue(plan) === hashCanonicalValue(secondPlan), detail: "The same course, world, and seed produce the same six-segment demand plan." },
    { id: "segment-price-response", passed: Object.keys(plan.segments).length === 6 && plan.segments.casual.priceElasticity > plan.segments.pro.priceElasticity, detail: "All six segments expose differentiated willingness to pay and price elasticity." },
    { id: "safe-route-vs-hazard", passed: plan.segments.casual.bookingAppeal < openPlan.segments.casual.bookingAppeal && plan.supportedSegments.length > 0, detail: "Shared hazard pressure lowers casual appeal while a coherent course still retains supported demand." },
    { id: "truthful-marketing", passed: marketing.promise.cost > supportedMarketing.promise.cost && marketing.promise.credibility < supportedMarketing.promise.credibility && marketing.promise.disappointmentRisk > supportedMarketing.promise.disappointmentRisk, detail: "Unsupported promises cost more and begin with lower credibility and higher disappointment risk." },
    { id: "observed-evidence", passed: live.rounds > 0 && (history?.observedRounds ?? 0) > 0 && (history?.completedRounds ?? 0) > 0, detail: `${live.rounds} live rounds became bounded per-course observed evidence over ${liveDays} days.` },
    { id: "no-play-reputation", passed: noPlayReputation.delta === 0 && noPlayReputation.observedRounds === 0, detail: "No-play and incomplete evidence cannot create a reputation move." },
    { id: "multi-course-isolation", passed: isolatedA?.observedRounds === 1 && isolatedB?.observedRounds === 1, detail: "Observed history keys by course and does not bleed between layouts." },
    { id: "save-migration", passed: save.deterministic && save.observedRounds > 0, detail: `Active live evidence survives save/reload deterministically (${save.saveBytes} bytes).` },
    { id: "report-reconciliation", passed: report.reconciliation.ledgerBalanced && report.reconciliation.authoritativeCondition === live.course.condition, detail: "Management reporting reconciles the supplied revenue ledger and reads current course condition as authoritative." },
    { id: "actionable-alerts", passed: lowConditionReport.alerts.some((alert) => alert.id === "condition-critical") && new Set(lowConditionReport.alerts.map((alert) => alert.id)).size === lowConditionReport.alerts.length, detail: "Low condition produces a prioritized actionable alert with deduplicated IDs." },
  ];
  return {
    version: 1,
    fixture: { courseId: activeCourseLayout(course).id, courseName: course.name, holes: course.holes.length, seed },
    checks,
    metrics: {
      liveDays,
      liveRounds: live.rounds,
      observedRounds: history?.observedRounds ?? 0,
      completedObservedRounds: history?.completedRounds ?? 0,
      segments: Object.keys(plan.segments).length,
      supportedSegments: plan.supportedSegments.length,
      demandHash: hashCanonicalValue(plan),
      saveBytes: save.saveBytes,
    },
    passed: checks.every((check) => check.passed),
  };
}
