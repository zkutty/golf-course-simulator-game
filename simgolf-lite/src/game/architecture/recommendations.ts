import type { Course } from "../models/types";
import {
  computeTerrainChangeCost,
  terrainMaintenanceWeight,
} from "../models/terrainEconomics";
import { buildStrategicPortfolio } from "./portfolio";
import type { M48Recommendation, M48StrategicHoleEvaluation, M48StrategicPortfolio } from "./m48Types";

const clamp = (value: number, min = 0, max = 100) => Math.max(min, Math.min(max, value));
const round = (value: number, digits = 1) => Number(value.toFixed(digits));

function economics(
  course: Course,
  hole: M48StrategicHoleEvaluation,
  coverageFactor: number,
  costMult: number,
): Pick<M48Recommendation, "constructionCost" | "upkeepDelta"> {
  const tiles = Math.max(
    1,
    Math.ceil((hole.options[0]?.geometry.length ?? 1) * coverageFactor),
  );
  const unitQuote = computeTerrainChangeCost(
    "rough",
    "fairway",
    costMult,
    course.theme,
  );
  return {
    constructionCost: Math.round(Math.max(0, unitQuote.net) * tiles),
    upkeepDelta: round(
      (
        terrainMaintenanceWeight("fairway", course.theme)
        - terrainMaintenanceWeight("rough", course.theme)
      ) * tiles,
      2,
    ),
  };
}

function recommendationFor(
  course: Course,
  hole: M48StrategicHoleEvaluation,
  costMult: number,
): M48Recommendation[] {
  if (hole.status !== "complete" || !hole.options.length) return [];
  const safe = hole.options.find((option) => option.kind === "safe");
  const hero = hole.options.find((option) => option.kind === "hero");
  const positional = hole.options.find((option) => option.kind === "positional");
  const recovery = hole.options.find((option) => option.kind === "recovery");
  const casual = hole.cohorts.find((cohort) => cohort.cohortId === "casual");
  const affected = hole.cohorts.filter((cohort) => cohort.viability < Math.max(46, hole.fairnessFloor + 8)).map((cohort) => cohort.cohortId);
  const confidence = hole.sampleCount >= 6 ? .86 : hole.sampleCount >= 2 ? .61 : .28;
  const sampleStatus = hole.sampleCount > 0 ? "simulated" as const : "insufficient" as const;
  const recommendations: M48Recommendation[] = [];
  if (hole.safeRouteViability < 58 || hole.bailoutQuality < 32) recommendations.push({ id: `${hole.id}:bailout`, kind: "widen-bailout", holeId: hole.holeId, titleKey: "architecture.recommendation.widenBailout.title", detailKey: "architecture.recommendation.widenBailout.body", location: safe?.location ?? hole.options[0].location, affectedCohorts: affected.length ? affected : ["casual", "accuracy"], failingMetric: "safeRouteViability", currentValue: hole.safeRouteViability, expectedDirection: "up", ...economics(course, hole, .9, costMult), confidence, sampleStatus });
  if (hole.forcedCarryBurden > 58 && hole.unavoidablePunishment > 48) recommendations.push({ id: `${hole.id}:carry`, kind: "open-runup", holeId: hole.holeId, titleKey: "architecture.recommendation.openRunup.title", detailKey: "architecture.recommendation.openRunup.body", location: hero?.location ?? hole.options[0].location, affectedCohorts: affected.length ? affected : ["casual", "shortGame"], failingMetric: "forcedCarryBurden", currentValue: hole.forcedCarryBurden, expectedDirection: "down", ...economics(course, hole, 1.2, costMult), confidence, sampleStatus });
  if ((hero?.heroLineReward ?? 0) < 5 && hole.visualChallenge > 34 && hole.optionCount >= 2) recommendations.push({ id: `${hole.id}:hero`, kind: "protect-hero-line", holeId: hole.holeId, titleKey: "architecture.recommendation.protectHero.title", detailKey: "architecture.recommendation.protectHero.body", location: hero?.location ?? hole.options[0].location, affectedCohorts: ["power", "accuracy"], failingMetric: "heroLineReward", currentValue: hole.heroLineReward, expectedDirection: "up", ...economics(course, hole, .7, costMult), confidence, sampleStatus });
  if (hole.optionCount <= 1) recommendations.push({ id: `${hole.id}:choice`, kind: "create-angle", holeId: hole.holeId, titleKey: "architecture.recommendation.createAngle.title", detailKey: "architecture.recommendation.createAngle.body", location: positional?.location ?? hole.options[0].location, affectedCohorts: ["power", "accuracy", "shortGame"], failingMetric: "optionCount", currentValue: hole.optionCount, expectedDirection: "up", ...economics(course, hole, 1.1, costMult), confidence, sampleStatus });
  if (casual && casual.viability < 42) recommendations.push({ id: `${hole.id}:casual`, kind: "shift-carry", holeId: hole.holeId, titleKey: "architecture.recommendation.shiftCarry.title", detailKey: "architecture.recommendation.shiftCarry.body", location: recovery?.location ?? safe?.location ?? hole.options[0].location, affectedCohorts: ["casual", "shortGame"], failingMetric: "fairnessFloor", currentValue: hole.fairnessFloor, expectedDirection: "up", ...economics(course, hole, .8, costMult), confidence, sampleStatus });
  return recommendations;
}

export function buildStrategicRecommendations(
  course: Course,
  portfolioOrOptions: M48StrategicPortfolio | { courseId?: string; samplesPerOption?: number; seed?: number } = {},
  costMult = 1,
): M48Recommendation[] {
  const portfolio = "evaluation" in portfolioOrOptions ? portfolioOrOptions : buildStrategicPortfolio(course, portfolioOrOptions);
  const recommendations = portfolio.evaluation.holes.flatMap((hole) => recommendationFor(course, hole, costMult));
  const seen = new Set<string>();
  return recommendations
    .filter((recommendation) => {
      const dedupe = `${recommendation.kind}:${recommendation.holeId}`;
      if (seen.has(dedupe)) return false;
      seen.add(dedupe);
      return true;
    })
    .sort((a, b) => b.confidence - a.confidence || b.currentValue - a.currentValue || a.id.localeCompare(b.id))
    .slice(0, 24)
    .map((recommendation) => ({ ...recommendation, currentValue: round(clamp(recommendation.currentValue)), confidence: round(recommendation.confidence, 2) }));
}
