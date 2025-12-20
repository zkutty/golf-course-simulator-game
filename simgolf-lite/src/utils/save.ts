import type { Course, WeekResult, World } from "../game/models/types";
import { DEFAULT_COURSE, DEFAULT_WORLD } from "../game/models/defaults";

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

export function loadGame(): { course: Course; world: World; history?: WeekResult[] } | null {
  const raw = localStorage.getItem(KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<SaveV1>;
    if (parsed.schemaVersion !== SCHEMA_VERSION) return null;
    if (!parsed.course || !parsed.world) return null;
    // Basic forwards safety: if holes missing, fall back to defaults.
    const course: Course = {
      ...DEFAULT_COURSE,
      ...(parsed.course as Course),
      holes: (parsed.course as Course).holes ?? DEFAULT_COURSE.holes,
    };
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


