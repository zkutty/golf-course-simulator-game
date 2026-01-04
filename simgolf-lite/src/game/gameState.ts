import type { Course, Terrain, World } from "./models/types";
import { DEFAULT_COURSE, DEFAULT_WORLD } from "./models/defaults";

export interface GameState {
  course: Course;
  world: World;
  selectedTerrain: Terrain;
  terrainVersion: number;
  obstaclesVersion: number;
  markersVersion: number;
  economyVersion: number;
}

export const DEFAULT_STATE: GameState = {
  course: DEFAULT_COURSE,
  world: DEFAULT_WORLD,
  selectedTerrain: "fairway",
  terrainVersion: 0,
  obstaclesVersion: 0,
  markersVersion: 0,
  economyVersion: 0,
};


