import { getBiomeDefinition } from "../models/biomes";
import { buildingTiles } from "../models/buildings";
import type { Course, Obstacle, Terrain } from "../models/types";
import type { ResolvedGraphicsQuality } from "./graphicsQuality";
import {
  TERRAIN_DETAILS,
  type TerrainDetailDefinition,
  type TerrainDetailFrame,
  type TerrainDetailKind,
} from "./terrainDetails";

export const HABITAT_COMPOSITION_CAPS: Readonly<Record<ResolvedGraphicsQuality, number>> = {
  high: 160,
  medium: 84,
  low: 0,
};

export const HABITAT_COMPOSITION_ROLES = [
  "woodland_floor",
  "understory",
  "rough_mass",
  "rock_plant_cluster",
] as const;

export type HabitatCompositionRole = (typeof HABITAT_COMPOSITION_ROLES)[number];
export type HabitatCompositionTier = "near" | "middle" | "far";

const INTERIOR_TERRAINS: readonly Terrain[] = ["rough", "deep_rough"];
const HARD_CLEARANCE_TERRAINS: readonly Terrain[] = [
  "water", "wetland", "sand", "waste_area", "path",
];
const SOFT_CLEARANCE_TERRAINS: readonly Terrain[] = ["fairway", "green", "tee"];
const INTERIOR_DETAIL_KINDS: ReadonlySet<TerrainDetailKind> = new Set([
  "short_grass", "tall_grass", "fescue", "flowers", "leaf_litter", "scrub",
]);
const TIER_ORDER: readonly HabitatCompositionTier[] = ["near", "middle", "far"];

/**
 * A member of a named world-space habitat mass. Its identity never includes
 * camera state or quality, so rotation and LOD changes cannot reshuffle it.
 */
export interface HabitatCompositionPlacement {
  readonly id: string;
  readonly clusterId: string;
  readonly massId: string;
  readonly role: HabitatCompositionRole;
  readonly tier: HabitatCompositionTier;
  readonly tileX: number;
  readonly tileY: number;
  readonly worldX: number;
  readonly worldY: number;
  readonly frame: TerrainDetailFrame;
  readonly kind: TerrainDetailKind;
  readonly scale: number;
  /** Deterministic grouped-plan order, never a global cell score. */
  readonly rank: number;
}

export interface HabitatCompositionInput {
  readonly course: Course;
  /** M19 effective terrain cells, if a renderer has a derived tile view. */
  readonly tiles?: readonly Terrain[];
  /** M19 effective obstacle layer, if a renderer has a derived obstacle view. */
  readonly obstacles?: readonly Obstacle[];
  readonly worldSeed: number;
  readonly quality: ResolvedGraphicsQuality;
}

interface HabitatCluster {
  readonly id: string;
  readonly trees: readonly Obstacle[];
  readonly centerX: number;
  readonly centerY: number;
}

interface HabitatTile {
  readonly x: number;
  readonly y: number;
  readonly terrain: Terrain;
  readonly distance: number;
}

type RolePlan = Readonly<Record<HabitatCompositionRole, Readonly<Record<HabitatCompositionTier, number>>>>;

// Each entry is a distinct tile placement. Four roles across each ring form
// visible, multi-placement masses rather than count inflation at one cell.
const ROLE_PLAN: RolePlan = {
  woodland_floor: { near: 4, middle: 3, far: 3 },
  understory: { near: 4, middle: 3, far: 3 },
  rough_mass: { near: 5, middle: 4, far: 4 },
  rock_plant_cluster: { near: 3, middle: 1, far: 1 },
};

const ROLE_KINDS: Readonly<Record<HabitatCompositionRole, readonly TerrainDetailKind[]>> = {
  woodland_floor: ["leaf_litter", "short_grass", "tall_grass", "fescue"],
  understory: ["flowers", "scrub", "tall_grass", "fescue", "short_grass"],
  rough_mass: ["tall_grass", "fescue", "short_grass", "leaf_litter"],
  // The current vocabulary has no free-standing interior rock frame. Until a
  // future asset packet supplies one, this semantic mass uses plant frames and
  // deliberately never borrows shoreline stones or bunker props.
  rock_plant_cluster: ["scrub", "flowers", "leaf_litter", "tall_grass", "fescue", "short_grass"],
};

function mix32(value: number): number {
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
  return (value ^ (value >>> 16)) >>> 0;
}

function hash(seed: number, x: number, y: number, slot: number, salt = 0): number {
  return mix32(seed
    ^ Math.imul(x + 17, 0x45d9f3b)
    ^ Math.imul(y + 31, 0x119de1f3)
    ^ Math.imul(slot + 1, 0x9e3779b1)
    ^ salt);
}

