import type { LiveShotOutcome } from "../live/m47Types";
import type { Point } from "../models/types";

/** Read-only adapter, not a save carrier, solver, or permission to re-sample. */
export type CommittedShotCarrier = Pick<LiveShotOutcome,
  "id" | "holeId" | "shotNumber" | "seed" | "club" | "from" | "landing" | "rest"
  | "lieAfter" | "penaltyStrokes" | "holed" | "sharedOutcome" | "finalPosition"
  | "greenRollout" | "greenPutting"
>;

export interface ShotTruthProjection {
  readonly id: string;
  readonly holeId: string;
  readonly shotNumber: number;
  readonly seed: number;
  readonly club: string;
  readonly source: "shared-outcome" | "legacy-trace";
  readonly from: Readonly<Point>;
  readonly landing: Readonly<Point>;
  /** Null on historical carriers that cannot distinguish a drop from rest. */
  readonly physicalRest: Readonly<Point> | null;
  readonly finalPosition: Readonly<Point>;
  /** Kept separately: legacy rest may be clamped/rounded after relief. */
  readonly nextLiePosition: Readonly<Point>;
  readonly lieAfter: string;
  readonly penaltyStrokes: number;
  readonly holed: boolean;
  readonly reliefStatus: "resolved" | "not_required" | "unavailable" | "unknown";
  readonly automaticPutts: number;
  readonly strokeCost: number;
  /** Recorded ground samples only; an absent path is not synthesized. */
  readonly rollPath: readonly Readonly<Point>[];
}

const point = (value: Point): Readonly<Point> => Object.freeze({ x: value.x, y: value.y });

/** One scoring projection for M47 totals, reaction and downstream telemetry. */
export function committedShotStrokeCost(shot: Pick<CommittedShotCarrier, "sharedOutcome" | "penaltyStrokes" | "greenPutting">): number {
  return 1 + (shot.sharedOutcome?.ruling.penaltyStrokes ?? shot.penaltyStrokes) + (shot.greenPutting?.putts ?? 0);
}

/**
 * Preview-after-commit, telemetry and replay all read this same projection.
 * Before commitment, an intent's fixed-seed candidate is only a prediction:
 * M47 deliberately draws the committed seed later from its existing stream.
 * No course, clock, locale, camera, or RNG is accepted here.
 */
export function projectCommittedShot(shot: CommittedShotCarrier): ShotTruthProjection {
  const shared = shot.sharedOutcome;
  const penaltyStrokes = shared?.ruling.penaltyStrokes ?? shot.penaltyStrokes;
  const automaticPutts = shot.greenPutting?.putts ?? 0;
  return Object.freeze({
    id: shot.id, holeId: shot.holeId, shotNumber: shot.shotNumber, seed: shot.seed, club: shot.club,
    source: shared ? "shared-outcome" : "legacy-trace",
    from: point(shot.from),
    landing: point(shared?.flight.carryEnd ?? shot.landing),
    physicalRest: shared ? point(shared.physicalRest) : shot.greenRollout ? point(shot.greenRollout.rest) : null,
    finalPosition: point(shared?.finalPosition ?? shot.finalPosition ?? shot.rest),
    nextLiePosition: point(shot.rest),
    lieAfter: shot.lieAfter,
    penaltyStrokes,
    holed: shared ? shared.ruling.status === "holed" : shot.holed,
    reliefStatus: shared?.relief.status ?? "unknown",
    automaticPutts,
    strokeCost: committedShotStrokeCost(shot),
    rollPath: Object.freeze((shot.greenRollout?.path ?? []).map(point)),
  });
}
