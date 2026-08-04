import { roundHalfAwayFromZero, strokesByHole, strokesOffLow } from "./handicap";
import type { CompetitionHole, CompetitionPlayer, HoleScore, MeasurementEvidence, ScorecardPlayer, Settlement, TeamFormat, TeamHoleMemberScore } from "./types";

export interface HoleResult { gross: number; net: number; stableford: number; strokes: number; }
export interface StrokePlayResult { playerId: string; gross: number; net: number; stableford: number; holes: HoleResult[]; }

function requirePlayed(score: HoleScore | undefined, playerId: string, holeId: string): number {
  if (!score || score.status === "withdrawn") throw new Error(`${playerId} withdrew before completing ${holeId}.`);
  if (!Number.isInteger(score.gross) || score.gross! <= 0) throw new Error(`${playerId} requires a positive gross score for ${holeId}.`);
  return score.gross!;
}

/** Net double bogey maximum used for adjusted gross; PCC is deliberately excluded. */
export function adjustedGrossScore(player: ScorecardPlayer, holes: readonly CompetitionHole[]): number {
  const strokes = strokesByHole(player.playingHandicap, holes);
  return holes.reduce((total, hole, index) => {
    const gross = requirePlayed(player.holeScores[index], player.id, hole.id);
    return total + Math.min(gross, hole.par + 2 + strokes[index]);
  }, 0);
}

/** WHS differential without PCC or committee-score safeguards. */
export function scoreDifferentialUnrounded(adjustedGross: number, courseRating: number, slopeRating: number): number {
  if (!Number.isFinite(adjustedGross) || !Number.isFinite(courseRating) || !Number.isFinite(slopeRating) || slopeRating <= 0) throw new Error("A finite adjusted score, rating, and positive slope are required.");
  return (adjustedGross - courseRating) * 113 / slopeRating;
}

/** A posted WHS-style differential is reported to one decimal place. */
export function scoreDifferential(adjustedGross: number, courseRating: number, slopeRating: number): number {
  return roundHalfAwayFromZero(scoreDifferentialUnrounded(adjustedGross, courseRating, slopeRating) * 10) / 10;
}

export function stablefordPoints(gross: number, par: number, strokes: number): number {
  const netToPar = gross - strokes - par;
  if (netToPar >= 2) return 0;
  if (netToPar === 1) return 1;
  if (netToPar === 0) return 2;
  if (netToPar === -1) return 3;
  if (netToPar === -2) return 4;
  return 5;
}

export function scoreStrokePlay(player: ScorecardPlayer, holes: readonly CompetitionHole[]): StrokePlayResult {
  const strokes = strokesByHole(player.playingHandicap, holes);
  const results = holes.map((hole, index) => {
    const gross = requirePlayed(player.holeScores[index], player.id, hole.id);
    const net = gross - strokes[index];
    return { gross, net, strokes: strokes[index], stableford: stablefordPoints(gross, hole.par, strokes[index]) };
  });
  return { playerId: player.id, gross: results.reduce((sum, hole) => sum + hole.gross, 0), net: results.reduce((sum, hole) => sum + hole.net, 0), stableford: results.reduce((sum, hole) => sum + hole.stableford, 0), holes: results };
}

export interface MatchHoleResult { holeId: string; winnerId?: string; status: "won" | "halved" | "conceded" | "withdrawn"; scores: Record<string, number>; }
export interface MatchPlayResult { holes: MatchHoleResult[]; wins: Record<string, number>; winnerId?: string; margin: number; status: "won" | "halved" | "withdrawn"; }