function unit(value: number): number {
  return value / 0xffffffff;
}

function tileKey(x: number, y: number): number {
  return y * 100_000 + x;
}

function terrainAt(course: Course, tiles: readonly Terrain[], x: number, y: number): Terrain | null {
  if (x < 0 || y < 0 || x >= course.width || y >= course.height) return null;
  return tiles[y * course.width + x] ?? null;
}

function clearanceAround(course: Course, points: readonly Obstacle[], radius: number): Set<number> {
  const blocked = new Set<number>();
  for (const point of points) for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
    const x = point.x + dx;
    const y = point.y + dy;
    if (x >= 0 && y >= 0 && x < course.width && y < course.height) blocked.add(tileKey(x, y));
  }
  return blocked;
}

function structureClearance(course: Course): Set<number> {
  const points: Obstacle[] = [];
  for (const building of course.buildings ?? []) for (const tile of buildingTiles(building)) {
    points.push({ x: tile.x, y: tile.y, type: "rock" });
  }
  return clearanceAround(course, points, 2);
}

function clearOfCourseFeatures(
  course: Course,
  tiles: readonly Terrain[],
  structures: ReadonlySet<number>,
  obstacles: ReadonlySet<number>,
  x: number,
  y: number,
): boolean {
  if (x < 2 || y < 2 || x >= course.width - 2 || y >= course.height - 2) return false;
  if (structures.has(tileKey(x, y)) || obstacles.has(tileKey(x, y))) return false;
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    const terrain = terrainAt(course, tiles, x + dx, y + dy);
    if (!terrain || HARD_CLEARANCE_TERRAINS.includes(terrain)) return false;
    if (Math.max(Math.abs(dx), Math.abs(dy)) <= 1 && SOFT_CLEARANCE_TERRAINS.includes(terrain)) return false;
  }
  return true;
}

function mediumFrame(frame: TerrainDetailFrame): TerrainDetailFrame {
  return frame.endsWith("_1") ? (frame.slice(0, -1) + "0") as TerrainDetailFrame : frame;
}

function habitatClusters(obstacles: readonly Obstacle[]): readonly HabitatCluster[] {
  const trees = obstacles.filter((obstacle) => obstacle.type === "tree")
    .slice().sort((left, right) => left.y - right.y || left.x - right.x);
  const remaining = new Set(trees.map((_, index) => index));
  const clusters: HabitatCluster[] = [];
  while (remaining.size > 0) {
    const first = Math.min(...remaining);
    remaining.delete(first);
    const members = [first];
    for (let cursor = 0; cursor < members.length; cursor++) {
      const source = trees[members[cursor]];
      for (const candidate of [...remaining]) {
        const target = trees[candidate];
        const dx = source.x - target.x;
        const dy = source.y - target.y;
        // This is a fixed world-space relation, not a view-angle relation.
        if (dx * dx + dy * dy > 20) continue;
        remaining.delete(candidate);
        members.push(candidate);
      }
    }
    if (members.length < 2) continue;
    const group = members.map((index) => trees[index]);
    const signature = group.map((tree) => String(tree.x) + "," + String(tree.y)).join(";");
    clusters.push({
      id: "grove:" + signature,
      trees: group,
      centerX: group.reduce((total, tree) => total + tree.x, 0) / group.length,
      centerY: group.reduce((total, tree) => total + tree.y, 0) / group.length,
    });
  }
  return clusters.sort((left, right) => left.id.localeCompare(right.id));
}

function treeDistance(cluster: HabitatCluster, x: number, y: number): number {
  return Math.sqrt(Math.min(...cluster.trees.map((tree) => {
    const dx = tree.x - x;
    const dy = tree.y - y;
    return dx * dx + dy * dy;
  })));
}

function tierFor(distance: number): HabitatCompositionTier | null {
  if (distance <= 3) return "near";
  if (distance <= 6) return "middle";
  if (distance <= 10) return "far";
  return null;
}

function nearestCluster(clusters: readonly HabitatCluster[], x: number, y: number): HabitatCluster | null {
  let best: HabitatCluster | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const cluster of clusters) {
    const dx = cluster.centerX - x;
    const dy = cluster.centerY - y;
    const distance = dx * dx + dy * dy;
    if (distance < bestDistance || (distance === bestDistance && cluster.id < (best?.id ?? ""))) {
      best = cluster;
      bestDistance = distance;
    }
  }
  return best;
}

