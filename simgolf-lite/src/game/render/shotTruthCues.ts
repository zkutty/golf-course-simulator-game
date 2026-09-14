import { pseudoLocalize, translate, type Locale } from "../../i18n/core";
import type { ShotTruthProjection } from "../rules/shotTruth";
import type { CurrentShotEvidence } from "../live/currentShotEvidence";
import { isValidAppliedShotWindV1 } from "../rules/contracts";
import type { AppliedShotWindV1 } from "../rules/shotEnvironment";

const rounded = (value: number, places: number) => +value.toFixed(places) || 0;
const signed = (display: number, places: number) => `${display > 0 ? "+" : ""}${display.toFixed(places)}`;
const direction = (value: number, positive: string, negative: string) => value > 0 ? positive : value < 0 ? negative : "neutral";

/** Text-only view of stored, validated directional wind evidence. */
export function appliedWindCues(wind: AppliedShotWindV1 | null | undefined, locale: Locale): readonly string[] {
  if (!isValidAppliedShotWindV1(wind)) return [];
  const headwind = rounded(wind.headwindMph, 1);
  const crosswind = rounded(wind.crosswindMph, 1);
  const lateralShift = rounded(wind.lateralCenterlineTiles, 2);
  const cues = translate("en", "w", {
    a: signed(headwind, 1), b: direction(headwind, "headwind", "tailwind"),
    c: signed(crosswind, 1), d: direction(crosswind, "right", "left"),
    m: wind.carryMultiplier.toFixed(2), s: signed(lateralShift, 2), t: direction(lateralShift, "right", "left"),
  }).split("|");
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
