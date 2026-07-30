import type { Course, World } from "../models/types";
import { activeCourseLayout } from "../models/courseLayouts";
import { scoreCourseHoles } from "../sim/holes";
import { buildStrategicPortfolio } from "../architecture/portfolio";
import { ARCHETYPES } from "../live/archetypes";
import type { M49DemandPlan, M49SegmentDemand } from "./types";
import { M49_ECONOMY_VERSION, M49_SEGMENTS } from "./types";
import { m49CourseHistory, normalizeM49State } from "./history";
import { basePriceElasticity, baseWillingnessToPay, strategicCohortForSegment } from "./experience";
import { m49CurrentMobilitySupport, m49MobilityHistoryDisappointment } from "./mobility";

const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const round = (value: number, digits = 3) => Number(value.toFixed(digits));

export interface M49DemandSignals {
  quality?: number;
  difficulty?: number;
  scenery?: number;
  condition?: number;
  price?: number;
  marketing?: number;
  staff?: number;
  reputation?: number;
  samplesPerOption?: number;
}

function profileSignals(course: Course, world: World, signals: M49DemandSignals) {
  const summary = scoreCourseHoles(course);
  const portfolio = buildStrategicPortfolio(course, { samplesPerOption: signals.samplesPerOption ?? 4, seed: 494002 });
  return {
    quality: clamp(signals.quality ?? (summary.courseQuality / 100 * .62 + portfolio.summary.total / 100 * .38)),
    difficulty: clamp(signals.difficulty ?? (summary.holes.length ? summary.holes.filter((hole) => hole.isComplete && hole.isValid).reduce((sum, hole) => sum + hole.difficultyScore, 0) / Math.max(1, summary.holes.filter((hole) => hole.isComplete && hole.isValid).length) / 100 : .5)),
    scenery: clamp(signals.scenery ?? (summary.holes.length ? summary.holes.filter((hole) => hole.isComplete && hole.isValid).reduce((sum, hole) => sum + hole.aestheticsScore, 0) / Math.max(1, summary.holes.filter((hole) => hole.isComplete && hole.isValid).length) / 100 : .5)),
    condition: clamp(signals.condition ?? course.condition),
    price: clamp(signals.price ?? 1),
    marketing: clamp(signals.marketing ?? world.marketingLevel / 5),
    staff: clamp(signals.staff ?? world.staffLevel / 5),
    reputation: clamp(signals.reputation ?? world.reputation / 100),
    portfolio,
  };
}

function strategicFit(segment: (typeof M49_SEGMENTS)[number], portfolio: ReturnType<typeof buildStrategicPortfolio>): number {
  const cohort = strategicCohortForSegment(segment);
  const fits = portfolio.evaluation.holes
    .map((hole) => hole.cohorts.find((candidate) => candidate.cohortId === cohort)?.viability ?? 0)
    .filter((value) => Number.isFinite(value));
  const local = fits.length ? fits.reduce((sum, value) => sum + value, 0) / fits.length / 100 : .5;
  return clamp(local * .72 + portfolio.summary.total / 100 * .28);
}

function priceAppeal(price: number, willingnessToPay: number, elasticity: number): number {
  const ratio = price / Math.max(1, willingnessToPay);
  const overValue = Math.max(0, ratio - .62);
  return clamp(Math.exp(-elasticity * overValue * .72));
}

