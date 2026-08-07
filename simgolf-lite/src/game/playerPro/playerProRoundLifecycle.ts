import type { GameState } from "../gameState";
import type { PlayerPlayableRound } from "../models/playerProTypes";
import type { World } from "../models/types";
import { advanceCampaign } from "../campaign/campaign";
import { settleMentorTechniqueChallenge } from "../competition/equipmentMentor";
import { recordPlayerRoundArchitecture } from "../livingClub/livingClub";
import { tournamentCalendar } from "../tournaments/tournaments";
import { settlePlayerChallengeContract } from "./challengePlayerProAdapter";
import { currentPlayerTournament, normalizePlayerPro } from "./playerPro";
import { settlePlayerRound } from "./playerProSettlement";

/**
 * Completes every authority that shares a Player Pro round in one deferred
 * transaction. The caller remains responsible for compare-and-swap commit and
 * durable save of the returned world.
 */
export function settleRound(
  state: GameState,
  observedRound: PlayerPlayableRound,
  day: number,
): World | null {
  const current = state.world;
  const career = normalizePlayerPro(current.playerPro, {
    seed: current.runSeed,
    founderName: current.founderName,
  });
  const authoritative = career.activeRound;
  if (!authoritative || authoritative.id !== observedRound.id || authoritative.rewardsApplied) return null;

  const settlement = settlePlayerRound(
    career,
    authoritative,
    currentPlayerTournament(current, authoritative.tournamentId),
  );
  if (!settlement.round) return null;

  const mentorCareer = settleMentorTechniqueChallenge(settlement.career, authoritative);
  const recorded = recordPlayerRoundArchitecture(current, authoritative, settlement.round);
  const recordedCareer = {
    ...mentorCareer,
    rounds: mentorCareer.rounds.map((round) =>
      round.id === recorded.careerRound.id ? recorded.careerRound : round
    ),
  };
  const events = settlement.tournamentEvent
    ? tournamentCalendar(current).events.map((event) =>
      event.id === settlement.tournamentEvent!.id ? settlement.tournamentEvent! : event
    )
    : null;
  let nextWorld: World = {
    ...recorded.world,
    cash: recorded.world.cash + settlement.cashDelta,
    reputation: Math.max(0, Math.min(100, recorded.world.reputation + settlement.reputationDelta)),
    tournaments: events ? { version: 2, events } : current.tournaments,
    playerPro: recordedCareer,
  };

  if (recordedCareer.activeChallengeRuntime) {
    nextWorld = settlePlayerChallengeContract({
      world: nextWorld,
      career: nextWorld.playerPro!,
      round: recorded.careerRound,
      day,
      resolutionKind: authoritative.phase === "conceded" ? "concession" : "completed",
    });
  }

  return advanceCampaign(state.course, {
    ...nextWorld,
    playerPro: {
      ...nextWorld.playerPro!,
      activeRound: { ...authoritative, rewardsApplied: true },
    },
  });
}
