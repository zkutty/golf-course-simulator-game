import { getElevation } from "./elevation";
import { buildingAtTile } from "./buildings";
import type { Course, Decoration, DecorationKind, DecorationRotation, LandTheme, Point, Terrain } from "./types";
import { isOwnedTile } from "../estate/estate";
import { BIOME_KEYS, getBiomeDefinition } from "./biomes";
import {
  dailyPlantCareCost,
  isPlantId,
  plantDefinition,
  plantFitMultipliers,
  plantWaterDemand,
  resolvedDecorationPlantId,
  type EconomyQuote,
} from "./plantRegistry";

export interface DecorationVisual {
  frame: string;
  anchor: readonly [number, number];
  scale: number;
  shadow: { radiusX: number; radiusY: number; alpha: number };
}

export interface DecorationSpec {
  kind: DecorationKind;
  name: string;
  category: "furniture" | "planting" | "structure";
  buildCost: number;
  salvageRate: number;
  blocksWalking: boolean;
  allowedTerrain?: readonly Terrain[];
  defaultSpan?: number;
  maxSpan?: number;
  visuals: Record<LandTheme, DecorationVisual>;
}

export const DECORATION_KINDS = [
  "fence", "bench", "tee_sign", "lamp", "bin", "parked_cart", "flower_bed",
  "planter", "ornamental_feature", "bridge", "boardwalk",
] as const satisfies readonly DecorationKind[];

const themed = (
  frame: string,
  scale = 1,
  shadow = { radiusX: 17, radiusY: 7, alpha: 0.18 },
): Record<LandTheme, DecorationVisual> => Object.fromEntries(
  BIOME_KEYS.map((theme) => [theme, {
    frame: `${theme}_${frame}`,
    anchor: [0.5, 1] as const,
    scale,
    shadow,
  }]),
) as Record<LandTheme, DecorationVisual>;

export const DECORATION_SPECS: Record<DecorationKind, DecorationSpec> = {
  fence: { kind: "fence", name: "Fence", category: "furniture", buildCost: 90, salvageRate: .5, blocksWalking: true, visuals: themed("fence", 1.05) },
  bench: { kind: "bench", name: "Bench", category: "furniture", buildCost: 140, salvageRate: .5, blocksWalking: false, visuals: themed("bench", .95) },
  tee_sign: { kind: "tee_sign", name: "Tee Sign", category: "furniture", buildCost: 110, salvageRate: .5, blocksWalking: false, visuals: themed("tee_sign", .9) },
  lamp: { kind: "lamp", name: "Lamp", category: "furniture", buildCost: 220, salvageRate: .45, blocksWalking: false, visuals: themed("lamp", 1) },
  bin: { kind: "bin", name: "Bin", category: "furniture", buildCost: 75, salvageRate: .5, blocksWalking: false, visuals: themed("bin", .72) },
  parked_cart: { kind: "parked_cart", name: "Parked Cart", category: "furniture", buildCost: 450, salvageRate: .55, blocksWalking: true, visuals: themed("parked_cart", 1.05) },
  flower_bed: { kind: "flower_bed", name: "Flower Bed", category: "planting", buildCost: 120, salvageRate: .35, blocksWalking: false, visuals: themed("flower_bed", .95, { radiusX: 15, radiusY: 5, alpha: .12 }) },
  planter: { kind: "planter", name: "Planter", category: "planting", buildCost: 160, salvageRate: .4, blocksWalking: false, visuals: themed("planter", .9) },
  ornamental_feature: { kind: "ornamental_feature", name: "Ornamental Feature", category: "planting", buildCost: 900, salvageRate: .35, blocksWalking: true, visuals: themed("ornamental_feature", 1.35, { radiusX: 23, radiusY: 9, alpha: .18 }) },
  bridge: { kind: "bridge", name: "Bridge", category: "structure", buildCost: 1_200, salvageRate: .45, blocksWalking: false, allowedTerrain: ["water"], defaultSpan: 3, maxSpan: 6, visuals: themed("bridge", 1.05, { radiusX: 25, radiusY: 8, alpha: .14 }) },
  boardwalk: { kind: "boardwalk", name: "Boardwalk", category: "structure", buildCost: 800, salvageRate: .45, blocksWalking: false, allowedTerrain: ["wetland"], defaultSpan: 3, maxSpan: 8, visuals: themed("boardwalk", 1.05, { radiusX: 25, radiusY: 8, alpha: .14 }) },
};

