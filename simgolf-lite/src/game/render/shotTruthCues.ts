import { translate, type Locale } from "../../i18n/core";
import type { ShotTruthProjection } from "../rules/shotTruth";

/** Text-equivalent cues for visible labels/accessible descriptions, never state. */
export function shotTruthCues(truth: ShotTruthProjection, locale: Locale): readonly string[] {
  const position = `${truth.finalPosition.x}, ${truth.finalPosition.y}`;
  return Object.freeze([
    translate(locale, "playerPro.shot.latestRulingShot", { shot: truth.shotNumber }),
    translate(locale, "opening.shotPenalty", { penalties: truth.penaltyStrokes }),
    ...(truth.reliefStatus === "resolved" || truth.reliefStatus === "not_required"
      ? [translate(locale, "playerPro.shot.finalPosition", { position })]
      : truth.reliefStatus === "unknown" ? [translate(locale, "playerPro.shot.legacyRelief")] : []),
    ...(truth.holed ? [translate(locale, "playerPro.shot.ruling.holed")] : []),
    ...(truth.physicalRest === null ? [translate(locale, "opening.markerLegend")] : []),
  ]);
}
