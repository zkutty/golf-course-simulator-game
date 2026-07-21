import type { GameState } from "../game/gameState";
import type { Action } from "./actions";
import { computeElevationChangeCost, computeTerrainChangeCost } from "../game/models/terrainEconomics";
import { clampElevation } from "../game/models/elevation";
import { hitsLiquidityTrap } from "../game/sim/runState";
import { terrainCostMult } from "../game/balance/difficulty";
import {
  BUILDING_SPECS,
  buildingAtTile,
  canPlaceBuilding,
  isConcessionType,
} from "../game/models/buildings";
import { getEffectiveBalance } from "../game/balance/difficulty";
import { createLoan } from "../game/sim/loans";
import { canTakeBridgeLoan, canTakeExpansionLoan } from "../game/sim/loanEligibility";
import { canPlaceDecoration, decorationAtTile, decorationCost, decorationSpec } from "../game/models/decorations";

/**
 * Apply a core editor/economy action to game state. Long-running live-simulation
 * commits use App's versioned integration setters; player-triggered mutations
 * belong here so version invalidation is automatic.
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

  // Difficulty-scaled build economics (ZKU-165).
  const costMult = terrainCostMult(state.world.difficulty);

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
            const cost = computeTerrainChangeCost(prev, terrain, costMult, state.course.theme);
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
          isBankrupt: state.world.isBankrupt || hitsLiquidityTrap(state.world.cash - cashDelta),
        },
      };
      terrainVersion++;
      economyVersion++;
      break;
    }

    case "SCULPT_TILES": {
      // Elevation sculpting (ZKU-143): apply clamped integer deltas and
      // charge earthworks per actually-applied step (no salvage, both
      // directions cost the same).
      const prevElev = state.course.elevations ?? new Array(state.course.width * state.course.height).fill(0);
      const newElevations = prevElev.slice();
      let cashDelta = 0;

      for (const { x, y, delta } of action.deltas) {
        if (x < 0 || y < 0 || x >= state.course.width || y >= state.course.height) continue;
        const idx = y * state.course.width + x;
        const prev = newElevations[idx] ?? 0;
        const next = clampElevation(prev + delta);
        const applied = next - prev;
        if (applied !== 0) {
          cashDelta += computeElevationChangeCost(applied, costMult).net;
          newElevations[idx] = next;
        }
      }

      if (cashDelta === 0) break; // nothing applied — no state churn

      newState = {
        ...newState,
        course: { ...state.course, elevations: newElevations },
        world: {
          ...state.world,
          cash: state.world.cash - cashDelta,
          isBankrupt: state.world.isBankrupt || hitsLiquidityTrap(state.world.cash - cashDelta),
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
      const cost = computeTerrainChangeCost(prevTerrain, "tee", costMult, state.course.theme);
      
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
          isBankrupt: state.world.isBankrupt || hitsLiquidityTrap(state.world.cash - cost.net),
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
      const removeCost = computeTerrainChangeCost(oldTerrain, "rough", costMult, state.course.theme);
      // Place new marker
      const placeCost = computeTerrainChangeCost(newTerrain, "tee", costMult, state.course.theme);
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
          isBankrupt: state.world.isBankrupt || hitsLiquidityTrap(state.world.cash - totalCost),
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
      const cost = computeTerrainChangeCost(prevTerrain, "green", costMult, state.course.theme);
      
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
          isBankrupt: state.world.isBankrupt || hitsLiquidityTrap(state.world.cash - cost.net),
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
      const removeCost = computeTerrainChangeCost(oldTerrain, "rough", costMult, state.course.theme);
      // Place new marker
      const placeCost = computeTerrainChangeCost(newTerrain, "green", costMult, state.course.theme);
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
          isBankrupt: state.world.isBankrupt || hitsLiquidityTrap(state.world.cash - totalCost),
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
      // Scenario constraint (ZKU-164): heritage trees can't be removed.
      if (state.world.constraints?.protectedTrees) {
        const target = state.course.obstacles.find((o) => o.x === action.x && o.y === action.y);
        if (target?.type === "tree") break;
      }
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

    case "PLACE_BUILDING": {
      const validation = canPlaceBuilding(state.course, action.buildingType, action.x, action.y);
      if (!validation.ok) break;
      const spec = BUILDING_SPECS[action.buildingType];
      if (state.world.cash < spec.buildCost) break;
      const building = {
        type: action.buildingType,
        x: action.x,
        y: action.y,
        ...(isConcessionType(action.buildingType)
          ? { tier: 1 as const, price: spec.defaultPrice }
          : {}),
      };
      const cash = state.world.cash - spec.buildCost;
      newState = {
        ...newState,
        course: { ...state.course, buildings: [...(state.course.buildings ?? []), building] },
        world: {
          ...state.world,
          cash,
          isBankrupt: state.world.isBankrupt || hitsLiquidityTrap(cash),
        },
      };
      terrainVersion++;
      economyVersion++;
      break;
    }

    case "REMOVE_BUILDING": {
      const target = buildingAtTile(state.course, action.x, action.y);
      if (!target || target.type === "clubhouse") break;
      const salvage = Math.round(BUILDING_SPECS[target.type].buildCost * 0.35);
      newState = {
        ...newState,
        course: {
          ...state.course,
          buildings: state.course.buildings.filter((b) => b !== target),
        },
        world: { ...state.world, cash: state.world.cash + salvage },
      };
      terrainVersion++;
      economyVersion++;
      break;
    }

    case "CONFIGURE_BUILDING": {
      const target = state.course.buildings.find((b) => b.x === action.x && b.y === action.y);
      if (!target || !isConcessionType(target.type)) break;
      const buildings = state.course.buildings.map((b) => {
        if (b !== target) return b;
        return {
          ...b,
          tier: action.tier ?? b.tier ?? 1,
          price: action.price == null ? b.price : Math.max(1, Math.round(action.price)),
        };
      });
      newState = { ...newState, course: { ...state.course, buildings } };
      economyVersion++;
      break;
    }

    case "PLACE_DECORATION": {
      const validation = canPlaceDecoration(state.course, action.decoration);
      if (!validation.ok) break;
      const cost = decorationCost(action.decoration);
      if (state.world.cash < cost) break;
      const cash = state.world.cash - cost;
      newState = {
        ...newState,
        course: { ...state.course, decorations: [...(state.course.decorations ?? []), action.decoration] },
        world: { ...state.world, cash, isBankrupt: state.world.isBankrupt || hitsLiquidityTrap(cash) },
      };
      terrainVersion++;
      economyVersion++;
      break;
    }

    case "REMOVE_DECORATION": {
      const target = decorationAtTile(state.course, action.x, action.y);
      if (!target) break;
      const salvage = Math.round(decorationCost(target) * decorationSpec(target.kind).salvageRate);
      newState = {
        ...newState,
        course: { ...state.course, decorations: (state.course.decorations ?? []).filter((entry) => entry !== target) },
        world: { ...state.world, cash: state.world.cash + salvage },
      };
      terrainVersion++;
      economyVersion++;
      break;
    }

    case "ROTATE_DECORATION": {
      const target = decorationAtTile(state.course, action.x, action.y);
      if (!target) break;
      const rotated = { ...target, rotation: ((target.rotation + 1) % 4) as 0 | 1 | 2 | 3 };
      const withoutTarget = { ...state.course, decorations: (state.course.decorations ?? []).filter((entry) => entry !== target) };
      if (!canPlaceDecoration(withoutTarget, rotated).ok) break;
      newState = { ...newState, course: { ...state.course, decorations: (state.course.decorations ?? []).map((entry) => entry === target ? rotated : entry) } };
      terrainVersion++;
      break;
    }

    case "TAKE_LOAN": {
      const balance = getEffectiveBalance(state.world.difficulty);
      const eligible =
        action.kind === "BRIDGE"
          ? canTakeBridgeLoan(state.course, state.world, balance)
          : canTakeExpansionLoan(state.course, state.world, balance);
      if (!eligible) break;
      const terms = action.kind === "BRIDGE" ? balance.loans.bridge : balance.loans.expansion;
      const loan = createLoan({
        kind: action.kind,
        principal: terms.maxPrincipal,
        apr: terms.apr,
        termWeeks: terms.termWeeks,
        idSeed: state.world.week,
      });
      newState = {
        ...newState,
        world: {
          ...state.world,
          cash: state.world.cash + loan.principal,
          loans: [...(state.world.loans ?? []), loan],
          ...(action.kind === "BRIDGE" ? { lastBridgeLoanWeek: state.world.week } : {}),
        },
      };
      economyVersion++;
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
