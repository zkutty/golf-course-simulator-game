import type { LandTheme, Terrain } from "../models/types";

export type TerrainPresentationClass = "tile-surface" | "organic-hazard" | "route";

/**
 * Exhaustive renderer presentation policy. This classification is visual
 * only: simulation, picking, saving, and course hashes continue to consume
 * the authoritative terrain array.
 */
export const TERRAIN_PRESENTATION_POLICY = {
  fairway: "tile-surface",
  rough: "tile-surface",
  deep_rough: "tile-surface",
  green: "tile-surface",
  tee: "tile-surface",
  sand: "organic-hazard",
  water: "organic-hazard",
  wetland: "organic-hazard",
  waste_area: "organic-hazard",
  path: "route",
} as const satisfies Readonly<Record<Terrain, TerrainPresentationClass>>;

export const TILE_SURFACE_TERRAINS = [
  "fairway", "rough", "deep_rough", "green", "tee",
] as const satisfies readonly Terrain[];
export const ORGANIC_HAZARD_TERRAINS = [
  "sand", "water", "wetland", "waste_area",
] as const satisfies readonly Terrain[];
export const ROUTE_TERRAINS = ["path"] as const satisfies readonly Terrain[];

export type TerrainPresentationMappingReason =
  | "singleton-deep-rough"
  | "enclosed-singleton-rough";

export interface TerrainPresentationMapping {
  readonly cell: number;
  readonly x: number;
  readonly y: number;
  readonly from: Terrain;
  readonly to: Terrain;
  readonly reason: TerrainPresentationMappingReason;
}

export interface TerrainPresentationMap {
  /** The original authoritative array, retained by identity. */
  readonly authoritativeTiles: readonly Terrain[];
  /** A deterministic visual-only copy. */
  readonly presentationTiles: Terrain[];
  readonly mappings: readonly TerrainPresentationMapping[];
  readonly authoritativeBytes: string;
  readonly presentationBytes: string;
  readonly policy: {
    readonly classification: typeof TERRAIN_PRESENTATION_POLICY;
    readonly tileSurface: readonly Terrain[];
    readonly organicHazard: readonly Terrain[];
    readonly route: readonly Terrain[];
  };
}

interface PresentationComponent {
  readonly terrain: Terrain;
  readonly cells: readonly unknown[];
  readonly rings: readonly unknown[];
}

export interface TerrainPresentationDiagnostics {
  readonly authoritativeSingletonDeepRough: number;
  readonly distinctSingletonDeepRoughFields: 0;
  readonly distinctSingletonDeepRoughBands: 0;
  readonly coalescedSingletonDeepRough: number;
  readonly enclosedSingletonRoughToFairway: number;
  readonly policy: TerrainPresentationMap["policy"];
  readonly mappings: readonly TerrainPresentationMapping[];
  readonly authoritativeBytes: string;
  readonly presentationBytes: string;
  readonly authoritativeCellCounts: Readonly<Record<Terrain, number>>;
  readonly presentationCellCounts: Readonly<Record<Terrain, number>>;
  readonly authoritativeComponentCounts: Readonly<Record<Terrain, number>>;
  readonly presentationComponentCounts: Readonly<Record<Terrain, number>>;
  readonly authoritativeRingCounts: Readonly<Record<Terrain, number>>;
  readonly presentationRingCounts: Readonly<Record<Terrain, number>>;
  readonly tileSurfaceConnectedMasks: number;
}

const CARDINALS = [[1, 0], [0, 1], [-1, 0], [0, -1]] as const;
const presentationCache = new WeakMap<readonly Terrain[], Map<string, TerrainPresentationMap>>();

