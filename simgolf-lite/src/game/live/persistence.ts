import type { SpeedName } from "./liveConfig";
import type { Arrival, Golfer, LiveState, Segment } from "./types";
import { createWeekLedger, normalizeWeekLedger, type LiveWeekLedger } from "./weeklyLedger";
import { emptyPaceDayMetrics } from "./pace";
import { createGolferCapabilities, normalizeGolferCapabilities, stableGolferSeed } from "./capabilities";
import type { StrategicIntentKind } from "./m47Types";

const MAX_GOLFERS = 500;
const MAX_ARRIVALS = 1_000;
const MAX_SEGMENTS_PER_GOLFER = 5_000;
const MAX_M47_PLANS = 36;
const MAX_M47_OUTCOMES = 240;
const MAX_M47_REACTIONS = 36;

export interface LiveSimulationSnapshotV1 {
  version: 1 | 2 | 3 | 4;
  state: Omit<LiveState, "walkCache">;
  pendingCash: number;
  speed: SpeedName;
  selectedGolferId: number | null;
  clockRemainderMinutes?: number;
  weekLedger?: LiveWeekLedger;
}

export interface RestoredLiveSimulation {
  state: LiveState;
  pendingCash: number;
  speed: SpeedName;
  selectedGolferId: number | null;
  clockRemainderMinutes: number;
  weekLedger: LiveWeekLedger;
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
    (value.shot == null || value.shot === "swing" || value.shot === "putt") &&
    (value.concession == null || (
      isRecord(value.concession) && typeof value.concession.buildingType === "string" &&
      finite(value.concession.buildingX) && finite(value.concession.buildingY) &&
      typeof value.concession.item === "string" && finite(value.concession.amount)
    ))
  );
}

const intentKinds = new Set<StrategicIntentKind>(["safe", "hero", "positional", "recovery", "approach"]);
const techniques = new Set(["normal", "draw", "fade", "punch", "flop", "backspin"]);

function fact(value: unknown): boolean {
  return isRecord(value) && ["capability-fit", "risk", "terrain", "next-shot", "context", "outcome"].includes(String(value.code)) && typeof value.detail === "string";
}

function shotIntent(value: unknown): boolean {
  return isRecord(value) && typeof value.id === "string" && intentKinds.has(value.kind as StrategicIntentKind) &&
    point(value.from) && point(value.target) && typeof value.club === "string" && techniques.has(String(value.technique)) &&
    ["power", "expectedStrokes", "variance", "hazardRisk", "nextShotQuality"].every((key) => finite(value[key])) &&
    Array.isArray(value.facts) && value.facts.length <= 8 && value.facts.every(fact);
}

function holePlan(value: unknown): boolean {
  return isRecord(value) && value.version === 1 && typeof value.holeId === "string" && finite(value.par) && finite(value.expectedScore) &&
    shotIntent(value.chosen) && Array.isArray(value.rejected) && value.rejected.length <= 5 && value.rejected.every((alternative) =>
      isRecord(alternative) && intentKinds.has(alternative.kind as StrategicIntentKind) && finite(alternative.expectedStrokes) &&
      typeof alternative.reason === "string" && Array.isArray(alternative.facts) && alternative.facts.length <= 8 && alternative.facts.every(fact)
    );
}

function shotOutcome(value: unknown): boolean {
  return isRecord(value) && value.version === 1 && typeof value.id === "string" && typeof value.holeId === "string" &&
    finite(value.shotNumber) && Number.isInteger(value.shotNumber) && value.shotNumber > 0 && intentKinds.has(value.intent as StrategicIntentKind) &&
    typeof value.intentId === "string" && typeof value.club === "string" && techniques.has(String(value.technique)) &&
    point(value.from) && point(value.aim) && point(value.landing) && point(value.rest) && typeof value.lieBefore === "string" &&
    typeof value.lieAfter === "string" && ["carryYards", "rollYards", "penaltyStrokes", "seed"].every((key) => finite(value[key])) &&
    typeof value.holed === "boolean" && Array.isArray(value.facts) && value.facts.length <= 12 && value.facts.every(fact);
}

