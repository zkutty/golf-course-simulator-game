import type { SpeedName } from "./liveConfig";
import type { Arrival, Golfer, LiveState, Segment } from "./types";

const MAX_GOLFERS = 500;
const MAX_ARRIVALS = 1_000;
const MAX_SEGMENTS_PER_GOLFER = 5_000;

export interface LiveSimulationSnapshotV1 {
  version: 1;
  state: Omit<LiveState, "walkCache">;
  pendingCash: number;
  speed: SpeedName;
  selectedGolferId: number | null;
}

export interface RestoredLiveSimulation {
  state: LiveState;
  pendingCash: number;
  speed: SpeedName;
  selectedGolferId: number | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function point(value: unknown, nullable = false): boolean {
  if (nullable && value === null) return true;
  return isRecord(value) && finite(value.x) && finite(value.y);
}

function segment(value: unknown): value is Segment {
  if (!isRecord(value)) return false;
  return (
    (value.kind === "walk" || value.kind === "flight" || value.kind === "pause") &&
    point(value.from) &&
    point(value.to) &&
    finite(value.dur) &&
    value.dur >= 0 &&
    Number.isInteger(value.holeIndex) &&
    (value.shot == null || value.shot === "swing" || value.shot === "putt")
  );
}

function golfer(value: unknown): value is Golfer {
  if (!isRecord(value)) return false;
  if (!Number.isInteger(value.id) || typeof value.name !== "string" || typeof value.archetype !== "string") return false;
  if (!isRecord(value.personality) || typeof value.color !== "string") return false;
  if (!Array.isArray(value.segments) || value.segments.length > MAX_SEGMENTS_PER_GOLFER || value.segments.some((s) => !segment(s))) return false;
  if (!point(value.pos) || !point(value.ball, true)) return false;
  if (!Array.isArray(value.holePar) || value.holePar.some((n) => !finite(n))) return false;
  if (!Array.isArray(value.holeStrokes) || value.holeStrokes.some((n) => !finite(n))) return false;
  for (const key of ["segIndex", "segElapsed", "scoredHoles", "currentHole", "strokes", "scoreToPar", "mood", "thoughtUntil", "spent"] as const) {
    if (!finite(value[key])) return false;
  }
  return typeof value.finished === "boolean" && (value.thought === null || typeof value.thought === "string");
}

function arrival(value: unknown): value is Arrival {
  return isRecord(value) && finite(value.atMinute) && typeof value.archetype === "string";
}

function validSpeed(value: unknown): value is SpeedName {
  return value === "paused" || value === "1x" || value === "2x" || value === "3x";
}

function cloneSerializableState(state: Omit<LiveState, "walkCache">): Omit<LiveState, "walkCache"> {
  return JSON.parse(JSON.stringify(state)) as Omit<LiveState, "walkCache">;
}

export function snapshotLiveSimulation(args: {
  state: LiveState;
  pendingCash: number;
  speed: SpeedName;
  selectedGolferId: number | null;
}): LiveSimulationSnapshotV1 {
  const { walkCache: _walkCache, ...serializable } = args.state;
  void _walkCache;
  return {
    version: 1,
    state: cloneSerializableState(serializable),
    pendingCash: args.pendingCash,
    speed: args.speed,
    selectedGolferId: args.selectedGolferId,
  };
}

export function restoreLiveSimulation(input: unknown): RestoredLiveSimulation | null {
  if (!isRecord(input) || input.version !== 1 || !isRecord(input.state)) return null;
  const state = input.state;
  if (!Array.isArray(state.golfers) || state.golfers.length > MAX_GOLFERS || state.golfers.some((g) => !golfer(g))) return null;
  if (!Array.isArray(state.arrivals) || state.arrivals.length > MAX_ARRIVALS || state.arrivals.some((a) => !arrival(a))) return null;
  for (const key of [
    "dayIndex", "dayMinute", "nextArrivalIdx", "nextGolferId", "greenFeeCollected",
    "roundsStarted", "roundsFinished", "satisfactionSum", "promoters", "detractors",
    "willReturnCount", "reconcileEpoch", "nextTeeFreeAt", "seed",
  ] as const) {
    if (!finite(state[key])) return null;
  }
  if (typeof state.dayOver !== "boolean") return null;
  if (!finite(input.pendingCash) || input.pendingCash < 0 || !validSpeed(input.speed)) return null;
  if (input.selectedGolferId !== null && !Number.isInteger(input.selectedGolferId)) return null;

  const serializable = cloneSerializableState(state as unknown as Omit<LiveState, "walkCache">);
  return {
    state: { ...serializable, walkCache: new Map() },
    pendingCash: input.pendingCash,
    speed: input.speed,
    selectedGolferId: input.selectedGolferId as number | null,
  };
}
