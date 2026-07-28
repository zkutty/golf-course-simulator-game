import type { Course, World } from "../game/models/types";
import type { LiveSimulationSnapshotV1 } from "../game/live/persistence";
import { withNormalizedHoleSetup } from "../game/models/courseSetup";
import { normalizeCourseLayouts } from "../game/models/courseLayouts";
import { normalizedBuilding } from "../game/models/buildings";

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
    .join(",")}}`;
}

/** Stable, order-independent FNV-1a hash for persisted certification evidence. */
export function hashCanonicalValue(value: unknown): string {
  const text = canonical(value);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function hashGameState(value: {
  course: Course;
  world: World;
  live?: LiveSimulationSnapshotV1;
}): string {
  // Callers often pass a full SavePayload. Hash only the persisted game-state
  // contract declared above; UI metadata such as tutorial/profile fields must
  // not make an otherwise lossless save/load round trip look different.
  // Optional collection defaults are semantically empty both before and
  // after migration; canonicalize them so a lossless save/load does not
  // appear different merely because the loader materialized `[]`.
  const normalized = normalizeCourseLayouts(value.course);
  const course = {
    ...normalized,
    decorations: value.course.decorations ?? [],
    buildings: (value.course.buildings ?? []).map(normalizedBuilding),
    activePinRotation: value.course.activePinRotation ?? "A",
    holes: normalized.holes.map(withNormalizedHoleSetup),
  };
  return hashCanonicalValue({ course, world: value.world, live: value.live });
}
