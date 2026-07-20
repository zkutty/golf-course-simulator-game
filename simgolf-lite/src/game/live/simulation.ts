import type { Course, Point, World } from "../models/types";
import { mulberry32 } from "../../utils/rng";
import { getGolferProfile } from "../sim/golferProfiles";
import { scoreCourseHoles } from "../sim/holes";
import { ARCHETYPES, golferName } from "./archetypes";
import { rollPersonality, solverProfileForSkill } from "./personality";
import { getDifficultyProfile } from "../balance/difficulty";
import { buildGolferRound, entryPoint, planFromHole } from "./golfer";
import { advanceGolfer } from "./golfer";
import { planDay } from "./spawn";
import { findWalkPath } from "./walkPath";
import { LIVE } from "./liveConfig";
import type { Arrival, Golfer, GolferRenderData, LiveState, RoundReactions } from "./types";
import { rollDiscretionaryWallet } from "./concessions";
import type { CompletedRound } from "../retention/types";
import { createLiveTournament, planTournamentDay, tournamentForDate, updateTournamentStanding } from "../tournaments/tournaments";

// A memoized walk router bound to a course + per-day cache. Golfers spawned the
// same day share cached routes, so pathfinding runs at most once per (from,to).
function makeRouter(course: Course, cache: Map<string, Point[] | null>) {
  return (from: Point, to: Point): Point[] | null => {
    const key = `${Math.round(from.x)},${Math.round(from.y)}>${Math.round(to.x)},${Math.round(to.y)}`;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    const path = findWalkPath(course, from, to);
    cache.set(key, path);
    return path;
  };
}

export function createLiveState(
  course: Course,
  world: World,
  dayIndex: number
): LiveState {
  const seed = (world.runSeed | 0) + dayIndex * 7919;
  const tournamentEvent = tournamentForDate(world, dayIndex);
  const arrivals = tournamentEvent
    ? planTournamentDay(tournamentEvent, LIVE.day.firstArrivalMinute, LIVE.day.teeGapMinutes)
    : planDay(course, world, seed);
  return {
    difficulty: world.difficulty,
    dayIndex,
    dayMinute: LIVE.day.openMinute,
    golfers: [],
    arrivals,
    nextArrivalIdx: 0,
    nextGolferId: 1,
    greenFeeCollected: 0,
    concessionCollected: 0,
    concessionTransactions: [],
    concessionByType: {},
    roundsStarted: 0,
    roundsFinished: 0,
    satisfactionSum: 0,
    promoters: 0,
    detractors: 0,
    willReturnCount: 0,
    reconcileEpoch: 0,
    nextTeeFreeAt: 0,
    walkCache: new Map(),
    dayOver: false,
    seed,
    tournament: tournamentEvent ? createLiveTournament(tournamentEvent) : undefined,
  };
}

// Turn a finished golfer's observed round into a discrete reaction. Kept here
// (not on the golfer) so it reads only final state and stays deterministic.
function classifyReaction(g: Golfer): { promoter: boolean; detractor: boolean; willReturn: boolean } {
  const r = LIVE.reactions;
  const returnScore = g.mood + (g.personality.patience - 0.5) * r.returnPatienceNudge;
  return {
    promoter: g.mood >= r.promoterMood,
    detractor: g.mood <= r.detractorMood,
    willReturn: returnScore >= r.returnMood,
  };
}

