import { getBiomeDefinition } from "../models/biomes";
import { buildingTiles } from "../models/buildings";
import type { Course, Obstacle, Terrain } from "../models/types";
import type { ResolvedGraphicsQuality } from "./graphicsQuality";
import {
  TERRAIN_DETAILS,
  type TerrainDetailFrame,
  type TerrainDetailKind,
} from "./terrainDetails";

export const HABITAT_COMPOSITION_CAPS: Readonly<Record<ResolvedGraphicsQuality, number>> = {
  high: 160,
  medium: 84,
  // The low bundle intentionally carries no optional terrain-detail atlas.
  low: 0,
};

const INTERIOR_TERRAINS: readonly Terrain[] = ["rough", "deep_rough"];
const HARD_CLEARANCE_TERRAINS: readonly Terrain[] = [
  "water",
  "wetland",
  "sand",
  "path",
];
const SOFT_CLEARANCE_TERRAINS: readonly Terrain[] = [
  "fairway",
  "green",
  "tee",
  "waste_area",
];
const INTERIOR_DETAIL_KINDS: ReadonlySet<TerrainDetailKind> = new Set([
  "short_grass",
  "tall_grass",
  "fescue",
  "flowers",
  "leaf_litter",
  "scrub",
]);

export interface HabitatCompositionPlacement {
  /** Stable identity used to prove tier nesting without depending on frame LOD. */
  readonly id: string;
  readonly tileX: number;
  readonly tileY: number;
  readonly worldX: number;
  readonly worldY: number;
  readonly frame: TerrainDetailFrame;
  readonly kind: TerrainDetailKind;
  readonly scale: number;
  readonly rank: number;
}

export interface HabitatCompositionInput {
  readonly course: Course;
  readonly tiles?: readonly Terrain[];
  readonly obstacles?: readonly Obstacle[];
  readonly worldSeed: number;
  readonly quality: ResolvedGraphicsQuality;
}

function mix32(value: number): number {
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
  return (value ^ (value >>> 16)) >>> 0;
}

function hash(seed: number, x: number, y: number, slot: number, salt = 0): number {
  return mix32(
    seed
      ^ Math.imul(x + 17, 0x45d9f3b)
      ^ Math.imul(y + 31, 0x119de1f3)
      ^ Math.imul(slot + 1, 0x9e3779b1)
      ^ salt,
  );
}

function unit(value: number): number {
  return value / 0xffffffff;
}

function terrainAt(
  course: Course,
  tiles: readonly Terrain[],
  x: number,
  y: number,
): Terrain | null {
  if (x < 0 || y < 0 || x >= course.width || y >= course.height) return null;
  return tiles[y * course.width + x] ?? null;
}

function clearOfCourseFeatures(
  course: Course,
  tiles: readonly Terrain[],
  buildingClearance: ReadonlySet<number>,
  x: number,
  y: number,
): boolean {
  if (x < 2 || y < 2 || x >= course.width - 2 || y >= course.height - 2) return false;
  if (buildingClearance.has(y * course.width + x)) return false;
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    const terrain = terrainAt(course, tiles, x + dx, y + dy);
    if (!terrain) return false;
    const distance = Math.max(Math.abs(dx), Math.abs(dy));
    if (HARD_CLEARANCE_TERRAINS.includes(terrain)) return false;
    if (distance <= 1 && SOFT_CLEARANCE_TERRAINS.includes(terrain)) return false;
  }
  return true;
}

function buildingClearance(course: Course): Set<number> {
  const blocked = new Set<number>();
  for (const building of course.buildings ?? []) for (const tile of buildingTiles(building)) {
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const x = tile.x + dx;
      const y = tile.y + dy;
      if (x >= 0 && y >= 0 && x < course.width && y < course.height) {
        blocked.add(y * course.width + x);
      }
    }
  }
  return blocked;
}

function mediumFrame(frame: TerrainDetailFrame): TerrainDetailFrame {
  return frame.endsWith("_1") ? `${frame.slice(0, -1)}0` as TerrainDetailFrame : frame;
}

/**
 * Derives presentation-only habitat interiors around real tree clusters.
 *
 * The returned sprites never enter course state or collision. Candidates are
 * ranked once, then quality tiers take strict prefixes so an LOD change cannot
 * reshuffle the composition. Boundary reeds, stones, and bunker edging are
 * deliberately excluded; those belong to the material-transition system.
 */
export function deriveHabitatComposition(
  input: HabitatCompositionInput,
): readonly HabitatCompositionPlacement[] {
  const cap = HABITAT_COMPOSITION_CAPS[input.quality];
  if (cap === 0) return [];
  const { course, worldSeed } = input;
  const tiles = input.tiles ?? course.tiles;
  if (tiles.length !== course.width * course.height) return [];
  const obstacles = input.obstacles ?? course.obstacles;
  const trees = obstacles.filter((obstacle) => obstacle.type === "tree");
  if (trees.length < 2) return [];
  const occupied = new Set(obstacles.map((obstacle) => `${obstacle.x},${obstacle.y}`));
  const clearedBuildings = buildingClearance(course);
  const detailOwner = getBiomeDefinition(course.theme).content.materials.details;
  const candidates: HabitatCompositionPlacement[] = [];

  for (let y = 0; y < course.height; y++) for (let x = 0; x < course.width; x++) {
    const terrain = terrainAt(course, tiles, x, y);
    if (!terrain || !INTERIOR_TERRAINS.includes(terrain)) continue;
    if (occupied.has(`${x},${y}`)) continue;
    if (!clearOfCourseFeatures(course, tiles, clearedBuildings, x, y)) continue;
    const clusterTrees = trees.filter((tree) => {
      const dx = tree.x - x;
      const dy = tree.y - y;
      return dx * dx + dy * dy <= 18;
    });
    if (clusterTrees.length < 2) continue;
    const definitions = TERRAIN_DETAILS.filter((definition) =>
      definition.theme === detailOwner
      && !definition.edgeTerrain
      && INTERIOR_DETAIL_KINDS.has(definition.kind)
      && definition.allowedTerrain.includes(terrain)
    );
    if (definitions.length === 0) continue;

    // Dense cluster cores receive a second, independently ranked accent.
    const slots = clusterTrees.length >= 3 && (hash(worldSeed, x, y, 9) & 1) === 0 ? 2 : 1;
    for (let slot = 0; slot < slots; slot++) {
      const h = hash(worldSeed, x, y, slot, detailOwner.length * 131);
      const definition = definitions[h % definitions.length];
      const variant = (h >>> 27) & 1;
      const sourceFrame = definition.frames[variant];
      const scaleT = ((h >>> 16) & 0xff) / 0xff;
      const frame = input.quality === "medium" ? mediumFrame(sourceFrame) : sourceFrame;
      candidates.push({
        id: `${detailOwner}:${x},${y}:${slot}`,
        tileX: x,
        tileY: y,
        worldX: x + 0.5 + (unit(hash(worldSeed, x, y, slot, 0x2f6e2b1)) - 0.5) * 0.56,
        worldY: y + 0.5 + (unit(hash(worldSeed, x, y, slot, 0x6d2b79f5)) - 0.5) * 0.56,
        frame,
        kind: definition.kind,
        scale: definition.scaleRange[0]
          + (definition.scaleRange[1] - definition.scaleRange[0]) * scaleT,
        rank: unit(hash(worldSeed, x, y, slot, 0x51ed270b)),
      });
    }
  }

  return candidates
    .sort((left, right) => left.rank - right.rank || left.id.localeCompare(right.id))
    .slice(0, cap);
}
