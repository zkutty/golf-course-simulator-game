import type { Course, World } from "../game/models/types";
import type { LiveSimulationSnapshotV1 } from "../game/live/persistence";

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

export function hashGameState(value: {
  course: Course;
  world: World;
  live?: LiveSimulationSnapshotV1;
}): string {
  // Callers often pass a full SavePayload. Hash only the persisted game-state
  // contract declared above; UI metadata such as tutorial/profile fields must
  // not make an otherwise lossless save/load round trip look different.
  const text = canonical({ course: value.course, world: value.world, live: value.live });
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
