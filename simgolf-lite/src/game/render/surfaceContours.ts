import type { SurfaceFeature, SurfacePoint, Terrain } from "../models/types";
import { simplifySurfacePoints } from "../models/surfaceIntent";

export interface TerrainContour {
  terrain: Terrain;
  points: SurfacePoint[];
}

interface Edge {
  start: SurfacePoint;
  end: SurfacePoint;
}

const key = (point: SurfacePoint) => `${point.x},${point.y}`;

/** Reconstructs what lies below persisted intent without increasing save size. */
export function buildIntentUnderlayTiles(
  tiles: readonly Terrain[],
  width: number,
  height: number,
  features: readonly SurfaceFeature[],
): Terrain[] {
  const result = tiles.slice();
  for (const feature of features) {
    const coverage = new Set(feature.coverage.filter((index) => tiles[index] === feature.terrain));
    for (const index of coverage) {
      const x = index % width;
      const y = Math.floor(index / width);
      const candidates = new Map<Terrain, number>();
      for (let radius = 1; radius <= 3 && candidates.size === 0; radius++) {
        for (let dy = -radius; dy <= radius; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            if (Math.abs(dx) + Math.abs(dy) !== radius) continue;
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            const neighborIndex = ny * width + nx;
            if (coverage.has(neighborIndex)) continue;
            const terrain = result[neighborIndex];
            if (terrain === feature.terrain) continue;
            candidates.set(terrain, (candidates.get(terrain) ?? 0) + 1);
          }
        }
      }
      result[index] = [...candidates].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "rough";
    }
  }
  return result;
}

export function smoothClosedContour(
  points: readonly SurfacePoint[],
  passes = 1,
): SurfacePoint[] {
  let result = points.map((point) => ({ ...point }));
  if (result.length >= 5) {
    let pivot = 1;
    let farthest = 0;
    for (let index = 1; index < result.length; index++) {
      const distance = (result[index].x - result[0].x) ** 2 + (result[index].y - result[0].y) ** 2;
      if (distance > farthest) {
        farthest = distance;
        pivot = index;
      }
    }
    const firstHalf = simplifySurfacePoints(result.slice(0, pivot + 1), 0.72);
    const secondHalf = simplifySurfacePoints([...result.slice(pivot), result[0]], 0.72);
    result = [...firstHalf.slice(0, -1), ...secondHalf.slice(0, -1)];
  }
  for (let pass = 0; pass < passes && result.length >= 3; pass++) {
    const next: SurfacePoint[] = [];
    for (let index = 0; index < result.length; index++) {
      const current = result[index];
      const after = result[(index + 1) % result.length];
      next.push(
        { x: current.x * 0.75 + after.x * 0.25, y: current.y * 0.75 + after.y * 0.25 },
        { x: current.x * 0.25 + after.x * 0.75, y: current.y * 0.25 + after.y * 0.75 },
      );
    }
    result = next;
  }
  return result;
}

/**
 * Extracts clockwise tile-union rings per orthogonally connected component.
 * Separate inner rings are safe for the painter's-order renderer: the terrain
 * occupying a hole is drawn later by material priority.
 */
export function buildTerrainContours(
  tiles: readonly Terrain[],
  width: number,
  height: number,
): TerrainContour[] {
  const visited = new Uint8Array(tiles.length);
  const contours: TerrainContour[] = [];
  for (let seed = 0; seed < tiles.length; seed++) {
    if (visited[seed]) continue;
    const terrain = tiles[seed];
    const component: number[] = [];
    const queue = [seed];
    visited[seed] = 1;
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const index = queue[cursor];
      component.push(index);
      const x = index % width;
      const y = Math.floor(index / width);
      for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]] as const) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const neighbor = ny * width + nx;
        if (!visited[neighbor] && tiles[neighbor] === terrain) {
          visited[neighbor] = 1;
          queue.push(neighbor);
        }
      }
    }

    const inComponent = new Set(component);
    const edges: Edge[] = [];
    for (const index of component) {
      const x = index % width;
      const y = Math.floor(index / width);
      const contains = (nx: number, ny: number) => (
        nx >= 0 && ny >= 0 && nx < width && ny < height &&
        inComponent.has(ny * width + nx)
      );
      if (!contains(x, y - 1)) edges.push({ start: { x, y }, end: { x: x + 1, y } });
      if (!contains(x + 1, y)) edges.push({ start: { x: x + 1, y }, end: { x: x + 1, y: y + 1 } });
      if (!contains(x, y + 1)) edges.push({ start: { x: x + 1, y: y + 1 }, end: { x, y: y + 1 } });
      if (!contains(x - 1, y)) edges.push({ start: { x, y: y + 1 }, end: { x, y } });
    }

    const byStart = new Map<string, number[]>();
    edges.forEach((edge, index) => {
      const edgeKey = key(edge.start);
      byStart.set(edgeKey, [...(byStart.get(edgeKey) ?? []), index]);
    });
    const unused = new Set(edges.map((_, index) => index));
    while (unused.size) {
      const firstIndex = unused.values().next().value as number;
      const first = edges[firstIndex];
      const ring: SurfacePoint[] = [{ ...first.start }];
      let edgeIndex = firstIndex;
      while (unused.delete(edgeIndex)) {
        const end = edges[edgeIndex].end;
        if (key(end) === key(first.start)) break;
        ring.push({ ...end });
        const next = (byStart.get(key(end)) ?? []).find((candidate) => unused.has(candidate));
        if (next == null) break;
        edgeIndex = next;
      }
      if (ring.length >= 3) contours.push({ terrain, points: smoothClosedContour(ring) });
    }
  }
  return contours;
}
