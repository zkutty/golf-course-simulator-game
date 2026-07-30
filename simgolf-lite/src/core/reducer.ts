import type { GameState } from "../game/gameState";
import type { Action } from "./actions";
import { computeElevationChangeCost, computeTerrainChangeCost } from "../game/models/terrainEconomics";
import { computeTerrainBatch } from "../game/models/terrainStroke";
import { clampElevation } from "../game/models/elevation";
import { hitsLiquidityTrap } from "../game/sim/runState";
import { terrainCostMult } from "../game/balance/difficulty";
import {
  BUILDING_SPECS,
  buildingTiles,
  buildingAtTile,
  canPlaceBuilding,
  isConcessionType,
} from "../game/models/buildings";
import { getEffectiveBalance } from "../game/balance/difficulty";
import { createLoan } from "../game/sim/loans";
import { canTakeBridgeLoan, canTakeExpansionLoan } from "../game/sim/loanEligibility";
import {
  canPlaceDecoration,
  decorationAtTile,
  decorationCost,
  decorationRemovalQuote,
  decorationTiles,
} from "../game/models/decorations";
import {
  getPinPosition,
  getTeeBox,
  isSetupPointUsedByAnotherTee,
  samePoint,
  validateHoleCourseSetup,
  withNormalizedHoleSetup,
} from "../game/models/courseSetup";
import { revalidateScheduledTournaments } from "../game/tournaments/tournaments";
import { canPurchaseParcel, isOwnedTile } from "../game/estate/estate";
import { applyPropertyCommand } from "../game/property/property";
import {
  appendSurfaceFeature,
  rasterizeSurfaceFeatureDetailed,
} from "../game/models/surfaceIntent";
import { prepareSurfaceFeatureEdit } from "../game/models/surfaceFeatureEdit";
import { applyWaterGrading } from "../game/models/waterGrading";
import { isWaterHazard } from "../game/models/terrainRules";
import { mutateMobilityRental } from "../game/m51/rentalBusiness";
import {
  naturalFeatureInstallationQuote,
  naturalFeatureRemovalQuote,
  resolvedDecorationPlantId,
  resolvedObstaclePlantId,
} from "../game/models/plantRegistry";
import {
  reconcileSurfaceCareAfterEdit,
  startSurfaceRepair,
} from "../game/conditions/surfaceCare";

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
    case "CONFIGURE_MOBILITY_PRODUCT": {
      const result = mutateMobilityRental(state.course, state.world, { type: "configure", buildingId: action.buildingId, mode: action.mode, enabled: action.enabled, price: action.price });
      if (!result) break;
      newState = { ...newState, course: result.course, world: result.world }; economyVersion++; break;
    }
    case "PURCHASE_MOBILITY_FLEET": {
      const result = mutateMobilityRental(state.course, state.world, { type: "purchase", buildingId: action.buildingId, mode: action.mode, quantity: action.quantity });
      if (!result) break;
      newState = { ...newState, course: result.course, world: result.world }; economyVersion++; break;
    }
    case "SALVAGE_MOBILITY_FLEET": {
      const result = mutateMobilityRental(state.course, state.world, { type: "salvage", buildingId: action.buildingId, mode: action.mode, quantity: action.quantity });
      if (!result) break;
      newState = { ...newState, course: result.course, world: result.world }; economyVersion++; break;
    }
    case "UPGRADE_MOBILITY_RENTAL_TIER": {
      const result = mutateMobilityRental(state.course, state.world, { type: "upgrade", buildingId: action.buildingId });
      if (!result) break;
      newState = { ...newState, course: result.course, world: result.world }; economyVersion++; break;
    }
    case "PAINT_TILES": {
      const preview = computeTerrainBatch({
        course: state.course,
        tiles: action.tiles,
        cash: state.world.cash,
        costMult,
        reputation: state.world.reputation,
        protectedTrees: state.world.constraints?.protectedTrees,
      });
      const featureMatchesStroke = Boolean(
        action.surfaceFeature &&
        action.tiles.length > 0 &&
        action.tiles.every((tile) => tile.terrain === action.surfaceFeature?.terrain),
      );
      const acceptedFeatureIndices = featureMatchesStroke
        ? new Set(preview.acceptedTiles.map((tile) => tile.y * state.course.width + tile.x))
        : null;
      const clippedSurfaceFeature = featureMatchesStroke && acceptedFeatureIndices
        ? rasterizeSurfaceFeatureDetailed(
          action.surfaceFeature!,
          state.course.width,
          state.course.height,
          acceptedFeatureIndices,
        )
        : null;
      // Affordability is atomic: no terrain, cash, or version mutation when
      // even one otherwise-valid stroke would exceed available cash.
      if (
        !preview.affordable
        || (
          preview.changedCount === 0
          && preview.elevationDeltas.length === 0
          && preview.removedObstacles.length === 0
          && !(clippedSurfaceFeature && clippedSurfaceFeature.tiles.length > 0)
        )
        || state.world.isBankrupt
      ) break;

      const newTiles = state.course.tiles.slice();
      for (const { x, y, terrain } of preview.tiles) newTiles[y * state.course.width + x] = terrain;
      const newElevations = preview.elevationDeltas.length > 0
        ? applyWaterGrading(state.course, {
          deltas: preview.elevationDeltas,
          earthworkSteps: preview.earthworkSteps,
        })
        : state.course.elevations;
      const removedObstacleKeys = new Set(
        preview.removedObstacles.map((obstacle) => `${obstacle.x},${obstacle.y}`),
      );
      const newObstacles = preview.removedObstacles.length > 0
        ? state.course.obstacles.filter(
          (obstacle) => !removedObstacleKeys.has(`${obstacle.x},${obstacle.y}`),
        )
        : state.course.obstacles;

      const paintedCourse = {
        ...state.course,
        tiles: newTiles,
        elevations: newElevations,
        obstacles: newObstacles,
      };
      let committedCourse = paintedCourse;
      if (action.surfaceFeature && clippedSurfaceFeature) {
        committedCourse = {
          ...paintedCourse,
          surfaceIntent: appendSurfaceFeature(paintedCourse, {
            ...action.surfaceFeature,
            coverage: clippedSurfaceFeature.tiles.map((point) => point.y * state.course.width + point.x),
            renderRings: clippedSurfaceFeature.rings,
          }),
        };
      }
      committedCourse = reconcileSurfaceCareAfterEdit(state.course, committedCourse);
      newState = {
        ...newState,
        course: committedCourse,
        world: {
          ...state.world,
          cash: preview.projectedCash,
          isBankrupt: state.world.isBankrupt || hitsLiquidityTrap(preview.projectedCash),
        },
      };
      terrainVersion++;
      if (preview.removedObstacles.length > 0) obstaclesVersion++;
      economyVersion++;
      break;
    }

    case "EDIT_SURFACE_FEATURE": {
      if (state.world.isBankrupt) break;
      const prepared = prepareSurfaceFeatureEdit(
        state.course,
        action.feature,
        state.world.cash,
        costMult,
        state.world.reputation,
        state.world.constraints?.protectedTrees,
      );
      if (!prepared?.commitAllowed || !prepared.preview.affordable) break;
      const editedCourse = reconcileSurfaceCareAfterEdit(state.course, {
        ...state.course,
        tiles: prepared.tiles,
        elevations: prepared.elevations,
        obstacles: prepared.obstacles,
        surfaceIntent: prepared.intent,
      });
      newState = {
        ...newState,
        course: editedCourse,
        world: {
          ...state.world,
          cash: prepared.preview.projectedCash,
          isBankrupt: state.world.isBankrupt || hitsLiquidityTrap(prepared.preview.projectedCash),
        },
      };
      terrainVersion++;
      if (prepared.preview.removedObstacles.length > 0) obstaclesVersion++;
      economyVersion++;
      break;
    }

    case "START_SURFACE_REPAIR": {
      if (state.world.isBankrupt) break;
      const result = startSurfaceRepair(
        state.course,
        state.world,
        action.key,
        action.kind,
        action.absoluteDay,
      );
      if (!result.ok) break;
      newState = {
        ...newState,
        course: result.course,
        world: result.world,
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
        if (!isOwnedTile(state.course, x, y)) continue;
        const idx = y * state.course.width + x;
        const prev = newElevations[idx] ?? 0;
        const next = clampElevation(prev + delta);
        const applied = next - prev;
        if (applied !== 0) {
          cashDelta += computeElevationChangeCost(applied, costMult, state.course.theme).net;
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
      if (!isOwnedTile(state.course, action.position.x, action.position.y)) break;

      const idx = action.position.y * state.course.width + action.position.x;
      if (idx < 0 || idx >= state.course.tiles.length) break;

      const prevTerrain = state.course.tiles[idx];
      const cost = computeTerrainChangeCost(prevTerrain, "tee", costMult, state.course.theme);
      
      const newTiles = state.course.tiles.slice();
      newTiles[idx] = "tee";

      const newHoles = state.course.holes.slice();
      newHoles[action.holeIndex] = withNormalizedHoleSetup({
        ...hole,
        tee: action.position,
        teeBoxes: { ...hole.teeBoxes, member: action.position },
      });

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
      if (!isOwnedTile(state.course, action.position.x, action.position.y)) break;

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
      newHoles[action.holeIndex] = withNormalizedHoleSetup({
        ...hole,
        tee: action.position,
        teeBoxes: { ...hole.teeBoxes, member: action.position },
      });

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
      if (!isOwnedTile(state.course, action.position.x, action.position.y)) break;

      const idx = action.position.y * state.course.width + action.position.x;
      if (idx < 0 || idx >= state.course.tiles.length) break;

      const prevTerrain = state.course.tiles[idx];
      const cost = computeTerrainChangeCost(prevTerrain, "green", costMult, state.course.theme);
      
      const newTiles = state.course.tiles.slice();
      newTiles[idx] = "green";

      const newHoles = state.course.holes.slice();
      newHoles[action.holeIndex] = withNormalizedHoleSetup({
        ...hole,
        green: action.position,
        pinPositions: { ...hole.pinPositions, A: action.position },
      });

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
      if (!isOwnedTile(state.course, action.position.x, action.position.y)) break;

      const oldIdx = action.oldPosition.y * state.course.width + action.oldPosition.x;
      const newIdx = action.position.y * state.course.width + action.position.x;
      if (oldIdx < 0 || oldIdx >= state.course.tiles.length || newIdx < 0 || newIdx >= state.course.tiles.length) break;

      const newTerrain = state.course.tiles[newIdx];
      // Pin moves never destroy the putting surface left behind.
      const placeCost = computeTerrainChangeCost(newTerrain, "green", costMult, state.course.theme);
      const totalCost = placeCost.net;

      const newTiles = state.course.tiles.slice();
      newTiles[newIdx] = "green";

      const newHoles = state.course.holes.slice();
      newHoles[action.holeIndex] = withNormalizedHoleSetup({
        ...hole,
        green: action.position,
        pinPositions: { ...hole.pinPositions, A: action.position },
      });

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

    case "SET_TEE_BOX": {
      const hole = state.course.holes[action.holeIndex];
      if (!hole) break;
      const { x, y } = action.position;
      if (!isOwnedTile(state.course, x, y)) break;
      if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= state.course.width || y >= state.course.height) break;
      if (getTeeBox(hole, action.teeSet) && samePoint(getTeeBox(hole, action.teeSet), action.position)) break;
      if (isSetupPointUsedByAnotherTee(hole, action.teeSet, action.position)) break;

      const oldPosition = getTeeBox(hole, action.teeSet);
      const prospective = withNormalizedHoleSetup({
        ...hole,
        teeBoxes: { ...hole.teeBoxes, [action.teeSet]: action.position },
        ...(action.teeSet === "member" ? { tee: action.position } : {}),
      });
      if (validateHoleCourseSetup(state.course, prospective).some((issue) => issue.code === "TEE_ORDER" || issue.code === "DUPLICATE")) break;

      const newTiles = state.course.tiles.slice();
      let cashDelta = 0;
      if (oldPosition && !isSetupPointUsedByAnotherTee(hole, action.teeSet, oldPosition)) {
        const oldIdx = oldPosition.y * state.course.width + oldPosition.x;
        cashDelta += computeTerrainChangeCost(newTiles[oldIdx], "rough", costMult, state.course.theme).net;
        newTiles[oldIdx] = "rough";
      }
      const idx = y * state.course.width + x;
      cashDelta += computeTerrainChangeCost(newTiles[idx], "tee", costMult, state.course.theme).net;
      if (cashDelta > state.world.cash) break;
      newTiles[idx] = "tee";
      const holes = state.course.holes.slice();
      holes[action.holeIndex] = prospective;
      const cash = state.world.cash - cashDelta;
      newState = {
        ...newState,
        course: { ...state.course, tiles: newTiles, holes },
        world: { ...state.world, cash, isBankrupt: state.world.isBankrupt || hitsLiquidityTrap(cash) },
      };
      terrainVersion++;
      markersVersion++;
      economyVersion++;
      break;
    }

    case "REMOVE_TEE_BOX": {
      const hole = state.course.holes[action.holeIndex];
      const oldPosition = hole ? getTeeBox(hole, action.teeSet) : null;
      if (!hole || !oldPosition) break;
      const newTiles = state.course.tiles.slice();
      let cashDelta = 0;
      if (!isSetupPointUsedByAnotherTee(hole, action.teeSet, oldPosition)) {
        const idx = oldPosition.y * state.course.width + oldPosition.x;
        cashDelta = computeTerrainChangeCost(newTiles[idx], "rough", costMult, state.course.theme).net;
        newTiles[idx] = "rough";
      }
      const holes = state.course.holes.slice();
      holes[action.holeIndex] = withNormalizedHoleSetup({
        ...hole,
        teeBoxes: { ...hole.teeBoxes, [action.teeSet]: null },
        ...(action.teeSet === "member" ? { tee: null } : {}),
      });
      const cash = state.world.cash - cashDelta;
      newState = { ...newState, course: { ...state.course, tiles: newTiles, holes }, world: { ...state.world, cash } };
      terrainVersion++;
      markersVersion++;
      economyVersion++;
      break;
    }

    case "SET_PIN_POSITION": {
      const hole = state.course.holes[action.holeIndex];
      if (!hole) break;
      const { x, y } = action.position;
      if (!isOwnedTile(state.course, x, y)) break;
      if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= state.course.width || y >= state.course.height) break;
      if (state.course.tiles[y * state.course.width + x] !== "green") break;
      if (["A", "B", "C"].some((rotation) => rotation !== action.pinRotation && samePoint(getPinPosition(hole, rotation as "A" | "B" | "C"), action.position))) break;
      const holes = state.course.holes.slice();
      holes[action.holeIndex] = withNormalizedHoleSetup({
        ...hole,
        pinPositions: { ...hole.pinPositions, [action.pinRotation]: action.position },
        ...(action.pinRotation === "A" ? { green: action.position } : {}),
      });
      newState = { ...newState, course: { ...state.course, holes } };
      markersVersion++;
      break;
    }

    case "REMOVE_PIN_POSITION": {
      const hole = state.course.holes[action.holeIndex];
      if (!hole || !getPinPosition(hole, action.pinRotation)) break;
      const holes = state.course.holes.slice();
      holes[action.holeIndex] = withNormalizedHoleSetup({
        ...hole,
        pinPositions: { ...hole.pinPositions, [action.pinRotation]: null },
        ...(action.pinRotation === "A" ? { green: null } : {}),
      });
      newState = { ...newState, course: { ...state.course, holes } };
      markersVersion++;
      break;
    }

    case "SET_ACTIVE_PIN_ROTATION": {
      if (state.course.activePinRotation === action.pinRotation) break;
      newState = { ...newState, course: { ...state.course, activePinRotation: action.pinRotation } };
      markersVersion++;
      break;
    }

    case "PLACE_OBSTACLE": {
      if (!isOwnedTile(state.course, action.x, action.y)) break;
      const terrain = state.course.tiles[action.y * state.course.width + action.x];
      if (isWaterHazard(terrain)) break;
      const existingIdx = state.course.obstacles.findIndex(
        (o) => o.x === action.x && o.y === action.y
      );
      
      if (existingIdx >= 0) {
        // Already exists, do nothing
        break;
      }

      const plantId = action.obstacleType === "rock"
        ? undefined
        : resolvedObstaclePlantId(state.course.theme, {
          type: action.obstacleType,
          plantId: action.plantId,
        });
      const quote = naturalFeatureInstallationQuote({
        theme: state.course.theme,
        obstacleType: action.obstacleType,
        plantId,
        costMult,
      });
      if (state.world.cash < quote.net) break;
      const cash = state.world.cash - quote.net;
      const newObstacles = [...state.course.obstacles, {
        x: action.x,
        y: action.y,
        type: action.obstacleType,
        origin: "player" as const,
        ...(plantId ? { plantId } : {}),
      }];
      newState = {
        ...newState,
        course: {
          ...state.course,
          obstacles: newObstacles,
        },
        world: {
          ...state.world,
          cash,
          isBankrupt: state.world.isBankrupt || hitsLiquidityTrap(cash),
        },
      };
      obstaclesVersion++;
      economyVersion++;
      break;
    }

    case "REMOVE_OBSTACLE": {
      if (!isOwnedTile(state.course, action.x, action.y)) break;
      const target = state.course.obstacles.find(
        (o) => o.x === action.x && o.y === action.y,
      );
      if (!target) break;
      // Scenario constraint (ZKU-164): heritage trees can't be removed.
      if (state.world.constraints?.protectedTrees) {
        if (target?.type === "tree") break;
      }
      const quote = naturalFeatureRemovalQuote({
        theme: state.course.theme,
        obstacle: target,
        costMult,
      });
      if (quote.net > state.world.cash) break;
      const cash = state.world.cash - quote.net;
      const newObstacles = state.course.obstacles.filter(
        (o) => !(o.x === action.x && o.y === action.y)
      );
      newState = {
        ...newState,
        course: {
          ...state.course,
          obstacles: newObstacles,
        },
        world: {
          ...state.world,
          cash,
          isBankrupt: state.world.isBankrupt || hitsLiquidityTrap(cash),
        },
      };
      obstaclesVersion++;
      economyVersion++;
      break;
    }

    case "PLACE_BUILDING": {
      const footprint = buildingTiles({ type: action.buildingType, x: action.x, y: action.y });
      if (footprint.some((tile) => !isOwnedTile(state.course, tile.x, tile.y))) break;
      const validation = canPlaceBuilding(state.course, action.buildingType, action.x, action.y);
      if (!validation.ok) break;
      const spec = BUILDING_SPECS[action.buildingType];
      if (state.world.cash < spec.buildCost) break;
      const building = {
        id: `building-${action.buildingType}-${action.x}-${action.y}`,
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
      if (buildingTiles(target).some((tile) => !isOwnedTile(state.course, tile.x, tile.y))) break;
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
      if (target.type === "cart_rental" && action.tier != null) break;
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

    case "PROPERTY_COMMAND": {
      const result = applyPropertyCommand(state.course, state.world, action.command);
      if (!result.ok) break;
      newState = { ...newState, course: result.course, world: result.world };
      terrainVersion++;
      economyVersion++;
      break;
    }

    case "PLACE_DECORATION": {
      if (decorationTiles(action.decoration).some((tile) => !isOwnedTile(state.course, tile.x, tile.y))) break;
      const validation = canPlaceDecoration(state.course, action.decoration);
      if (!validation.ok) break;
      const plantId = resolvedDecorationPlantId(state.course.theme, action.decoration);
      const decoration = plantId
        ? { ...action.decoration, plantId, origin: "player" as const }
        : action.decoration;
      const cost = decorationCost(decoration, state.course.theme, costMult);
      if (state.world.cash < cost) break;
      const cash = state.world.cash - cost;
      newState = {
        ...newState,
        course: { ...state.course, decorations: [...(state.course.decorations ?? []), decoration] },
        world: { ...state.world, cash, isBankrupt: state.world.isBankrupt || hitsLiquidityTrap(cash) },
      };
      terrainVersion++;
      economyVersion++;
      break;
    }

    case "REMOVE_DECORATION": {
      const target = decorationAtTile(state.course, action.x, action.y);
      if (!target) break;
      if (decorationTiles(target).some((tile) => !isOwnedTile(state.course, tile.x, tile.y))) break;
      const removal = decorationRemovalQuote(
        target,
        state.course.theme,
        costMult,
      );
      newState = {
        ...newState,
        course: { ...state.course, decorations: (state.course.decorations ?? []).filter((entry) => entry !== target) },
        world: { ...state.world, cash: state.world.cash - removal.net },
      };
      terrainVersion++;
      economyVersion++;
      break;
    }

    case "ROTATE_DECORATION": {
      const target = decorationAtTile(state.course, action.x, action.y);
      if (!target) break;
      const rotated = { ...target, rotation: ((target.rotation + 1) % 4) as 0 | 1 | 2 | 3 };
      if (decorationTiles(rotated).some((tile) => !isOwnedTile(state.course, tile.x, tile.y))) break;
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

    case "PURCHASE_PARCEL": {
      const result = canPurchaseParcel(state.course, state.world.cash, action.parcelId);
      if (!result.ok || !state.course.estate) break;
      const cash = state.world.cash - result.parcel.appraisal.total;
      newState = {
        ...newState,
        course: {
          ...state.course,
          estate: {
            ...state.course.estate,
            ownedParcelIds: [...state.course.estate.ownedParcelIds, result.parcel.id],
          },
        },
        world: { ...state.world, cash, isBankrupt: state.world.isBankrupt || hitsLiquidityTrap(cash) },
      };
      terrainVersion++;
      economyVersion++;
      break;
    }

    case "SET_COURSE_LAYOUTS": {
      newState = { ...newState, course: action.course };
      markersVersion++;
      economyVersion++;
      break;
    }

    case "ADD_WAYPOINT": {
      if (!isOwnedTile(state.course, action.position.x, action.position.y)) break;
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
      if (!isOwnedTile(state.course, action.position.x, action.position.y)) break;
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

  // Marker tools also repaint cultivated terrain. Reproject existing local
  // condition by exact overlap so an unrelated tee/pin edit cannot erase
  // neglect elsewhere, while the genuinely replaced cells start fresh.
  if (
    newState.course !== state.course
    && (
      action.type === "PLACE_TEE"
      || action.type === "MOVE_TEE"
      || action.type === "PLACE_GREEN"
      || action.type === "MOVE_GREEN"
      || action.type === "SET_TEE_BOX"
      || action.type === "REMOVE_TEE_BOX"
    )
  ) {
    newState = {
      ...newState,
      course: reconcileSurfaceCareAfterEdit(state.course, newState.course),
    };
  }

  // Rating-relevant edits immediately refresh warnings on future tournament
  // bookings. Economy-only and UI-only changes intentionally do not churn the
  // persisted qualification snapshots.
  if (
    newState.course !== state.course &&
    (terrainVersion !== state.terrainVersion || obstaclesVersion !== state.obstaclesVersion || markersVersion !== state.markersVersion)
  ) {
    newState = { ...newState, world: revalidateScheduledTournaments(newState.course, newState.world) };
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
