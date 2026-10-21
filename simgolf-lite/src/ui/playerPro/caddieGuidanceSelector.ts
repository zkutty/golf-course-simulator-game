import type { PlayerPlayableRound, PlayerProSkills } from "../../game/models/playerProTypes";
import { caddieShotGuidance } from "../../game/playerPro/playerPro";

/** One HUD's bounded cache. The round ID owns its immutable course snapshot. */
export function createCaddieGuidanceSelector(resolve = caddieShotGuidance) {
  let previousKey: string | null = null;
  let previous: ReturnType<typeof caddieShotGuidance> | null = null;
  return (round: PlayerPlayableRound, skills: PlayerProSkills) => {
    const key = JSON.stringify({ roundId: round.id, hole: round.currentHoleIndex, ball: round.ball, lie: round.lie,
      handedness: round.handedness, skills, performanceLoadout: round.performanceLoadout, confidence: round.confidenceSnapshot,
      // Historical previews inspect their historical next-shot certificate.
      legacySeed: round.course.shotModel ? undefined : [round.rngSeed, round.rngCursor, round.scorecard[round.currentHoleIndex]?.strokes] });
    if (previousKey === key && previous) return previous;
    previous = resolve(round, skills);
    previousKey = key;
    return previous;
  };
}
