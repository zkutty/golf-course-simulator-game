import type { Golfer } from "./types";
import type { currentShotEvidence } from "./currentShotEvidence";

type ShotCursor = NonNullable<Parameters<typeof currentShotEvidence>[0]>;
export type ShotTelemetryGolfer = ShotCursor & Pick<Golfer, "id">;

/**
 * Detached cursor data for render_game_to_text, captured at its effect boundary.
 * Cover every golfer ID: the displayed/selected ID can change before the text
 * callback runs. Preserve JSON normalization and Map's last-duplicate-ID rule.
 * This is a projection of generated/restored plain JSON live data, not a save
 * snapshot API; arbitrary custom toJSON/functions or omitted-field cycles are
 * outside that authority. Persistence continues to clone the complete state.
 */
export function captureShotTelemetrySnapshot(golfers: readonly Golfer[]): ReadonlyMap<number, ShotTelemetryGolfer> {
  const cursors = golfers.map((golfer) => ({
    id: golfer.id,
    segments: golfer.segments,
    segIndex: golfer.segIndex,
    segElapsed: golfer.segElapsed,
    scoredHoles: golfer.scoredHoles,
    holeIds: golfer.holeIds,
    shotOutcomes: golfer.shotOutcomes,
    holeReactions: golfer.holeReactions,
  }));
  const detached = JSON.parse(JSON.stringify(cursors)) as ShotTelemetryGolfer[];
  return new Map(detached.map((golfer) => [golfer.id, golfer]));
}
