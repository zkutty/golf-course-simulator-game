import type { Course, World } from "../models/types";
import { mulberry32 } from "../../utils/rng";
import { getGolferProfile } from "../sim/golferProfiles";
import { ARCHETYPES, golferName } from "./archetypes";
import { buildGolferRound, entryPoint } from "./golfer";
import { advanceGolfer } from "./golfer";
import { planDay } from "./spawn";
import { LIVE } from "./liveConfig";
import type {
  Arrival,
  FinishedRound,
  Golfer,
  GolferRenderData,
  GolferSnapshot,
  LiveState,
} from "./types";

export function createLiveState(
  course: Course,
  world: World,
  dayIndex: number
): LiveState {
  const seed = (world.runSeed | 0) + dayIndex * 7919;
  const arrivals = planDay(course, world, seed);
  return {
    dayIndex,
    dayMinute: LIVE.day.openMinute,
    golfers: [],
    finishedRounds: [],
    arrivals,
    nextArrivalIdx: 0,
    nextGolferId: 1,
    greenFeeCollected: 0,
    roundsStarted: 0,
    roundsFinished: 0,
    satisfactionSum: 0,
    dayOver: false,
    seed,
  };
}

function spawnGolfer(state: LiveState, course: Course, arrival: Arrival): Golfer {
  const id = state.nextGolferId++;
  const arch = ARCHETYPES[arrival.archetype];
  const profile = getGolferProfile(arch.solverProfile, course);
  const rng = mulberry32(state.seed + id * 131);
  const entry = entryPoint(course);
  const round = buildGolferRound({
    course,
    profile,
    entry,
    rng,
    puttVariance: arch.puttVariance,
  });
  return {
    id,
    name: golferName(rng(), rng()),
    archetype: arch.name,
    color: arch.color,
    segments: round.segments,
    segIndex: 0,
    segElapsed: 0,
    pos: { ...entry },
    ball: null,
    holePar: round.holePar,
    holeStrokes: round.holeStrokes,
    holeNumbers: round.holeNumbers,
    scoredHoles: 0,
    currentHole: -1,
    strokes: 0,
    scoreToPar: 0,
    mood: LIVE.mood.start,
    waiting: false,
    waitMinutes: 0,
    thought: null,
    thoughtUntil: 0,
    finished: false,
    spent: course.baseGreenFee, // green fee paid on arrival
  };
}

export interface StepEvents {
  cashDelta: number; // green fees collected this step
  finishedThisStep: number;
}

// Advance the live day by dtMin game-minutes. Mutates and returns state; also
// returns the cash collected this step so the caller can update world.cash.
export function stepLive(
  state: LiveState,
  course: Course,
  dtMin: number
): StepEvents {
  if (state.dayOver || dtMin <= 0) return { cashDelta: 0, finishedThisStep: 0 };

  state.dayMinute += dtMin;
  let cashDelta = 0;
  let finishedThisStep = 0;

  // Spawn any arrivals that are now due (no arrivals after close).
  while (
    state.nextArrivalIdx < state.arrivals.length &&
    state.arrivals[state.nextArrivalIdx].atMinute <= state.dayMinute &&
    state.dayMinute <= LIVE.day.closeMinute
  ) {
    const arrival = state.arrivals[state.nextArrivalIdx++];
    const golfer = spawnGolfer(state, course, arrival);
    state.golfers.push(golfer);
    state.roundsStarted++;
    cashDelta += course.baseGreenFee;
    state.greenFeeCollected += course.baseGreenFee;
  }

  // Tee-time pacing (ZKU-110): a golfer occupies a hole once they're past its
  // gate (still-approaching and gate-blocked golfers don't count). Capacity is
  // claimed inside canEnter so earlier-spawned golfers get priority this step.
  const occupancy = new Map<number, number>();
  for (const g of state.golfers) {
    const seg = g.segments[g.segIndex];
    if (seg && seg.holeIndex >= 0 && !seg.gate) {
      occupancy.set(seg.holeIndex, (occupancy.get(seg.holeIndex) ?? 0) + 1);
    }
  }
  const canEnter = (holeIndex: number): boolean => {
    const n = occupancy.get(holeIndex) ?? 0;
    if (n >= LIVE.pace.holeCapacity) return false;
    occupancy.set(holeIndex, n + 1);
    return true;
  };

  // Advance every golfer; retire finished ones.
  const stillPlaying: Golfer[] = [];
  for (const g of state.golfers) {
    advanceGolfer(g, dtMin, course.condition, canEnter);
    if (g.finished) {
      state.satisfactionSum += g.mood * 100;
      state.roundsFinished++;
      finishedThisStep++;
      state.finishedRounds.push(toFinishedRound(g));
    } else {
      stillPlaying.push(g);
    }
  }
  state.golfers = stillPlaying;

  const allArrived = state.nextArrivalIdx >= state.arrivals.length;
  if (state.dayMinute >= LIVE.day.closeMinute && allArrived && state.golfers.length === 0) {
    state.dayOver = true;
  }

  return { cashDelta, finishedThisStep };
}

