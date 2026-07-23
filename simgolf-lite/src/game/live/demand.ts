import type { Course, World } from "../models/types";
import { demandIndex } from "../sim/score";
import { scoreCourseHoles } from "../sim/holes";
import { BALANCE } from "../balance/balanceConfig";
import { getDifficultyProfile } from "../balance/difficulty";
import { ARCHETYPES } from "./archetypes";
import { LIVE } from "./liveConfig";
import type { GolferArchetypeName } from "./types";
import { courseOperations } from "./pace";
import { propertyAccessMultiplier } from "../property/property";

function clamp(x: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, x));
}
function clamp01(x: number): number {
  return clamp(x, 0, 1);
}

// A compact description of a course's *character*, used to decide who is drawn
// to play it. Every field is derived from the same signals the abstract demand
// model already uses (design quality, difficulty, scenery, price, reputation),
// but expressed in a form the personality preferences can be matched against.
export interface CourseProfile {
  quality: number; // 0..1 overall design quality
  difficulty: number; // 0..1 (0 easy .. 1 punishing)
  scenery: number; // 0..1 aesthetics
  premium: number; // -1..1 green fee relative to market price
  prestige: number; // 0..1 reputation
  pace: number; // 0 relaxed .. 1 brisk operating identity
}

export function courseProfile(course: Course, world: World): CourseProfile {
  const summary = scoreCourseHoles(course);
  const complete = summary.holes.filter((h) => h.isComplete && h.isValid);
  const avg = (pick: (h: (typeof complete)[number]) => number, fallback: number) =>
    complete.length === 0 ? fallback : complete.reduce((a, h) => a + pick(h), 0) / complete.length;

  const difficulty = clamp01(avg((h) => h.difficultyScore, 50) / 100);
  const scenery = clamp01(avg((h) => h.aestheticsScore, 0) / 100);
  const premium = clamp(
    (course.baseGreenFee - BALANCE.pricing.marketPrice) / BALANCE.pricing.marketPrice,
    -1,
    1
  );
  return {
    quality: clamp01(summary.courseQuality / 100),
    difficulty,
    scenery,
    premium,
    prestige: clamp01(world.reputation / 100),
    pace: courseOperations(course).preset === "relaxed" ? 0 : courseOperations(course).preset === "brisk" ? 1 : .5,
  };
}

export type ArchetypeAppeal = Record<GolferArchetypeName, number>;

// Score how strongly each archetype is drawn to this course, then normalise into
// a probability distribution. Appeal blends four matches against the archetype's
// personality baseline:
//   - difficulty: how well the course's challenge matches their taste
//   - scenery:    scenery-lovers favour pretty courses
//   - price:      price-sensitive golfers avoid premium fees; big spenders don't
//   - prestige:   skilled players need reputation before they'll bother showing up
export function archetypeAppeal(profile: CourseProfile): ArchetypeAppeal {
  const diffSigned = profile.difficulty * 2 - 1; // -1..1 to match prefs.difficulty
  const raw = {} as ArchetypeAppeal;
  let total = 0;

  for (const a of Object.values(ARCHETYPES)) {
    const p = a.personality;
    const difficultyMatch = 1 - Math.abs(p.prefs.difficulty - diffSigned) / 2; // 0..1
    const sceneryAppeal = clamp01(0.5 + p.prefs.scenery * (profile.scenery - 0.5));
    const priceAppeal = clamp01(0.5 + profile.premium * p.prefs.price * 0.8);
    // High-skill archetypes are gated by reputation; casual players are not.
    const prestigeGate = clamp01(1 - Math.max(0, p.skill - profile.prestige) * 1.5);
    const pacePreference = clamp01(p.skill * .6 + (1 - p.patience) * .3 + .1);
    const paceMatch = 1 - Math.abs(pacePreference - profile.pace);

    const w = a.weight * difficultyMatch * sceneryAppeal * priceAppeal * prestigeGate * (.65 + paceMatch * .35);
    raw[a.name] = w;
    total += w;
  }

  // Degenerate course (no appeal to anyone): fall back to base frequencies so
  // the course is never completely empty when demand says people should come.
  if (total <= 1e-6) {
    let baseTotal = 0;
    for (const a of Object.values(ARCHETYPES)) baseTotal += a.weight;
    for (const a of Object.values(ARCHETYPES)) raw[a.name] = a.weight / baseTotal;
    return raw;
  }

  for (const name of Object.keys(raw) as GolferArchetypeName[]) raw[name] /= total;
  return raw;
}

// Weighted pick of an archetype from a normalised appeal distribution.
export function pickArchetypeFrom(appeal: ArchetypeAppeal, r: number): GolferArchetypeName {
  let t = r;
  let last: GolferArchetypeName = "casual";
  for (const name of Object.keys(appeal) as GolferArchetypeName[]) {
    last = name;
    t -= appeal[name];
    if (t <= 0) return name;
  }
  return last;
}

// How many golfers play today. Derived straight from the blended demand index
// (which already folds in reputation, price, design quality and condition),
// replacing the M1 interim math that scaled an abstract weekly-visitors integer.
export function plannedGolfersForDay(course: Course, world: World): number {
  const summary = scoreCourseHoles(course);
  const validHoles = summary.holes.filter((h) => h.isComplete && h.isValid).length;
  if (validHoles === 0) return 0;

  const di = demandIndex(course, world); // 0..~1.2
  const norm = clamp01(di / LIVE.volume.demandFullHouse);
  const span = LIVE.volume.maxGolfers - LIVE.volume.minGolfers;
  // Difficulty scales the day's tee sheet (ZKU-165); identity on normal.
  const raw = (LIVE.volume.minGolfers + norm * span) * getDifficultyProfile(world.difficulty).demandMult;
  const planned = clamp(raw, LIVE.volume.minGolfers, LIVE.volume.maxGolfers);
  // Formal roads and parking can support a destination tee sheet; relying on
  // informal roadside/grass arrival constrains an otherwise busy course.
  return Math.max(1, Math.round(planned * propertyAccessMultiplier(course, planned, world)));
}