function spawnGolfer(state: LiveState, course: Course, arrival: Arrival): Golfer {
  const id = state.nextGolferId++;
  const arch = ARCHETYPES[arrival.archetype];
  const rng = mulberry32(state.seed + id * 131);
  // Roll this individual's personality, then plan their round from the shot
  // model their rolled skill implies (not a fixed per-archetype tier).
  const dp = getDifficultyProfile(state.difficulty);
  const rolledPersonality = rollPersonality(arch.personality, rng, {
    patience: dp.patienceMult,
    spend: dp.spendMult,
  });
  const personality = arrival.tournament
    ? { ...rolledPersonality, skill: Math.max(0, Math.min(1, arrival.tournament.skill)), consistency: Math.max(rolledPersonality.consistency, .62) }
    : rolledPersonality;
  const profile = getGolferProfile(solverProfileForSkill(personality.skill), course);
  const entry = entryPoint(course);
  const wallet = rollDiscretionaryWallet(personality, rng);
  const round = buildGolferRound({
    course,
    profile,
    entry,
    rng,
    personality,
    route: makeRouter(course, state.walkCache),
    wallet,
  });
  return {
    id,
    name: arrival.tournament?.name ?? golferName(rng(), rng()),
    archetype: arch.name,
    personality,
    color: arch.color,
    segments: round.segments,
    segIndex: 0,
    segElapsed: 0,
    pos: { ...entry },
    ball: null,
    holePar: round.holePar,
    holeStrokes: round.holeStrokes,
    scoredHoles: 0,
    currentHole: -1,
    strokes: 0,
    scoreToPar: 0,
    mood: LIVE.mood.start,
    thought: null,
    thoughtUntil: 0,
    finished: false,
    spent: 0,
    wallet,
    purchasedSegmentIndexes: [],
    tournamentId: arrival.tournament?.eventId,
    tournamentEntrantId: arrival.tournament?.entrantId,
  };
}

/** Seed 100 active golfers across one immutable round plan for render perf QA. */
export function createRenderPerfLiveState(course: Course, world: World): LiveState {
  const state = createLiveState(course, world, 0);
  const template = spawnGolfer(state, course, { atMinute: LIVE.day.openMinute, archetype: "casual" });
  const colors = Object.values(ARCHETYPES).map((archetype) => archetype.color);
  state.golfers = Array.from({ length: 100 }, (_, index) => {
    const holeIndex = index % 18;
    const pos = { x: 12 + ((index * 17) % 85), y: 5 + holeIndex * 3 };
    const to = { x: Math.min(course.width - 2, pos.x + 1), y: pos.y };
    return {
      ...template,
      id: index + 1,
      name: `Perf Golfer ${index + 1}`,
      color: colors[index % colors.length],
      segments: [{ kind: "walk" as const, from: pos, to, holeIndex, dur: 10_000 }],
      segIndex: 0,
      segElapsed: (index % 100) * 10,
      pos,
      ball: null,
      currentHole: holeIndex,
      holePar: new Array(18).fill(5),
      holeStrokes: new Array(18).fill(5),
      mood: 0.2 + (index % 8) * 0.1,
    };
  });
  state.arrivals = [];
  state.nextArrivalIdx = 0;
  state.nextGolferId = 101;
  state.roundsStarted = 100;
  state.dayMinute = LIVE.day.openMinute + 240;
  state.nextTeeFreeAt = state.dayMinute + LIVE.day.teeGapMinutes;
  return state;
}

export interface StepEvents {
  cashDelta: number; // green fees collected this step
  finishedThisStep: number;
  completedRounds: CompletedRound[];
}