function terrainBytes(tiles: readonly Terrain[]): string {
  let hash = 0x811c9dc5;
  for (const terrain of tiles) {
    for (let index = 0; index < terrain.length; index++) {
      hash ^= terrain.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    hash ^= 0xff;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function singletonCells(
  tiles: readonly Terrain[],
  width: number,
  height: number,
  terrain: Terrain,
): readonly number[] {
  const visited = new Uint8Array(tiles.length);
  const singleton: number[] = [];
  for (let seed = 0; seed < tiles.length; seed++) {
    if (visited[seed] || tiles[seed] !== terrain) continue;
    const component: number[] = [];
    const queue = [seed];
    visited[seed] = 1;
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const cell = queue[cursor];
      component.push(cell);
      const x = cell % width;
      const y = Math.floor(cell / width);
      for (const [dx, dy] of CARDINALS) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const neighbor = ny * width + nx;
        if (visited[neighbor] || tiles[neighbor] !== terrain) continue;
        visited[neighbor] = 1;
        queue.push(neighbor);
      }
    }
    if (component.length === 1) singleton.push(component[0]);
  }
  return singleton;
}

/**
 * Builds the Parkland singleton presentation map from one immutable authority
 * snapshot. Both rules are decided from that original snapshot, so applying
 * the deep-rough mappings can never change which rough island qualifies.
 */
export function buildTerrainPresentationMap(
  authoritativeTiles: readonly Terrain[],
  width: number,
  height: number,
  theme: LandTheme | undefined,
): TerrainPresentationMap {
  if (authoritativeTiles.length !== width * height) {
    throw new Error("Terrain presentation dimensions are inconsistent");
  }
  const cacheKey = `${width}:${height}:${theme ?? "parkland"}`;
  const cached = presentationCache.get(authoritativeTiles)?.get(cacheKey);
  if (cached) return cached;
  const presentationTiles = [...authoritativeTiles];
  const mappings: TerrainPresentationMapping[] = [];
  if ((theme ?? "parkland") === "parkland") {
    for (const cell of singletonCells(authoritativeTiles, width, height, "deep_rough")) {
      mappings.push({
        cell,
        x: cell % width,
        y: Math.floor(cell / width),
        from: "deep_rough",
        to: "rough",
        reason: "singleton-deep-rough",
      });
    }
    for (const cell of singletonCells(authoritativeTiles, width, height, "rough")) {
      const x = cell % width;
      const y = Math.floor(cell / width);
      const neighbors = CARDINALS.flatMap(([dx, dy]) => {
        const nx = x + dx;
        const ny = y + dy;
        return nx < 0 || ny < 0 || nx >= width || ny >= height
          ? []
          : [authoritativeTiles[ny * width + nx]];
      });
      const fairwayNeighbors = neighbors.filter((terrain) => terrain === "fairway").length;
      const enclosedByFairwayField = neighbors.length === 4
        && fairwayNeighbors >= 3
        && neighbors.every((terrain) => terrain === "fairway" || terrain === "deep_rough");
      if (!enclosedByFairwayField) continue;
      mappings.push({
        cell,
        x,
        y,
        from: "rough",
        to: "fairway",
        reason: "enclosed-singleton-rough",
      });
    }
  }
  mappings.sort((a, b) => a.cell - b.cell || a.to.localeCompare(b.to));
  for (const mapping of mappings) presentationTiles[mapping.cell] = mapping.to;
  const result = {
    authoritativeTiles,
    presentationTiles,
    mappings,
    authoritativeBytes: terrainBytes(authoritativeTiles),
    presentationBytes: terrainBytes(presentationTiles),
    policy: {
      classification: TERRAIN_PRESENTATION_POLICY,
      tileSurface: TILE_SURFACE_TERRAINS,
      organicHazard: ORGANIC_HAZARD_TERRAINS,
      route: ROUTE_TERRAINS,
    },
  };
  const entries = presentationCache.get(authoritativeTiles) ?? new Map<string, TerrainPresentationMap>();
  entries.set(cacheKey, result);
  presentationCache.set(authoritativeTiles, entries);
  return result;
}

export function terrainCellCounts(tiles: readonly Terrain[]): Readonly<Record<Terrain, number>> {
  const counts: Record<Terrain, number> = {
    fairway: 0, rough: 0, deep_rough: 0, green: 0, tee: 0,
    sand: 0, water: 0, wetland: 0, waste_area: 0, path: 0,
  };
  for (const terrain of tiles) counts[terrain]++;
  return counts;
}

function landscapeCounts(
  components: readonly PresentationComponent[],
  rings: boolean,
): Readonly<Record<Terrain, number>> {
  const counts = terrainCellCounts([]) as Record<Terrain, number>;
  for (const component of components) counts[component.terrain] += rings ? component.rings.length : 1;
  return counts;
}

export function buildTerrainPresentationDiagnostics(
  map: TerrainPresentationMap,
  authoritativeComponents: readonly PresentationComponent[],
  presentationComponents: readonly PresentationComponent[],
): TerrainPresentationDiagnostics {
  return {
    authoritativeSingletonDeepRough: authoritativeComponents.filter((component) => (
      component.terrain === "deep_rough" && component.cells.length === 1
    )).length,
    distinctSingletonDeepRoughFields: 0,
    distinctSingletonDeepRoughBands: 0,
    coalescedSingletonDeepRough: map.mappings.filter((mapping) => (
      mapping.reason === "singleton-deep-rough"
    )).length,
    enclosedSingletonRoughToFairway: map.mappings.filter((mapping) => (
      mapping.reason === "enclosed-singleton-rough"
    )).length,
    policy: map.policy,
    mappings: map.mappings,
    authoritativeBytes: map.authoritativeBytes,
    presentationBytes: map.presentationBytes,
    authoritativeCellCounts: terrainCellCounts(map.authoritativeTiles),
    presentationCellCounts: terrainCellCounts(map.presentationTiles),
    authoritativeComponentCounts: landscapeCounts(authoritativeComponents, false),
    presentationComponentCounts: landscapeCounts(presentationComponents, false),
    authoritativeRingCounts: landscapeCounts(authoritativeComponents, true),
    presentationRingCounts: landscapeCounts(presentationComponents, true),
    tileSurfaceConnectedMasks: 0,
  };
}
