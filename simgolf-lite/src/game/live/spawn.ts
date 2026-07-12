import type { Course, World } from "../models/types";
import { demandBreakdown } from "../sim/score";
import { scoreCourseHoles } from "../sim/holes";
import { mulberry32 } from "../../utils/rng";
import { LIVE } from "./liveConfig";
import { pickArchetype } from "./archetypes";
import type { Arrival } from "./types";

// Dev/tuning override: `?livegolfers=N` forces a fixed golfer count per day.
function debugGolferOverride(): number | null {
  if (typeof window === "undefined") return null;
  const raw = new URLSearchParams(window.location.search).get("livegolfers");
  if (raw == null) return null;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? Math.max(0, Math.min(200, n)) : null;
}

// How many golfers actually walk the course today. Derived from the existing
// abstract demand model, then clamped into a watchable range so you see every
// golfer individually (Sim-Golf style) rather than an aggregate integer.
export function plannedGolfersForDay(course: Course, world: World): number {
  const summary = scoreCourseHoles(course);
  const validHoles = summary.holes.filter((h) => h.isComplete && h.isValid).length;
  if (validHoles === 0) return 0;

  const override = debugGolferOverride();
  if (override != null) return override;

  const demand = demandBreakdown(course, world);
  const weeklyPotential = demand.segments?.totalBaseVisitors ?? demand.demandIndex * 400;
  const raw = weeklyPotential * LIVE.volume.dailyDemandFraction;
  const clamped = Math.round(
    Math.max(LIVE.volume.minGolfers, Math.min(LIVE.volume.maxGolfers, raw))
  );
  return clamped;
}

// Build the day's arrival schedule (times + archetypes), deterministic per seed.
export function planDay(course: Course, world: World, seed: number): Arrival[] {
  const count = plannedGolfersForDay(course, world);
  const rng = mulberry32(seed);
  const arrivals: Arrival[] = [];
  const { firstArrivalMinute, lastArrivalMinute } = LIVE.day;
  for (let i = 0; i < count; i++) {
    const atMinute =
      firstArrivalMinute + rng() * (lastArrivalMinute - firstArrivalMinute);
    const archetype = pickArchetype(rng()).name;
    arrivals.push({ atMinute, archetype });
  }
  arrivals.sort((a, b) => a.atMinute - b.atMinute);
  return arrivals;
}
