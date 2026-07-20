import type {
  Building,
  Course,
  Difficulty,
  LandTheme,
  PlayMode,
  WeekResult,
  World,
  Point,
  Obstacle,
} from "../game/models/types";
import type { ObjectiveState } from "../game/models/objectives";
import {
  restoreLiveSimulation,
  type LiveSimulationSnapshotV1,
} from "../game/live/persistence";

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}
import { DEFAULT_COURSE, DEFAULT_WORLD } from "../game/models/defaults";
import { COURSE_WIDTH, COURSE_HEIGHT } from "../game/models/constants";
import { withNormalizedElevations } from "../game/models/elevation";
import { BUILDING_SPECS, normalizedBuilding } from "../game/models/buildings";
import { normalizeTutorialProgress, type TutorialProgress } from "../game/onboarding/tutorial";
import { emptyCourseRecords, seedRecordsFromHistory } from "../game/retention/records";
import type { CourseRecords } from "../game/retention/types";

const KEY = "simgolf_lite_save_v1";
export const CURRENT_SAVE_SCHEMA_VERSION = 4 as const;
const MAX_SAVE_GRID_DIMENSION = 256;
const TERRAIN_VALUES = [
  "fairway",
  "rough",
  "deep_rough",
  "sand",
  "water",
  "green",
  "tee",
  "path",
] as const;

export interface SaveV1 {
  schemaVersion: 1;
  savedAt: number;
  course: Course;
  world: World;
  history?: WeekResult[];
  live?: LiveSimulationSnapshotV1;
  tutorial?: TutorialProgress | null;
}

export interface SaveV2 extends Omit<SaveV1, "schemaVersion"> {
  schemaVersion: 2;
}

export interface SaveV3 extends Omit<SaveV1, "schemaVersion"> {
  schemaVersion: 3;
}
export interface SaveV4 extends Omit<SaveV1, "schemaVersion"> {
  schemaVersion: typeof CURRENT_SAVE_SCHEMA_VERSION;
  records?: CourseRecords;
}

export type SaveLoadErrorCode =
  | "INVALID_JSON"
  | "INVALID_SHAPE"
  | "INVALID_VERSION"
  | "UNSUPPORTED_VERSION"
  | "INVALID_COURSE"
  | "INVALID_WORLD"
  | "INVALID_LIVE_STATE";

export interface SaveLoadError {
  code: SaveLoadErrorCode;
  message: string;
}

export type SaveLoadResult =
  | { ok: true; payload: SavePayload; migratedFrom?: number }
  | { ok: false; error: SaveLoadError };

export function saveGame(payload: SavePayload) {
  const save: SaveV4 = {
    schemaVersion: CURRENT_SAVE_SCHEMA_VERSION,
    savedAt: Date.now(),
    course: payload.course,
    world: payload.world,
    history: payload.history,
    records: payload.records,
    live: payload.live,
    tutorial: payload.tutorial,
  };
  localStorage.setItem(KEY, JSON.stringify(save));
}

/**
 * Migrate an old course grid to the new size
 * Copies old grid into top-left of new grid, clamping out-of-bounds elements
 */
function migrateCourseGrid(oldCourse: Course): Course {
  const oldWidth = oldCourse.width;
  const oldHeight = oldCourse.height;
  const newWidth = COURSE_WIDTH;
  const newHeight = COURSE_HEIGHT;

  // If already correct size, return as-is
  if (oldWidth === newWidth && oldHeight === newHeight) {
    return oldCourse;
  }

  // Create new grid filled with rough (elevations default to base level)
  const newTiles: Course["tiles"] = Array.from({ length: newWidth * newHeight }, () => "rough" as const);
  const newElevations: number[] = new Array(newWidth * newHeight).fill(0);

  // Copy old tiles into top-left (centered would be: offsetX = (newWidth - oldWidth) / 2)
  const offsetX = 0; // Top-left alignment
  const offsetY = 0; // Top-left alignment

  for (let y = 0; y < oldHeight; y++) {
    for (let x = 0; x < oldWidth; x++) {
      const newX = x + offsetX;
      const newY = y + offsetY;
      if (newX >= 0 && newX < newWidth && newY >= 0 && newY < newHeight) {
        const oldIdx = y * oldWidth + x;
        const newIdx = newY * newWidth + newX;
        if (oldIdx < oldCourse.tiles.length) {
          newTiles[newIdx] = oldCourse.tiles[oldIdx];
        }
        if (oldCourse.elevations && oldIdx < oldCourse.elevations.length) {
          newElevations[newIdx] = oldCourse.elevations[oldIdx];
        }
      }
    }
  }

  // Migrate holes: clamp tee/green positions
  const migratedHoles = oldCourse.holes.map((hole) => {
    const clampPoint = (p: Point | null): Point | null => {
      if (!p) return null;
      return {
        x: Math.max(0, Math.min(newWidth - 1, p.x + offsetX)),
        y: Math.max(0, Math.min(newHeight - 1, p.y + offsetY)),
      };
    };
    return {
      ...hole,
      tee: clampPoint(hole.tee),
      green: clampPoint(hole.green),
    };
  });

  // Migrate obstacles: clamp positions, remove out-of-bounds
  const migratedObstacles: Obstacle[] = (oldCourse.obstacles ?? [])
    .map((obs) => ({
      ...obs,
      x: obs.x + offsetX,
      y: obs.y + offsetY,
    }))
    .filter((obs) => obs.x >= 0 && obs.x < newWidth && obs.y >= 0 && obs.y < newHeight);

  return {
    ...oldCourse,
    width: newWidth,
    height: newHeight,
    tiles: newTiles,
    elevations: newElevations,
    holes: migratedHoles,
    obstacles: migratedObstacles,
    buildings: (oldCourse.buildings ?? []).filter(
      (b) => b.x >= 0 && b.y >= 0 && b.x < newWidth && b.y < newHeight
    ),
  };
}

