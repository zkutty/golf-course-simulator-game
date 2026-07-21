import type { Course, World } from "../models/types";
import { mulberry32 } from "../../utils/rng";
import { LIVE } from "./liveConfig";
import {
  archetypeAppeal,
  courseProfile,
  pickArchetypeFrom,
  plannedGolfersForDay,
} from "./demand";
import type { Arrival } from "./types";
import { activeCourseLayout, operatingCourseViews } from "../models/courseLayouts";

// Re-exported so callers/tests keep a single import surface for spawning.
export { plannedGolfersForDay } from "./demand";

// Build the day's arrival schedule (times + archetypes), deterministic per seed.
// The archetype mix is drawn from the course's personality-appeal distribution,
// so a premium, challenging, high-reputation course pulls in more pros and
// low-handicappers while a cheap, scenic, easy one skews casual/tourist.
export function planDay(course: Course, world: World, seed: number): Arrival[] {
  const count = plannedGolfersForDay(course, world);
  const rng = mulberry32(seed);
  const appeal = archetypeAppeal(courseProfile(course, world));
  const arrivals: Arrival[] = [];
  const { firstArrivalMinute, lastArrivalMinute } = LIVE.day;
  for (let i = 0; i < count; i++) {
    const atMinute =
      firstArrivalMinute + rng() * (lastArrivalMinute - firstArrivalMinute);
    const archetype = pickArchetypeFrom(appeal, rng());
    arrivals.push({ atMinute, archetype, courseId: activeCourseLayout(course).id });
  }
  arrivals.sort((a, b) => a.atMinute - b.atMinute);
  return arrivals;
}

/** Build one deterministic tee sheet per open published course. */
export function planEstateDay(
  course: Course,
  world: World,
  seed: number,
  views = operatingCourseViews(course),
): Arrival[] {
  const arrivals = views.flatMap(({ layout, course: view }, index) =>
    planDay(view, world, seed + index * 104729).slice(0, layout.roundLength * 4).map((arrival) => ({ ...arrival, courseId: layout.id }))
  );
  arrivals.sort((a, b) => a.atMinute - b.atMinute || (a.courseId ?? "").localeCompare(b.courseId ?? ""));
  return arrivals;
}