const bridgeTilesByCourse = new WeakMap<Course, Set<number>>();
const blockingTilesByCourse = new WeakMap<Course, Set<number>>();

export function decorationSpec(kind: DecorationKind): DecorationSpec {
  return DECORATION_SPECS[kind];
}

export function decorationVisual(decoration: Decoration, theme: LandTheme = "parkland"): DecorationVisual {
  const visuals = decorationSpec(decoration.kind).visuals;
  const owner = getBiomeDefinition(theme).content.structures.decorations;
  return visuals[owner];
}

export function rotationVector(rotation: DecorationRotation): Point {
  return rotation === 0 ? { x: 1, y: 0 } : rotation === 1 ? { x: 0, y: 1 } : rotation === 2 ? { x: -1, y: 0 } : { x: 0, y: -1 };
}

/** Every occupied/path-connected tile, including both dry approaches for spans. */
export function decorationTiles(decoration: Decoration): Point[] {
  if (decoration.kind !== "bridge" && decoration.kind !== "boardwalk") return [{ x: decoration.x, y: decoration.y }];
  const span = Math.max(1, Math.floor(decoration.span ?? decorationSpec(decoration.kind).defaultSpan ?? 1));
  const vector = rotationVector(decoration.rotation);
  return Array.from({ length: span + 2 }, (_, i) => ({ x: decoration.x + vector.x * i, y: decoration.y + vector.y * i }));
}

export function decorationAtTile(course: Course, x: number, y: number): Decoration | undefined {
  return (course.decorations ?? []).find((decoration) => decorationTiles(decoration).some((tile) => tile.x === x && tile.y === y));
}

export function decorationCost(
  decoration: Decoration,
  theme: LandTheme = "parkland",
  costMult = 1,
): number {
  const spec = decorationSpec(decoration.kind);
  const base = spec.category !== "structure"
    ? spec.buildCost
    : spec.buildCost
      + Math.max(1, decoration.span ?? spec.defaultSpan ?? 1)
        * (decoration.kind === "bridge" ? 600 : 350);
  const plantId = resolvedDecorationPlantId(theme, decoration);
  if (!plantId) return base * costMult;
  const plant = plantDefinition(plantId);
  const fit = plantFitMultipliers(theme, plantId);
  return base * plant.installationScale * fit.installationMultiplier * costMult;
}

export function decorationRemovalQuote(
  decoration: Decoration,
  theme: LandTheme = "parkland",
  costMult = 1,
): EconomyQuote {
  if (
    decorationSpec(decoration.kind).category === "planting"
    && decoration.origin !== "player"
  ) {
    return { net: 0, charged: 0, refunded: 0, gross: 0, salvage: 0 };
  }
  const installed = decorationCost(decoration, theme, costMult);
  const salvage = Math.min(
    installed * 0.5,
    installed * decorationSpec(decoration.kind).salvageRate,
  );
  return { net: -salvage, charged: 0, refunded: salvage, gross: 0, salvage };
}

export function decorationDailyCareCost(
  decoration: Decoration,
  theme: LandTheme = "parkland",
): number {
  if (decoration.origin !== "player") return 0;
  const plantId = resolvedDecorationPlantId(theme, decoration);
  return plantId ? dailyPlantCareCost(theme, plantId) : 0;
}

export function decorationPlantWaterDemand(
  decoration: Decoration,
  theme: LandTheme = "parkland",
): number {
  if (decoration.origin !== "player") return 0;
  const plantId = resolvedDecorationPlantId(theme, decoration);
  return plantId ? plantWaterDemand(theme, plantId) : 0;
}

export function bridgeTileSet(course: Course): Set<number> {
  const cached = bridgeTilesByCourse.get(course);
  if (cached) return cached;
  const set = new Set<number>();
  for (const decoration of course.decorations ?? []) {
    if (decoration.kind !== "bridge" && decoration.kind !== "boardwalk") continue;
    for (const tile of decorationTiles(decoration).slice(1, -1)) set.add(tile.y * course.width + tile.x);
  }
  bridgeTilesByCourse.set(course, set);
  return set;
}

