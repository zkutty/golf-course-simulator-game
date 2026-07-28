import type { Personality } from "./personality";
import type { GolferCapabilities, RiskStyle } from "./m47Types";

const clamp = (value: number, min = 0, max = 100) => Math.max(min, Math.min(max, value));
const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

function hashSeed(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function jitter(seed: number, salt: number): number {
  let x = (seed ^ Math.imul(salt, 0x45d9f3b)) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b) >>> 0;
  return ((x ^ (x >>> 16)) / 0xffffffff - 0.5) * 2;
}

function styleFor(riskTolerance: number): RiskStyle {
  if (riskTolerance >= 0.67) return "aggressive";
  if (riskTolerance <= 0.35) return "conservative";
  return "balanced";
}

function labels(values: Record<string, number>): { strengths: string[]; weaknesses: string[] } {
  const entries = Object.entries(values).sort((a, b) => b[1] - a[1]);
  return {
    strengths: entries.slice(0, 2).map(([key]) => key),
    weaknesses: entries.slice(-2).reverse().map(([key]) => key),
  };
}

export function stableGolferSeed(identity: string, fallback: number): number {
  return hashSeed(identity || `golfer:${fallback >>> 0}`);
}

export function createGolferCapabilities(args: {
  personality: Personality;
  seed: number;
}): GolferCapabilities {
  const { personality: p, seed } = args;
  const skill = clamp01(p.skill);
  const consistency = clamp01(p.consistency);
  const jittered = (base: number, salt: number, spread = 5) => clamp(base + jitter(seed, salt) * spread);
  const riskTolerance = clamp01(.5 + p.prefs.difficulty * .36 + (skill - .5) * .18 + jitter(seed, 11) * .04);
  const challengeSeeking = clamp01(.5 + p.prefs.difficulty * .5 + jitter(seed, 13) * .08);
  const values = {
    power: jittered(skill * 100 + p.prefs.difficulty * 4, 1),
    accuracy: jittered((skill * .7 + consistency * .3) * 100, 2),
    irons: jittered((skill * .62 + consistency * .38) * 100, 3),
    shortGame: jittered((skill * .45 + consistency * .55) * 100, 4),
    recovery: jittered((skill * .35 + consistency * .65 + (1 - Math.abs(p.prefs.difficulty)) * .08) * 100, 5),
    consistency: jittered(consistency * 100, 6),
  };
  const labelsForValues = labels(values);
  return {
    version: 1,
    seed: seed >>> 0,
    ...values,
    riskTolerance,
    challengeSeeking,
    sceneryAffinity: clamp01((p.prefs.scenery + 1) / 2),
    valueSensitivity: clamp01((1 - p.prefs.price) / 2),
    riskStyle: styleFor(riskTolerance),
    strengths: labelsForValues.strengths,
    weaknesses: labelsForValues.weaknesses,
  };
}

export function normalizeGolferCapabilities(value: unknown, fallback: GolferCapabilities): GolferCapabilities {
  if (!value || typeof value !== "object") return fallback;
  const candidate = value as Partial<GolferCapabilities>;
  const number = (key: keyof GolferCapabilities, defaultValue: number) => {
    const item = candidate[key];
    return typeof item === "number" && Number.isFinite(item) ? item : defaultValue;
  };
  const riskTolerance = clamp01(number("riskTolerance", fallback.riskTolerance));
  const riskStyle = candidate.riskStyle === "aggressive" || candidate.riskStyle === "conservative" || candidate.riskStyle === "balanced"
    ? candidate.riskStyle
    : styleFor(riskTolerance);
  return {
    version: 1,
    seed: Math.max(0, Math.floor(number("seed", fallback.seed))) >>> 0,
    power: clamp(number("power", fallback.power)),
    accuracy: clamp(number("accuracy", fallback.accuracy)),
    irons: clamp(number("irons", fallback.irons)),
    shortGame: clamp(number("shortGame", fallback.shortGame)),
    recovery: clamp(number("recovery", fallback.recovery)),
    consistency: clamp(number("consistency", fallback.consistency)),
    riskTolerance,
    challengeSeeking: clamp01(number("challengeSeeking", fallback.challengeSeeking)),
    sceneryAffinity: clamp01(number("sceneryAffinity", fallback.sceneryAffinity)),
    valueSensitivity: clamp01(number("valueSensitivity", fallback.valueSensitivity)),
    riskStyle,
    strengths: Array.isArray(candidate.strengths) ? candidate.strengths.filter((item): item is string => typeof item === "string").slice(0, 4) : fallback.strengths.slice(),
    weaknesses: Array.isArray(candidate.weaknesses) ? candidate.weaknesses.filter((item): item is string => typeof item === "string").slice(0, 4) : fallback.weaknesses.slice(),
  };
}

export function capabilitiesToPlayerSkills(capabilities: GolferCapabilities) {
  return {
    power: capabilities.power,
    driving: capabilities.accuracy,
    irons: capabilities.irons,
    shortGame: capabilities.shortGame,
    putting: (capabilities.shortGame + capabilities.consistency) / 2,
    recovery: capabilities.recovery,
  } as const;
}
