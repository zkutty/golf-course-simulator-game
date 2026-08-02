import type { Point } from "../models/types";
import type { PlayerRoundCourseSnapshot, PlayerProSkills } from "../models/playerProTypes";
import { mulberry32 } from "../../utils/rng";
import { sampleGreenRolloutSurface, type GreenRolloutV1 } from "./greenRollout";

/** Immutable automatic-putting result retained with the shot that reached green. */
export interface GreenPuttingV1 {
  version: 1;
  seed: number;
  putts: 1 | 2 | 3;
  leaveDistanceYards: number;
  breakTiles: number;
  pinDifficulty: number;
  realizedSpeedFeet: number;
  effectiveMoisture: number;
  wear: number;
  puttingSkill: number;
  consistency: number;
}

export interface GreenPuttingEstimate {
  expectedPutts: number;
  leaveDistanceYards: number;
  breakTiles: number;
  pinDifficulty: number;
  realizedSpeedFeet: number;
  effectiveMoisture: number;
  wear: number;
}

const clamp = (value: number, minimum = 0, maximum = 1) => Math.max(minimum, Math.min(maximum, value));
const round = (value: number, places = 3) => Number(value.toFixed(places));

function surfaceFacts(args: {
  snapshot: PlayerRoundCourseSnapshot;
  holeId: string;
  rest: Point;
  rollout?: GreenRolloutV1;
}) {
  const hole = args.snapshot.holes.find((candidate) => candidate.id === args.holeId) ?? args.snapshot.holes[0];
  const pin = hole?.pin ?? args.rest;
  const leaveDistanceYards = Math.hypot(args.rest.x - pin.x, args.rest.y - pin.y) * Math.max(1, args.snapshot.yardsPerTile);
  const sampled = sampleGreenRolloutSurface({
    width: args.snapshot.width,
    height: args.snapshot.height,
    tiles: args.snapshot.tiles,
    elevations: args.snapshot.elevations,
    holes: args.snapshot.holes.map((item) => ({ id: item.id, green: item.pin })),
    greenSurface: args.snapshot.greenSnapshot?.surface,
    greenProgram: args.snapshot.greenSnapshot?.program,
    greenLocalState: args.snapshot.greenSnapshot?.localState,
  }, args.snapshot.greenSnapshot?.surface, pin);
  const pinDifficulty = clamp(Math.hypot(sampled.gradient.x, sampled.gradient.y) * .78 + Math.abs(args.rollout?.breakTiles ?? 0) * .018, 0, 1);
  const effectiveMoisture = args.rollout?.evidence.effectiveMoisture ?? .5;
  const wear = args.snapshot.greenSnapshot?.localState?.holes?.find((item) => item.holeId === args.holeId)?.wear ?? 0;
  return {
    leaveDistanceYards: round(leaveDistanceYards, 2),
    breakTiles: round(Math.abs(args.rollout?.breakTiles ?? 0), 3),
    pinDifficulty: round(pinDifficulty, 3),
    realizedSpeedFeet: round(args.rollout?.evidence.realizedSpeedFeet ?? 9, 2),
    effectiveMoisture: round(effectiveMoisture, 3),
    wear: round(wear, 3),
  };
}

/** Planning-only information. It intentionally consumes no seed and exposes no outcome. */
export function estimateAutomaticPutts(args: {
  snapshot: PlayerRoundCourseSnapshot;
  holeId: string;
  rest: Point;
  rollout?: GreenRolloutV1;
  skills: Pick<PlayerProSkills, "putting" | "shortGame"> & Partial<Pick<PlayerProSkills, "recovery">>;
}): GreenPuttingEstimate {
  const facts = surfaceFacts(args);
  const puttingSkill = clamp((args.skills.putting + args.skills.shortGame * .2) / 120, 0, 1);
  const difficulty = clamp(
    facts.leaveDistanceYards / 35
    + facts.breakTiles / 8
    + facts.pinDifficulty * .55
    + Math.abs(facts.realizedSpeedFeet - 10.5) * .045
    + facts.effectiveMoisture * .08
    + facts.wear * .14
    - puttingSkill * .52,
    0,
    1.8,
  );
  return { ...facts, expectedPutts: round(clamp(1.45 + difficulty, 1, 2.95), 2) };
}

/**
 * The only outcome resolver for automatic putting. It receives only frozen
 * shot/round facts and a supplied seed, making resolved sequences save-safe.
 */
export function resolveAutomaticPutts(args: {
  snapshot: PlayerRoundCourseSnapshot;
  holeId: string;
  rest: Point;
  rollout?: GreenRolloutV1;
  skills: Pick<PlayerProSkills, "putting" | "shortGame" | "recovery">;
  seed: number;
}): GreenPuttingV1 {
  const estimate = estimateAutomaticPutts(args);
  const puttingSkill = clamp((args.skills.putting + args.skills.shortGame * .2) / 120, 0, 1);
  const consistency = clamp((args.skills.putting * .6 + args.skills.recovery * .4) / 100, 0, 1);
  const rng = mulberry32(args.seed >>> 0);
  const variance = (rng() - .5) * (1.15 - consistency * .72);
  const pressure = estimate.expectedPutts - 2 + variance - puttingSkill * .12;
  const putts: 1 | 2 | 3 = pressure <= -.45 ? 1 : pressure >= .52 ? 3 : 2;
  return {
    version: 1,
    seed: args.seed >>> 0,
    putts,
    leaveDistanceYards: estimate.leaveDistanceYards,
    breakTiles: estimate.breakTiles,
    pinDifficulty: estimate.pinDifficulty,
    realizedSpeedFeet: estimate.realizedSpeedFeet,
    effectiveMoisture: estimate.effectiveMoisture,
    wear: estimate.wear,
    puttingSkill: round(puttingSkill, 3),
    consistency: round(consistency, 3),
  };
}

export function isValidGreenPutting(value: unknown): value is GreenPuttingV1 {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<GreenPuttingV1>;
  return candidate.version === 1
    && Number.isSafeInteger(candidate.seed)
    && (candidate.putts === 1 || candidate.putts === 2 || candidate.putts === 3)
    && ["leaveDistanceYards", "breakTiles", "pinDifficulty", "realizedSpeedFeet", "effectiveMoisture", "wear", "puttingSkill", "consistency"]
      .every((key) => typeof candidate[key as keyof GreenPuttingV1] === "number" && Number.isFinite(candidate[key as keyof GreenPuttingV1] as number));
}
