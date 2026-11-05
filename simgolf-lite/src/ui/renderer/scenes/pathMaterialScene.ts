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

/** Scene-owned contact on accepted core triangles, independent of camera/quality.
 * G clips each triangle to one cell. The CSR borrows immutable G arrays and
 * samples vertex heights once; queries allocate nothing and never retrace G.
 */
export function createContinuousPathContactSampler(
  plan: Pick<PathMaterialScenePlan, "layers" | "suppressWholeCellPaths">,
  width: number, height: number, sampleHeight: (x: number, y: number) => number,
): (x: number, y: number) => number | null {
  const absent = () => null;
  // Match supported save dimensions before any grid-sized allocation.
  if (!plan.suppressWholeCellPaths || !Number.isInteger(width) || !Number.isInteger(height)
    || width < 1 || height < 1 || width > 256 || height > 256 || width * height > 65536) return absent;
  const core = plan.layers.find(layer => layer.role === "core");
  if (!core || !core.indices.length) return absent;
  const p = core.positions, indices = core.indices, vertexCount = p.length / 2;
  if (p.length % 2 || indices.length % 3 || vertexCount > 0xffffffff || indices.length > 0xffffffff
    || !p.every(Number.isFinite) || !indices.every(index => Number.isInteger(index) && index >= 0 && index < vertexCount)) return absent;
  const clipEpsilon = 1e-8;
  // -1 is degenerate; -2 invalidates a topology that is not cell-clipped.
  const owner = (offset: number): number => {
    const a = indices[offset] * 2, b = indices[offset + 1] * 2, c = indices[offset + 2] * 2;
    const determinant = (p[b + 1] - p[c + 1]) * (p[a] - p[c]) + (p[c] - p[b]) * (p[a + 1] - p[c + 1]);
    if (Math.abs(determinant) <= 1e-12) return -1;
    const cx = Math.floor((p[a] + p[b] + p[c]) / 3), cy = Math.floor((p[a + 1] + p[b + 1] + p[c + 1]) / 3);
    for (let y = Math.max(0, cy - 1); y <= Math.min(height - 1, cy + 1); y++) {
      for (let x = Math.max(0, cx - 1); x <= Math.min(width - 1, cx + 1); x++) {
        if (p[a] >= x - clipEpsilon && p[a] <= x + 1 + clipEpsilon && p[a + 1] >= y - clipEpsilon && p[a + 1] <= y + 1 + clipEpsilon
          && p[b] >= x - clipEpsilon && p[b] <= x + 1 + clipEpsilon && p[b + 1] >= y - clipEpsilon && p[b + 1] <= y + 1 + clipEpsilon
          && p[c] >= x - clipEpsilon && p[c] <= x + 1 + clipEpsilon && p[c + 1] >= y - clipEpsilon && p[c + 1] <= y + 1 + clipEpsilon) return y * width + x;
      }
    }
    return -2;
  };
  const cellCount = width * height, counts = new Uint32Array(cellCount);
  let triangleCount = 0;
  for (let offset = 0; offset < indices.length; offset += 3) {
    const cell = owner(offset);
    if (cell === -2) return absent;
    if (cell >= 0) { counts[cell]++; triangleCount++; }
  }
  if (!triangleCount) return absent;
  const heights = new Float64Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) {
    heights[i] = sampleHeight(p[i * 2], p[i * 2 + 1]);
    if (!Number.isFinite(heights[i])) return absent;
  }
  const offsets = new Uint32Array(cellCount + 1), triangles = new Uint32Array(triangleCount);
  for (let cell = 0; cell < cellCount; cell++) offsets[cell + 1] = offsets[cell] + counts[cell];
  counts.fill(0);
  for (let offset = 0; offset < indices.length; offset += 3) {
    const cell = owner(offset);
    if (cell >= 0) triangles[offsets[cell] + counts[cell]++] = offset;
  }
  return (x, y) => {
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > width || y < 0 || y > height) return null;
    let chosen = Infinity, result: number | null = null;
    // At an exact seam inspect both owners; never broaden beyond containment.
    for (let cy = Math.max(0, Math.floor(y - clipEpsilon)); cy <= Math.min(height - 1, Math.floor(y + clipEpsilon)); cy++) {
      for (let cx = Math.max(0, Math.floor(x - clipEpsilon)); cx <= Math.min(width - 1, Math.floor(x + clipEpsilon)); cx++) {
        const cell = cy * width + cx;
        for (let j = offsets[cell]; j < offsets[cell + 1]; j++) {
          const offset = triangles[j];
          // CSR offsets ascend: later entries cannot win; continue outer seam-owner cells.
          if (offset >= chosen) break;
          const ai = indices[offset], bi = indices[offset + 1], ci = indices[offset + 2];
          const a = ai * 2, b = bi * 2, c = ci * 2;
          const denominator = (p[b + 1] - p[c + 1]) * (p[a] - p[c]) + (p[c] - p[b]) * (p[a + 1] - p[c + 1]);
          const u = ((p[b + 1] - p[c + 1]) * (x - p[c]) + (p[c] - p[b]) * (y - p[c + 1])) / denominator;
          const v = ((p[c + 1] - p[a + 1]) * (x - p[c]) + (p[a] - p[c]) * (y - p[c + 1])) / denominator;
          const w = 1 - u - v;
          if (u < -1e-9 || v < -1e-9 || w < -1e-9) continue;
          result = u * heights[ai] + v * heights[bi] + w * heights[ci]; chosen = offset; break;
        }
      }
    }
    return result;
  };
}
