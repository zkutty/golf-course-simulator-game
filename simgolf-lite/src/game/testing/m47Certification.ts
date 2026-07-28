import type { Course, Hole, Point, Terrain, World } from "../models/types";
import { DEFAULT_WORLD } from "../models/defaults";
import { createGolferCapabilities } from "../live/capabilities";
import { buildStrategicGolferRound } from "../live/m47Round";
import type { GolferCapabilities, StrategicHolePlan } from "../live/m47Types";
import type { Personality } from "../live/personality";
import { generateStrategicHolePlan } from "../live/strategicOptions";
import { entryPoint } from "../live/golfer";
import { createLiveState, stepLive } from "../live/simulation";
import { restoreLiveSimulation, snapshotLiveSimulation } from "../live/persistence";
import { completeTournament, createTournamentEvent, scheduleTournament } from "../tournaments/tournaments";
import { mulberry32 } from "../../utils/rng";
import { hashCanonicalValue, hashGameState } from "../../utils/stateHash";
import { createTournamentStandardsCourse } from "./referenceCourse";

export const M47_ROUND_LENGTHS = [9, 18, 36] as const;

export interface M47ReferenceGolfer {
  id: string;
  name: string;
  seed: number;
  personality: Personality;
}

const basePreferences = { scenery: 0.2, price: 0 };
type ReferencePersonalityOverrides = Omit<Partial<Personality>, "prefs"> & { prefs?: Partial<Personality["prefs"]> };

function referencePersonality(overrides: ReferencePersonalityOverrides): Personality {
  return {
    skill: 0.65,
    consistency: 0.65,
    patience: 0.55,
    spendPropensity: 0.5,
    ...overrides,
    prefs: { difficulty: 0, ...basePreferences, ...overrides.prefs },
  };
}

/** Stable identities used by every M47 matrix run. */
export const M47_REFERENCE_GOLFERS: readonly M47ReferenceGolfer[] = [
  { id: "power", name: "Parker Power", seed: 470101, personality: referencePersonality({ skill: .88, consistency: .62, prefs: { difficulty: .55 } }) },
  { id: "accuracy", name: "Avery Accurate", seed: 470102, personality: referencePersonality({ skill: .72, consistency: .94, prefs: { difficulty: -.2 } }) },
  { id: "irons", name: "Iris Irons", seed: 470103, personality: referencePersonality({ skill: .76, consistency: .84, prefs: { difficulty: .1 } }) },
  { id: "short-game", name: "Shay Shortgame", seed: 470104, personality: referencePersonality({ skill: .58, consistency: .9, prefs: { difficulty: -.1 } }) },
  { id: "recovery", name: "Rory Recovery", seed: 470105, personality: referencePersonality({ skill: .54, consistency: .88, prefs: { difficulty: 0 } }) },
  { id: "consistency", name: "Cameron Consistent", seed: 470106, personality: referencePersonality({ skill: .7, consistency: .99, prefs: { difficulty: -.15 } }) },
  { id: "aggressive", name: "Arden Aggressive", seed: 470107, personality: referencePersonality({ skill: .8, consistency: .78, prefs: { difficulty: 1 } }) },
  { id: "conservative", name: "Connie Conservative", seed: 470108, personality: referencePersonality({ skill: .68, consistency: .86, prefs: { difficulty: -1 } }) },
  { id: "casual", name: "Casey Casual", seed: 470109, personality: referencePersonality({ skill: .34, consistency: .38, patience: .7, spendPropensity: .8, prefs: { difficulty: -.75, scenery: .55, price: -.25 } }) },
  { id: "balanced", name: "Bailey Balanced", seed: 470110, personality: referencePersonality({ skill: .67, consistency: .72, prefs: { difficulty: 0 } }) },
];

function setTile(tiles: Terrain[], width: number, point: Point, terrain: Terrain): void {
  if (point.x < 0 || point.y < 0 || point.x >= width) return;
  const index = point.y * width + point.x;
  if (index >= 0 && index < tiles.length) tiles[index] = terrain;
}