function holeReaction(value: unknown): boolean {
  return isRecord(value) && value.version === 1 && typeof value.holeId === "string" &&
    ["expectedScore", "actualScore", "satisfaction"].every((key) => finite(value[key])) &&
    ["delighted", "pleased", "neutral", "frustrated", "unfair"].includes(String(value.outcome)) &&
    Array.isArray(value.facts) && value.facts.length <= 12 && value.facts.every(fact) && typeof value.thought === "string" &&
    (value.memory == null || typeof value.memory === "string");
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
  return typeof value.finished === "boolean" && (value.thought === null || typeof value.thought === "string") &&
    (value.teeSet == null || value.teeSet === "forward" || value.teeSet === "member" || value.teeSet === "championship") &&
    (value.pinRotation == null || value.pinRotation === "A" || value.pinRotation === "B" || value.pinRotation === "C") &&
    (value.courseId == null || typeof value.courseId === "string") &&
    (value.courseName == null || typeof value.courseName === "string") &&
    (value.holeIds == null || (Array.isArray(value.holeIds) && value.holeIds.every((id) => typeof id === "string"))) &&
    (value.currentHoleId == null || typeof value.currentHoleId === "string") &&
    (value.paceIdentityAtVisit == null || (finite(value.paceIdentityAtVisit) && value.paceIdentityAtVisit >= 0 && value.paceIdentityAtVisit <= 1)) &&
    (value.wallet == null || finite(value.wallet)) &&
    (value.purchasedSegmentIndexes == null || (Array.isArray(value.purchasedSegmentIndexes) && value.purchasedSegmentIndexes.every(Number.isInteger))) &&
    (value.tournamentId == null || typeof value.tournamentId === "string") &&
    (value.tournamentEntrantId == null || typeof value.tournamentEntrantId === "string") &&
    (value.capabilities == null || isRecord(value.capabilities)) &&
    (value.currentIntent == null || shotIntent(value.currentIntent)) &&
    (value.holePlans == null || (Array.isArray(value.holePlans) && value.holePlans.length <= MAX_M47_PLANS && value.holePlans.every(holePlan))) &&
    (value.shotOutcomes == null || (Array.isArray(value.shotOutcomes) && value.shotOutcomes.length <= MAX_M47_OUTCOMES && value.shotOutcomes.every(shotOutcome))) &&
    (value.holeReactions == null || (Array.isArray(value.holeReactions) && value.holeReactions.length <= MAX_M47_REACTIONS && value.holeReactions.every(holeReaction)));
}

function arrival(value: unknown): value is Arrival {
  if (!isRecord(value) || !finite(value.atMinute) || typeof value.archetype !== "string") return false;
  if (value.courseId != null && typeof value.courseId !== "string") return false;
  if (value.paceIdentityAtVisit != null && (!finite(value.paceIdentityAtVisit) || value.paceIdentityAtVisit < 0 || value.paceIdentityAtVisit > 1)) return false;
  if (value.tournament == null) return true;
  return isRecord(value.tournament) && typeof value.tournament.eventId === "string" &&
    typeof value.tournament.entrantId === "string" && typeof value.tournament.name === "string" && finite(value.tournament.skill) &&
    (value.tournament.teeSet == null || value.tournament.teeSet === "forward" || value.tournament.teeSet === "member" || value.tournament.teeSet === "championship") &&
    (value.tournament.pinRotation == null || value.tournament.pinRotation === "A" || value.tournament.pinRotation === "B" || value.tournament.pinRotation === "C");
}