/** Scores a two-player net match. Conceded scores are supplied explicitly. */
export function scoreMatchPlay(players: readonly CompetitionPlayer[], holes: readonly CompetitionHole[], scores: Readonly<Record<string, readonly HoleScore[]>>): MatchPlayResult {
  if (players.length !== 2) throw new Error("Match play requires exactly two players.");
  const [first, second] = players;
  const offLow = players.map((player) => strokesOffLow(player.playingHandicap, players));
  const firstStrokes = strokesByHole(offLow[0], holes);
  const secondStrokes = strokesByHole(offLow[1], holes);
  const wins: Record<string, number> = { [first.id]: 0, [second.id]: 0 };
  let withdrawn: string | undefined;
  const results = holes.map((hole, index) => {
    if (withdrawn) return { holeId: hole.id, status: "withdrawn" as const, scores: {} };
    const one = scores[first.id]?.[index]; const two = scores[second.id]?.[index];
    if (one?.status === "withdrawn" || two?.status === "withdrawn") {
      withdrawn ||= one?.status === "withdrawn" ? first.id : second.id;
      return { holeId: hole.id, status: "withdrawn" as const, scores: {} };
    }
    const oneGross = requirePlayed(one, first.id, hole.id); const twoGross = requirePlayed(two, second.id, hole.id);
    const oneNet = oneGross - firstStrokes[index]; const twoNet = twoGross - secondStrokes[index];
    if (oneNet === twoNet) return { holeId: hole.id, status: "halved" as const, scores: { [first.id]: oneNet, [second.id]: twoNet } };
    const winnerId = oneNet < twoNet ? first.id : second.id; wins[winnerId] += 1;
    const conceded = one?.status === "conceded" || two?.status === "conceded";
    return { holeId: hole.id, winnerId, status: conceded ? "conceded" as const : "won" as const, scores: { [first.id]: oneNet, [second.id]: twoNet } };
  });
  if (withdrawn) return { holes: results, wins, winnerId: withdrawn === first.id ? second.id : first.id, margin: holes.length, status: "withdrawn" };
  const margin = Math.abs(wins[first.id] - wins[second.id]);
  return { holes: results, wins, winnerId: wins[first.id] === wins[second.id] ? undefined : wins[first.id] > wins[second.id] ? first.id : second.id, margin, status: margin ? "won" : "halved" };
}

/**
 * Applies the caller's frozen per-member percentages to raw Course
 * Handicaps. Formats deliberately do not hide these percentages: four-ball
 * match and stroke play use different rules, and an event can override them.
 */
export function teamAllowance(memberCourseHandicaps: readonly number[], percentages: readonly number[]): number {
  if (!memberCourseHandicaps.length || memberCourseHandicaps.length !== percentages.length) throw new Error("Every team member requires one allowance percentage.");
  if (memberCourseHandicaps.some((value) => !Number.isFinite(value)) || percentages.some((value) => !Number.isFinite(value) || value < 0)) throw new Error("Team handicaps and percentages must be finite, non-negative values.");
  return memberCourseHandicaps.reduce((total, handicap, index) => total + handicap * percentages[index], 0);
}

export function teamPlayingHandicap(memberCourseHandicaps: readonly number[], percentages: readonly number[]): { unrounded: number; rounded: number } {
  const unrounded = teamAllowance(memberCourseHandicaps, percentages);
  return { unrounded, rounded: roundHalfAwayFromZero(unrounded) };
}

/** The format has already chosen the representative gross score for the hole. */
export function scoreTeamHole(format: TeamFormat, grossScores: readonly number[], par: number, teamPlayingHandicap: number, strokeIndex: number, holes: readonly CompetitionHole[]): HoleResult {
  if (!grossScores.length || grossScores.some((score) => !Number.isInteger(score) || score <= 0)) throw new Error("Team-hole scores must be positive integers.");
  const stroke = strokesByHole(teamPlayingHandicap, holes)[holes.findIndex((hole) => hole.strokeIndex === strokeIndex)];
  if (stroke == null) throw new Error("Team-hole stroke index is not in the routed card.");
  const gross = format === "four-ball" ? Math.min(...grossScores) : grossScores[0];
  return { gross, strokes: stroke, net: gross - stroke, stableford: stablefordPoints(gross, par, stroke) };
}

export interface TeamNetHoleResult { gross: number; net: number; countedPlayerIds: string[]; }

/**
 * Resolves the counted individual net evidence for formats where every member
 * plays a ball. Alternate shot and scramble submit their single selected-ball
 * evidence; four-ball selects one net ball; Pro-Am selects two including an
 * amateur. Stable ordering makes equal choices reproducible.
 */