function setRect(tiles: Terrain[], width: number, fromX: number, toX: number, centerY: number, radius: number, terrain: Terrain): void {
  for (let x = Math.min(fromX, toX); x <= Math.max(fromX, toX); x++) {
    for (let y = centerY - radius; y <= centerY + radius; y++) setTile(tiles, width, { x, y }, terrain);
  }
}

/**
 * Compact canonical holes with a maintained lane, a lateral bailout, a
 * recoverable hazard crossing, and a visible green. The same geometry is
 * repeated at 9/18/36 holes so only round length changes between fixtures.
 */
export function createM47CertificationCourse(holeCount: 9 | 18 | 36 = 18): Course {
  const width = 84;
  const height = holeCount * 3 + 8;
  const tiles = Array.from({ length: width * height }, () => "rough" as Terrain);
  const elevations = Array.from({ length: width * height }, (_, index) => {
    const x = index % width;
    const y = Math.floor(index / width);
    return Math.max(0, Math.min(4, Math.round(1 + Math.sin(x / 11) + Math.cos(y / 9))));
  });
  const holes: Hole[] = [];

  for (let index = 0; index < holeCount; index++) {
    const y = 4 + index * 3;
    const leftToRight = index % 2 === 0;
    const tee = { x: leftToRight ? 7 : 76, y };
    const green = { x: leftToRight ? 76 : 7, y };
    const direction = leftToRight ? 1 : -1;
    setRect(tiles, width, tee.x, green.x, y, 2, "fairway");
    setTile(tiles, width, tee, "tee");
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) setTile(tiles, width, { x: green.x + dx, y: green.y + dy }, "green");

    // The central carry is visually risky, while the north/south lanes stay
    // playable for a safe or positional plan. The hazard is never the only
    // way through the hole.
    const hazardX = Math.round((tee.x + green.x) / 2);
    for (let x = hazardX; x !== hazardX + direction * 3; x += direction) {
      for (let dy = -1; dy <= 1; dy++) setTile(tiles, width, { x, y: y + dy }, "water");
      setTile(tiles, width, { x, y: y - 2 }, "fairway");
      setTile(tiles, width, { x, y: y + 2 }, "fairway");
    }
    const waypoint = { x: hazardX - direction * 4, y: y + 2 };
    setTile(tiles, width, waypoint, "fairway");
    setTile(tiles, width, { x: waypoint.x + direction, y: waypoint.y }, "fairway");
    holes.push({
      id: `m47-hole-${index + 1}`,
      name: `M47 Decision ${index + 1}`,
      tee,
      green,
      waypoints: [waypoint],
      parMode: "MANUAL",
      parManual: index % 6 === 0 ? 5 : index % 4 === 0 ? 3 : 4,
      holeIndex: index + 1,
    });
  }

  return {
    width,
    height,
    tiles,
    elevations,
    holes,
    obstacles: [],
    buildings: [
      { id: "m47-clubhouse", type: "clubhouse", x: 2, y: Math.max(1, Math.floor(height / 2) - 2) },
      { id: "m47-pro-shop", type: "pro_shop", x: 5, y: Math.max(1, Math.floor(height / 2) - 2), tier: 3, price: 40 },
      { id: "m47-snack-bar", type: "snack_bar", x: 10, y: Math.max(1, Math.floor(height / 2) + 2), tier: 3, price: 15 },
      { id: "m47-cart-rental", type: "cart_rental", x: 15, y: Math.max(1, Math.floor(height / 2) + 2), tier: 2, price: 30 },
    ],
    yardsPerTile: 10,
    name: `M47 ${holeCount}-Hole Certification Course`,
    baseGreenFee: 125,
    condition: .92,
    theme: "parkland",
  };
}

