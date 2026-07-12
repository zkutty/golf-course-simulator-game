import type { Course, World } from "../models/types";
import { demandBreakdown } from "../sim/score";
import { scoreCourseHoles } from "../sim/holes";
import { mulberry32 } from "../../utils/rng";
import { LIVE } from "./liveConfig";
import { pickArchetype } from "./archetypes";
import type { Arrival } from "./types";

// How many golfers actually walk the course today. Driven by the demand index
// (not raw base visitors, whose floors flatten the response) so reputation and
// course quality visibly change how busy the course looks, then clamped into a
// watchable range so you see every golfer individually (Sim-Golf style).
export function plannedGolfersForDay(course: Course, world: World): number {
  const summary = scoreCourseHoles(course);
  const validHoles = summary.holes.filter((h) => h.isComplete && h.isValid).length;
  if (validHoles === 0) return 0;

  const { minGolfers, maxGolfers, demandFloor, demandCeil, demandGamma, perValidHole } =
    LIVE.volume;
  const demand = demandBreakdown(course, world);
  const norm = Math.max(
    0,
    Math.min(1, (demand.demandIndex - demandFloor) / (demandCeil - demandFloor))
  );
  const raw = minGolfers + (maxGolfers - minGolfers) * Math.pow(norm, demandGamma);
  const holeCap = validHoles * perValidHole;
  return Math.round(
    Math.max(minGolfers, Math.min(maxGolfers, holeCap, raw))
  );
}

// Build the day's arrival schedule (times + archetypes), deterministic per seed.
export function planDay(course: Course, world: World, seed: number): Arrival[] {
  const count = plannedGolfersForDay(course, world);
  const rng = mulberry32(seed);
  const arrivals: Arrival[] = [];
  const { firstArrivalMinute, lastArrivalMinute, arrivalMorningBias } = LIVE.day;
  for (let i = 0; i < count; i++) {
    // rng^bias skews arrivals toward the morning like a real tee sheet.
    const atMinute =
      firstArrivalMinute +
      Math.pow(rng(), arrivalMorningBias) * (lastArrivalMinute - firstArrivalMinute);
    const archetype = pickArchetype(rng()).name;
    arrivals.push({ atMinute, archetype });
  }
  arrivals.sort((a, b) => a.atMinute - b.atMinute);
  return arrivals;
}
