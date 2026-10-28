import type { Course, Hole } from "../models/types";
import { scoreCourseHoles, type CourseHoleSummary } from "./holes";

type DataSnapshot = { key: PropertyKey; descriptor: PropertyDescriptor }[];
type Entry = {
  source: DataSnapshot;
  projected: DataSnapshot;
  tee: DataSnapshot | null;
  green: DataSnapshot | null;
  hole: Hole;
};
type Owner = {
  source: Course;
  holes: Hole[];
  obstacles: { value: Course["obstacles"][number]; data: DataSnapshot }[];
  entries: Map<Hole, Entry>;
};

let owner: Owner | undefined;
let active = false;

// This private boundary consumes normalized serialized state and the actual
// courseForCourseSetup projection. These checks decline observable accessors
// and unusual records; they are not a general transparent-Proxy detector.
function dataSnapshot(value: object): DataSnapshot | undefined {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype) return;
  const result: DataSnapshot = [];
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (!("value" in descriptor)) return;
    result.push({ key, descriptor });
  }
  return result;
}

function sameData(a: DataSnapshot, b: DataSnapshot): boolean {
  return a.length === b.length && a.every(({ key, descriptor: x }, index) => {
    const { key: otherKey, descriptor: y } = b[index];
    return key === otherKey && x.enumerable === y.enumerable && x.configurable === y.configurable
      && x.writable === y.writable && Object.is(x.value, y.value);
  });
}

function pointSnapshot(point: Hole["tee"]): DataSnapshot | null | undefined {
  if (point === null) return null;
  const snapshot = dataSnapshot(point);
  if (!snapshot) return;
  const x = snapshot.find((item) => item.key === "x")?.descriptor.value;
  const y = snapshot.find((item) => item.key === "y")?.descriptor.value;
  if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)
    || Object.is(x, -0) || Object.is(y, -0)) return;
  return snapshot;
}

function entryFor(source: Hole, projected: Hole): Entry | undefined {
  const sourceData = dataSnapshot(source);
  const projectedData = dataSnapshot(projected);
  if (!sourceData || !projectedData) return;
  const tee = pointSnapshot(projected.tee);
  const green = pointSnapshot(projected.green);
  if (tee === undefined || green === undefined) return;
  return { source: sourceData, projected: projectedData, tee, green, hole: projected };
}

function samePointData(a: DataSnapshot | null, b: DataSnapshot | null): boolean {
  return a === null || b === null ? a === b : sameData(a, b);
}

function sameEntry(a: Entry, b: Entry): boolean {
  return sameData(a.source, b.source) && sameData(a.projected, b.projected)
    && samePointData(a.tee, b.tee) && samePointData(a.green, b.green);
}

// Inspect descriptors without invoking indexed getters. No terrain/elevation
// values are retained here: the unchanged scorer owns its exact read footprint.
function ordinaryArray(values: unknown[], kind: "string" | "number" | "object"): boolean {
  if (Object.getPrototypeOf(values) !== Array.prototype || Reflect.ownKeys(values).length !== values.length + 1) return false;
  for (let index = 0; index < values.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(values, String(index));
    if (!descriptor || !("value" in descriptor) || typeof descriptor.value !== kind) return false;
    if (kind === "number" && (!Number.isFinite(descriptor.value) || Object.is(descriptor.value, -0))) return false;
  }
  return true;
}

function newOwner(source: Course, projected: Course): Owner | undefined {
  if (!dataSnapshot(source) || !dataSnapshot(projected) || source.holes.length > 36
    || source.holes.length !== projected.holes.length || !ordinaryArray(source.holes, "object")
    || !ordinaryArray(source.tiles, "string") || !ordinaryArray(source.elevations, "number")
    || !ordinaryArray(source.obstacles, "object")) return;
  const obstacles: Owner["obstacles"] = [];
  for (const value of source.obstacles) {
    const data = dataSnapshot(value);
    if (!data) return;
    obstacles.push({ value, data });
  }
  return { source: { ...source }, holes: source.holes.slice(), obstacles, entries: new Map() };
}

function sameOwner(a: Owner, b: Owner): boolean {
  const x = a.source;
  const y = b.source;
  return x.holes === y.holes && x.tiles === y.tiles && x.elevations === y.elevations
    && x.obstacles === y.obstacles && Object.is(x.width, y.width) && Object.is(x.height, y.height)
    && Object.is(x.yardsPerTile, y.yardsPerTile) && Object.is(x.theme, y.theme)
    && a.holes.length === b.holes.length && a.holes.every((hole, index) => hole === b.holes[index])
    && a.obstacles.length === b.obstacles.length && a.obstacles.every((item, index) => {
      const other = b.obstacles[index];
      return item.value === other.value && sameData(item.data, other.data);
    });
}

/** Scoring-only identity reuse. Never return the private Course/Hole to callers. */
export function scorePrivateRatingSetup(
  source: Course,
  projected: Course,
  score: (course: Course) => CourseHoleSummary = scoreCourseHoles,
): CourseHoleSummary {
  if (active) return score(projected);
  active = true;
  try {
    const candidate = newOwner(source, projected);
    if (!candidate) {
      const result = score(projected);
      owner = undefined;
      return result;
    }
    const previous = owner && sameOwner(owner, candidate) ? owner : undefined;
    const holes = projected.holes.map((hole, index) => {
      const original = source.holes[index];
      const entry = entryFor(original, hole);
      if (!entry) return hole;
      const old = previous?.entries.get(original);
      const selected = old && sameEntry(old, entry) ? old : entry;
      candidate.entries.set(original, selected);
      return selected.hole;
    });
    const result = score({ ...projected, holes });
    // Failures and nested calls cannot publish a partially scored generation.
    owner = candidate;
    return result;
  } finally {
    active = false;
  }
}

export function __privateRatingScoringStateForTests(): { owners: number; entries: number; active: boolean } {
  return { owners: owner ? 1 : 0, entries: owner?.entries.size ?? 0, active };
}

export function __resetPrivateRatingScoringForTests(): void {
  owner = undefined;
  active = false;
}
