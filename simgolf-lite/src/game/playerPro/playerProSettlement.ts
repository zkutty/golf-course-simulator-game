import {
  PLAYER_PRO_SKILLS,
  type PlayerCareerRound,
  type PlayerPlayableRound,
  type PlayerProCareer,
  type PlayerProSkill,
  type PlayerProSkills,
  type PlayerShotTechnique,
  type PlayerTournamentRecord,
} from "../models/playerProTypes";
import type { TournamentEvent, TournamentStanding } from "../tournaments/types";
import { mulberry32 } from "../../utils/rng";
import { absoluteDayFor } from "../seasons/seasons";
import { createHandicapScoreRecord, postCompletedHandicapRound } from "../competition/persistence";
import { applyRoundConfidence, confidenceAtDay } from "./confidence";

const XP_PER_LEVEL = 12;
const MAX_HISTORY = 40;
const TECHNIQUE_GATES: Record<Exclude<PlayerShotTechnique, "normal">, { skill: PlayerProSkill; value: number }> = {
  draw: { skill: "driving", value: 48 },
  fade: { skill: "irons", value: 48 },
  punch: { skill: "recovery", value: 46 },
  flop: { skill: "shortGame", value: 55 },
  backspin: { skill: "irons", value: 62 },
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function scoreToPar(round: PlayerPlayableRound): number {
  const playedPar = round.scorecard.filter((hole) => hole.complete).reduce((sum, hole) => sum + hole.par, 0);
  return round.strokes + round.penalties - playedPar;
}

function unlockTechniques(skills: PlayerProSkills): PlayerShotTechnique[] {
  return [
    "normal",
    ...(Object.entries(TECHNIQUE_GATES) as Array<[Exclude<PlayerShotTechnique, "normal">, { skill: PlayerProSkill; value: number }]> )
      .filter(([, gate]) => skills[gate.skill] >= gate.value)
      .map(([technique]) => technique),
  ];
}

function projectedOpponentStrokes(round: PlayerPlayableRound, skill: number, salt: number): number {
  const par = round.scorecard.reduce((sum, hole) => sum + hole.par, 0);
  const rng = mulberry32(round.rngSeed ^ salt);
  const handicap = Math.round((1 - clamp(skill, 0, 1)) * round.scorecard.length * 1.15);
  return Math.max(round.scorecard.length, par + handicap + Math.floor(rng() * 5) - 2);
}

export interface PlayerRoundSettlement {
  career: PlayerProCareer;
  cashDelta: number;
  reputationDelta: number;
  round: PlayerCareerRound | null;
  tournamentEvent?: TournamentEvent;
}

export function settlePlayerRound(career: PlayerProCareer, round: PlayerPlayableRound, event?: TournamentEvent): PlayerRoundSettlement {
  const ledgerId = `round:${round.id}`;
  if ((round.phase !== "round_complete" && round.phase !== "conceded") || career.settlementLedger.includes(ledgerId)) {
    return { career, cashDelta: 0, reputationDelta: 0, round: null };
  }
  const evidence = round.shots.flatMap((shot) => shot.evidence);
  const skillXp = { ...career.skillXp };
  const skills = { ...career.skills };
  const skillGains: Partial<PlayerProSkills> = {};
  for (const skill of PLAYER_PRO_SKILLS) {
    const relevant = evidence.filter((item) => item.skill === skill);
    let awarded = 0;
    relevant.forEach((item, index) => {
      awarded += item.amount * (item.successful ? 1 : 0.35) / (1 + index * 0.2);
    });
    awarded = Math.min(18, awarded);
    const beforeLevel = Math.floor(skillXp[skill] / XP_PER_LEVEL);
    skillXp[skill] += awarded;
    const afterLevel = Math.floor(skillXp[skill] / XP_PER_LEVEL);
    const gain = Math.max(0, Math.min(100 - skills[skill], afterLevel - beforeLevel));
    if (gain > 0) {
      skills[skill] += gain;
      skillGains[skill] = gain;
    }
  }
  const totalPar = round.scorecard.reduce((sum, hole) => sum + hole.par, 0);
  let result: PlayerCareerRound["result"] = round.phase === "conceded" ? "conceded" : "complete";
  let cashDelta = 0;
  let reputationDelta = 0;
  let opponentStrokes: number | undefined;
  if (round.opponent) {
    opponentStrokes = round.opponent.projectedStrokes || projectedOpponentStrokes(round, round.opponent.skill, round.opponent.id.length);
    const playerTotal = round.strokes + round.penalties;
    result = round.phase === "conceded" || playerTotal > opponentStrokes ? "lost" : playerTotal < opponentStrokes ? "won" : "tied";
    cashDelta = round.kind === "wager" ? (result === "won" ? round.opponent.wager : result === "lost" ? -round.opponent.wager : 0) : 0;
    reputationDelta = result === "won" ? 1 : 0;
  }
  let tournamentRecord: PlayerTournamentRecord | undefined;
  let tournamentEvent: TournamentEvent | undefined;
  let trophy = null;
  if (event && round.tournamentId === event.id) {
    const playerTotal = round.strokes + round.penalties;
    const existingPlayer = event.field.some((entrant) => entrant.id === career.identity.id);
    const eligibleOpponents = event.field.filter((entrant) => entrant.id !== career.identity.id);
    const opponents = existingPlayer ? eligibleOpponents : eligibleOpponents.slice(0, Math.max(0, event.field.length - 1));
    const playerEntrant = {
      id: career.identity.id,
      name: career.identity.name,
      archetype: "pro" as const,
      skill: PLAYER_PRO_SKILLS.reduce((sum, skill) => sum + career.skills[skill], 0) / PLAYER_PRO_SKILLS.length / 100,
    };
    const standings: TournamentStanding[] = opponents.map((entrant, index) => {
      const score = projectedOpponentStrokes(round, entrant.skill, index * 977 + entrant.id.length);
      return {
        entrantId: entrant.id,
        golferId: null,
        name: entrant.name,
        archetype: entrant.archetype,
        holesCompleted: round.scorecard.length,
        score,
        scoreToPar: score - totalPar,
        finished: true,
      };
    });
    standings.push({
      entrantId: playerEntrant.id,
      golferId: null,
      name: playerEntrant.name,
      archetype: playerEntrant.archetype,
      holesCompleted: round.scorecard.filter((hole) => hole.complete).length,
      score: playerTotal,
      scoreToPar: playerTotal - totalPar,
      finished: round.phase === "round_complete",
    });
    standings.sort((a, b) => {
      if (a.finished !== b.finished) return a.finished ? -1 : 1;
      if (a.scoreToPar !== b.scoreToPar) return a.scoreToPar - b.scoreToPar;
      if (a.holesCompleted !== b.holesCompleted) return b.holesCompleted - a.holesCompleted;
      return a.name.localeCompare(b.name);
    });
    const finish = standings.findIndex((standing) => standing.entrantId === playerEntrant.id) + 1;
    const field = [...opponents, playerEntrant];
    tournamentEvent = {
      ...event,
      field,
      status: "completed",
      results: standings,
      winnerName: standings[0]?.name,
    };
    const prizeShare = finish === 1 ? 1 : finish <= 3 ? 0.45 : finish <= Math.ceil(field.length / 2) ? 0.12 : 0;
    const prize = Math.round(event.revenueAward * prizeShare);
    cashDelta += prize;
    reputationDelta += finish === 1 ? event.reputationAward : finish <= 3 ? Math.ceil(event.reputationAward / 2) : 0;
    result = finish === 1 ? "won" : "complete";
    tournamentRecord = {
      id: `pro-event-${event.id}`,
      eventId: event.id,
      name: event.name,
      tier: event.tier,
      status: "complete",
      roundId: round.id,
      finish,
      fieldSize: field.length,
      prize,
      settled: true,
    };
    if (finish === 1) trophy = {
      id: `trophy-${event.id}`,
      name: event.name,
      courseId: round.course.courseId,
      courseName: round.course.courseName,
      week: round.startedWeek,
      tournamentId: event.id,
    };
  }
  const careerRound: PlayerCareerRound = {
    id: round.id,
    kind: round.kind,
    courseId: round.course.courseId,
    courseName: round.course.courseName,
    week: round.startedWeek,
    strokes: round.strokes,
    penalties: round.penalties,
    par: totalPar,
    scoreToPar: scoreToPar(round),
    result,
    opponentId: round.opponent?.id,
    opponentName: round.opponent?.name,
    tournamentId: round.tournamentId,
    tournamentName: round.tournamentName,
    earnings: cashDelta,
    scorecard: round.scorecard.map((hole) => ({ ...hole })),
    shots: round.shots.map((shot) => ({
      ...shot,
      from: { ...shot.from },
      aim: { ...shot.aim },
      landing: { ...shot.landing },
      rest: { ...shot.rest },
      evidence: shot.evidence.map((item) => ({ ...item })),
      greenRollout: shot.greenRollout ? structuredClone(shot.greenRollout) : undefined,
      greenPutting: shot.greenPutting ? { ...shot.greenPutting } : undefined,
    })),
    evidence,
    skillGains,
    rulesSnapshot: round.rulesSnapshot,
    handicapSnapshot: round.handicapSnapshot,
  };
  const challenges = career.challenges.map((challenge) => challenge.roundId === round.id ? {
    ...challenge,
    status: "complete" as const,
    result: result === "won" || result === "lost" || result === "tied" || result === "conceded" ? result : "tied",
    relationship: clamp(challenge.relationship + (result === "won" ? 2 : result === "lost" ? 1 : 0), -100, 100),
    settled: true,
  } : challenge);
  const tournaments = tournamentRecord
    ? [...career.tournaments.filter((record) => record.eventId !== tournamentRecord!.eventId), tournamentRecord]
    : career.tournaments;
  const completionDay = absoluteDayFor(round.completedWeek ?? round.startedWeek, round.startedDay);
  let confidence = confidenceAtDay(career.confidence, completionDay);
  const handicapProfile = round.handicapSnapshot
    ? (() => {
        const score = createHandicapScoreRecord(round.handicapSnapshot, {
          roundId: round.id,
          completedWeek: round.completedWeek ?? round.startedWeek,
          completedDay: round.startedDay,
          conceded: round.phase === "conceded",
          source: round.kind === "tournament"
            ? "tournament"
            : round.kind === "friendly" || round.kind === "wager"
              ? "challenge"
              : round.kind === "exhibition"
                ? "practice"
                : "casual",
          scorecard: round.scorecard,
        });
        confidence = applyRoundConfidence(confidence, {
          indexBefore: round.handicapSnapshot.handicapIndex,
          differential: score.evidence.differential,
          conceded: round.phase === "conceded",
        });
        return postCompletedHandicapRound(career.handicapProfile, score);
      })()
    : career.handicapProfile;
  const settledCareer: PlayerProCareer = {
    ...career,
    skills,
    skillXp,
    unlockedTechniques: unlockTechniques(skills),
    careerPoints: career.careerPoints + Math.max(1, round.scorecard.filter((hole) => hole.complete).length) + (result === "won" ? 4 : 0),
    activeRound: null,
    rounds: [...career.rounds, careerRound].slice(-MAX_HISTORY),
    challenges,
    tournaments,
    trophies: trophy ? [...career.trophies, trophy].slice(-40) : career.trophies,
    earnings: career.earnings + cashDelta,
    reputation: clamp(career.reputation + reputationDelta, 0, 100),
    settlementLedger: [...career.settlementLedger, ledgerId].slice(-160),
    handicapProfile,
    confidence,
  };
  return {
    cashDelta,
    reputationDelta,
    round: careerRound,
    tournamentEvent,
    career: settledCareer,
  };
}
