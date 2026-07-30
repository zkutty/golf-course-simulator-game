import type { BuildingTier, BuildingType, Decoration, Point, Terrain, ObstacleType, Course, World, TeeSet, PinRotation, PlantId, SurfaceFeature } from "../game/models/types";
import type { PropertyCommand } from "../game/property/property";

// Actions that mutate terrain (increment terrainVersion)
export type TerrainMutationAction =
  | { type: "PAINT_TILES"; tiles: Array<{ x: number; y: number; terrain: Terrain }>; surfaceFeature?: SurfaceFeature }
  | { type: "EDIT_SURFACE_FEATURE"; feature: SurfaceFeature }
  | { type: "SCULPT_TILES"; deltas: Array<{ x: number; y: number; delta: number }> }
  | { type: "PLACE_TEE"; holeIndex: number; position: Point }
  | { type: "MOVE_TEE"; holeIndex: number; position: Point; oldPosition: Point }
  | { type: "PLACE_GREEN"; holeIndex: number; position: Point }
  | { type: "MOVE_GREEN"; holeIndex: number; position: Point; oldPosition: Point }
  | { type: "NEW_GAME"; course: Course; world: World }
  | { type: "LOAD_GAME"; course: Course; world: World }
  | { type: "SIMULATE_WEEK"; course: Course; world: World };

// Actions that mutate obstacles (increment obstaclesVersion)
export type ObstacleMutationAction =
  | { type: "PLACE_OBSTACLE"; x: number; y: number; obstacleType: ObstacleType; plantId?: PlantId }
  | { type: "REMOVE_OBSTACLE"; x: number; y: number };

export type BuildingMutationAction =
  | { type: "PLACE_BUILDING"; buildingType: BuildingType; x: number; y: number }
  | { type: "REMOVE_BUILDING"; x: number; y: number }
  | { type: "CONFIGURE_BUILDING"; x: number; y: number; tier?: BuildingTier; price?: number };
export type MobilityBusinessAction =
  | { type: "CONFIGURE_MOBILITY_PRODUCT"; buildingId: string; mode: "pushcart" | "riding_cart"; enabled?: boolean; price?: number }
  | { type: "PURCHASE_MOBILITY_FLEET"; buildingId: string; mode: "pushcart" | "riding_cart"; quantity: number }
  | { type: "SALVAGE_MOBILITY_FLEET"; buildingId: string; mode: "pushcart" | "riding_cart"; quantity: number }
  | { type: "UPGRADE_MOBILITY_RENTAL_TIER"; buildingId: string };

export type DecorationMutationAction =
  | { type: "PLACE_DECORATION"; decoration: Decoration }
  | { type: "REMOVE_DECORATION"; x: number; y: number }
  | { type: "ROTATE_DECORATION"; x: number; y: number };

// Actions that mutate markers (increment markersVersion)
export type MarkerMutationAction =
  | { type: "PLACE_TEE"; holeIndex: number; position: Point }
  | { type: "MOVE_TEE"; holeIndex: number; position: Point; oldPosition: Point }
  | { type: "PLACE_GREEN"; holeIndex: number; position: Point }
  | { type: "MOVE_GREEN"; holeIndex: number; position: Point; oldPosition: Point }
  | { type: "SET_TEE_BOX"; holeIndex: number; teeSet: TeeSet; position: Point }
  | { type: "REMOVE_TEE_BOX"; holeIndex: number; teeSet: TeeSet }
  | { type: "SET_PIN_POSITION"; holeIndex: number; pinRotation: PinRotation; position: Point }
  | { type: "REMOVE_PIN_POSITION"; holeIndex: number; pinRotation: PinRotation }
  | { type: "SET_ACTIVE_PIN_ROTATION"; pinRotation: PinRotation }
  | { type: "ADD_WAYPOINT"; holeIndex: number; position: Point; segmentIndex: number }
  | { type: "UPDATE_WAYPOINT"; holeIndex: number; waypointIndex: number; position: Point }
  | { type: "REMOVE_WAYPOINT"; holeIndex: number; waypointIndex: number }
  | { type: "NEW_GAME"; course: Course; world: World }
  | { type: "LOAD_GAME"; course: Course; world: World };

// Actions that mutate economy (increment economyVersion)
export type EconomyMutationAction =
  | { type: "PAINT_TILES"; tiles: Array<{ x: number; y: number; terrain: Terrain }>; surfaceFeature?: SurfaceFeature }
  | { type: "EDIT_SURFACE_FEATURE"; feature: SurfaceFeature }
  | { type: "SCULPT_TILES"; deltas: Array<{ x: number; y: number; delta: number }> }
  | { type: "PLACE_TEE"; holeIndex: number; position: Point }
  | { type: "MOVE_TEE"; holeIndex: number; position: Point; oldPosition: Point }
  | { type: "PLACE_GREEN"; holeIndex: number; position: Point }
  | { type: "MOVE_GREEN"; holeIndex: number; position: Point; oldPosition: Point }
  | { type: "SET_TEE_BOX"; holeIndex: number; teeSet: TeeSet; position: Point }
  | { type: "REMOVE_TEE_BOX"; holeIndex: number; teeSet: TeeSet }
  | { type: "PLACE_OBSTACLE"; x: number; y: number; obstacleType: ObstacleType; plantId?: PlantId }
  | { type: "REMOVE_OBSTACLE"; x: number; y: number }
  | { type: "PLACE_BUILDING"; buildingType: BuildingType; x: number; y: number }
  | { type: "REMOVE_BUILDING"; x: number; y: number }
  | { type: "PLACE_DECORATION"; decoration: Decoration }
  | { type: "REMOVE_DECORATION"; x: number; y: number }
  | { type: "TAKE_LOAN"; kind: "BRIDGE" | "EXPANSION" }
  | { type: "PURCHASE_PARCEL"; parcelId: string }
  | { type: "PROPERTY_COMMAND"; command: PropertyCommand }
  | { type: "SIMULATE_WEEK"; course: Course; world: World };

// UI-only actions (do not affect versions)
export type UIAction =
  | { type: "SET_MODE"; mode: "PAINT" | "HOLE_WIZARD" | "OBSTACLE" | "SCULPT" | "BUILDING" | "DECOR" }
  | { type: "SET_ACTIVE_HOLE"; holeIndex: number }
  | { type: "SET_BRUSH"; terrain: Terrain };

// Union of all actions
export type Action =
  | TerrainMutationAction
  | ObstacleMutationAction
  | BuildingMutationAction
  | DecorationMutationAction
  | MarkerMutationAction
  | EconomyMutationAction
  | MobilityBusinessAction
  | { type: "SET_COURSE_LAYOUTS"; course: Course }
  | UIAction;
