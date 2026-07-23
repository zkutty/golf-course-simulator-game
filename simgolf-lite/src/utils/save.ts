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
  Decoration,
  DecorationKind,
  PinRotation,
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
import { normalizeTournamentCalendar } from "../game/tournaments/tournaments";
import { DECORATION_KINDS, normalizedDecoration } from "../game/models/decorations";
import { PIN_ROTATIONS, TEE_SETS, validateHoleCourseSetup, withNormalizedHoleSetup } from "../game/models/courseSetup";
import { generateWildLandWithObstacles } from "../game/gen/generateWildLand";
import { createEstate, starterParcelOffset, validateEstate } from "../game/estate/estate";
import { MAX_ESTATE_HOLES, normalizeCourseLayouts } from "../game/models/courseLayouts";
import { normalizedStaff } from "../game/live/pace";

const KEY = "simgolf_lite_save_v1";
export const CURRENT_SAVE_SCHEMA_VERSION = 11 as const;
const MAX_SAVE_GRID_DIMENSION = 256;
const TERRAIN_VALUES = [
  "fairway",
  "rough",
  "deep_rough",
  "sand",
  "waste_area",
  "water",
  "wetland",
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
  schemaVersion: 4;
  records?: CourseRecords;
}
export interface SaveV5 extends Omit<SaveV1, "schemaVersion"> {
  schemaVersion: 5;
  records?: CourseRecords;
}
export interface SaveV6 extends Omit<SaveV1, "schemaVersion"> {
  schemaVersion: 6;
  records?: CourseRecords;
}
export interface SaveV7 extends Omit<SaveV1, "schemaVersion"> {
  schemaVersion: 7;
  records?: CourseRecords;
}
export interface SaveV8 extends Omit<SaveV1, "schemaVersion"> {
  schemaVersion: 8;
  records?: CourseRecords;
}
export interface SaveV9 extends Omit<SaveV1, "schemaVersion"> {
  schemaVersion: 9;
  records?: CourseRecords;
}
export interface SaveV10 extends Omit<SaveV1, "schemaVersion"> {
  schemaVersion: 10;
  records?: CourseRecords;
}
export interface SaveV11 extends Omit<SaveV1, "schemaVersion"> {
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
  const save: SaveV11 = {
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
function migrateCourseGrid(oldCourse: Course, runSeed: number): { course: Course; offset: Point } {
  const oldWidth = oldCourse.width;
  const oldHeight = oldCourse.height;
  const newWidth = COURSE_WIDTH;
  const newHeight = COURSE_HEIGHT;

  // If already correct size, return as-is
  if (oldWidth === newWidth && oldHeight === newHeight) {
    return { course: oldCourse, offset: { x: 0, y: 0 } };
  }

  // Generate the newly exposed estate first, then preserve the complete old
  // property in the exact central starter footprint.
  const generated = generateWildLandWithObstacles(newWidth, newHeight, runSeed | 0, [], oldCourse.theme ?? "parkland");
  const newTiles: Course["tiles"] = generated.tiles;
  const newElevations: number[] = generated.elevations;

  // Copy old tiles into top-left (centered would be: offsetX = (newWidth - oldWidth) / 2)
  const { x: offsetX, y: offsetY } = starterParcelOffset(newWidth, newHeight);

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
      teeBoxes: Object.fromEntries(TEE_SETS.map((set) => [set, clampPoint(hole.teeBoxes?.[set] ?? (set === "member" ? hole.tee : null))])),
      pinPositions: Object.fromEntries(PIN_ROTATIONS.map((rotation) => [rotation, clampPoint(hole.pinPositions?.[rotation] ?? (rotation === "A" ? hole.green : null))])),
      waypoints: hole.waypoints?.map((point) => clampPoint(point)!).filter(Boolean),
    };
  });

  // Migrate obstacles: clamp positions, remove out-of-bounds
  const exteriorObstacles = generated.obstacles.filter((obs) =>
    obs.x < offsetX || obs.y < offsetY || obs.x >= offsetX + oldWidth || obs.y >= offsetY + oldHeight
  );
  const migratedObstacles: Obstacle[] = [...exteriorObstacles, ...(oldCourse.obstacles ?? [])
    .map((obs) => ({
      ...obs,
      x: obs.x + offsetX,
      y: obs.y + offsetY,
    }))
    .filter((obs) => obs.x >= 0 && obs.x < newWidth && obs.y >= 0 && obs.y < newHeight)];

  const course: Course = {
    ...oldCourse,
    width: newWidth,
    height: newHeight,
    tiles: newTiles,
    elevations: newElevations,
    holes: migratedHoles,
    obstacles: migratedObstacles,
    buildings: (oldCourse.buildings ?? []).map((b) => ({ ...b, x: b.x + offsetX, y: b.y + offsetY })),
    decorations: (oldCourse.decorations ?? []).map((decoration) => ({ ...decoration, x: decoration.x + offsetX, y: decoration.y + offsetY })),
  };
  course.estate = createEstate(course, runSeed);
  return { course, offset: { x: offsetX, y: offsetY } };
}