export interface SavePayload {
  course: Course;
  world: World;
  history?: WeekResult[];
  live?: LiveSimulationSnapshotV1;
  tutorial?: TutorialProgress | null;
  records?: CourseRecords;
}

type SaveRecord = Record<string, unknown>;

function isRecord(value: unknown): value is SaveRecord {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function fail(code: SaveLoadErrorCode, message: string): SaveLoadResult {
  return { ok: false, error: { code, message } };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function validPoint(value: unknown, width: number, height: number): boolean {
  if (value === null) return true;
  if (!isRecord(value)) return false;
  return (
    Number.isInteger(value.x) &&
    Number.isInteger(value.y) &&
    (value.x as number) >= 0 &&
    (value.y as number) >= 0 &&
    (value.x as number) < width &&
    (value.y as number) < height
  );
}

function validateCourseShape(raw: unknown): SaveLoadError | null {
  if (!isRecord(raw)) return { code: "INVALID_COURSE", message: "The save has no valid course data." };
  const { width, height, tiles, holes } = raw;
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    (width as number) < 1 ||
    (height as number) < 1 ||
    (width as number) > MAX_SAVE_GRID_DIMENSION ||
    (height as number) > MAX_SAVE_GRID_DIMENSION
  ) {
    return { code: "INVALID_COURSE", message: "The saved course dimensions are invalid." };
  }
  const expected = (width as number) * (height as number);
  if (
    !Array.isArray(tiles) ||
    tiles.length !== expected ||
    tiles.some((tile) => typeof tile !== "string" || !(TERRAIN_VALUES as readonly string[]).includes(tile))
  ) {
    return { code: "INVALID_COURSE", message: "The saved terrain grid is malformed." };
  }
  if (!Array.isArray(holes) || holes.length < 1 || holes.length > 18) {
    return { code: "INVALID_COURSE", message: "The saved hole list is malformed." };
  }
  for (const hole of holes) {
    if (!isRecord(hole) || !validPoint(hole.tee ?? null, width as number, height as number) || !validPoint(hole.green ?? null, width as number, height as number)) {
      return { code: "INVALID_COURSE", message: "A saved tee or green position is invalid." };
    }
    if (hole.waypoints != null && (!Array.isArray(hole.waypoints) || hole.waypoints.some((p) => !validPoint(p, width as number, height as number)))) {
      return { code: "INVALID_COURSE", message: "A saved hole waypoint is invalid." };
    }
  }
  return null;
}

function validateWorldShape(raw: unknown): SaveLoadError | null {
  if (!isRecord(raw)) return { code: "INVALID_WORLD", message: "The save has no valid world data." };
  for (const key of ["week", "cash", "reputation", "runSeed"] as const) {
    if (!isFiniteNumber(raw[key])) {
      return { code: "INVALID_WORLD", message: `The saved world field "${key}" is invalid.` };
    }
  }
  return null;
}

type SaveMigration = (save: SaveRecord) => SaveRecord;

const SAVE_MIGRATIONS: Record<number, SaveMigration> = {
  // V2 formalizes the migration/validation pipeline. Its gameplay payload is
  // deliberately unchanged, so every existing v1 slot can migrate losslessly.
  1: (save) => ({ ...save, schemaVersion: 2 }),
  // V3 adds configurable concession fields. Normalization supplies defaults
  // for every pre-M4 building so old saves remain playable.
  2: (save) => ({ ...save, schemaVersion: 3 }),
  // V4 adds compact long-run history and incremental course records.
  3: (save) => ({ ...save, schemaVersion: 4 }),
};

function normalizeRecords(raw: unknown, history: WeekResult[] | undefined, world: World): CourseRecords {
  if (!isRecord(raw) || raw.version !== 1 || !Array.isArray(raw.history) || !Array.isArray(raw.holes) || !Array.isArray(raw.hall) || !Array.isArray(raw.aces)) {
    return seedRecordsFromHistory(history, Math.max(1, world.week - (history?.length ?? 0)));
  }
  const defaults = emptyCourseRecords();
  const candidate = raw as unknown as CourseRecords;
  return {
    ...defaults,
    ...candidate,
    history: candidate.history.filter((row) => Array.isArray(row) && row.length === 6 && row.every(isFiniteNumber)),
    holes: candidate.holes.filter((hole) => hole && isFiniteNumber(hole.rounds) && isFiniteNumber(hole.strokes) && isFiniteNumber(hole.par)),
    hall: candidate.hall.filter((entry) => entry && typeof entry.golferName === "string" && isFiniteNumber(entry.rounds)),
    aces: candidate.aces.filter((ace) => ace && typeof ace.golferName === "string" && isFiniteNumber(ace.week)),
  };
}

function migrateSave(input: unknown):
  | { ok: true; save: SaveRecord; migratedFrom?: number }
  | { ok: false; error: SaveLoadError } {
  if (!isRecord(input)) {
    return { ok: false, error: { code: "INVALID_SHAPE", message: "The save file is not an object." } };
  }
  const version = input.schemaVersion;
  if (!Number.isInteger(version) || (version as number) < 1) {
    return { ok: false, error: { code: "INVALID_VERSION", message: "The save has no valid schema version." } };
  }
  if ((version as number) > CURRENT_SAVE_SCHEMA_VERSION) {
    return { ok: false, error: { code: "UNSUPPORTED_VERSION", message: "This save was created by a newer version of CourseCraft." } };
  }
  const migratedFrom = version as number;
  let save = { ...input };
  while ((save.schemaVersion as number) < CURRENT_SAVE_SCHEMA_VERSION) {
    const migration = SAVE_MIGRATIONS[save.schemaVersion as number];
    if (!migration) {
      return { ok: false, error: { code: "UNSUPPORTED_VERSION", message: `No migration is available for save version ${save.schemaVersion}.` } };
    }
    save = migration(save);
  }
  return {
    ok: true,
    save,
    ...(migratedFrom === CURRENT_SAVE_SCHEMA_VERSION ? {} : { migratedFrom }),
  };
}

/**
 * Keep only well-formed buildings of known types whose footprint fits the
 * grid — renderers and pathfinding dereference the spec unconditionally, so
 * a hostile import with a bogus type/position must not survive the load.
 */
function sanitizeBuildings(raw: unknown, width: number, height: number): Building[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((b): b is Building => {
    if (!b || typeof b !== "object") return false;
    const { type, x, y } = b as Building;
    const spec =
      typeof type === "string"
        ? (BUILDING_SPECS as Record<string, (typeof BUILDING_SPECS)[keyof typeof BUILDING_SPECS] | undefined>)[type]
        : undefined;
    if (!spec) return false;
    if (!Number.isInteger(x) || !Number.isInteger(y)) return false;
    return x >= 0 && y >= 0 && x + spec.w <= width && y + spec.d <= height;
  }).map(normalizedBuilding);
}

function sanitizeObstacles(raw: unknown, width: number, height: number): Obstacle[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((value): value is Obstacle => {
    if (!isRecord(value)) return false;
    return (
      Number.isInteger(value.x) &&
      Number.isInteger(value.y) &&
      (value.x as number) >= 0 &&
      (value.y as number) >= 0 &&
      (value.x as number) < width &&
      (value.y as number) < height &&
      (value.type === "tree" || value.type === "bush" || value.type === "rock")
    );
  });
}

/**
 * Objective state must be structurally sound or the goals panel / evaluator
 * would crash on first render. Pre-M13 saves have no field at all → null
 * (free play). Anything malformed also degrades to null rather than failing
 * the whole load.
 */
function sanitizeObjectives(raw: unknown): ObjectiveState | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as ObjectiveState;
  if (!Array.isArray(o.goals) || !Array.isArray(o.progress)) return null;
  if (o.outcome !== "OPEN" && o.outcome !== "WON" && o.outcome !== "LOST") return null;
  if (o.goals.some((g) => !g || typeof g.id !== "string" || !Array.isArray(g.conditions))) return null;
  if (o.progress.some((p) => !p || typeof p.goalId !== "string" || !Array.isArray(p.conditions))) return null;
  return {
    ...o,
    totalRounds: typeof o.totalRounds === "number" ? o.totalRounds : 0,
    profitStreak: typeof o.profitStreak === "number" ? o.profitStreak : 0,
    weekProfitAccum: typeof o.weekProfitAccum === "number" ? o.weekProfitAccum : 0,
  };
}

