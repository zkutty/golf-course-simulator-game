import type { PlayerProPoint } from "../models/playerProTypes";
import { courseHandicapUnrounded, playingHandicapFromUnrounded, strokesByHole } from "./handicap";
import { teamPlayingHandicap } from "./scoring";
import type { CompetitionHole, CompetitionTeam, HandicapCourse } from "./types";

export type ChallengeTeamFormat = "four-ball" | "alternate-shot" | "scramble";
export type ChallengeTeamScoring = "match" | "stroke";

export interface TeamHandicapMemberSnapshot {
  playerId: string;
  handicapIndex: number;
  courseHandicapUnrounded: number;
  courseHandicap: number;
  allowance: number;
  playingHandicap: number;
  strokesOffLow: number;
  strokesByHole: readonly number[];
}

export interface TeamHandicapSnapshot {
  version: 1;
  teamId: string;
  format: ChallengeTeamFormat;
  scoring: ChallengeTeamScoring;
  formula: "90%-per-player" | "85%-per-player" | "50%-combined" | "35%-low+15%-high";
  members: readonly TeamHandicapMemberSnapshot[];
  unrounded: number;
  playingHandicap: number;
  strokesOffLow: number;
  strokesByHole: readonly number[];
}

export interface TeamBallCandidate {
  playerId: string;
  shotId: string;
  rest: PlayerProPoint;
  lie: string;
  penaltyStrokes: number;
  strokeCost: number;
  completesHole: boolean;
  distanceToPin: number;
}

export interface TeamHoleScore {
  holeId: string;
  par: number;
  handicapStrokes: number;
  strokes: number;
  penalties: number;
  gross: number | null;
  net: number | null;
  status: "active" | "played" | "withdrawn";
  countedPlayerIds: readonly string[];
}

export interface TeamBallState {
  teamId: string;
  ball: PlayerProPoint;
  lie: string;
  nextPlayerId: string;
  candidates: readonly TeamBallCandidate[];
  scorecard: readonly TeamHoleScore[];
}

export interface TeamBallChoiceEvidence {
  holeId: string;
  sequence: number;
  teamId: string;
  selectedPlayerId: string;
  candidateShotIds: readonly string[];
  controller: "player" | "ai";
  reason: string;
}

export interface ChallengeTeamAuthority {
  version: 1;
  format: ChallengeTeamFormat;
  scoring: ChallengeTeamScoring;
  teams: readonly CompetitionTeam[];
  handicaps: readonly TeamHandicapSnapshot[];
  balls: readonly TeamBallState[];
  choices: readonly TeamBallChoiceEvidence[];
}

type HandicapInput = { id: string; handicapIndex: number };

const freeze = <T>(value: T): T => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value as Record<string, unknown>).forEach(freeze);
  }
  return value;
};

function memberAllowance(format: ChallengeTeamFormat, scoring: ChallengeTeamScoring): number {
  if (format !== "four-ball") return 0;
  return scoring === "match" ? .9 : .85;
}