/** Tournament fixture: a published 18 with all three prescribed setup axes. */
export function createM47TournamentCourse(): Course {
  const standards = createTournamentStandardsCourse();
  const holes = standards.holes.map((hole, index) => {
    const tee = hole.tee!;
    const green = hole.green!;
    const direction = green.x > tee.x ? 1 : -1;
    const forward = hole.teeBoxes?.forward ?? { x: tee.x + direction * 1, y: tee.y };
    const championship = hole.teeBoxes?.championship ?? { x: tee.x - direction * 1, y: tee.y };
    const pinB = hole.pinPositions?.B ?? { x: green.x, y: green.y + (index % 2 ? 1 : -1) };
    const pinC = hole.pinPositions?.C ?? { x: green.x - direction, y: green.y };
    return {
      ...hole,
      id: `m47-tournament-hole-${index + 1}`,
      teeBoxes: { forward, member: tee, championship },
      pinPositions: { A: green, B: pinB, C: pinC },
      parByTee: { forward: { mode: "MANUAL" as const, par: hole.parManual! }, member: { mode: "MANUAL" as const, par: hole.parManual! }, championship: { mode: "MANUAL" as const, par: hole.parManual! } },
    };
  });
  const ids = holes.map((hole) => hole.id!);
  return {
    ...standards,
    name: "M47 Tournament Certification Course",
    holes,
    layouts: [{ id: "m47-tournament", name: "M47 Tournament Course", draftHoleIds: ids, publishedHoleIds: ids, roundLength: 18, state: "open", greenFee: standards.baseGreenFee }],
    activeCourseId: "m47-tournament",
    activePinRotation: "B",
  };
}

/** Single-hole matrix fixture with a safe route around a central carry. */
export function createM47StrategyMatrixCourse(): Course {
  const width = 56;
  const height = 26;
  const tiles = Array.from({ length: width * height }, () => "fairway" as Terrain);
  const tee = { x: 4, y: 13 };
  const green = { x: 48, y: 13 };
  tiles[tee.y * width + tee.x] = "tee";
  for (let y = green.y - 1; y <= green.y + 1; y++) for (let x = green.x - 1; x <= green.x + 1; x++) tiles[y * width + x] = "green";
  for (let y = 2; y < height - 2; y++) tiles[y * width + 26] = y === 5 || y === 20 ? "fairway" : "water";
  return {
    name: "M47 Strategy Matrix Crossroads",
    width,
    height,
    tiles,
    elevations: new Array(width * height).fill(0),
    holes: [{ id: "m47-matrix-hole", tee, green, parMode: "MANUAL", parManual: 4, name: "The Five-Way Decision" }],
    obstacles: [],
    buildings: [],
    yardsPerTile: 10,
    baseGreenFee: 65,
    condition: .8,
    theme: "parkland",
  };
}

export interface M47RoundResult {
  golfer: M47ReferenceGolfer;
  course: Course;
  capabilities: GolferCapabilities;
  plans: StrategicHolePlan[];
  outcomes: NonNullable<ReturnType<typeof buildStrategicGolferRound>["shotOutcomes"]>;
  reactions: NonNullable<ReturnType<typeof buildStrategicGolferRound>["holeReactions"]>;
  holePar: number[];
  holeStrokes: number[];
}

export function buildM47RoundResult(holeCount: 9 | 18 | 36, golfer: M47ReferenceGolfer): M47RoundResult {
  const course = createM47CertificationCourse(holeCount);
  const capabilities = createGolferCapabilities({ personality: golfer.personality, seed: golfer.seed });
  const round = buildStrategicGolferRound({
    course,
    entry: entryPoint(course),
    exit: entryPoint(course),
    rng: mulberry32(golfer.seed ^ holeCount),
    personality: golfer.personality,
    capabilities,
    wallet: 250,
    skipPreRoundPurchases: true,
  });
  return {
    golfer,
    course,
    capabilities,
    plans: round.holePlans ?? [],
    outcomes: round.shotOutcomes ?? [],
    reactions: round.holeReactions ?? [],
    holePar: round.holePar,
    holeStrokes: round.holeStrokes,
  };
}

export interface M47StrategyMatrixRow {
  golferId: string;
  riskStyle: GolferCapabilities["riskStyle"];
  strengths: string[];
  chosen: StrategicHolePlan["chosen"]["kind"];
  rejected: StrategicHolePlan["rejected"][number]["kind"][];
  expectedScore: number;
  hazardRisk: number;
}

