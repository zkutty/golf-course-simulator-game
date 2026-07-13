import type { Building, Course, WeekResult, World, Point, Obstacle } from "../game/models/types";
import { DEFAULT_COURSE, DEFAULT_WORLD } from "../game/models/defaults";
import { COURSE_WIDTH, COURSE_HEIGHT } from "../game/models/constants";
import { withNormalizedElevations } from "../game/models/elevation";
import { BUILDING_SPECS } from "../game/models/buildings";

const KEY = "simgolf_lite_save_v1";
const SCHEMA_VERSION = 1 as const;

export interface SaveV1 {
  schemaVersion: typeof SCHEMA_VERSION;
  savedAt: number;
  course: Course;
  world: World;
  history?: WeekResult[];
}

export function saveGame(payload: { course: Course; world: World; history?: WeekResult[] }) {
  const save: SaveV1 = {
    schemaVersion: SCHEMA_VERSION,
    savedAt: Date.now(),
    course: payload.course,
    world: payload.world,
    history: payload.history?.slice(-20),
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
  });
}

/**
 * Validate + normalize a parsed save of any vintage into a playable
 * payload, or null if it's unusable. Shared by the legacy single-slot
 * loader and the slot store / file import (ZKU-174), so every load path
 * gets the same field-default migrations (elevations, buildings, grid
 * resize) and can never crash the game on a hostile file.
 */
export function normalizeLoadedSave(input: unknown): SavePayload | null {
  try {
    const parsed = input as Partial<SaveV1>;
    if (!parsed || typeof parsed !== "object") return null;
    if (parsed.schemaVersion !== SCHEMA_VERSION) return null;
    if (!parsed.course || !parsed.world) return null;
    const rawCourse = parsed.course as Course;
    if (!Array.isArray(rawCourse.tiles) || !Array.isArray(rawCourse.holes)) return null;

    const loadedCourse: Course = {
      ...DEFAULT_COURSE,
      ...rawCourse,
      holes:
        rawCourse.holes?.map((h, i) => ({
          ...DEFAULT_COURSE.holes[i],
          ...h,
          parMode: h.parMode ?? "AUTO",
        })) ?? DEFAULT_COURSE.holes,
      obstacles: rawCourse.obstacles ?? DEFAULT_COURSE.obstacles,
      elevations: rawCourse.elevations ?? [], // normalized to flat below
      buildings: sanitizeBuildings(
        rawCourse.buildings,
        rawCourse.width ?? DEFAULT_COURSE.width,
        rawCourse.height ?? DEFAULT_COURSE.height
      ),
      yardsPerTile: rawCourse.yardsPerTile ?? DEFAULT_COURSE.yardsPerTile,
    };

    // Migrate if grid size differs, then guarantee a well-formed
    // elevations array (pre-elevation saves load flat — ZKU-143).
    const course = withNormalizedElevations(migrateCourseGrid(loadedCourse));

    const world: World = { ...DEFAULT_WORLD, ...(parsed.world as World) };
    const history = parsed.history ?? undefined;
    return { course, world, history };
  } catch {
    return null;
  }
}

export function loadGame(): SavePayload | null {
  const raw = localStorage.getItem(KEY);
  if (!raw) return null;
  try {
    return normalizeLoadedSave(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function resetSave() {
  localStorage.removeItem(KEY);
}

export function hasSavedGame() {
  return localStorage.getItem(KEY) != null;
}


