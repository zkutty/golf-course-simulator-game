import type { Course, Terrain, World } from "./models/types";
import { DEFAULT_COURSE, DEFAULT_WORLD } from "./models/defaults";

export interface GameState {
  course: Course;
  world: World;
  selectedTerrain: Terrain;
}

export const DEFAULT_STATE: GameState = {
  course: DEFAULT_COURSE,
  world: DEFAULT_WORLD,
  selectedTerrain: "fairway",
};


