import type { ChallengeGroupRound } from "./challengeGroupRound";

/** Handicap posting may consume only formats in which every member completed an individual ball. */
export function challengeGroupIndividualGrossEvidence(round: ChallengeGroupRound) {
  if (round.teamAuthority?.format !== "four-ball") return [];
  return round.golfers.map((golfer) => ({
    playerId: golfer.id,
    holeScores: golfer.scorecard
      .filter((score) => score.gross != null)
      .map((score) => ({ holeId: score.holeId, gross: score.gross!, par: score.par })),
  }));
}

/** Compact evidence intended for the existing `render_game_to_text` envelope. */
export function challengeGroupRoundTextState(round: ChallengeGroupRound) {
  const recentTurn = round.turnEvidence.at(-1) ?? null;
  return {
    id: round.id,
    phase: round.phase,
    courseId: round.course.courseId,
    currentHole: round.currentHoleIndex + 1,
    holes: round.course.holes.length,
    activeGolferId: round.activeGolferId,
    playerGolferId: round.playerGolferId,
    controls: round.phase === "complete" ? "none" : round.phase === "awaiting_ball_choice" ? "choose-scramble-ball" : round.activeGolferId === round.playerGolferId ? "player-shot" : "ai-automatic",
    honorsOrder: round.honorsOrder,
    golfers: round.golfers.map((golfer) => ({
      id: golfer.id,
      name: golfer.name,
      controller: golfer.controller,
      teamId: golfer.teamId,
      ball: golfer.ball,
      lie: golfer.lie,
      withdrawn: golfer.withdrawn,
      setup: golfer.setup,
      handicap: golfer.handicap,
      equipment: golfer.equipment,
      currentScore: golfer.scorecard[round.currentHoleIndex],
      scorecard: golfer.scorecard,
      latestShot: golfer.shots.at(-1) ?? null,
    })),
    match: round.match,
    teamAuthority: round.teamAuthority ?? null,
    individualAuthority: round.individualAuthority ?? null,
    individualGrossEvidence: challengeGroupIndividualGrossEvidence(round),
    sideBets: round.sideBets,
    recentTurn,
    recentRulings: round.turnEvidence.slice(-4).map((turn) => ({ golferId: turn.golferId, shotId: turn.shotId, ruling: turn.ruling })),
    reactions: round.reactions.filter((entry) => entry.reaction.holeId === round.course.holes[round.currentHoleIndex]?.id),
  };
}

export function renderChallengeGroupRoundToText(round: ChallengeGroupRound): string {
  return JSON.stringify(challengeGroupRoundTextState(round));
}