// Advance the live day by dtMin game-minutes. Mutates and returns state; also
// returns the cash collected this step so the caller can update world.cash.
export function stepLive(
  state: LiveState,
  course: Course,
  dtMin: number
): StepEvents {
  if (state.dayOver || dtMin <= 0) return { cashDelta: 0, finishedThisStep: 0, completedRounds: [] };

  state.dayMinute += dtMin;
  let cashDelta = 0;
  let finishedThisStep = 0;
  const completedRounds: CompletedRound[] = [];

  // Spawn arrivals that are now due (no arrivals after close). The first tee
  // only clears every `teeGapMinutes`, so backed-up arrivals queue instead of
  // all teeing off together (ZKU-110).
  while (
    state.nextArrivalIdx < state.arrivals.length &&
    state.arrivals[state.nextArrivalIdx].atMinute <= state.dayMinute &&
    state.dayMinute <= LIVE.day.closeMinute &&
    state.dayMinute >= state.nextTeeFreeAt
  ) {
    const arrival = state.arrivals[state.nextArrivalIdx++];
    const golfer = spawnGolfer(state, course, arrival);
    state.golfers.push(golfer);
    state.roundsStarted++;
    state.nextTeeFreeAt = state.dayMinute + LIVE.day.teeGapMinutes;
    // Hosted-event players are in the contracted field; the sponsor/hosting
    // award is settled after results instead of charging each entrant a fee.
    if (!arrival.tournament) {
      cashDelta += course.baseGreenFee;
      state.greenFeeCollected += course.baseGreenFee;
      golfer.spent += course.baseGreenFee;
    }
  }

  // Advance every golfer; retire finished ones.
  const stillPlaying: Golfer[] = [];
  for (const g of state.golfers) {
    const previousSegment = g.segIndex;
    advanceGolfer(g, dtMin, course.condition);
    if (state.tournament) updateTournamentStanding(state.tournament, g);
    for (let i = previousSegment; i <= Math.min(g.segIndex, g.segments.length - 1); i++) {
      const concession = g.segments[i]?.concession;
      if (!concession || g.purchasedSegmentIndexes.includes(i) || g.wallet < concession.amount) continue;
      g.purchasedSegmentIndexes.push(i);
      g.wallet -= concession.amount;
      g.spent += concession.amount;
      g.thought = `Bought ${concession.item.toLowerCase()} for $${concession.amount}`;
      g.thoughtUntil = state.dayMinute + 18;
      const transaction = {
        id: `${state.seed}-${g.id}-${i}`,
        golferId: g.id,
        golferName: g.name,
        buildingType: concession.buildingType,
        buildingX: concession.buildingX,
        buildingY: concession.buildingY,
        item: concession.item,
        amount: concession.amount,
        atMinute: state.dayMinute,
      };
      state.concessionTransactions.push(transaction);
      state.concessionCollected += concession.amount;
      state.concessionByType[concession.buildingType] =
        (state.concessionByType[concession.buildingType] ?? 0) + concession.amount;
      cashDelta += concession.amount;
    }
    if (g.finished) {
      state.satisfactionSum += g.mood * 100;
      state.roundsFinished++;
      const reaction = classifyReaction(g);
      if (reaction.promoter) state.promoters++;
      if (reaction.detractor) state.detractors++;
      if (reaction.willReturn) state.willReturnCount++;
      finishedThisStep++;
      completedRounds.push({
        golferId: g.id,
        golferName: g.name,
        archetype: g.archetype,
        score: g.strokes,
        scoreToPar: g.scoreToPar,
        holePar: g.holePar.slice(),
        holeStrokes: g.holeStrokes.slice(),
        mood: g.mood,
        tournamentId: g.tournamentId,
        tournamentEntrantId: g.tournamentEntrantId,
      });
    } else {
      stillPlaying.push(g);
    }
  }
  state.golfers = stillPlaying;

  const allArrived = state.nextArrivalIdx >= state.arrivals.length;
  if (state.dayMinute >= LIVE.day.closeMinute && allArrived && state.golfers.length === 0) {
    state.dayOver = true;
  }

  return { cashDelta, finishedThisStep, completedRounds };
}

export function liveRenderData(state: LiveState, out: GolferRenderData[] = []): GolferRenderData[] {
  let outIndex = 0;
  for (const g of state.golfers) {
    // Animation facts (ZKU-153): current segment kind/progress, the stroke
    // being played, and a facing direction. Pure derivation — no sim state
    // is touched. The pause before a flight is the address/swing windup, so
    // its facing and shot come from the upcoming flight; that lets the
    // renderer land the contact frame exactly when the ball launches.
    const seg = g.segments[g.segIndex];
    const segKind = seg?.kind ?? null;
    const segT = seg ? (seg.dur > 0 ? Math.max(0, Math.min(1, g.segElapsed / seg.dur)) : 1) : 0;
    let shot: "swing" | "putt" | null = null;
    let dirX = 0;
    let dirY = 0;
    if (seg) {
      let aim: { from: { x: number; y: number }; to: { x: number; y: number } } | null = null;
      if (seg.kind === "walk") {
        aim = seg;
      } else if (seg.kind === "flight") {
        shot = seg.shot ?? "swing";
        aim = seg;
      } else {
        const next = g.segments[g.segIndex + 1];
        if (next?.kind === "flight") {
          shot = next.shot ?? "swing";
          aim = next;
        }
      }
      if (aim) {
        const dx = aim.to.x - aim.from.x;
        const dy = aim.to.y - aim.from.y;
        const len = Math.hypot(dx, dy);
        if (len > 1e-6) {
          dirX = dx / len;
          dirY = dy / len;
        }
      }
    }
    const next: GolferRenderData = {
      id: g.id,
      x: g.pos.x,
      y: g.pos.y,
      ballX: g.ball ? g.ball.x : null,
      ballY: g.ball ? g.ball.y : null,
      ballToX: g.ball && seg?.kind === "flight" ? seg.to.x : null,
      ballToY: g.ball && seg?.kind === "flight" ? seg.to.y : null,
      color: g.color,
      mood: g.mood,
      thought: g.thought,
      archetype: g.archetype,
      segKind,
      segT,
      shot,
      dirX,
      dirY,
      scoredHoles: g.scoredHoles,
      lastHoleDelta:
        g.scoredHoles > 0
          ? (g.holeStrokes[g.scoredHoles - 1] ?? 0) - (g.holePar[g.scoredHoles - 1] ?? 0)
          : 0,
    };
    if (out[outIndex]) Object.assign(out[outIndex], next);
    else out.push(next);
    outIndex += 1;
  }
  out.length = outIndex;
  return out;
}