function translateLiveSnapshot(raw: unknown, offset: Point): unknown {
  if (!raw || typeof raw !== "object" || (offset.x === 0 && offset.y === 0)) return raw;
  const snapshot = JSON.parse(JSON.stringify(raw)) as Record<string, unknown>;
  const state = snapshot.state as Record<string, unknown> | undefined;
  if (!state || !Array.isArray(state.golfers)) return raw;
  const move = (point: unknown) => {
    if (point && typeof point === "object") {
      const p = point as Record<string, unknown>;
      if (typeof p.x === "number" && typeof p.y === "number") { p.x += offset.x; p.y += offset.y; }
    }
  };
  for (const rawGolfer of state.golfers) {
    const golfer = rawGolfer as Record<string, unknown>;
    move(golfer.pos); move(golfer.ball);
    if (Array.isArray(golfer.segments)) for (const rawSegment of golfer.segments) {
      const segment = rawSegment as Record<string, unknown>;
      move(segment.from); move(segment.to);
      const concession = segment.concession as Record<string, unknown> | undefined;
      if (concession && typeof concession.buildingX === "number" && typeof concession.buildingY === "number") {
        concession.buildingX += offset.x; concession.buildingY += offset.y;
      }
    }
  }
  if (Array.isArray(state.concessionTransactions)) for (const rawTransaction of state.concessionTransactions) {
    const transaction = rawTransaction as Record<string, unknown>;
    if (typeof transaction.buildingX === "number" && typeof transaction.buildingY === "number") {
      transaction.buildingX += offset.x; transaction.buildingY += offset.y;
    }
  }
  return snapshot;
}

function attachLiveCourseModel(raw: unknown, course: Course): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const snapshot = JSON.parse(JSON.stringify(raw)) as Record<string, unknown>;
  const state = snapshot.state as Record<string, unknown> | undefined;
  const starter = course.layouts?.find((layout) => layout.id === course.activeCourseId) ?? course.layouts?.[0];
  if (!state || !starter) return snapshot;
  if (Array.isArray(state.arrivals)) for (const rawArrival of state.arrivals) {
    const arrival = rawArrival as Record<string, unknown>;
    if (typeof arrival.courseId !== "string") arrival.courseId = starter.id;
  }
  if (Array.isArray(state.golfers)) for (const rawGolfer of state.golfers) {
    const golfer = rawGolfer as Record<string, unknown>;
    if (typeof golfer.courseId !== "string") golfer.courseId = starter.id;
    if (typeof golfer.courseName !== "string") golfer.courseName = starter.name;
    if (!Array.isArray(golfer.holeIds)) golfer.holeIds = [...starter.publishedHoleIds];
    if (Array.isArray(golfer.segments)) for (const rawSegment of golfer.segments) {
      const segment = rawSegment as Record<string, unknown>;
      if (typeof segment.holeId !== "string" && Number.isInteger(segment.holeIndex) && (segment.holeIndex as number) >= 0) segment.holeId = starter.publishedHoleIds[segment.holeIndex as number];
    }
  }
  const tournament = state.tournament as Record<string, unknown> | undefined;
  if (tournament && typeof tournament.courseId !== "string") tournament.courseId = starter.id;
  return snapshot;
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