export function scoreTeamNetHole(format: TeamFormat, members: readonly TeamHoleMemberScore[]): TeamNetHoleResult {
  if (!members.length || members.some((member) => !member.playerId || !Number.isInteger(member.gross) || !Number.isInteger(member.net) || member.gross <= 0)) throw new Error("Team-hole evidence requires a player ID and positive integer gross/net scores.");
  const ranked = [...members].sort((a, b) => a.net - b.net || a.gross - b.gross || a.playerId.localeCompare(b.playerId));
  if (format === "alternate-shot" || format === "scramble") {
    if (members.length !== 1) throw new Error(`${format} requires exactly one selected team-ball score.`);
    return { gross: members[0].gross, net: members[0].net, countedPlayerIds: [members[0].playerId] };
  }
  if (format === "four-ball") return { gross: ranked[0].gross, net: ranked[0].net, countedPlayerIds: [ranked[0].playerId] };
  let best: TeamHoleMemberScore[] | undefined;
  for (let first = 0; first < ranked.length - 1; first += 1) for (let second = first + 1; second < ranked.length; second += 1) {
    const pair = [ranked[first], ranked[second]];
    if (!pair.some((member) => member.role === "amateur")) continue;
    if (!best || pair[0].net + pair[1].net < best[0].net + best[1].net || (pair[0].net + pair[1].net === best[0].net + best[1].net && pair[0].gross + pair[1].gross < best[0].gross + best[1].gross)) best = pair;
  }
  if (!best) throw new Error("Pro-Am requires two net scores including at least one amateur.");
  return { gross: best[0].gross + best[1].gross, net: best[0].net + best[1].net, countedPlayerIds: best.map((member) => member.playerId) };
}

export function settleSkins(holeWinners: readonly (string | undefined)[], stake: number, priorCarry = 0): Settlement[] {
  if (stake < 0 || priorCarry < 0) throw new Error("Skin stakes and carries cannot be negative.");
  let carry = priorCarry;
  return holeWinners.map((winnerId) => {
    if (!winnerId) { carry += stake; return { status: "carried", amount: 0, carry }; }
    const amount = stake + carry; carry = 0; return { status: "settled", winnerId, amount, carry };
  });
}

export function settleNassau(segmentWinners: readonly (string | undefined)[], stake: number): Settlement[] {
  if (stake < 0) throw new Error("Nassau stake cannot be negative.");
  return segmentWinners.map((winnerId) => winnerId ? { status: "settled", winnerId, amount: stake, carry: 0 } : { status: "tie", amount: 0, carry: 0 });
}

export function settleClosestToPinOrLongestDrive(winnerId: string | undefined, stake: number, eligible: boolean, withdrawn = false): Settlement {
  if (stake < 0) throw new Error("Prize stake cannot be negative.");
  if (withdrawn) return { status: "withdrawn", amount: 0, carry: 0, reason: "Competitor withdrew." };
  if (!eligible) return { status: "refunded", amount: stake, carry: 0, reason: "No eligible measurement." };
  return winnerId ? { status: "settled", winnerId, amount: stake, carry: 0 } : { status: "tie", amount: 0, carry: 0 };
}

/** Resolves raw closest-to-pin (lowest) or longest-drive (highest) evidence. */
export function settleMeasuredContest(kind: "closest-to-pin" | "longest-drive", evidence: readonly MeasurementEvidence[], stake: number): Settlement {
  const eligible = evidence.filter((entry) => entry.eligible && !entry.withdrawn && Number.isFinite(entry.measurement));
  if (!eligible.length) return settleClosestToPinOrLongestDrive(undefined, stake, false, evidence.some((entry) => entry.withdrawn));
  const target = kind === "closest-to-pin" ? Math.min(...eligible.map((entry) => entry.measurement)) : Math.max(...eligible.map((entry) => entry.measurement));
  const winners = eligible.filter((entry) => entry.measurement === target);
  return settleClosestToPinOrLongestDrive(winners.length === 1 ? winners[0].playerId : undefined, stake, true);
}