export function blockingDecorationSet(course: Course): Set<number> {
  const cached = blockingTilesByCourse.get(course);
  if (cached) return cached;
  const set = new Set<number>();
  for (const decoration of course.decorations ?? []) {
    if (!decorationSpec(decoration.kind).blocksWalking) continue;
    for (const tile of decorationTiles(decoration)) set.add(tile.y * course.width + tile.x);
  }
  blockingTilesByCourse.set(course, set);
  return set;
}

export function canPlaceDecoration(course: Course, decoration: Decoration): { ok: boolean; reason?: string } {
  const spec = decorationSpec(decoration.kind);
  const tiles = decorationTiles(decoration);
  if (tiles.some((tile) => tile.x < 0 || tile.y < 0 || tile.x >= course.width || tile.y >= course.height)) return { ok: false, reason: "out of bounds" };
  if (tiles.some((tile) => !isOwnedTile(course, tile.x, tile.y))) return { ok: false, reason: "land is not owned" };
  if ((course.decorations ?? []).some((existing) => decorationTiles(existing).some((a) => tiles.some((b) => a.x === b.x && a.y === b.y)))) return { ok: false, reason: "overlaps course decor" };
  if (tiles.some((tile) => buildingAtTile(course, tile.x, tile.y))) return { ok: false, reason: "overlaps a building" };
  if (tiles.some((tile) => course.obstacles.some((obstacle) => obstacle.x === tile.x && obstacle.y === tile.y))) return { ok: false, reason: "blocked by a natural feature" };
  if (tiles.some((tile) => course.holes.some((hole) => [hole.tee, hole.green].some((marker) => marker?.x === tile.x && marker.y === tile.y)))) return { ok: false, reason: "covers a tee or green" };

  if (spec.category === "structure") {
    const span = Math.floor(decoration.span ?? spec.defaultSpan ?? 0);
    if (span < 1 || span > (spec.maxSpan ?? 1)) return { ok: false, reason: "invalid span" };
    const interior = tiles.slice(1, -1);
    const approaches = [tiles[0], tiles[tiles.length - 1]];
    if (interior.some((tile) => !spec.allowedTerrain?.includes(course.tiles[tile.y * course.width + tile.x]))) return { ok: false, reason: decoration.kind === "bridge" ? "bridge must span water" : "boardwalk must span wetland" };
    if (approaches.some((tile) => ["water", "wetland"].includes(course.tiles[tile.y * course.width + tile.x]))) return { ok: false, reason: "approaches need dry land" };
    const elevations = approaches.map((tile) => getElevation(course, tile.x, tile.y));
    if (Math.abs(elevations[0] - elevations[1]) > 1) return { ok: false, reason: "approach elevations do not meet" };
  } else if (spec.allowedTerrain && !spec.allowedTerrain.includes(course.tiles[decoration.y * course.width + decoration.x])) {
    return { ok: false, reason: "invalid terrain" };
  } else if (["water", "wetland"].includes(course.tiles[decoration.y * course.width + decoration.x])) {
    return { ok: false, reason: "requires dry land" };
  }
  return { ok: true };
}

export function normalizedDecoration(value: Decoration): Decoration {
  const rotation = ([0, 1, 2, 3] as const).includes(value.rotation as DecorationRotation) ? value.rotation as DecorationRotation : 0;
  const spec = decorationSpec(value.kind);
  const span = spec.category === "structure" ? Math.max(1, Math.min(spec.maxSpan ?? 1, Math.floor(value.span ?? spec.defaultSpan ?? 1))) : undefined;
  const plant = isPlantId(value.plantId) ? plantDefinition(value.plantId) : undefined;
  const plantId = plant?.semantics.kind === "decoration"
    && plant.semantics.decorationKind === value.kind
    ? plant.id
    : undefined;
  return {
    kind: value.kind,
    x: Math.floor(value.x),
    y: Math.floor(value.y),
    rotation,
    ...(Number.isInteger(value.variant) ? { variant: value.variant } : {}),
    ...(plantId ? { plantId } : {}),
    ...(value.origin === "player" || value.origin === "natural"
      ? { origin: value.origin }
      : {}),
    ...(span ? { span } : {}),
  };
}