/** Captures the one authoritative WHS-style team calculation before play starts. */
export function captureTeamHandicapSnapshots(
  teams: readonly CompetitionTeam[],
  players: readonly HandicapInput[],
  format: ChallengeTeamFormat,
  scoring: ChallengeTeamScoring,
  course: HandicapCourse,
  holes: readonly CompetitionHole[],
): readonly TeamHandicapSnapshot[] {
  if (teams.length !== 2 || teams.some((team) => team.playerIds.length !== 2)) throw new Error("Team formats require exactly two teams of two golfers.");
  const ids = teams.flatMap((team) => team.playerIds);
  if (new Set(ids).size !== 4 || ids.some((id) => !players.some((player) => player.id === id))) throw new Error("Team membership must cover four unique golfers exactly once.");
  const raw = new Map(players.map((player) => [player.id, courseHandicapUnrounded(player.handicapIndex, course)]));
  const provisional = teams.map((team) => {
    const ordered = team.playerIds.map((id) => ({ id, value: raw.get(id)! }));
    const byHandicap = [...ordered].sort((a, b) => a.value - b.value || a.id.localeCompare(b.id));
    const percentages = format === "scramble" ? [.35, .15] : [.5, .5];
    const result = format === "four-ball"
      ? { unrounded: 0, rounded: 0 }
      : teamPlayingHandicap(byHandicap.map((entry) => entry.value), percentages);
    return { team, ordered, byHandicap, result };
  });
  const fourBallPlaying = format === "four-ball"
    ? players.map((player) => playingHandicapFromUnrounded(raw.get(player.id)!, memberAllowance(format, scoring)).rounded)
    : [];
  const lowestMember = fourBallPlaying.length ? Math.min(...fourBallPlaying) : 0;
  const lowestTeam = provisional.length ? Math.min(...provisional.map((entry) => entry.result.rounded)) : 0;
  return freeze(provisional.map(({ team, ordered, byHandicap, result }) => {
    const teamOffLow = scoring === "match" && format !== "four-ball" ? result.rounded - lowestTeam : result.rounded;
    const members = ordered.map((entry) => {
      const allowance = format === "four-ball" ? memberAllowance(format, scoring)
        : format === "alternate-shot" ? .5
          : byHandicap[0].id === entry.id ? .35 : .15;
      const playing = playingHandicapFromUnrounded(entry.value, allowance).rounded;
      const offLow = format === "four-ball" && scoring === "match" ? playing - lowestMember : playing;
      return {
        playerId: entry.id,
        handicapIndex: players.find((player) => player.id === entry.id)!.handicapIndex,
        courseHandicapUnrounded: entry.value,
        courseHandicap: playingHandicapFromUnrounded(entry.value).rounded,
        allowance,
        playingHandicap: playing,
        strokesOffLow: format === "four-ball" ? offLow : 0,
        strokesByHole: format === "four-ball" ? strokesByHole(offLow, holes) : Array(holes.length).fill(0),
      };
    });
    const formula = format === "four-ball" ? (scoring === "match" ? "90%-per-player" : "85%-per-player")
      : format === "alternate-shot" ? "50%-combined" : "35%-low+15%-high";
    return {
      version: 1 as const,
      teamId: team.id,
      format,
      scoring,
      formula,
      members,
      unrounded: format === "four-ball" ? members.reduce((sum, member) => sum + member.courseHandicapUnrounded * member.allowance, 0) : result.unrounded,
      playingHandicap: format === "four-ball" ? 0 : result.rounded,
      strokesOffLow: format === "four-ball" ? 0 : teamOffLow,
      strokesByHole: format === "four-ball" ? Array(holes.length).fill(0) : strokesByHole(teamOffLow, holes),
    };
  }));
}

/** Stable choice: completion, fewer penalties, shortest leave, roster order, shot ID. */
export function chooseDeterministicScrambleBall(candidates: readonly TeamBallCandidate[], playerOrder: readonly string[]): TeamBallCandidate {
  if (candidates.length !== 2 || new Set(candidates.map((candidate) => candidate.playerId)).size !== 2) throw new Error("A scramble choice requires one candidate from each partner.");
  return [...candidates].sort((a, b) => Number(b.completesHole) - Number(a.completesHole)
    || a.penaltyStrokes - b.penaltyStrokes
    || a.distanceToPin - b.distanceToPin
    || playerOrder.indexOf(a.playerId) - playerOrder.indexOf(b.playerId)
    || a.shotId.localeCompare(b.shotId))[0];
}

/** A penalty is part of the shared score but never consumes the partner's turn. */
export function advanceAlternateShotBall(ball: TeamBallState, holeIndex: number, shot: TeamBallCandidate, playerOrder: readonly string[]): TeamBallState {
  if (playerOrder.length !== 2 || ball.nextPlayerId !== shot.playerId || !playerOrder.includes(shot.playerId)) throw new Error("Alternate shot requires the scheduled partner to play the shared ball.");
  const score = ball.scorecard[holeIndex];
  if (!score || score.status !== "active") throw new Error("Alternate shot requires an active team hole.");
  const strokes = score.strokes + shot.strokeCost;
  const penalties = score.penalties + shot.penaltyStrokes;
  return {
    ...ball,
    ball: { ...shot.rest },
    lie: shot.lie,
    nextPlayerId: playerOrder.find((id) => id !== shot.playerId)!,
    scorecard: ball.scorecard.map((entry, index) => index === holeIndex ? {
      ...score,
      strokes,
      penalties,
      gross: shot.completesHole ? strokes + penalties : null,
      net: shot.completesHole ? strokes + penalties - score.handicapStrokes : null,
      status: shot.completesHole ? "played" as const : "active" as const,
      countedPlayerIds: [...score.countedPlayerIds, shot.playerId],
    } : entry),
  };
}