export function avgSatisfactionSoFar(state: LiveState): number {
  if (state.roundsFinished === 0) return LIVE.mood.start * 100;
  return state.satisfactionSum / state.roundsFinished;
}

// Aggregate the day's real finished-round reactions for the reputation model.
export function roundReactions(state: LiveState): RoundReactions {
  const rounds = state.roundsFinished;
  return {
    rounds,
    avgSatisfaction: avgSatisfactionSoFar(state),
    promoters: state.promoters,
    detractors: state.detractors,
    willReturnRate: rounds > 0 ? state.willReturnCount / rounds : 0,
  };
}

// Index of the n-th (0-based) currently-valid, complete hole, or -1 if there
// are fewer than n+1 of them. Used to find the hole a golfer should resume on.
function nthValidHoleIndex(course: Course, n: number): number {
  const summary = scoreCourseHoles(course);
  let count = 0;
  for (let i = 0; i < course.holes.length; i++) {
    const hole = course.holes[i];
    const info = summary.holes[i];
    if (!hole.tee || !hole.green || !info?.isComplete || !info?.isValid) continue;
    if (count === n) return i;
    count++;
  }
  return -1;
}

// Re-plan every in-progress golfer against an edited course (ZKU-136).
//
// Holes already scored are kept as-is; the golfer restarts their current hole
// on the new terrain, walking from wherever they stand to that hole's tee. This
// freezes committed history but stops golfers from walking a stale itinerary
// (e.g. flying over freshly-painted water) for the rest of the round.
export function reconcileGolfers(state: LiveState, course: Course): void {
  state.reconcileEpoch++;
  state.walkCache.clear(); // terrain changed → cached routes are stale
  const exit = entryPoint(course);
  for (const g of state.golfers) {
    if (g.finished) continue;
    // The hole to resume on is the next one not yet folded into the score.
    const startHole = nthValidHoleIndex(course, g.scoredHoles);
    if (startHole < 0) continue; // nothing left to play; let them walk off

    const rng = mulberry32(state.seed + g.id * 911 + state.reconcileEpoch * 17);
    const profile = getGolferProfile(solverProfileForSkill(g.personality.skill), course);
    const from: Point = { x: g.pos.x, y: g.pos.y };
    const replanned = planFromHole({
      course,
      profile,
      personality: g.personality,
      rng,
      startHole,
      cursor: from,
      exit,
      route: makeRouter(course, state.walkCache),
      wallet: g.wallet,
    });

    // Splice: keep scored holes, replace the unplayed tail with the new plan.
    g.holePar = g.holePar.slice(0, g.scoredHoles).concat(replanned.holePar);
    g.holeStrokes = g.holeStrokes.slice(0, g.scoredHoles).concat(replanned.holeStrokes);
    g.segments = replanned.segments;
    g.segIndex = 0;
    g.segElapsed = 0;
    g.ball = null;
    g.currentHole = startHole;
  }
}
