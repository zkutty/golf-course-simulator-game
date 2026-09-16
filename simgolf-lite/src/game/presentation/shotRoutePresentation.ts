import type { Point } from "../models/types";
import type { ShotPlanStep } from "../sim/shots/solveShotsToGreen";

/** Par convention used by the route preview; putting is not a route target. */
export const ROUTE_PREVIEW_EXPECTED_PUTTS = 2;

/**
 * Render-facing route authority. Geometry is deliberately separate from the
 * discrete destinations: sampling may make a smoother line, but can never
 * create extra shots or endpoint markers.
 */
export interface ShotRoutePresentation {
  /** Sampled polyline used only to draw a smooth route. */
  readonly geometry: readonly Point[];
  /** One endpoint for each full shot in the solver's authoritative plan. */
  readonly destinations: readonly Point[];
  readonly fullShots: number;
  readonly expectedPutts: typeof ROUTE_PREVIEW_EXPECTED_PUTTS;
  readonly plannedStrokes: number;
}

export function presentShotRoute(
  shotPlan: readonly Pick<ShotPlanStep, "to">[],
  geometry: readonly Point[],
): ShotRoutePresentation {
  const fullShots = shotPlan.length;
  return {
    geometry,
    destinations: shotPlan.map((step) => step.to),
    fullShots,
    expectedPutts: ROUTE_PREVIEW_EXPECTED_PUTTS,
    plannedStrokes: fullShots + ROUTE_PREVIEW_EXPECTED_PUTTS,
  };
}

/** Incomplete holes have no route, targets, or implied putting total to show. */
export function presentCompleteShotRoute(
  score: { readonly isComplete: boolean; readonly shotPlan: readonly Pick<ShotPlanStep, "to">[]; readonly path: readonly Point[] } | null | undefined,
): ShotRoutePresentation | null {
  return score?.isComplete ? presentShotRoute(score.shotPlan, score.path) : null;
}
