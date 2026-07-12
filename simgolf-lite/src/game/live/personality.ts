import type { GolferArchetypeName } from "./types";

// Per-golfer personality (ZKU-112). Archetypes describe the crowd; personality
// makes each individual differ within it. Rolled once at spawn from the
// archetype's base traits plus seeded jitter, so two Casuals can behave very
// differently. This replaces reading aggregate SCRATCH/BOGEY behavior alone.
export interface Personality {
  skill: number; // 0..1 — sharpens putting today; shot variance comes in ZKU-113
  patience: number; // 0..1 — tolerance for slow play; drives waiting mood + leave-early
  spend: number; // 0..1 — spending propensity (concessions hook, M4)
  prefDifficulty: number; // 0..1 — how much challenge they want from a course
  priceSensitivity: number; // 0..1 — how hard green-fee value affects their mood
}

const BASE: Record<GolferArchetypeName, Personality> = {
  pro: { skill: 0.95, patience: 0.6, spend: 0.5, prefDifficulty: 0.9, priceSensitivity: 0.1 },
  lowHandicap: { skill: 0.75, patience: 0.55, spend: 0.6, prefDifficulty: 0.7, priceSensitivity: 0.3 },
  casual: { skill: 0.35, patience: 0.5, spend: 0.5, prefDifficulty: 0.3, priceSensitivity: 0.6 },
  senior: { skill: 0.45, patience: 0.85, spend: 0.4, prefDifficulty: 0.25, priceSensitivity: 0.7 },
  junior: { skill: 0.3, patience: 0.35, spend: 0.2, prefDifficulty: 0.4, priceSensitivity: 0.8 },
  tourist: { skill: 0.35, patience: 0.65, spend: 0.85, prefDifficulty: 0.35, priceSensitivity: 0.35 },
};

const JITTER = 0.18; // each trait varies ±this around the archetype base

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

export function rollPersonality(archetype: GolferArchetypeName, rng: () => number): Personality {
  const b = BASE[archetype];
  const j = () => (rng() * 2 - 1) * JITTER;
  return {
    skill: clamp01(b.skill + j()),
    patience: clamp01(b.patience + j()),
    spend: clamp01(b.spend + j()),
    prefDifficulty: clamp01(b.prefDifficulty + j()),
    priceSensitivity: clamp01(b.priceSensitivity + j()),
  };
}

// Effective putting inconsistency: personal skill sharpens or dulls the
// archetype's baseline (high skill ~halves it, low skill inflates it).
export function effectivePuttVariance(basePuttVariance: number, p: Personality): number {
  return Math.max(0.05, Math.min(0.5, basePuttVariance * (1.4 - p.skill)));
}

// How many game-minutes of waiting this golfer tolerates before storming off.
export function waitToleranceMin(p: Personality): number {
  return 15 + p.patience * 45; // impatient junior ~21, zen senior ~55
}

// First-impression mood shift on arrival: green-fee value for money and
// whether the course's difficulty matches their taste.
export function arrivalMoodShift(args: {
  p: Personality;
  greenFee: number;
  reputation: number; // 0..100
  avgDifficulty: number; // 0..100
}): number {
  const { p, greenFee, reputation, avgDifficulty } = args;
  // What feels like a fair fee scales with the course's reputation.
  const fairFee = 25 + reputation * 0.9;
  const overpay = (greenFee - fairFee) / fairFee;
  const priceShift =
    overpay > 0
      ? -Math.min(0.25, overpay * p.priceSensitivity * 0.3)
      : Math.min(0.06, -overpay * (1 - p.priceSensitivity) * 0.1);
  const mismatch = Math.abs(avgDifficulty / 100 - p.prefDifficulty);
  const diffShift = Math.max(-0.05, Math.min(0.05, (0.3 - mismatch) * 0.08));
  return priceShift + diffShift;
}
