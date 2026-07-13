import type { GolferProfile } from "../sim/golferProfiles";

// A single golfer's personality. Replaces the old aggregate SCRATCH/BOGEY split
// with per-individual parameters, so two golfers of the same archetype are not
// identical. Skill/consistency drive shot outcomes (ZKU-113); patience/spend and
// style preferences feed reactions, demand, and concessions in later M3/M4 work.
export interface StylePrefs {
  difficulty: number; // -1 wants an easy round .. +1 seeks a challenge
  scenery: number; // -1 indifferent to looks .. +1 values scenery/nature
  price: number; // -1 very price-sensitive .. +1 happy to pay a premium
}

export interface Personality {
  skill: number; // 0..1 overall shot-making ability
  consistency: number; // 0..1 how repeatable that skill is (low = streaky)
  patience: number; // 0..1 tolerance for slow play and hard holes
  spendPropensity: number; // 0..1 likelihood to spend on concessions (M4)
  prefs: StylePrefs;
}

// Per-archetype centre of the personality distribution. Individuals are sampled
// around these means with `spread`, so an archetype is a cloud of people rather
// than one fixed golfer.
export interface PersonalityBaseline {
  skill: number;
  consistency: number;
  patience: number;
  spendPropensity: number;
  prefs: StylePrefs;
  spread: number; // stddev-ish; how far individuals drift from the mean
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}
function clampSigned(x: number): number {
  return Math.max(-1, Math.min(1, x));
}

// Bounded, bell-ish sample in [-1, 1] with mean 0 (average of three uniforms).
// Avoids the heavy tails of a single uniform without needing a real gaussian.
function bell(rng: () => number): number {
  return ((rng() + rng() + rng()) / 3 - 0.5) * 2;
}

export function rollPersonality(
  base: PersonalityBaseline,
  rng: () => number,
  // Difficulty knobs (ZKU-165): scale the rolled patience/spend, identity by default.
  mults: { patience?: number; spend?: number } = {}
): Personality {
  const s = base.spread;
  return {
    skill: clamp01(base.skill + bell(rng) * s),
    consistency: clamp01(base.consistency + bell(rng) * s),
    patience: clamp01((base.patience + bell(rng) * s) * (mults.patience ?? 1)),
    spendPropensity: clamp01((base.spendPropensity + bell(rng) * s) * (mults.spend ?? 1)),
    prefs: {
      difficulty: clampSigned(base.prefs.difficulty + bell(rng) * s),
      scenery: clampSigned(base.prefs.scenery + bell(rng) * s),
      price: clampSigned(base.prefs.price + bell(rng) * s),
    },
  };
}

// Which shot-planning model plans this golfer's round, chosen from their rolled
// skill rather than a fixed per-archetype tier. A high-skill casual can plan
// like a scratch player, and vice-versa.
export function solverProfileForSkill(skill: number): GolferProfile["name"] {
  return skill >= 0.5 ? "SCRATCH" : "BOGEY";
}

// --- Personality-driven shot outcomes (ZKU-113) -----------------------------
// The Dijkstra planner (solveShotsToGreen) returns one optimal line for a given
// profile; on its own every golfer of a profile scores identically. These
// functions add personality-consistent variance on top of that plan so the same
// hole yields a spread of scores.

// Probability that a single planned shot is mishit into a recovery stroke
// (+1 to the hole). Weak, streaky players spray more; pros almost never do.
export function mishitChance(p: Personality): number {
  const base = (1 - p.skill) * 0.28 + (1 - p.consistency) * 0.12;
  return Math.max(0.01, Math.min(0.4, base));
}

// Putts taken on a green (1, 2, or 3) from a single 0..1 roll. Base is 2; low
// consistency widens the swing both ways, and skill biases sinks toward 1-putts
// and away from 3-putts.
export function puttOutcome(p: Personality, roll: number): number {
  const variance = (1 - p.consistency) * 0.5 + 0.1; // 0.1 .. 0.6
  const skillEdge = (p.skill - 0.5) * 0.3; // good putters drain more
  const oneChance = Math.max(0, variance * 0.5 + skillEdge);
  const threeChance = Math.max(0, variance * 0.5 - skillEdge);
  if (roll < oneChance) return 1;
  if (roll > 1 - threeChance) return 3;
  return 2;
}
