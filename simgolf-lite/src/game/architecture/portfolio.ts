import type { Course, Point } from "../models/types";
import { evaluateStrategicArchitecture } from "./strategic";
import type { M48CohortId, M48PortfolioHole, M48StrategicEvaluation, M48StrategicHoleEvaluation, M48StrategicPortfolio } from "./m48Types";

const clamp = (value: number, min = 0, max = 100) => Math.max(min, Math.min(max, value));
const round = (value: number, digits = 1) => Number(value.toFixed(digits));
const COHORTS: M48CohortId[] = ["power", "accuracy", "shortGame", "recovery", "casual"];

function holeWarnings(hole: M48StrategicHoleEvaluation): string[] {
  const warnings = hole.warnings.slice();
  const greenFunnel = hole.optionCount <= 1 && hole.options.some((option) => option.kind === "hero" && option.hazardRisk > .65);
  if (greenFunnel) warnings.push("Funnel-like finish: most cohorts are rewarded for the same narrow landing.");
  if (hole.options.filter((option) => option.viable).length >= 2 && hole.options.every((option) => Math.abs(option.expectedStrokes - hole.expectedStrokes) < .08)) warnings.push("Fake choice: alternate lines exist but do not change the decision.");
  if (hole.options.filter((option) => option.hazardRisk > .65).length >= 3) warnings.push("Hazard spam: too many visible options carry severe risk.");
  return [...new Set(warnings)];
}

function holeScore(hole: M48StrategicHoleEvaluation): M48PortfolioHole {
  const warnings = holeWarnings(hole);
  const cohortScores = hole.cohorts.map((cohort) => cohort.skillAdvantageDelta);
  const favoredCohorts = hole.cohorts
    .slice()
    .sort((a, b) => b.skillAdvantageDelta - a.skillAdvantageDelta || a.cohortId.localeCompare(b.cohortId))
    .filter((cohort) => cohort.skillAdvantageDelta >= .12)
    .map((cohort) => cohort.cohortId);
  const fairness = hole.status === "complete" ? hole.fairnessFloor : 0;
  const genuineChoice = clamp(hole.optionCount / 3 * 100 - (warnings.some((warning) => warning.startsWith("Fake choice")) ? 24 : 0));
  const spectacleWithMercy = clamp(hole.visualChallenge * .56 + hole.safeRouteViability * .44 - hole.unavoidablePunishment * .34);
  const separation = clamp(Math.abs(Math.max(...cohortScores, 0) - Math.min(...cohortScores, 0)) * 24);
  const penalties = warnings.length * 4 + hole.unavoidablePunishment * .18;
  const strategicScore = round(clamp(fairness * .34 + genuineChoice * .24 + spectacleWithMercy * .2 + separation * .22 - penalties));
  return {
    holeId: hole.holeId,
    setup: hole.setup,
    strategicScore,
    fairnessFloor: fairness,
    genuineChoice: round(genuineChoice),
    spectacleWithMercy: round(spectacleWithMercy),
    strategyWarnings: warnings,
    favoredCohorts,
    opportunityCount: favoredCohorts.length,
  };
}

function entropy(values: number[]): number {
  const total = values.reduce((sum, value) => sum + value, 0);
  if (!total || values.length <= 1) return 0;
  return clamp(-values.reduce((sum, value) => {
    if (!value) return sum;
    const share = value / total;
    return sum + share * Math.log(share);
  }, 0) / Math.log(values.length) * 100);
}

function portfolioSummary(holes: M48PortfolioHole[], evaluation: M48StrategicEvaluation) {
  const complete = evaluation.holes.filter((hole) => hole.status === "complete");
  const scores = holes.map((hole) => hole.strategicScore);
  const favoredCohorts = Object.fromEntries(COHORTS.map((cohort) => [cohort, holes.filter((hole) => hole.favoredCohorts.includes(cohort)).length])) as Record<M48CohortId, number>;
  const warningCount = (prefix: string) => holes.filter((hole) => hole.strategyWarnings.some((warning) => warning.toLowerCase().startsWith(prefix))).length;
  const oneDominant = holes.length && Math.max(...Object.values(favoredCohorts)) / holes.length > .7 ? 100 : 0;
  const repeated = holes.length > 1 && holes.every((hole) => hole.favoredCohorts[0] === holes[0].favoredCohorts[0]) ? 100 : 0;
  const opportunityRotation = entropy(Object.values(favoredCohorts));
  const average = scores.length ? scores.reduce((sum, value) => sum + value, 0) / scores.length : 0;
  const fairnessFloor = complete.length ? complete.reduce((sum, hole) => sum + hole.fairnessFloor, 0) / complete.length : 0;
  const strategicSeparation = complete.length ? complete.reduce((sum, hole) => sum + hole.strategicSeparation, 0) / complete.length : 0;
  const genuineChoice = complete.length ? complete.reduce((sum, hole) => sum + clamp(hole.optionCount / 3 * 100), 0) / complete.length : 0;
  const spectacleWithMercy = complete.length ? complete.reduce((sum, hole) => sum + clamp(hole.visualChallenge * .56 + hole.safeRouteViability * .44), 0) / complete.length : 0;
  const penalties = {
    funnelGreens: warningCount("funnel-like"),
    fakeChoices: warningCount("fake choice"),
    mandatoryCarries: complete.filter((hole) => hole.unavoidablePunishment > 50).length,
    hazardSpam: warningCount("hazard spam"),
    repetitiveStrategy: repeated ? Math.max(1, holes.length - 1) : 0,
    oneCohortDominance: oneDominant,
  };
  const penaltyPoints = penalties.funnelGreens * 5 + penalties.fakeChoices * 4 + penalties.mandatoryCarries * 5 + penalties.hazardSpam * 3 + (penalties.repetitiveStrategy ? 8 : 0) + penalties.oneCohortDominance * .12;
  const total = round(clamp(average * .22 + fairnessFloor * .27 + strategicSeparation * .15 + genuineChoice * .17 + spectacleWithMercy * .11 + opportunityRotation * .08 - penaltyPoints));
  return { total, fairnessFloor: round(fairnessFloor), strategicSeparation: round(strategicSeparation), genuineChoice: round(genuineChoice), spectacleWithMercy: round(spectacleWithMercy), opportunityRotation: round(opportunityRotation), penalties, favoredCohorts, holeCount: holes.length };
}

export function buildStrategicPortfolio(course: Course, options: { courseId?: string; samplesPerOption?: number; seed?: number } = {}): M48StrategicPortfolio {
  const evaluation = evaluateStrategicArchitecture(course, options);
  const holes = evaluation.holes.map(holeScore);
  return { evaluation, holes, summary: portfolioSummary(holes, evaluation) };
}

export function portfolioHoleAt(portfolio: M48StrategicPortfolio, holeId: string, teeSet?: string, pinRotation?: string): M48PortfolioHole | undefined {
  return portfolio.holes.find((hole) => hole.holeId === holeId && (!teeSet || hole.setup.teeSet === teeSet) && (!pinRotation || hole.setup.pinRotation === pinRotation));
}

export function portfolioLocation(portfolio: M48StrategicPortfolio, holeId: string): Point | undefined {
  const evaluation = portfolio.evaluation.holes.find((hole) => hole.holeId === holeId);
  return evaluation?.options.find((option) => option.kind === "safe")?.location ?? evaluation?.options[0]?.location;
}