export function liveRenderData(state: LiveState): GolferRenderData[] {
  const out: GolferRenderData[] = [];
  // Golfers queued at the same tee stand in a short diagonal line instead of
  // stacking on one tile (slot = how many earlier waiters share the spot).
  const queueSlots = new Map<string, number>();
  for (const g of state.golfers) {
    let qx = 0;
    let qy = 0;
    if (g.waiting) {
      const key = `${Math.round(g.pos.x)},${Math.round(g.pos.y)}`;
      const slot = queueSlots.get(key) ?? 0;
      queueSlots.set(key, slot + 1);
      qx = -0.55 * slot;
      qy = 0.35 * slot;
    }
    out.push({
      id: g.id,
      x: g.pos.x + qx,
      y: g.pos.y + qy,
      ballX: g.ball ? g.ball.x : null,
      ballY: g.ball ? g.ball.y : null,
      color: g.color,
      mood: g.mood,
      thought: g.thought,
    });
  }
  return out;
}

function toFinishedRound(g: Golfer): FinishedRound {
  return {
    id: g.id,
    name: g.name,
    archetype: g.archetype,
    strokes: g.strokes,
    scoreToPar: g.scoreToPar,
    mood: g.mood,
    spent: g.spent,
    holeNumbers: g.holeNumbers,
    holePar: g.holePar,
    holeStrokes: g.holeStrokes,
    holesPlayed: g.scoredHoles,
  };
}

// Snapshot a golfer for the inspector UI. Falls back to today's finished
// rounds so a selected golfer who walks off still shows their final card.
export function snapshotGolfer(state: LiveState, id: number): GolferSnapshot | null {
  const g = state.golfers.find((x) => x.id === id);
  if (g) {
    return {
      id: g.id,
      name: g.name,
      archetype: g.archetype,
      currentHole: g.currentHole, // segments already carry the course hole index
      strokes: g.strokes,
      scoreToPar: g.scoreToPar,
      mood: g.mood,
      finished: false,
      waiting: g.waiting,
      waitMinutes: g.waitMinutes,
      spent: g.spent,
      holes: g.holePar.map((par, i) => ({
        holeNumber: g.holeNumbers[i],
        par,
        strokes: i < g.scoredHoles ? g.holeStrokes[i] : null,
      })),
    };
  }
  const f = state.finishedRounds.find((x) => x.id === id);
  if (f) {
    return {
      id: f.id,
      name: f.name,
      archetype: f.archetype,
      currentHole: -1,
      strokes: f.strokes,
      scoreToPar: f.scoreToPar,
      mood: f.mood,
      finished: true,
      waiting: false,
      waitMinutes: 0,
      spent: f.spent,
      holes: f.holePar.map((par, i) => ({
        holeNumber: f.holeNumbers[i],
        par,
        strokes: i < f.holesPlayed ? f.holeStrokes[i] : null,
      })),
    };
  }
  return null;
}

export function avgSatisfactionSoFar(state: LiveState): number {
  if (state.roundsFinished === 0) return LIVE.mood.start * 100;
  return state.satisfactionSum / state.roundsFinished;
}