function tournament(value: unknown): boolean {
  if (value == null) return true;
  if (!isRecord(value) || typeof value.eventId !== "string" || typeof value.name !== "string") return false;
  if (value.courseId != null && typeof value.courseId !== "string") return false;
  if (value.tier !== "local" && value.tier !== "regional" && value.tier !== "championship") return false;
  if (!Array.isArray(value.standings) || value.standings.length > MAX_GOLFERS) return false;
  if (value.teeSet != null && value.teeSet !== "forward" && value.teeSet !== "member" && value.teeSet !== "championship") return false;
  if (value.pinRotation != null && value.pinRotation !== "A" && value.pinRotation !== "B" && value.pinRotation !== "C") return false;
  return value.standings.every((row) => isRecord(row) && typeof row.entrantId === "string" &&
    (row.golferId === null || Number.isInteger(row.golferId)) && typeof row.name === "string" &&
    typeof row.archetype === "string" && finite(row.holesCompleted) && finite(row.score) &&
    finite(row.scoreToPar) && typeof row.finished === "boolean");
}

function normalizedSpeed(value: unknown): SpeedName | null {
  if (value === "3x") return "4x";
  return value === "paused" || value === "1x" || value === "2x" || value === "4x" ? value : null;
}

function cloneSerializableState(state: Omit<LiveState, "walkCache">): Omit<LiveState, "walkCache"> {
  return JSON.parse(JSON.stringify(state)) as Omit<LiveState, "walkCache">;
}

export function snapshotLiveSimulation(args: {
  state: LiveState;
  pendingCash: number;
  speed: SpeedName;
  selectedGolferId: number | null;
  clockRemainderMinutes?: number;
  weekLedger?: LiveWeekLedger;
}): LiveSimulationSnapshotV1 {
  const { walkCache: _walkCache, ...serializable } = args.state;
  void _walkCache;
  return {
    version: 4,
    state: cloneSerializableState(serializable),
    pendingCash: args.pendingCash,
    speed: args.speed,
    selectedGolferId: args.selectedGolferId,
    clockRemainderMinutes: Math.max(0, args.clockRemainderMinutes ?? 0),
    weekLedger: args.weekLedger ?? createWeekLedger(1),
  };
}

