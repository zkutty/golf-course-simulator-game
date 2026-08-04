import type { CompetitionHole, HandicapCourse, HandicapResult } from "./types";

/** WHS requires .5 values to move away from zero (unlike Math.round for -0.5). */
export function roundHalfAwayFromZero(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

function finite(value: number, name: string): number {
  if (!Number.isFinite(value)) throw new Error(`${name} must be finite.`);
  return value;
}

/**
 * The unrounded Course Handicap. Keep this when a competition allowance is
 * applied; it prevents each team format from reinventing the formula.
 */
export function courseHandicapUnrounded(handicapIndex: number, course: HandicapCourse): number {
  finite(handicapIndex, "Handicap Index");
  finite(course.courseRating, "Course rating");
  finite(course.slopeRating, "Slope rating");
  finite(course.par, "Par");
  if (course.slopeRating <= 0) throw new Error("Slope rating must be greater than zero.");
  return handicapIndex * course.slopeRating / 113 + (course.courseRating - course.par);
}

export function courseHandicap(handicapIndex: number, course: HandicapCourse): HandicapResult {
  const unrounded = courseHandicapUnrounded(handicapIndex, course);
  return { unrounded, rounded: roundHalfAwayFromZero(unrounded) };
}

/** Applies the format percentage before the one and only integer rounding. */
export function playingHandicapFromUnrounded(courseHandicapValue: number, allowance = 1): HandicapResult {
  finite(courseHandicapValue, "Course Handicap");
  finite(allowance, "Handicap allowance");
  if (allowance < 0) throw new Error("Handicap allowance cannot be negative.");
  const unrounded = courseHandicapValue * allowance;
  return { unrounded, rounded: roundHalfAwayFromZero(unrounded) };
}

export function playingHandicap(handicapIndex: number, course: HandicapCourse, allowance = 1): HandicapResult {
  return playingHandicapFromUnrounded(courseHandicapUnrounded(handicapIndex, course), allowance);
}

/**
 * Allocates received (+) and given (-, plus handicap) strokes by the exact
 * course index. Index 1 is revisited only after all holes have been visited.
 */
export function strokesByHole(playingHandicap: number, holes: readonly CompetitionHole[]): number[] {
  if (!Number.isInteger(playingHandicap)) throw new Error("Playing Handicap must be an integer.");
  if (holes.length !== 9 && holes.length !== 18) throw new Error("Stroke allocation requires 9 or 18 holes.");
  const indexes = holes.map((hole) => hole.strokeIndex);
  if (indexes.some((index) => !Number.isInteger(index) || index < 1 || index > holes.length)
    || new Set(indexes).size !== holes.length) throw new Error("Holes must have unique stroke indexes for the routed scorecard.");
  const sign = Math.sign(playingHandicap);
  const allocations = Array<number>(holes.length).fill(0);
  const ranked = holes.map((hole, position) => ({ position, index: hole.strokeIndex })).sort((a, b) => a.index - b.index);
  for (let stroke = 0; stroke < Math.abs(playingHandicap); stroke += 1) allocations[ranked[stroke % holes.length].position] += sign;
  return allocations;
}

export function strokesOffLow(playingHandicap: number, players: readonly { playingHandicap: number }[]): number {
  if (!players.length) throw new Error("Strokes-off-low requires at least one player.");
  return playingHandicap - Math.min(...players.map((player) => player.playingHandicap));
}
