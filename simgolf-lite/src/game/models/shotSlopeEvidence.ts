import type { ShotSlopeContext } from "./shotSlope";
import { normalizeShotSlopeContext } from "./shotSlope";

export interface ShotSlopeEvidenceFact {
  code: "context" | "outcome";
  detail: string;
}

/**
 * Formats already-resolved slope facts for evidence consumers. This module is
 * deliberately presentational: it never reads course geometry or derives a
 * second elevation/sidehill result.
 */
export function shotSlopeEvidenceFacts(
  value: ShotSlopeContext | null | undefined,
): ShotSlopeEvidenceFact[] {
  const slope = normalizeShotSlopeContext(value);
  if (!slope) return [];
  const elevation = slope.targetElevationDelta > 0
    ? "uphill"
    : slope.targetElevationDelta < 0
      ? "downhill"
      : "level";
  const signedSteps = slope.targetElevationDelta > 0
    ? `+${slope.targetElevationDelta}`
    : `${slope.targetElevationDelta}`;
  return [
    {
      code: "context",
      detail: `elevation:${elevation} steps:${signedSteps} plays-like:${Math.round(slope.playsLikeDistanceYards)}yd flat:${Math.round(slope.flatDistanceYards)}yd`,
    },
    {
      code: "context",
      detail: `sidehill:${slope.sidehill} handedness:${slope.handedness} natural-curve:${slope.naturalCurveBiasTiles.toFixed(3)}t`,
    },
  ];
}

export function shotSlopeExplanation(value: ShotSlopeContext | null | undefined): string | undefined {
  const facts = shotSlopeEvidenceFacts(value);
  return facts.length ? facts.map((fact) => fact.detail).join(" · ") : undefined;
}
