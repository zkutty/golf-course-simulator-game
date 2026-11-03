import type { Point, Terrain } from "../../../game/models/types";
import { DEFAULT_TILE_PATH_WIDTH, type ContinuousPathLayer, type ContinuousPathPlan, type PathRibbonRole } from "../../../game/paths/continuousPathPlan";
import type { AtlasPathMaterialRole, AtlasQuality } from "../../../render/atlasManifest";

export interface PathMaterialMeshData {
  readonly role: PathRibbonRole;
  readonly positions: Float32Array;
  readonly uvs: Float32Array;
  readonly indices: Uint32Array;
}
export interface PathMaterialScenePlan {
  readonly mode: "legacy" | "continuous";
  readonly key: string;
  readonly quality: AtlasQuality;
  readonly roles: readonly PathRibbonRole[];
  readonly textureRoles: readonly AtlasPathMaterialRole[];
  readonly layers: readonly ContinuousPathLayer[];
  readonly underlayTiles: readonly Terrain[];
  readonly underlay: readonly { terrain: Terrain; cells: readonly number[] }[];
  readonly suppressWholeCellPaths: boolean;
  readonly componentCount: number;
  readonly triangleCount: number;
  readonly widths: { minimum: number; maximum: number };
}

function graphComponentCount(plan: ContinuousPathPlan): number {
  const links = new Map(plan.nodes.map((node) => [node.id, new Set<string>()])); let cycles = 0;
  for (const edge of plan.edges) {
    if (edge.fromNodeId && edge.toNodeId) { links.get(edge.fromNodeId)?.add(edge.toNodeId); links.get(edge.toNodeId)?.add(edge.fromNodeId); }
    else if (edge.closed) cycles++;
  }
  const seen = new Set<string>(); let count = cycles;
  for (const id of links.keys()) {
    if (seen.has(id)) continue; count++; const queue = [id]; seen.add(id);
    for (let i = 0; i < queue.length; i++) for (const next of links.get(queue[i]) ?? []) if (!seen.has(next)) { seen.add(next); queue.push(next); }
  }
  return count;
}

/** Quality changes material detail only; every tier consumes the same G mesh. */
export function buildPathMaterialScenePlan(plan: ContinuousPathPlan, quality: AtlasQuality): PathMaterialScenePlan {
  const roles = ["shoulder", "edge", "core"] as const;
  const ready = roles.every((role) => {
    const layer = plan.layers.find((candidate) => candidate.role === role);
    return layer && layer.positions.length % 2 === 0 && layer.positions.every(Number.isFinite)
      && layer.indices.length % 3 === 0 && layer.indices.every((index) => Number.isInteger(index) && index >= 0 && index * 2 < layer.positions.length)
      && (role !== "core" || !plan.coverage.length || layer.indices.length > 0);
  });
  const groups = new Map<Terrain, number[]>();
  if (ready) for (const cell of plan.coverage) {
    const terrain = plan.underlayTiles[cell]; const group = groups.get(terrain) ?? []; group.push(cell); groups.set(terrain, group);
  }
  const widths = plan.edges.map((edge) => edge.width);
  return {
    mode: ready ? "continuous" : "legacy", key: plan.key, quality,
    roles: ready ? roles : ["core"], textureRoles: ready && quality !== "low" ? ["shoulder", "edge"] : [],
    layers: ready ? plan.layers : [], underlayTiles: plan.underlayTiles,
    underlay: [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([terrain, cells]) => ({ terrain, cells })),
    suppressWholeCellPaths: ready, componentCount: ready ? graphComponentCount(plan) : 0,
    triangleCount: ready ? plan.layers.reduce((sum, layer) => sum + layer.indices.length / 3, 0) : 0,
    widths: { minimum: widths.length ? Math.min(...widths) : plan.coverage.length ? DEFAULT_TILE_PATH_WIDTH : 0, maximum: widths.length ? Math.max(...widths) : plan.coverage.length ? DEFAULT_TILE_PATH_WIDTH : 0 },
  };
}

/** One render-only underlay input suppresses atlas and connected legacy owners. */
export function pathUnderlayForRenderer(tiles: Terrain[], plan: PathMaterialScenePlan): Terrain[] {
  if (!plan.suppressWholeCellPaths || !plan.underlay.length) return tiles;
  const result = [...tiles];
  for (const group of plan.underlay) for (const cell of group.cells) if (tiles[cell] === "path") result[cell] = group.terrain;
  return result;
}

/** Project accepted triangles only; no new centerline, clipping, cap or mask. */
export function pathMaterialLayerMesh(layer: ContinuousPathLayer, project: (point: Point) => Point, periodTiles: number | Readonly<Point> = 4): PathMaterialMeshData {
  const period = typeof periodTiles === "number" ? { x: periodTiles, y: periodTiles } : periodTiles;
  const positions = new Float32Array(layer.positions.length); const uvs = new Float32Array(layer.positions.length);
  for (let i = 0; i < layer.positions.length; i += 2) {
    const world = { x: layer.positions[i], y: layer.positions[i + 1] }; const projected = project(world);
    positions[i] = projected.x; positions[i + 1] = projected.y; uvs[i] = world.x / period.x; uvs[i + 1] = world.y / period.y;
  }
  return { role: layer.role, positions, uvs, indices: new Uint32Array(layer.indices) };
}

/** Path actors share the ribbon's continuous height, including legal tile seams. */
export function continuousPathGroundHeight(
  plan: Pick<PathMaterialScenePlan, "suppressWholeCellPaths">,
  tiles: readonly Terrain[], width: number, height: number, x: number, y: number,
  sampleHeight: (x: number, y: number) => number,
): number | null {
  if (!plan.suppressWholeCellPaths) return null;
  for (let cy = Math.max(0, Math.floor(y - 1e-7)); cy <= Math.min(height - 1, Math.floor(y)); cy++) {
    for (let cx = Math.max(0, Math.floor(x - 1e-7)); cx <= Math.min(width - 1, Math.floor(x)); cx++) {
      if (tiles[cy * width + cx] === "path") return sampleHeight(x, y);
    }
  }
  return null;
}