/** Build the six-segment demand view used by live tee sheets and weekly demand. */
export function buildM49DemandPlan(course: Course, world: World, signals: M49DemandSignals = {}): M49DemandPlan {
  const layout = activeCourseLayout(course);
  const profile = profileSignals(course, world, signals);
  const history = m49CourseHistory(world, layout.id);
  const price = layout.greenFee ?? course.baseGreenFee;
  const marketingPromises = normalizeM49State(world.m49).marketingPromises ?? [];
  const raw: M49SegmentDemand[] = M49_SEGMENTS.map((segment) => {
    const archetype = ARCHETYPES[segment];
    const observed = history?.segments[segment];
    const mobilityCurrent = m49CurrentMobilitySupport(course, segment);
    const mobilityHistory = observed?.mobility;
    const mobilityObservedValue = mobilityHistory?.averageValue;
    const mobilityLabel = mobilityHistory ? "mixed" as const : "predicted" as const;
    const mobilityRisk = m49MobilityHistoryDisappointment(mobilityHistory);
    const fit = strategicFit(segment, profile.portfolio);
    const observedValue = clamp(observed?.averageValue ?? fit * .62 + profile.condition * .38);
    const willingnessToPay = observed?.willingnessToPay ?? baseWillingnessToPay(segment) * (.8 + observedValue * .24);
    const elasticity = observed?.priceElasticity ?? basePriceElasticity(segment) * (1.18 - observedValue * .3);
    const priceFit = priceAppeal(price, willingnessToPay, elasticity);
    const promise = marketingPromises
      .filter((candidate) => candidate.courseId === layout.id && candidate.segment === segment)
      .sort((a, b) => b.createdWeek - a.createdWeek)[0];
    const difficultyTarget = archetype.personality.prefs.difficulty;
    const difficultyFit = clamp(1 - Math.abs(difficultyTarget - (profile.difficulty * 2 - 1)) / 2);
    const sceneryFit = clamp(.72 + archetype.personality.prefs.scenery * (profile.scenery - .5));
    const prestigeFit = clamp(1 - Math.max(0, archetype.personality.skill - profile.reputation) * 1.35);
    const marketingSupport = clamp(1 - Math.max(0, profile.marketing - (fit * .62 + observedValue * .38)) * .78);
    const promiseSupport = promise ? clamp(promise.credibility * .82 + (1 - promise.disappointmentRisk) * .18) : 1;
    const bookingAppeal = clamp(
      (profile.quality * .22 + fit * .27 + observedValue * .13 + profile.condition * .12 + difficultyFit * .08 + sceneryFit * .05 + prestigeFit * .06 + priceFit * .07 + profile.staff * .03 + mobilityCurrent.score * .04 + (mobilityObservedValue ?? .5) * .03 - mobilityRisk * .035)
      * marketingSupport
      * promiseSupport
      * (1 + profile.marketing * .045),
    );
    const confidence = clamp((observed?.observedRounds ?? 0) / 18);
    const causes = [
      `fit:${Math.round(fit * 100)}`,
      `value:${Math.round(observedValue * 100)}`,
      `price:${Math.round(priceFit * 100)}`,
      ...(marketingSupport < .86 ? ["marketing:unsupported-strength"] : []),
      ...(promise && promiseSupport < .78 ? ["marketing:promise-disappointment"] : []),
      ...(observed?.churnRate && observed.churnRate > .55 ? ["observed:churn-risk"] : []),
      ...mobilityCurrent.supportedBy.map((item) => `mobility:${item}`),
      ...(mobilityHistory ? Object.keys(mobilityHistory.causes).filter((cause) => cause.includes("disappointment") || cause.includes("stockout")).slice(0, 2) : ["mobility:unobserved"]),
    ];
    return {
      segment,
      strategicCohort: strategicCohortForSegment(segment),
      share: 0,
      bookingAppeal: round(bookingAppeal),
      willingnessToPay: round(willingnessToPay, 2),
      priceElasticity: round(elasticity),
      strategicFit: round(fit),
      observedValue: round(observedValue),
      confidence: round(confidence),
      returnRate: round(observed?.returnRate ?? .55),
      churnRate: round(observed?.churnRate ?? (1 - observedValue)),
      evidenceRounds: observed?.observedRounds ?? 0,
      evidenceLabel: observed ? "mixed" : "predicted",
      mobility: {
        evidenceLabel: mobilityLabel,
        currentSupport: mobilityCurrent.score,
        ...(mobilityObservedValue == null ? {} : { observedValue: round(mobilityObservedValue) }),
        observedRounds: mobilityHistory?.observedRounds ?? 0,
        disappointmentRisk: round(mobilityRisk),
        causes: mobilityHistory ? Object.keys(mobilityHistory.causes).sort().slice(0, 6) : ["mobility:current-geometry-only"],
      },
      causes,
    };
  });
  const weightedTotal = raw.reduce((sum, item) => sum + item.bookingAppeal * ARCHETYPES[item.segment].weight, 0);
  const segments = Object.fromEntries(raw.map((item) => [
    item.segment,
    { ...item, share: round((item.bookingAppeal * ARCHETYPES[item.segment].weight) / Math.max(.0001, weightedTotal)) },
  ])) as M49DemandPlan["segments"];
  const rows = Object.values(segments);
  const totalIndex = clamp(rows.reduce((sum, item) => sum + item.bookingAppeal * item.share, 0) * 1.2, 0, 1.2);
  const supportedSegments = rows.filter((item) => item.strategicFit >= .52 || item.observedValue >= .62).map((item) => item.segment);
  const broadAppeal = clamp(rows.filter((item) => item.bookingAppeal >= .58).length / M49_SEGMENTS.length);
  const nicheIdentity = clamp(Math.max(...rows.map((item) => item.bookingAppeal), 0) - broadAppeal * .45);
  return {
    version: M49_ECONOMY_VERSION,
    courseId: layout.id,
    totalIndex: round(totalIndex),
    broadAppeal: round(broadAppeal),
    nicheIdentity: round(nicheIdentity),
    supportedSegments,
    segments,
    evidenceRounds: rows.reduce((sum, item) => sum + item.evidenceRounds, 0),
  };
}
