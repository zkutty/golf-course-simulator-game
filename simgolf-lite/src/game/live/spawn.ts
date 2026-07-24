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
import { courseOperations } from "./pace";
import { normalizeLivingClub } from "../livingClub/livingClub";

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
  const layout = activeCourseLayout(course);
  const operations = courseOperations(course, layout.id);
  let golferIndex = 0;
  let groupIndex = 0;
  let slotMinute = firstArrivalMinute;
  while (golferIndex < count && slotMinute <= lastArrivalMinute) {
    const remaining = count - golferIndex;
    const desired = 1 + Math.floor(rng() * operations.maxGroupSize);
    const groupSize = Math.min(remaining, operations.maxGroupSize, Math.max(1, desired));
    const groupId = `${layout.id}-g${groupIndex + 1}`;
    for (let member = 0; member < groupSize; member++) {
      arrivals.push({ atMinute: slotMinute, archetype: pickArchetypeFrom(appeal, rng()), courseId: layout.id, groupId });
      golferIndex++;
    }
    groupIndex++;
    slotMinute += operations.teeIntervalMinutes;
    if (operations.starterGapEveryGroups > 0 && groupIndex % operations.starterGapEveryGroups === 0) slotMinute += operations.teeIntervalMinutes;
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
  // Persistent regulars reuse their stable person identity and appearance when
  // they revisit. They replace a bounded share of the ordinary tee sheet, so
  // living-club continuity never creates extra demand or duplicate customers.
  const regulars = normalizeLivingClub(world.livingClub).regulars
    .filter((regular) => !regular.favoriteCourseId || views.some(({ layout }) => layout.id === regular.favoriteCourseId))
    .sort((a, b) => b.loyalty - a.loyalty || a.id.localeCompare(b.id))
    .slice(0, Math.min(4, Math.floor(arrivals.length / 5)));
  const claimedArrivalIndices = new Set<number>();
  regulars.forEach((regular, index) => {
    const eligibleIndices = arrivals
      .map((arrival, arrivalIndex) => ({ arrival, arrivalIndex }))
      .filter(({ arrival, arrivalIndex }) =>
        !claimedArrivalIndices.has(arrivalIndex) &&
        !arrival.tournament &&
        (!regular.favoriteCourseId || arrival.courseId === regular.favoriteCourseId)
      )
      .map(({ arrivalIndex }) => arrivalIndex);
    if (!eligibleIndices.length) return;
    const chosenIndex = eligibleIndices[(hashCode(`${seed}:${regular.id}`) + index * 7) % eligibleIndices.length];
    claimedArrivalIndices.add(chosenIndex);
    arrivals[chosenIndex] = {
      ...arrivals[chosenIndex],
      personId: regular.id,
      name: regular.name,
      archetype: regular.archetype,
    };
  });
  arrivals.sort((a, b) => a.atMinute - b.atMinute || (a.courseId ?? "").localeCompare(b.courseId ?? ""));
  return arrivals;
}

function hashCode(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index++) hash = (Math.imul(hash, 31) + value.charCodeAt(index)) | 0;
  return Math.abs(hash);
}
