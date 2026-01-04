import type { GameState } from "../game/gameState";
import type { Action } from "./actions";
import { computeTerrainChangeCost } from "../game/models/terrainEconomics";

/**
 * Apply an action to the game state. This is the ONLY function that should mutate
 * terrain, obstacles, markers, or economy state.
 * 
 * @param state - Current game state
 * @param action - Action to apply
 * @returns New game state with updated versions
 */
export function applyAction(state: GameState, action: Action): GameState {
  // Handle UI-only actions (no state mutation, no version changes)
  if (action.type === "SET_MODE" || action.type === "SET_ACTIVE_HOLE" || action.type === "SET_BRUSH") {
    return state; // UI-only actions don't mutate state
  }

  // Clone state for mutation
  let newState: GameState = { ...state };
  let terrainVersion = state.terrainVersion;
  let obstaclesVersion = state.obstaclesVersion;
  let markersVersion = state.markersVersion;
  let economyVersion = state.economyVersion;

  switch (action.type) {
    case "PAINT_TILES": {
      // Update tiles and economy
      const newTiles = state.course.tiles.slice();
      let cashDelta = 0;

      for (const { x, y, terrain } of action.tiles) {
        const idx = y * state.course.width + x;
        if (idx >= 0 && idx < newTiles.length) {
          const prev = newTiles[idx];
          if (prev !== terrain) {
            const cost = computeTerrainChangeCost(prev, terrain);
            cashDelta += cost.net;
            newTiles[idx] = terrain;
          }
        }
      }

      newState = {
        ...newState,
        course: { ...state.course, tiles: newTiles },
        world: {
          ...state.world,
          cash: state.world.cash - cashDelta,
          isBankrupt: state.world.isBankrupt || (state.world.cash - cashDelta < -10_000),
        },
      };
      terrainVersion++;
      economyVersion++;
      break;
    }

    case "PLACE_TEE": {
      const hole = state.course.holes[action.holeIndex];
      if (!hole) break;

      const idx = action.position.y * state.course.width + action.position.x;
      if (idx < 0 || idx >= state.course.tiles.length) break;

      const prevTerrain = state.course.tiles[idx];
      const cost = computeTerrainChangeCost(prevTerrain, "tee");
      
      const newTiles = state.course.tiles.slice();
      newTiles[idx] = "tee";

      const newHoles = state.course.holes.slice();
      newHoles[action.holeIndex] = { ...hole, tee: action.position };

      newState = {
        ...newState,
        course: {
          ...state.course,
          tiles: newTiles,
          holes: newHoles,
        },
        world: {
          ...state.world,
          cash: state.world.cash - cost.net,
          isBankrupt: state.world.isBankrupt || (state.world.cash - cost.net < -10_000),
        },
      };
      terrainVersion++;
      markersVersion++;
      economyVersion++;
      break;
    }

    case "MOVE_TEE": {
      const hole = state.course.holes[action.holeIndex];
      if (!hole || !hole.tee) break;

      const oldIdx = action.oldPosition.y * state.course.width + action.oldPosition.x;
      const newIdx = action.position.y * state.course.width + action.position.x;
      if (oldIdx < 0 || oldIdx >= state.course.tiles.length || newIdx < 0 || newIdx >= state.course.tiles.length) break;

      const oldTerrain = state.course.tiles[oldIdx];
      const newTerrain = state.course.tiles[newIdx];
      
      // Remove old marker (revert to rough)
      const removeCost = computeTerrainChangeCost(oldTerrain, "rough");
      // Place new marker
      const placeCost = computeTerrainChangeCost(newTerrain, "tee");
      const totalCost = removeCost.net + placeCost.net;

      const newTiles = state.course.tiles.slice();
      newTiles[oldIdx] = "rough";
      newTiles[newIdx] = "tee";

      const newHoles = state.course.holes.slice();
      newHoles[action.holeIndex] = { ...hole, tee: action.position };

      newState = {
        ...newState,
        course: {
          ...state.course,
          tiles: newTiles,
          holes: newHoles,
        },
        world: {
          ...state.world,
          cash: state.world.cash - totalCost,
          isBankrupt: state.world.isBankrupt || (state.world.cash - totalCost < -10_000),
        },
      };
      terrainVersion++;
      markersVersion++;
      economyVersion++;
      break;
    }

    case "PLACE_GREEN": {
      const hole = state.course.holes[action.holeIndex];
      if (!hole) break;

      const idx = action.position.y * state.course.width + action.position.x;
      if (idx < 0 || idx >= state.course.tiles.length) break;

      const prevTerrain = state.course.tiles[idx];
      const cost = computeTerrainChangeCost(prevTerrain, "green");
      
      const newTiles = state.course.tiles.slice();
      newTiles[idx] = "green";

      const newHoles = state.course.holes.slice();
      newHoles[action.holeIndex] = { ...hole, green: action.position };

      newState = {
        ...newState,
        course: {
          ...state.course,
          tiles: newTiles,
          holes: newHoles,
        },
        world: {
          ...state.world,
          cash: state.world.cash - cost.net,
          isBankrupt: state.world.isBankrupt || (state.world.cash - cost.net < -10_000),
        },
      };
      terrainVersion++;
      markersVersion++;
      economyVersion++;
      break;
    }

    case "MOVE_GREEN": {
      const hole = state.course.holes[action.holeIndex];
      if (!hole || !hole.green) break;

      const oldIdx = action.oldPosition.y * state.course.width + action.oldPosition.x;
      const newIdx = action.position.y * state.course.width + action.position.x;
      if (oldIdx < 0 || oldIdx >= state.course.tiles.length || newIdx < 0 || newIdx >= state.course.tiles.length) break;

      const oldTerrain = state.course.tiles[oldIdx];
      const newTerrain = state.course.tiles[newIdx];
      
      // Remove old marker (revert to rough)
      const removeCost = computeTerrainChangeCost(oldTerrain, "rough");
      // Place new marker
      const placeCost = computeTerrainChangeCost(newTerrain, "green");
      const totalCost = removeCost.net + placeCost.net;

      const newTiles = state.course.tiles.slice();
      newTiles[oldIdx] = "rough";
      newTiles[newIdx] = "green";

      const newHoles = state.course.holes.slice();
      newHoles[action.holeIndex] = { ...hole, green: action.position };

      newState = {
        ...newState,
        course: {
          ...state.course,
          tiles: newTiles,
          holes: newHoles,
        },
        world: {
          ...state.world,
          cash: state.world.cash - totalCost,
          isBankrupt: state.world.isBankrupt || (state.world.cash - totalCost < -10_000),
        },
      };
      terrainVersion++;
      markersVersion++;
      economyVersion++;
      break;
    }

    case "PLACE_OBSTACLE": {
      const existingIdx = state.course.obstacles.findIndex(
        (o) => o.x === action.x && o.y === action.y
      );
      
      if (existingIdx >= 0) {
        // Already exists, do nothing
        break;
      }

      const newObstacles = [...state.course.obstacles, { x: action.x, y: action.y, type: action.obstacleType }];
      newState = {
        ...newState,
        course: {
          ...state.course,
          obstacles: newObstacles,
        },
      };
      obstaclesVersion++;
      break;
    }

    case "REMOVE_OBSTACLE": {
      const newObstacles = state.course.obstacles.filter(
        (o) => !(o.x === action.x && o.y === action.y)
      );
      newState = {
        ...newState,
        course: {
          ...state.course,
          obstacles: newObstacles,
        },
      };
      obstaclesVersion++;
      break;
    }

    case "ADD_WAYPOINT": {
      const hole = state.course.holes[action.holeIndex];
      if (!hole) break;

      const newHoles = state.course.holes.slice();
      const waypoints = hole.waypoints ? [...hole.waypoints] : [];
      waypoints.splice(action.segmentIndex, 0, action.position);
      newHoles[action.holeIndex] = { ...hole, waypoints };

      newState = {
        ...newState,
        course: {
          ...state.course,
          holes: newHoles,
        },
      };
      markersVersion++;
      break;
    }

    case "UPDATE_WAYPOINT": {
      const hole = state.course.holes[action.holeIndex];
      if (!hole || !hole.waypoints || action.waypointIndex < 0 || action.waypointIndex >= hole.waypoints.length) break;

      const newHoles = state.course.holes.slice();
      const waypoints = [...hole.waypoints];
      waypoints[action.waypointIndex] = action.position;
      newHoles[action.holeIndex] = { ...hole, waypoints };

      newState = {
        ...newState,
        course: {
          ...state.course,
          holes: newHoles,
        },
      };
      markersVersion++;
      break;
    }

    case "REMOVE_WAYPOINT": {
      const hole = state.course.holes[action.holeIndex];
      if (!hole || !hole.waypoints || action.waypointIndex < 0 || action.waypointIndex >= hole.waypoints.length) break;

      const newHoles = state.course.holes.slice();
      const waypoints = hole.waypoints.filter((_, i) => i !== action.waypointIndex);
      newHoles[action.holeIndex] = { ...hole, waypoints: waypoints.length > 0 ? waypoints : undefined };

      newState = {
        ...newState,
        course: {
          ...state.course,
          holes: newHoles,
        },
      };
      markersVersion++;
      break;
    }

    case "NEW_GAME":
    case "LOAD_GAME": {
      newState = {
        ...newState,
        course: action.course,
        world: action.world,
      };
      terrainVersion++;
      obstaclesVersion++;
      markersVersion++;
      economyVersion++;
      break;
    }

    case "SIMULATE_WEEK": {
      newState = {
        ...newState,
        course: action.course,
        world: action.world,
      };
      terrainVersion++; // tickWeek can modify course.condition
      economyVersion++; // tickWeek modifies world economy
      break;
    }

    default: {
      // TypeScript exhaustiveness check
      const _exhaustive: never = action;
      void _exhaustive; // Suppress unused warning
      return state;
    }
  }

  // Update version counters
  return {
    ...newState,
    terrainVersion,
    obstaclesVersion,
    markersVersion,
    economyVersion,
  };
}