export function restoreLiveSimulation(input: unknown): RestoredLiveSimulation | null {
  if (!isRecord(input) || (input.version !== 1 && input.version !== 2 && input.version !== 3 && input.version !== 4) || !isRecord(input.state)) return null;
  const state = input.state;
  if (!Array.isArray(state.golfers) || state.golfers.length > MAX_GOLFERS || state.golfers.some((g) => !golfer(g))) return null;
  if (!Array.isArray(state.arrivals) || state.arrivals.length > MAX_ARRIVALS || state.arrivals.some((a) => !arrival(a))) return null;
  if (!tournament(state.tournament)) return null;
  if (state.nextTeeFreeAtByCourse != null && (!isRecord(state.nextTeeFreeAtByCourse) || Object.values(state.nextTeeFreeAtByCourse).some((value) => !finite(value)))) return null;
  if (state.perCourse != null && (!isRecord(state.perCourse) || Object.values(state.perCourse).some((value) => {
    if (!isRecord(value) || typeof value.courseName !== "string") return true;
    return ["arrivals", "roundsStarted", "roundsFinished", "greenFees", "satisfactionSum", "promoters", "detractors", "willReturnCount"].some((key) => !finite(value[key]));
  }))) return null;
  for (const key of [
    "dayIndex", "dayMinute", "nextArrivalIdx", "nextGolferId", "greenFeeCollected",
    "roundsStarted", "roundsFinished", "satisfactionSum", "promoters", "detractors",
    "willReturnCount", "reconcileEpoch", "nextTeeFreeAt", "seed",
  ] as const) {
    if (!finite(state[key])) return null;
  }
  if (typeof state.dayOver !== "boolean") return null;
  const speed = normalizedSpeed(input.speed);
  if (!finite(input.pendingCash) || input.pendingCash < 0 || !speed) return null;
  if (input.clockRemainderMinutes != null && (!finite(input.clockRemainderMinutes) || input.clockRemainderMinutes < 0)) return null;
  if (input.selectedGolferId !== null && !Number.isInteger(input.selectedGolferId)) return null;

  const serializable = cloneSerializableState(state as unknown as Omit<LiveState, "walkCache">);
  const stateSeed = finite(state.seed) ? state.seed : 0;
  serializable.golfers = serializable.golfers.map((g) => {
    const fallbackCapabilities = createGolferCapabilities({
      personality: g.personality,
      seed: stableGolferSeed(g.personId ?? `${g.name}:${g.id}`, stateSeed + g.id),
    });
    return {
    ...g,
    capabilities: normalizeGolferCapabilities(g.capabilities, fallbackCapabilities),
    holePlans: Array.isArray(g.holePlans) ? g.holePlans.slice(-MAX_M47_PLANS) : [],
    shotOutcomes: Array.isArray(g.shotOutcomes) ? g.shotOutcomes.slice(-MAX_M47_OUTCOMES) : [],
    holeReactions: Array.isArray(g.holeReactions) ? g.holeReactions.slice(-MAX_M47_REACTIONS) : [],
    wallet: g.wallet ?? 0,
    purchasedSegmentIndexes: g.purchasedSegmentIndexes ?? [],
    teeSet: g.teeSet ?? "member",
    pinRotation: g.pinRotation ?? "A",
    groupId: g.groupId ?? `${g.courseId ?? "course"}-solo-${g.id}`,
    groupStartedAt: g.groupStartedAt ?? serializable.dayMinute,
    waitMinutes: g.waitMinutes ?? 0,
    pacePreference: g.pacePreference ?? g.personality.skill,
    paceIdentityAtVisit: g.paceIdentityAtVisit ?? 0.5,
    marshalInterventions: g.marshalInterventions ?? 0,
    forcedPickups: g.forcedPickups ?? 0,
    drinksServed: g.drinksServed ?? 0,
    alcoholUnits: g.alcoholUnits ?? 0,
    hospitalityDelay: g.hospitalityDelay ?? 0,
    disorderIncidents: g.disorderIncidents ?? 0,
    completionStatus: g.completionStatus === "daylight" || g.completionStatus === "congestion_abandonment"
      ? g.completionStatus
      : "completed",
  };
  });
  serializable.arrivals = serializable.arrivals.map((arrival, index) => ({
    ...arrival,
    groupId: arrival.groupId ?? `${arrival.courseId ?? "course"}-solo-arrival-${index}`,
    paceIdentityAtVisit: arrival.paceIdentityAtVisit ?? 0.5,
  }));
  serializable.groups ??= serializable.golfers.map((g) => ({ id: g.groupId!, courseId: g.courseId ?? "course-primary", bookedAt: g.groupStartedAt ?? serializable.dayMinute, startedAt: g.groupStartedAt ?? serializable.dayMinute, golferIds: [g.id], waitMinutes: g.waitMinutes ?? 0, blocked: false, interventions: g.marshalInterventions ?? 0, pickups: g.forcedPickups ?? 0, finishedAt: null }));
  serializable.pace ??= emptyPaceDayMetrics();
  serializable.pace.perCourse ??= {};
  serializable.marshalCoverageByCourse ??= {};
  serializable.beverageCoverageByCourse ??= {};
  serializable.overtimeRateByCourse ??= {};
  serializable.operationsByCourse ??= {};
  serializable.concessionCollected ??= 0;
  serializable.concessionTransactions ??= [];
  serializable.concessionByType ??= {};
  if (serializable.tournament) {
    serializable.tournament.teeSet ??= "member";
    serializable.tournament.pinRotation ??= "A";
    serializable.tournament.ordinaryPinRotation ??= "A";
    serializable.tournament.qualificationSnapshot ??= {
      eligible: true,
      teeSet: serializable.tournament.teeSet,
      pinRotation: serializable.tournament.pinRotation,
      rating: 0,
      slope: 113,
      effectiveYardage: 0,
      completeRotations: [serializable.tournament.pinRotation],
      requirements: [],
      blockingReasons: [],
    };
  }
  return {
    state: { ...serializable, walkCache: new Map() },
    pendingCash: input.pendingCash,
    speed,
    selectedGolferId: input.selectedGolferId as number | null,
    clockRemainderMinutes: finite(input.clockRemainderMinutes) ? input.clockRemainderMinutes : 0,
    weekLedger: normalizeWeekLedger(input.weekLedger, 1),
  };
}