/**
 * Validate + normalize a parsed save of any vintage into a playable
 * payload, or null if it's unusable. Shared by the legacy single-slot
 * loader and the slot store / file import (ZKU-174), so every load path
 * gets the same field-default migrations (elevations, buildings, grid
 * resize) and can never crash the game on a hostile file.
 */
export function normalizeLoadedSaveResult(input: unknown): SaveLoadResult {
  try {
    const migrated = migrateSave(input);
    if (!migrated.ok) return migrated;
    const parsed = migrated.save;
    const courseError = validateCourseShape(parsed.course);
    if (courseError) return { ok: false, error: courseError };
    const worldError = validateWorldShape(parsed.world);
    if (worldError) return { ok: false, error: worldError };
    const rawCourse = parsed.course as unknown as Course;
    const rawWidth = rawCourse.width;
    const rawHeight = rawCourse.height;

    const loadedCourse: Course = {
      ...DEFAULT_COURSE,
      ...rawCourse,
      holes:
        rawCourse.holes?.map((h, i) => ({
          ...DEFAULT_COURSE.holes[i],
          ...h,
          parMode: h.parMode ?? "AUTO",
        })) ?? DEFAULT_COURSE.holes,
      obstacles: sanitizeObstacles(rawCourse.obstacles, rawWidth, rawHeight),
      elevations: Array.isArray(rawCourse.elevations)
        ? rawCourse.elevations.map((value) => isFiniteNumber(value) ? value : 0)
        : [], // normalized to flat below
      buildings: sanitizeBuildings(
        rawCourse.buildings,
        rawCourse.width ?? DEFAULT_COURSE.width,
        rawCourse.height ?? DEFAULT_COURSE.height
      ),
      yardsPerTile: rawCourse.yardsPerTile ?? DEFAULT_COURSE.yardsPerTile,
      theme: oneOf<LandTheme>(rawCourse.theme, ["parkland", "links", "desert"], "parkland"),
    };

    // Migrate if grid size differs, then guarantee a well-formed
    // elevations array (pre-elevation saves load flat — ZKU-143).
    const course = withNormalizedElevations(migrateCourseGrid(loadedCourse));

    const rawWorld = parsed.world as unknown as World;
    const rawConstraints = rawWorld.constraints;
    const world: World = {
      ...DEFAULT_WORLD,
      ...rawWorld,
      objectives: sanitizeObjectives(rawWorld.objectives),
      mode: oneOf<PlayMode>(rawWorld.mode, ["sandbox", "challenge", "career"], "sandbox"),
      difficulty: oneOf<Difficulty>(rawWorld.difficulty, ["easy", "normal", "hard"], "normal"),
      scenarioId: typeof rawWorld.scenarioId === "string" ? rawWorld.scenarioId : undefined,
      constraints:
        rawConstraints && typeof rawConstraints === "object" && !Array.isArray(rawConstraints)
          ? {
              noLoans: rawConstraints.noLoans === true,
              ...(typeof rawConstraints.fixedGreenFee === "number"
                ? { fixedGreenFee: rawConstraints.fixedGreenFee }
                : {}),
              protectedTrees: rawConstraints.protectedTrees === true,
            }
          : undefined,
    };
    const history = Array.isArray(parsed.history) ? parsed.history as WeekResult[] : undefined;
    const records = normalizeRecords(parsed.records, history, world);
    const tutorial = normalizeTutorialProgress(parsed.tutorial);
    let live: LiveSimulationSnapshotV1 | undefined;
    if (parsed.live != null) {
      const restored = restoreLiveSimulation(parsed.live);
      if (!restored) {
        return fail("INVALID_LIVE_STATE", "The saved live simulation state is malformed.");
      }
      live = parsed.live as unknown as LiveSimulationSnapshotV1;
    }
    return {
      ok: true,
      payload: { course, world, history, live, tutorial, records },
      ...(migrated.migratedFrom == null ? {} : { migratedFrom: migrated.migratedFrom }),
    };
  } catch {
    return fail("INVALID_SHAPE", "The save data could not be safely read.");
  }
}

export function normalizeLoadedSave(input: unknown): SavePayload | null {
  const result = normalizeLoadedSaveResult(input);
  return result.ok ? result.payload : null;
}

export function parseSaveText(text: string): SaveLoadResult {
  try {
    return normalizeLoadedSaveResult(JSON.parse(text));
  } catch {
    return fail("INVALID_JSON", "The save file is not valid JSON.");
  }
}

export function loadGame(): SavePayload | null {
  const raw = localStorage.getItem(KEY);
  if (!raw) return null;
  const result = parseSaveText(raw);
  return result.ok ? result.payload : null;
}

export function resetSave() {
  localStorage.removeItem(KEY);
}

export function hasSavedGame() {
  return localStorage.getItem(KEY) != null;
}
