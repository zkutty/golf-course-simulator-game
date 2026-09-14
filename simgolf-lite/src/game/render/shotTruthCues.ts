import { pseudoLocalize, translate, type Locale } from "../../i18n/core";
import type { ShotTruthProjection } from "../rules/shotTruth";
import type { CurrentShotEvidence } from "../live/currentShotEvidence";
import { isValidAppliedShotWindV1 } from "../rules/contracts";
import type { AppliedShotWindV1 } from "../rules/shotEnvironment";

const rounded = (value: number, places: number) => +value.toFixed(places) || 0;
const windAxis = (value: number, places: number, positive: string, negative: string) => {
  const display = rounded(value, places);
  return [`${display > 0 ? "+" : ""}${display.toFixed(places)}`, display > 0 ? positive : display < 0 ? negative : "neutral"];
};

/** Text-only view of stored, validated directional wind evidence. */
export function appliedWindCues(wind: AppliedShotWindV1 | null | undefined, locale: Locale): readonly string[] {
  if (!isValidAppliedShotWindV1(wind)) return [];
  const [along, alongDirection] = windAxis(wind.headwindMph, 1, "headwind", "tailwind");
  const [across, crossDirection] = windAxis(wind.crosswindMph, 1, "right", "left");
  const [shift, shiftDirection] = windAxis(wind.lateralCenterlineTiles, 2, "right", "left");
  const cues = [
    `Along shot: ${along} mph ${alongDirection}`,
    `Crosswind: ${across} mph ${crossDirection}`,
    `Applied carry response: ×${wind.carryMultiplier.toFixed(2)}`,
    `Centerline shift: ${shift} tiles ${shiftDirection}`,
  ];
  return locale === "pseudo" ? cues.map(pseudoLocalize) : cues;
}

/** Text-equivalent cues for visible labels/accessible descriptions, never state. */
export function shotTruthCues(truth: ShotTruthProjection, locale: Locale): readonly string[] {
  const position = `${truth.finalPosition.x}, ${truth.finalPosition.y}`;
  return Object.freeze([
    translate(locale, "playerPro.shot.latestRulingShot", { shot: truth.shotNumber }),
    translate(locale, "opening.shotPenalty", { penalties: truth.penaltyStrokes }),
    ...(truth.flight ? [translate(locale, "playerPro.shot.flightEvidence", {
      profile: translate(locale, `shotTruth.flight.${truth.flight.profile}`), launch: truth.flight.launchAngleDegrees, apex: truth.flight.apexHeightYards,
    })] : []),
    ...(truth.collisionKind ? [translate(locale, `shotTruth.collision.${truth.collisionKind}`)] : []),
    ...(truth.penaltyKind ? [translate(locale, `shotTruth.penalty.${truth.penaltyKind}`)] : []),
    ...(truth.reliefStatus === "unavailable" ? [translate(locale, "shotTruth.reliefUnavailable")]
      : truth.reliefType ? [translate(locale, `shotTruth.relief.${truth.reliefType}`)] : []),
    ...(truth.reliefStatus === "resolved" || truth.reliefStatus === "not_required"
      ? [translate(locale, "playerPro.shot.finalPosition", { position })]
      : truth.reliefStatus === "unknown" ? [translate(locale, "playerPro.shot.legacyRelief")] : []),
    ...(truth.holed ? [translate(locale, "playerPro.shot.ruling.holed")] : []),
    ...(truth.physicalRest === null ? [translate(locale, "opening.markerLegend")] : []),
    ...appliedWindCues(truth.appliedWind, locale),
  ]);
}

export function currentShotEvidenceCues(evidence: CurrentShotEvidence, locale: Locale): readonly string[] {
  if (evidence.phase === "result") return shotTruthCues(evidence.truth, locale);
  if (evidence.phase === "intent") return [
    translate(locale, "shotTruth.intent", { shot: evidence.shotNumber, club: evidence.club, intent: translate(locale, `shotTruth.intentKind.${evidence.intent}`) }),
    ...(evidence.flightProfile ? [translate(locale, `shotTruth.flight.${evidence.flightProfile}`)] : []),
    translate(locale, "shotTruth.aim", { x: evidence.aim.x, y: evidence.aim.y }),
  ];
  if (evidence.phase === "reaction") return [
    translate(locale, `shotTruth.reaction.${evidence.reaction.outcome}`),
    translate(locale, "shotTruth.reaction", { expected: evidence.reaction.expectedScore, actual: evidence.reaction.actualScore, satisfaction: evidence.reaction.satisfaction }),
  ];
  return [translate(locale, "shotTruth.unavailable")];
}