function collectPools(
  course: Course,
  tiles: readonly Terrain[],
  clusters: readonly HabitatCluster[],
  structures: ReadonlySet<number>,
  obstacles: ReadonlySet<number>,
): ReadonlyMap<string, readonly HabitatTile[]> {
  const pools = new Map<string, HabitatTile[]>();
  for (const cluster of clusters) pools.set(cluster.id, []);
  for (let y = 0; y < course.height; y++) for (let x = 0; x < course.width; x++) {
    const terrain = terrainAt(course, tiles, x, y);
    if (!terrain || !INTERIOR_TERRAINS.includes(terrain)) continue;
    if (!clearOfCourseFeatures(course, tiles, structures, obstacles, x, y)) continue;
    const cluster = nearestCluster(clusters, x, y);
    if (!cluster) continue;
    const distance = treeDistance(cluster, x, y);
    if (!tierFor(distance)) continue;
    pools.get(cluster.id)?.push({ x, y, terrain, distance });
  }
  return pools;
}

function definitionsFor(
  role: HabitatCompositionRole,
  terrain: Terrain,
  detailOwner: string,
): readonly TerrainDetailDefinition[] {
  const eligible = TERRAIN_DETAILS.filter((definition) =>
    definition.theme === detailOwner
    && !definition.edgeTerrain
    && INTERIOR_DETAIL_KINDS.has(definition.kind)
    && definition.allowedTerrain.includes(terrain)
  );
  for (const kind of ROLE_KINDS[role]) {
    const matches = eligible.filter((definition) => definition.kind === kind);
    if (matches.length > 0) return matches;
  }
  return eligible;
}

interface RankedHabitatTile extends HabitatTile {
  readonly graphDistance: number;
}

function roleSalt(role: HabitatCompositionRole, tier: HabitatCompositionTier): number {
  return (HABITAT_COMPOSITION_ROLES.indexOf(role) + 1) * 0x1f123bb5
    ^ (TIER_ORDER.indexOf(tier) + 1) * 0x6c8e9cf5;
}

function candidateKey(tile: HabitatTile): number {
  return tileKey(tile.x, tile.y);
}

/**
 * Returns the 8-connected eligible component containing `anchor`. Habitat
 * masses must be a patch in world space, not a hash sample of an annulus.
 */
function connectedCandidates(
  anchor: HabitatTile,
  available: ReadonlyMap<number, HabitatTile>,
): readonly HabitatTile[] {
  const component: HabitatTile[] = [];
  const seen = new Set<number>([candidateKey(anchor)]);
  const queue = [anchor];
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const tile = queue[cursor];
    component.push(tile);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const neighbor = available.get(tileKey(tile.x + dx, tile.y + dy));
      if (!neighbor || seen.has(candidateKey(neighbor))) continue;
      seen.add(candidateKey(neighbor));
      queue.push(neighbor);
    }
  }
  return component;
}

function compactMassTiles(
  candidates: readonly HabitatTile[],
  usedTiles: ReadonlySet<number>,
  worldSeed: number,
  role: HabitatCompositionRole,
  tier: HabitatCompositionTier,
  count: number,
): readonly HabitatTile[] {
  const available = new Map(candidates
    .filter((tile) => !usedTiles.has(candidateKey(tile)))
    .map((tile) => [candidateKey(tile), tile]));
  if (available.size === 0) return [];

  const salt = roleSalt(role, tier);
  // Prefer an anchor whose connected eligibility can satisfy the whole mass;
  // this avoids silently turning a mass into two distant fragments.
  const anchors = [...available.values()].map((tile) => ({
    tile,
    component: connectedCandidates(tile, available),
  })).sort((left, right) => {
    const leftFits = left.component.length >= count ? 0 : 1;
    const rightFits = right.component.length >= count ? 0 : 1;
    return leftFits - rightFits
      || right.component.length - left.component.length
      || hash(worldSeed, left.tile.x, left.tile.y, salt, count) - hash(worldSeed, right.tile.x, right.tile.y, salt, count)
      || left.tile.y - right.tile.y
      || left.tile.x - right.tile.x;
  });
  const anchor = anchors[0].tile;
  const ranked: RankedHabitatTile[] = [{ ...anchor, graphDistance: 0 }];
  const seen = new Set<number>([candidateKey(anchor)]);
  for (let cursor = 0; cursor < ranked.length; cursor++) {
    const tile = ranked[cursor];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const neighbor = available.get(tileKey(tile.x + dx, tile.y + dy));
      if (!neighbor || seen.has(candidateKey(neighbor))) continue;
      seen.add(candidateKey(neighbor));
      ranked.push({ ...neighbor, graphDistance: tile.graphDistance + 1 });
    }
  }
  // A deterministic breadth-first order fills the nearest 8-connected cells
  // around the anchor before a different mass can claim any other patch.
  return ranked.sort((left, right) =>
    left.graphDistance - right.graphDistance
      || ((left.x - anchor.x) ** 2 + (left.y - anchor.y) ** 2)
        - ((right.x - anchor.x) ** 2 + (right.y - anchor.y) ** 2)
      || hash(worldSeed, left.x, left.y, salt, left.graphDistance)
        - hash(worldSeed, right.x, right.y, salt, right.graphDistance)
      || left.y - right.y
      || left.x - right.x,
  ).slice(0, count);
}

