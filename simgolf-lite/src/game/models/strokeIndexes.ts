import type { Course, Hole } from "./types";

export interface StrokeIndexValidation { valid: boolean; reasons: string[]; }

function label(hole: Hole, index: number): string { return hole.name?.trim() || `Hole ${index + 1}`; }

/** Use this only as the net/handicap eligibility gate; legacy gross and
 * practice rounds intentionally remain playable with incomplete cards. */
export function validateStrokeIndexes(course: Course): StrokeIndexValidation {
  const required = course.holes.length === 9 || course.holes.length === 18 ? course.holes.length : 0;
  if (!required) return { valid: false, reasons: ["Net and handicap-posted play requires a complete 9- or 18-hole scorecard."] };
  const values = new Map<number, number[]>();
  const missing = course.holes.map((hole, index) => ({ hole, index })).filter(({ hole, index }) => {
    const value = hole.holeIndex;
    if (Number.isInteger(value) && value! >= 1 && value! <= required) {
      values.set(value!, [...(values.get(value!) ?? []), index]);
      return false;
    }
    return true;
  });
  const reasons = missing.length ? [`Assign a stroke index to ${missing.map(({ hole, index }) => label(hole, index)).join(", ")}.`] : [];
  for (const [value, indexes] of values) if (indexes.length > 1) reasons.push(`Stroke index ${value} is duplicated on ${indexes.map((index) => label(course.holes[index], index)).join(", ")}.`);
  const absent = Array.from({ length: required }, (_, index) => index + 1).filter((value) => !values.has(value));
  if (absent.length) reasons.push(`Assign missing stroke index${absent.length === 1 ? "" : "es"}: ${absent.join(", ")}.`);
  return { valid: reasons.length === 0, reasons };
}

/** Table-testable allocation: ties use stable identity then source position. */
export function strokeIndexesForModeledGaps(values: readonly { id: string; gap: number }[]): number[] | null {
  if (values.length !== 9 && values.length !== 18) return null;
  const ranked = values.map((value, index) => ({ index, ...value })).sort((a, b) => b.gap - a.gap || a.id.localeCompare(b.id) || a.index - b.index);
  const indexes = new Array<number>(values.length);
  if (values.length === 9) ranked.forEach((value, index) => { indexes[value.index] = index + 1; });
  else {
    ranked.slice(0, 9).forEach((value, index) => { indexes[value.index] = index * 2 + 1; });
    ranked.slice(9).forEach((value, index) => { indexes[value.index] = index * 2 + 2; });
  }
  return indexes;
}