function validMarkerRecord(value: unknown, keys: readonly string[], width: number, height: number): boolean {
  if (value == null) return true;
  if (!isRecord(value)) return false;
  return Object.keys(value).every((key) => keys.includes(key)) && keys.every((key) => validPoint(value[key] ?? null, width, height));
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
  if (!Array.isArray(holes) || holes.length < 1 || holes.length > MAX_ESTATE_HOLES) {
    return { code: "INVALID_COURSE", message: "The saved hole list is malformed." };
  }
  for (const hole of holes) {
    if (!isRecord(hole) || !validPoint(hole.tee ?? null, width as number, height as number) || !validPoint(hole.green ?? null, width as number, height as number)) {
      return { code: "INVALID_COURSE", message: "A saved tee or green position is invalid." };
    }
    if (!validMarkerRecord(hole.teeBoxes, TEE_SETS, width as number, height as number) || !validMarkerRecord(hole.pinPositions, PIN_ROTATIONS, width as number, height as number)) {
      return { code: "INVALID_COURSE", message: "A saved tee set or pin rotation is invalid." };
    }
    if (hole.parByTee != null) {
      if (!isRecord(hole.parByTee)) return { code: "INVALID_COURSE", message: "A saved tee par setting is invalid." };
      for (const teeSet of TEE_SETS) {
        const setting = hole.parByTee[teeSet];
        if (setting == null) continue;
        if (!isRecord(setting) || (setting.mode !== "AUTO" && setting.mode !== "MANUAL") ||
          (setting.mode === "MANUAL" && setting.par !== 3 && setting.par !== 4 && setting.par !== 5)) {
          return { code: "INVALID_COURSE", message: "A saved tee par setting is invalid." };
        }
      }
    }
    if (hole.waypoints != null && (!Array.isArray(hole.waypoints) || hole.waypoints.some((p) => !validPoint(p, width as number, height as number)))) {
      return { code: "INVALID_COURSE", message: "A saved hole waypoint is invalid." };
    }
  }
  if (raw.layouts != null) {
    if (!Array.isArray(raw.layouts) || raw.layouts.length < 1 || raw.layouts.length > MAX_ESTATE_HOLES) {
      return { code: "INVALID_COURSE", message: "The saved course layout list is malformed." };
    }
    const ids = new Set<string>();
    const holeIds = new Set((holes as SaveRecord[]).map((hole) => typeof hole.id === "string" ? hole.id : "").filter(Boolean));
    if (holeIds.size !== holes.length) return { code: "INVALID_COURSE", message: "Stable hole identities are missing or duplicated." };
    const draftOwners = new Set<string>();
    const publishedOwners = new Set<string>();
    for (const layout of raw.layouts) {
      if (!isRecord(layout) || typeof layout.id !== "string" || !layout.id || ids.has(layout.id) || typeof layout.name !== "string" ||
        !Array.isArray(layout.draftHoleIds) || !Array.isArray(layout.publishedHoleIds) ||
        !layout.draftHoleIds.every((id) => typeof id === "string") || !layout.publishedHoleIds.every((id) => typeof id === "string") ||
        (layout.roundLength !== 9 && layout.roundLength !== 18) || (layout.state !== "open" && layout.state !== "closed") || !isFiniteNumber(layout.greenFee)) {
        return { code: "INVALID_COURSE", message: "A saved operating course layout is malformed." };
      }
      for (const holeId of layout.draftHoleIds as string[]) {
        if (!holeIds.has(holeId) || draftOwners.has(holeId)) return { code: "INVALID_COURSE", message: "A draft hole is missing or assigned to multiple courses." };
        draftOwners.add(holeId);
      }
      for (const holeId of layout.publishedHoleIds as string[]) {
        if (!holeIds.has(holeId) || publishedOwners.has(holeId)) return { code: "INVALID_COURSE", message: "A published hole is missing or assigned to multiple courses." };
        publishedOwners.add(holeId);
      }
      ids.add(layout.id);
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
  // V5 expands validation to waste-area and wetland terrain. Existing tile
  // arrays are deliberately retained by reference/value with no rewrites.
  4: (save) => ({ ...save, schemaVersion: 5 }),
  // V6 adds player-authored course decorations and walking structures.
  // The normalizer supplies an empty list for older courses.
  5: (save) => ({ ...save, schemaVersion: 6 }),
  // V7 introduces typed tee sets and pin rotations. The normalizer mirrors
  // every legacy tee/green into Member/A without altering terrain or routes.
  6: (save) => ({ ...save, schemaVersion: 7 }),
  // V8 introduces the full estate. Spatial translation and estate synthesis
  // happen in the normalizer where validated course/world data is available.
  7: (save) => ({ ...save, schemaVersion: 8 }),
  // V9 adds stable hole identities and independent named course routings.
  // Normalization creates one equivalent starter course for every older save.
  8: (save) => ({
    ...save,
    schemaVersion: 9,
    ...(isRecord(save.course) ? { course: normalizeCourseLayouts(save.course as unknown as Course) } : {}),
  }),
  // V10 adds independent par policy for every tee set. Existing par settings
  // remain the Member policy while Forward and Championship default to Auto.
  9: (save) => ({
    ...save,
    schemaVersion: 10,
    ...(isRecord(save.course) && Array.isArray(save.course.holes) ? {
      course: {
        ...save.course,
        holes: save.course.holes.map((rawHole) => {
          if (!isRecord(rawHole)) return rawHole;
          const member = rawHole.parMode === "MANUAL"
            ? { mode: "MANUAL", par: rawHole.parManual === 3 || rawHole.parManual === 5 ? rawHole.parManual : 4 }
            : { mode: "AUTO" };
          return { ...rawHole, parByTee: { forward: { mode: "AUTO" }, member, championship: { mode: "AUTO" } } };
        }),
      },
    } : {}),
  }),
  // V11 adds per-course pace operations, named operational staff, grouped tee
  // sheets, and hospitality state. Normalizers supply lossless defaults.
  10: (save) => ({ ...save, schemaVersion: 11 }),
};

function normalizeRecords(raw: unknown, history: WeekResult[] | undefined, world: World, course?: Course): CourseRecords {
  if (!isRecord(raw) || raw.version !== 1 || !Array.isArray(raw.history) || !Array.isArray(raw.holes) || !Array.isArray(raw.hall) || !Array.isArray(raw.aces)) {
    return seedRecordsFromHistory(history, Math.max(1, world.week - (history?.length ?? 0)));
  }
  const defaults = emptyCourseRecords();
  const candidate = raw as unknown as CourseRecords;
  const byCourse: NonNullable<CourseRecords["byCourse"]> = {};
  if (isRecord(candidate.byCourse)) for (const [courseId, value] of Object.entries(candidate.byCourse)) {
    if (!isRecord(value) || typeof value.courseName !== "string" || !isFiniteNumber(value.totalRounds) || !isRecord(value.holes)) continue;
    const holes: Record<string, { rounds: number; strokes: number; par: number }> = {};
    for (const [holeId, hole] of Object.entries(value.holes)) if (isRecord(hole) && isFiniteNumber(hole.rounds) && isFiniteNumber(hole.strokes) && isFiniteNumber(hole.par)) {
      holes[holeId] = { rounds: hole.rounds, strokes: hole.strokes, par: hole.par };
    }
    byCourse[courseId] = { courseName: value.courseName, totalRounds: value.totalRounds, bestRound: isRecord(value.bestRound) ? value.bestRound as NonNullable<CourseRecords["bestRound"]> : null, holes };
  }
  const normalized: CourseRecords = {
    ...defaults,
    ...candidate,
    history: candidate.history.filter((row) => Array.isArray(row) && row.length === 6 && row.every(isFiniteNumber)),
    holes: candidate.holes.filter((hole) => hole && isFiniteNumber(hole.rounds) && isFiniteNumber(hole.strokes) && isFiniteNumber(hole.par)),
    hall: candidate.hall.filter((entry) => entry && typeof entry.golferName === "string" && isFiniteNumber(entry.rounds)),
    aces: candidate.aces.filter((ace) => ace && typeof ace.golferName === "string" && isFiniteNumber(ace.week)),
    byCourse,
  };
  if (course && Object.keys(normalized.byCourse ?? {}).length === 0 && normalized.totalRounds > 0) {
    const starter = course.layouts?.find((layout) => layout.id === course.activeCourseId) ?? course.layouts?.[0];
    if (starter) normalized.byCourse = {
      [starter.id]: {
        courseName: starter.name,
        totalRounds: normalized.totalRounds,
        bestRound: normalized.bestRound,
        holes: Object.fromEntries(normalized.holes.map((hole, index) => [starter.publishedHoleIds[index] ?? `hole-${index + 1}`, hole])),
      },
    };
    normalized.aces = normalized.aces.map((ace) => ({ ...ace, courseId: ace.courseId ?? starter?.id, holeId: ace.holeId ?? starter?.publishedHoleIds[ace.holeIndex] }));
  }
  return normalized;
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

function sanitizeDecorations(raw: unknown, width: number, height: number): Decoration[] {
  if (!Array.isArray(raw)) return [];
  const allowed = DECORATION_KINDS as readonly string[];
  return raw.filter((value): value is Decoration => {
    if (!isRecord(value) || !allowed.includes(value.kind as string)) return false;
    if (!Number.isInteger(value.x) || !Number.isInteger(value.y) || !Number.isInteger(value.rotation) || (value.rotation as number) < 0 || (value.rotation as number) > 3) return false;
    return (value.x as number) >= 0 && (value.y as number) >= 0 && (value.x as number) < width && (value.y as number) < height;
  }).map((value) => normalizedDecoration({ ...value, kind: value.kind as DecorationKind }));
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
        rawCourse.holes?.map((h, i) => {
          const memberPar = h.parMode === "MANUAL"
            ? { mode: "MANUAL" as const, par: h.parManual ?? 4 }
            : { mode: "AUTO" as const };
          return {
          ...withNormalizedHoleSetup({
            ...DEFAULT_COURSE.holes[i],
            ...h,
            parMode: h.parMode ?? "AUTO",
            parByTee: { ...h.parByTee, member: memberPar },
          }),
        }; }) ?? DEFAULT_COURSE.holes,
      obstacles: sanitizeObstacles(rawCourse.obstacles, rawWidth, rawHeight),
      elevations: Array.isArray(rawCourse.elevations)
        ? rawCourse.elevations.map((value) => isFiniteNumber(value) ? value : 0)
        : [], // normalized to flat below
      buildings: sanitizeBuildings(
        rawCourse.buildings,
        rawCourse.width ?? DEFAULT_COURSE.width,
        rawCourse.height ?? DEFAULT_COURSE.height
      ),
      decorations: sanitizeDecorations(rawCourse.decorations, rawWidth, rawHeight),
      yardsPerTile: rawCourse.yardsPerTile ?? DEFAULT_COURSE.yardsPerTile,
      theme: oneOf<LandTheme>(rawCourse.theme, ["parkland", "links", "desert"], "parkland"),
      activePinRotation: oneOf<PinRotation>(rawCourse.activePinRotation, PIN_ROTATIONS, "A"),
      // Do not inherit DEFAULT_COURSE's starter routing when a valid legacy
      // course omitted M26 layout fields. Normalization must synthesize the
      // layout from that save's own holes, name, and green fee.
      layouts: Array.isArray(rawCourse.layouts) ? rawCourse.layouts : undefined,
      activeCourseId: typeof rawCourse.activeCourseId === "string" ? rawCourse.activeCourseId : undefined,
    };

    // Migrate if grid size differs, then guarantee a well-formed
    // elevations array (pre-elevation saves load flat — ZKU-143).
    const isLegacyStarterGrid = migrated.migratedFrom != null && rawWidth === 110 && rawHeight === 70;
    const migratedGrid = isLegacyStarterGrid
      ? migrateCourseGrid(loadedCourse, (parsed.world as unknown as World).runSeed)
      : { course: loadedCourse, offset: { x: 0, y: 0 } };
    let course = normalizeCourseLayouts(withNormalizedElevations(migratedGrid.course));
    if (rawCourse.estate && !validateEstate(rawCourse.estate, rawWidth, rawHeight)) {
      return fail("INVALID_COURSE", "The saved estate, ownership, or natural-land baseline is malformed.");
    }
    if (!course.estate && migrated.migratedFrom != null && course.width === COURSE_WIDTH && course.height === COURSE_HEIGHT) {
      course = { ...course, estate: createEstate(course, (parsed.world as unknown as World).runSeed) };
    }
    for (const hole of course.holes) {
      if (validateHoleCourseSetup(course, hole).length > 0) {
        return fail("INVALID_COURSE", "The saved tee and pin setup is invalid.");
      }
    }

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
      tournaments: normalizeTournamentCalendar(rawWorld.tournaments, course),
    };
    world.staffRoster = normalizedStaff(world, course);
    const history = Array.isArray(parsed.history) ? parsed.history as WeekResult[] : undefined;
    const records = normalizeRecords(parsed.records, history, world, course);
    const tutorial = normalizeTutorialProgress(parsed.tutorial);
    let live: LiveSimulationSnapshotV1 | undefined;
    if (parsed.live != null) {
      const translatedLive = attachLiveCourseModel(translateLiveSnapshot(parsed.live, migratedGrid.offset), course);
      const restored = restoreLiveSimulation(translatedLive);
      if (!restored) {
        return fail("INVALID_LIVE_STATE", "The saved live simulation state is malformed.");
      }
      live = translatedLive as LiveSimulationSnapshotV1;
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
