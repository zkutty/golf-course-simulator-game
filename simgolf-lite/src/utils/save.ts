import type { Course, WeekResult, World, Point, Obstacle } from "../game/models/types";
import { DEFAULT_COURSE, DEFAULT_WORLD } from "../game/models/defaults";
import { COURSE_WIDTH, COURSE_HEIGHT } from "../game/models/constants";

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

  // Create new grid filled with rough
  const newTiles: Course["tiles"] = Array.from({ length: newWidth * newHeight }, () => "rough" as const);

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
    holes: migratedHoles,
    obstacles: migratedObstacles,
  };
}

export function loadGame(): { course: Course; world: World; history?: WeekResult[] } | null {
  const raw = localStorage.getItem(KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<SaveV1>;
    if (parsed.schemaVersion !== SCHEMA_VERSION) return null;
    if (!parsed.course || !parsed.world) return null;
    
    // Load the course as-is first
    const loadedCourse: Course = {
      ...DEFAULT_COURSE,
      ...(parsed.course as Course),
      holes:
        (parsed.course as Course).holes?.map((h, i) => ({
          ...DEFAULT_COURSE.holes[i],
          ...h,
          parMode: (h as any).parMode ?? "AUTO",
        })) ?? DEFAULT_COURSE.holes,
      obstacles: (parsed.course as Course).obstacles ?? DEFAULT_COURSE.obstacles,
      yardsPerTile: (parsed.course as Course).yardsPerTile ?? DEFAULT_COURSE.yardsPerTile,
    };

    // Migrate if grid size differs
    const course = migrateCourseGrid(loadedCourse);
    
    const world: World = { ...DEFAULT_WORLD, ...(parsed.world as World) };
    const history = parsed.history ?? undefined;
    return { course, world, history };
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


