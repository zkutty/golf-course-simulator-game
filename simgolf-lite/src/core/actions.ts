import type { Point, Terrain, ObstacleType, Course, World } from "../game/models/types";

// Actions that mutate terrain (increment terrainVersion)
export type TerrainMutationAction =
  | { type: "PAINT_TILES"; tiles: Array<{ x: number; y: number; terrain: Terrain }> }
  | { type: "PLACE_TEE"; holeIndex: number; position: Point }
  | { type: "MOVE_TEE"; holeIndex: number; position: Point; oldPosition: Point }
  | { type: "PLACE_GREEN"; holeIndex: number; position: Point }
  | { type: "MOVE_GREEN"; holeIndex: number; position: Point; oldPosition: Point }
  | { type: "NEW_GAME"; course: Course; world: World }
  | { type: "LOAD_GAME"; course: Course; world: World }
  | { type: "SIMULATE_WEEK"; course: Course; world: World };

// Actions that mutate obstacles (increment obstaclesVersion)
export type ObstacleMutationAction =
  | { type: "PLACE_OBSTACLE"; x: number; y: number; obstacleType: ObstacleType }
  | { type: "REMOVE_OBSTACLE"; x: number; y: number };

// Actions that mutate markers (increment markersVersion)
export type MarkerMutationAction =
  | { type: "PLACE_TEE"; holeIndex: number; position: Point }
  | { type: "MOVE_TEE"; holeIndex: number; position: Point; oldPosition: Point }
  | { type: "PLACE_GREEN"; holeIndex: number; position: Point }
  | { type: "MOVE_GREEN"; holeIndex: number; position: Point; oldPosition: Point }
  | { type: "ADD_WAYPOINT"; holeIndex: number; position: Point; segmentIndex: number }
  | { type: "UPDATE_WAYPOINT"; holeIndex: number; waypointIndex: number; position: Point }
  | { type: "REMOVE_WAYPOINT"; holeIndex: number; waypointIndex: number }
  | { type: "NEW_GAME"; course: Course; world: World }
  | { type: "LOAD_GAME"; course: Course; world: World };

// Actions that mutate economy (increment economyVersion)
export type EconomyMutationAction =
  | { type: "PAINT_TILES"; tiles: Array<{ x: number; y: number; terrain: Terrain }> }
  | { type: "PLACE_TEE"; holeIndex: number; position: Point }
  | { type: "MOVE_TEE"; holeIndex: number; position: Point; oldPosition: Point }
  | { type: "PLACE_GREEN"; holeIndex: number; position: Point }
  | { type: "MOVE_GREEN"; holeIndex: number; position: Point; oldPosition: Point }
  | { type: "SIMULATE_WEEK"; course: Course; world: World };

// UI-only actions (do not affect versions)
export type UIAction =
  | { type: "SET_MODE"; mode: "PAINT" | "HOLE_WIZARD" | "OBSTACLE" }
  | { type: "SET_ACTIVE_HOLE"; holeIndex: number }
  | { type: "SET_BRUSH"; terrain: Terrain };

// Union of all actions
export type Action = TerrainMutationAction | ObstacleMutationAction | MarkerMutationAction | UIAction;