function planCluster(
  cluster: HabitatCluster,
  pool: readonly HabitatTile[],
  detailOwner: string,
  worldSeed: number,
  quality: ResolvedGraphicsQuality,
): readonly HabitatCompositionPlacement[] {
  const usedTiles = new Set<number>();
  const planned: HabitatCompositionPlacement[] = [];
  for (const role of HABITAT_COMPOSITION_ROLES) for (const tier of TIER_ORDER) {
    const candidates = pool.filter((tile) =>
      tierFor(tile.distance) === tier && definitionsFor(role, tile.terrain, detailOwner).length > 0,
    );
    const massTiles = compactMassTiles(candidates, usedTiles, worldSeed, role, tier, ROLE_PLAN[role][tier]);
    for (const [member, tile] of massTiles.entries()) {
      const definitions = definitionsFor(role, tile.terrain, detailOwner);
      const h = hash(worldSeed, tile.x, tile.y, member, role.length * 131 + tier.length);
      const definition = definitions[h % definitions.length];
      const massId = cluster.id + ":" + role + ":" + tier;
      const scaleT = ((h >>> 16) & 0xff) / 0xff;
      planned.push({
        id: massId + ":" + String(member),
        clusterId: cluster.id,
        massId,
        role,
        tier,
        tileX: tile.x,
        tileY: tile.y,
        // Keep a mass visually inside its connected cells. Larger jitter made
        // a valid tile patch read as isolated, annulus-scattered sprites.
        worldX: tile.x + 0.5 + (unit(hash(worldSeed, tile.x, tile.y, member, 0x2f6e2b1)) - 0.5) * 0.32,
        worldY: tile.y + 0.5 + (unit(hash(worldSeed, tile.x, tile.y, member, 0x6d2b79f5)) - 0.5) * 0.32,
        frame: quality === "medium" ? mediumFrame(definition.frames[(h >>> 27) & 1]) : definition.frames[(h >>> 27) & 1],
        kind: definition.kind,
        scale: definition.scaleRange[0] + (definition.scaleRange[1] - definition.scaleRange[0]) * scaleT,
        rank: 0,
      });
      usedTiles.add(tileKey(tile.x, tile.y));
    }
  }
  return planned;
}

function flattenClusters(
  clusters: readonly HabitatCluster[],
  planned: ReadonlyMap<string, readonly HabitatCompositionPlacement[]>,
): readonly HabitatCompositionPlacement[] {
  const output: HabitatCompositionPlacement[] = [];
  // Keep mass members adjacent in the plan. This is intentionally cluster-first
  // composition, not a global sort of unrelated single-cell candidates.
  for (const cluster of clusters) for (const placement of planned.get(cluster.id) ?? []) {
    output.push({ ...placement, rank: output.length });
  }
  return output;
}

/**
 * Produces presentation-only ecological masses around real tree groves.
 * Tiles, structures, hazards/routes, and effective obstacles are clearance
 * inputs only; no course data, collision layer, or gameplay state is mutated.
 * Quality is a final prefix cap, so medium is a strict semantic high subset.
 */
export function deriveHabitatComposition(
  input: HabitatCompositionInput,
): readonly HabitatCompositionPlacement[] {
  const cap = HABITAT_COMPOSITION_CAPS[input.quality];
  if (cap === 0) return [];
  const tiles = input.tiles ?? input.course.tiles;
  if (tiles.length !== input.course.width * input.course.height) return [];
  const effectiveObstacles = input.obstacles ?? input.course.obstacles;
  const clusters = habitatClusters(effectiveObstacles);
  if (clusters.length === 0) return [];
  const pools = collectPools(
    input.course,
    tiles,
    clusters,
    structureClearance(input.course),
    // Occupied obstacle tiles are excluded. Nearby open terrain remains usable
    // as a mass member; the terrain/routing clearance above still supplies a
    // two-cell buffer around every playable or hazard surface.
    clearanceAround(input.course, effectiveObstacles, 0),
  );
  const detailOwner = getBiomeDefinition(input.course.theme).content.materials.details;
  const planned = new Map(clusters.map((cluster) => [
    cluster.id,
    planCluster(cluster, pools.get(cluster.id) ?? [], detailOwner, input.worldSeed, input.quality),
  ]));
  return flattenClusters(clusters, planned).slice(0, cap);
}
