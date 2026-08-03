import type { GolferCapabilities, HoleReaction, LiveShotOutcome, StrategicHolePlan } from "./m47Types";
import type { Personality } from "./personality";
import { shotSlopeEvidenceFacts } from "../models/shotSlopeEvidence";

const clamp = (value: number, min = 0, max = 100) => Math.max(min, Math.min(max, value));

export function evaluateHoleReaction(args: {
  plan: StrategicHolePlan;
  outcomes: LiveShotOutcome[];
  capabilities: GolferCapabilities;
  personality: Personality;
  condition: number;
}): HoleReaction {
  const actualScore = args.outcomes.reduce((sum, outcome) => sum + 1 + outcome.penaltyStrokes + (outcome.greenPutting?.putts ?? 0), 0);
  const actualVsExpected = args.plan.expectedScore - actualScore;
  const heroSuccess = args.plan.chosen.kind === "hero" && args.outcomes.length > 0 && args.outcomes[0].penaltyStrokes === 0;
  const forcedMismatch = args.plan.chosen.hazardRisk > .7 && args.plan.chosen.kind !== "hero" && args.capabilities.power < 45;
  const voluntaryRisk = args.plan.chosen.kind === "hero" || args.plan.chosen.kind === "positional";
  const conditionDelta = (args.condition - .75) * 12;
  const scoreDelta = actualVsExpected * 13;
  const riskMoment = heroSuccess ? 9 : voluntaryRisk && actualVsExpected < 0 ? -2 : 0;
  const fairness = forcedMismatch ? -16 : 0;
  const satisfaction = clamp(67 + scoreDelta + riskMoment + conditionDelta + fairness + (args.personality.prefs.scenery * 3));
  const facts = args.plan.chosen.facts.slice();
  facts.push({ code: "outcome", detail: `expected:${args.plan.expectedScore.toFixed(2)} actual:${actualScore}` });
  if (heroSuccess) facts.push({ code: "outcome", detail: "hero-success" });
  if (forcedMismatch) facts.push({ code: "outcome", detail: "forced-carry-mismatch" });
  if (args.condition < .55) facts.push({ code: "context", detail: `condition:${args.condition.toFixed(2)}` });
  for (const shot of args.outcomes) {
    for (const fact of shotSlopeEvidenceFacts(shot.shotSlope)) {
      if (facts.length < 12 && !facts.some((candidate) => candidate.detail === fact.detail)) facts.push(fact);
    }
  }
  const outcome = forcedMismatch ? "unfair" : satisfaction >= 82 ? "delighted" : satisfaction >= 68 ? "pleased" : satisfaction >= 52 ? "neutral" : "frustrated";
  const thought = forcedMismatch
    ? "That carry asked for more power than I had."
    : heroSuccess
      ? "The brave line paid off."
      : actualVsExpected >= .5
        ? "That plan matched my game well."
        : actualVsExpected <= -.5
          ? "The hole asked more than the plan promised."
          : args.outcomes.some((shot) => shot.shotSlope?.targetElevationDelta !== 0 || shot.shotSlope?.sidehill !== "flat")
            ? "The slope shaped the shot exactly as the plan described."
            : "The hole felt fair.";
  return {
    version: 1,
    holeId: args.plan.holeId,
    expectedScore: args.plan.expectedScore,
    actualScore,
    satisfaction: Number(satisfaction.toFixed(2)),
    outcome,
    facts,
    thought,
    memory: heroSuccess ? "A successful hero line became a signature moment." : forcedMismatch ? "A forced carry became a frustrating memory." : undefined,
  };
}