export function buildM47StrategyMatrix(): M47StrategyMatrixRow[] {
  const course = createM47StrategyMatrixCourse();
  const hole = course.holes[0];
  return M47_REFERENCE_GOLFERS.map((golfer) => {
    const capabilities = createGolferCapabilities({ personality: golfer.personality, seed: golfer.seed });
    const plan = generateStrategicHolePlan({ course, hole, par: hole.parManual ?? 4, capabilities, personality: golfer.personality });
    return {
      golferId: golfer.id,
      riskStyle: capabilities.riskStyle,
      strengths: capabilities.strengths,
      chosen: plan.chosen.kind,
      rejected: plan.rejected.map((alternative) => alternative.kind),
      expectedScore: plan.expectedScore,
      hazardRisk: plan.chosen.hazardRisk,
    };
  });
}

export function hashM47Round(result: M47RoundResult): { planHash: string; outcomeHash: string; reactionHash: string; saveHash: string } {
  const planHash = hashCanonicalValue({ capabilities: result.capabilities, holePar: result.holePar, plans: result.plans });
  const outcomeHash = hashCanonicalValue({ holeStrokes: result.holeStrokes, outcomes: result.outcomes });
  const reactionHash = hashCanonicalValue(result.reactions);
  const world: World = { ...DEFAULT_WORLD, runSeed: result.golfer.seed };
  const saveHash = hashGameState({
    course: result.course,
    world,
    live: undefined,
  });
  return { planHash, outcomeHash, reactionHash, saveHash };
}

export function runM47SaveHashFixture() {
  const course = createM47CertificationCourse(9);
  const world: World = { ...DEFAULT_WORLD, cash: 1_000_000, reputation: 95, runSeed: 470909 };
  const live = createLiveState(course, world, 0);
  let guard = 0;
  while (live.golfers.length === 0 && guard++ < 100) stepLive(live, course, 5);
  if (!live.golfers.length) throw new Error("M47 save fixture did not spawn a golfer");
  const snapshot = snapshotLiveSimulation({ state: live, pendingCash: 123, speed: "paused", selectedGolferId: live.golfers[0].id });
  const beforeHash = hashGameState({ course, world, live: snapshot });
  const restored = restoreLiveSimulation(JSON.parse(JSON.stringify(snapshot)));
  if (!restored) throw new Error("M47 save fixture did not restore");
  const restoredSnapshot = snapshotLiveSimulation({
    state: restored.state,
    pendingCash: restored.pendingCash,
    speed: restored.speed,
    selectedGolferId: restored.selectedGolferId,
    clockRemainderMinutes: restored.clockRemainderMinutes,
    weekLedger: restored.weekLedger,
  });
  return {
    beforeHash,
    afterHash: hashGameState({ course, world, live: restoredSnapshot }),
    saveBytes: new TextEncoder().encode(JSON.stringify(snapshot)).byteLength,
    golferEvidence: {
      plans: live.golfers[0].holePlans?.length ?? 0,
      outcomes: live.golfers[0].shotOutcomes?.length ?? 0,
      reactions: live.golfers[0].holeReactions?.length ?? 0,
    },
  };
}

export function runM47TournamentFixture() {
  const course = createM47TournamentCourse();
  const baseWorld: World = { ...DEFAULT_WORLD, cash: 1_000_000, reputation: 95, runSeed: 470818 };
  const created = createTournamentEvent({ course, world: baseWorld, tier: "regional", currentDay: 0, daysAhead: 1, courseId: "m47-tournament" });
  if (!created.ok) throw new Error(`M47 tournament fixture is ineligible: ${created.reason}`);
  const scheduledWorld = scheduleTournament(baseWorld, created.event);
  const live = createLiveState(course, scheduledWorld, created.event.scheduledDay);
  let guard = 0;
  while (!live.dayOver && guard++ < 2_000) stepLive(live, course, 5);
  if (!live.dayOver) throw new Error("M47 tournament fixture did not terminate");
  const settled = completeTournament(scheduledWorld, live);
  return {
    field: created.event.field.length,
    roundsFinished: live.roundsFinished,
    daySteps: guard,
    allFinished: live.tournament?.standings.every((standing) => standing.finished && standing.holesCompleted === 18) ?? false,
    status: settled.event?.status ?? "missing",
    winner: settled.event?.winnerName ?? null,
  };
}
