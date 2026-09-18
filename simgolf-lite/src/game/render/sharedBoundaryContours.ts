import type { SurfacePoint, Terrain } from "../models/types";

export interface SharedBoundaryComponentInput {
  readonly id: number;
  readonly terrain: Terrain;
  readonly cells: readonly number[];
}

export interface SharedBoundaryOptions {
  readonly cornerRadius: number;
  readonly cornerSegments: number;
}

export interface SharedBoundaryEdge {
  /** Stable grid-edge identity. Each physical terrain seam appears once. */
  readonly key: string;
  readonly start: SurfacePoint;
  readonly end: SurfacePoint;
  /** Owner when traversing start -> end with its cells on the right. */
  readonly forwardComponentId: number | null;
  /** Owner when traversing end -> start with its cells on the right. */
  readonly reverseComponentId: number | null;
}

export interface SharedBoundarySeam {
  /** The unordered component pair which owns this presentation seam. */
  readonly componentIds: readonly [number, number];
  /**
   * Samples in the direction whose component id is the smaller member of the
   * pair. The other component consumes this exact array in reverse.
   */
  readonly samples: readonly SurfacePoint[];
  /** A pair can meet at a junction (open) or surround an island (closed). */
  readonly closed: boolean;
}

export interface SharedBoundaryResult {
  /** Presentation rings keyed by the caller's component id. */
  readonly ringsByComponent: ReadonlyMap<number, SurfacePoint[][]>;
  /** One record per unordered grid seam, reused in reverse by its neighbour. */
  readonly edges: readonly SharedBoundaryEdge[];
  /** Pair-owned, canonical presentation seams. Perimeter edges are omitted. */
  readonly seams: readonly SharedBoundarySeam[];
}

interface DirectedEdgeUse {
  readonly edgeIndex: number;
  readonly start: SurfacePoint;
  readonly end: SurfacePoint;
  readonly direction: 0 | 1 | 2 | 3;
}

const pointKey = (point: SurfacePoint) => `${point.x},${point.y}`;

const directionOf = (start: SurfacePoint, end: SurfacePoint): 0 | 1 | 2 | 3 => {
  if (end.x > start.x) return 0;
  if (end.y > start.y) return 1;
  if (end.x < start.x) return 2;
  return 3;
};

function signedArea(ring: readonly SurfacePoint[]): number {
  let area = 0;
  for (let index = 0; index < ring.length; index++) {
    const point = ring[index];
    const next = ring[(index + 1) % ring.length];
    area += point.x * next.y - next.x * point.y;
  }
  return area / 2;
}

function buildEdges(
  components: readonly SharedBoundaryComponentInput[],
  width: number,
  height: number,
): {
  edges: SharedBoundaryEdge[];
  ownerByCell: Int32Array;
  usesByComponent: ReadonlyMap<number, DirectedEdgeUse[]>;
} {
  const ownerByCell = new Int32Array(width * height);
  ownerByCell.fill(-1);
  for (const component of components) {
    for (const cell of component.cells) ownerByCell[cell] = component.id;
  }

  const edges: SharedBoundaryEdge[] = [];
  const usesByComponent = new Map<number, DirectedEdgeUse[]>();
  const addEdge = (edge: SharedBoundaryEdge) => {
    const edgeIndex = edges.length;
    edges.push(edge);
    if (edge.forwardComponentId != null) {
      const bucket = usesByComponent.get(edge.forwardComponentId) ?? [];
      bucket.push({
        edgeIndex,
        start: edge.start,
        end: edge.end,
        direction: directionOf(edge.start, edge.end),
      });
      usesByComponent.set(edge.forwardComponentId, bucket);
    }
    if (edge.reverseComponentId != null) {
      const bucket = usesByComponent.get(edge.reverseComponentId) ?? [];
      bucket.push({
        edgeIndex,
        start: edge.end,
        end: edge.start,
        direction: directionOf(edge.end, edge.start),
      });
      usesByComponent.set(edge.reverseComponentId, bucket);
    }
  };
  // Horizontal grid edges are canonical left -> right. The cell below is on
  // the right of that traversal and the cell above reuses it in reverse.
  for (let y = 0; y <= height; y++) {
    for (let x = 0; x < width; x++) {
      const above = y > 0 ? ownerByCell[(y - 1) * width + x] : -1;
      const below = y < height ? ownerByCell[y * width + x] : -1;
      if (above === below) continue;
      addEdge({
        key: `h:${x},${y}`,
        start: { x, y },
        end: { x: x + 1, y },
        forwardComponentId: below >= 0 ? below : null,
        reverseComponentId: above >= 0 ? above : null,
      });
    }
  }
  // Vertical grid edges are canonical top -> bottom. The cell to the left is
  // on the right in y-down world coordinates; the right cell reuses reverse.
  for (let x = 0; x <= width; x++) {
    for (let y = 0; y < height; y++) {
      const left = x > 0 ? ownerByCell[y * width + x - 1] : -1;
      const right = x < width ? ownerByCell[y * width + x] : -1;
      if (left === right) continue;
      addEdge({
        key: `v:${x},${y}`,
        start: { x, y },
        end: { x, y: y + 1 },
        forwardComponentId: left >= 0 ? left : null,
        reverseComponentId: right >= 0 ? right : null,
      });
    }
  }
  return { edges, ownerByCell, usesByComponent };
}

function chainUses(uses: readonly DirectedEdgeUse[]): DirectedEdgeUse[][] {
  const byStart = new Map<string, number[]>();
  uses.forEach((edge, index) => {
    const candidates = byStart.get(pointKey(edge.start)) ?? [];
    candidates.push(index);
    byStart.set(pointKey(edge.start), candidates);
  });
  const unused = new Set(uses.map((_, index) => index));
  const rings: DirectedEdgeUse[][] = [];
  while (unused.size > 0) {
    const firstIndex = unused.values().next().value as number;
    const first = uses[firstIndex];
    const ring: DirectedEdgeUse[] = [];
    let currentIndex = firstIndex;
    while (unused.delete(currentIndex)) {
      const current = uses[currentIndex];
      ring.push(current);
      if (pointKey(current.end) === pointKey(first.start)) break;
      const candidates = (byStart.get(pointKey(current.end)) ?? [])
        .filter((candidate) => unused.has(candidate));
      if (candidates.length === 0) break;
      // Filled space is on the right. At a kissing vertex, the tightest
      // right-hand continuation keeps diagonal components as separate rings.
      const turnPriority = [1, 0, 3, 2];
      candidates.sort((a, b) => {
        const turnA = (uses[a].direction - current.direction + 4) % 4;
        const turnB = (uses[b].direction - current.direction + 4) % 4;
        return turnPriority.indexOf(turnA) - turnPriority.indexOf(turnB);
      });
      currentIndex = candidates[0];
    }
    if (ring.length >= 3) rings.push(ring);
  }
  return rings;
}

function pointsForUses(uses: readonly DirectedEdgeUse[]): SurfacePoint[] {
  if (uses.length === 0) return [];
  const points = [{ ...uses[0].start }];
  for (const use of uses) points.push({ ...use.end });
  return points;
}

function pairForUse(
  use: DirectedEdgeUse,
  edges: readonly SharedBoundaryEdge[],
): string | null {
  const edge = edges[use.edgeIndex];
  if (edge.forwardComponentId == null || edge.reverseComponentId == null) return null;
  const low = Math.min(edge.forwardComponentId, edge.reverseComponentId);
  const high = Math.max(edge.forwardComponentId, edge.reverseComponentId);
  return `${low}:${high}`;
}

function isUnitAxisEdge(start: SurfacePoint, end: SurfacePoint): "h" | "v" | null {
  const dx = Math.abs(end.x - start.x);
  const dy = Math.abs(end.y - start.y);
  if (dx === 1 && dy === 0) return "h";
  if (dx === 0 && dy === 1) return "v";
  return null;
}

/**
 * Collapse a run of alternating unit stair steps into a sub-cell polycurve.
 * Each moved vertex is a 1/4, 1/2, 1/4 local blend, so an orthogonal corner
 * moves by sqrt(1/8) tiles (< 0.5) and no authoritative cell changes owner.
 */
function smoothAlternatingOpenPath(path: readonly SurfacePoint[]): SurfacePoint[] {
  if (path.length < 4) return path.map((point) => ({ ...point }));
  const output: SurfacePoint[] = [{ ...path[0] }];
  let start = 0;
  while (start < path.length - 1) {
    let end = start + 1;
    let previousAxis = isUnitAxisEdge(path[start], path[end]);
    while (previousAxis && end < path.length - 1) {
      const nextAxis = isUnitAxisEdge(path[end], path[end + 1]);
      if (!nextAxis || nextAxis === previousAxis) break;
      previousAxis = nextAxis;
      end++;
    }
    if (end - start >= 3) {
      for (let index = start + 1; index < end; index++) {
        const previous = path[index - 1];
        const current = path[index];
        const next = path[index + 1];
        output.push({
          x: previous.x * 0.25 + current.x * 0.5 + next.x * 0.25,
          y: previous.y * 0.25 + current.y * 0.5 + next.y * 0.25,
        });
      }
      output.push({ ...path[end] });
      start = end;
      continue;
    }
    output.push({ ...path[end] });
    start = end;
  }
  return output;
}

function smoothAlternatingClosedPath(path: readonly SurfacePoint[]): SurfacePoint[] {
  if (path.length < 4) return path.map((point) => ({ ...point }));
  const axes = path.map((point, index) => isUnitAxisEdge(point, path[(index + 1) % path.length]));
  if (axes.some((axis) => axis == null)) {
    return path.map((point) => ({ ...point }));
  }
  const breakAt = axes.findIndex((axis, index) => axis === axes[(index + 1) % axes.length]);
  // Most closed component rings have at least one straight section. Rotate
  // there, smooth only its alternating sub-runs, then restore an implicit
  // closed ring. This avoids treating the entire island as one diagonal.
  if (breakAt >= 0) {
    const start = (breakAt + 1) % path.length;
    const open = Array.from({ length: path.length + 1 }, (_, index) => ({
      ...path[(start + index) % path.length],
    }));
    return smoothAlternatingOpenPath(open).slice(0, -1);
  }
  return path.map((current, index) => {
    const previous = path[(index - 1 + path.length) % path.length];
    const next = path[(index + 1) % path.length];
    return {
      x: previous.x * 0.25 + current.x * 0.5 + next.x * 0.25,
      y: previous.y * 0.25 + current.y * 0.5 + next.y * 0.25,
    };
  });
}

function smoothSeamPoints(points: readonly SurfacePoint[], closed: boolean): SurfacePoint[] {
  if (closed) return smoothAlternatingClosedPath(points);
  return smoothAlternatingOpenPath(points);
}

function reconstructSharedRing(
  uses: readonly DirectedEdgeUse[],
  edges: readonly SharedBoundaryEdge[],
): SurfacePoint[] {
  if (uses.length === 0) return [];
  const pairs = uses.map((use) => pairForUse(use, edges));
  // Start at a pair boundary. This leaves every internal pair run as one
  // contiguous slice, including seams that meet at a three-way junction.
  let start = pairs.findIndex((pair, index) => pair !== pairs[(index - 1 + pairs.length) % pairs.length]);
  if (start < 0) start = 0;
  const ordered = uses.map((_, index) => uses[(start + index) % uses.length]);
  const orderedPairs = pairs.map((_, index) => pairs[(start + index) % pairs.length]);
  const output: SurfacePoint[] = [];
  for (let cursor = 0; cursor < ordered.length;) {
    const pair = orderedPairs[cursor];
    let end = cursor + 1;
    while (end < ordered.length && orderedPairs[end] === pair) end++;
    const segment = ordered.slice(cursor, end);
    const points = pointsForUses(segment);
    const samples = pair == null
      ? points
      : smoothSeamPoints(points, segment.length === ordered.length && pair != null);
    for (let index = 0; index < samples.length; index++) {
      const point = samples[index];
      const previous = output[output.length - 1];
      if (!previous || previous.x !== point.x || previous.y !== point.y) output.push(point);
    }
    cursor = end;
  }
  // The assembled ring is implicit; do not retain a duplicated closing point.
  if (output.length > 1) {
    const first = output[0];
    const last = output[output.length - 1];
    if (first.x === last.x && first.y === last.y) output.pop();
  }
  return output;
}

function buildCanonicalSeams(edges: readonly SharedBoundaryEdge[]): SharedBoundarySeam[] {
  const usesByPair = new Map<string, DirectedEdgeUse[]>();
  for (let edgeIndex = 0; edgeIndex < edges.length; edgeIndex++) {
    const edge = edges[edgeIndex];
    if (edge.forwardComponentId == null || edge.reverseComponentId == null) continue;
    const low = Math.min(edge.forwardComponentId, edge.reverseComponentId);
    const high = Math.max(edge.forwardComponentId, edge.reverseComponentId);
    const canonicalForward = edge.forwardComponentId === low;
    const uses = usesByPair.get(`${low}:${high}`) ?? [];
    uses.push({
      edgeIndex,
      start: canonicalForward ? edge.start : edge.end,
      end: canonicalForward ? edge.end : edge.start,
      direction: canonicalForward
        ? directionOf(edge.start, edge.end)
        : directionOf(edge.end, edge.start),
    });
    usesByPair.set(`${low}:${high}`, uses);
  }
  const seams: SharedBoundarySeam[] = [];
  for (const [pair, uses] of [...usesByPair].sort(([a], [b]) => a.localeCompare(b))) {
    const [low, high] = pair.split(":").map(Number) as [number, number];
    for (const chain of chainUses(uses)) {
      const closed = pointKey(chain[0].start) === pointKey(chain[chain.length - 1].end);
      const raw = pointsForUses(chain);
      seams.push({
        componentIds: [low, high],
        samples: smoothSeamPoints(closed ? raw.slice(0, -1) : raw, closed),
        closed,
      });
    }
  }
  return seams;
}

/**
 * Builds the presentation boundary contract for a whole tile grid. Physical
 * grid seams are enumerated once, then each neighbour receives the same edge
 * in the opposite direction. Rounded corner samples are likewise cached in a
 * canonical direction before either component receives them.
 */
export function buildSharedBoundaryContours(
  tiles: readonly Terrain[],
  width: number,
  height: number,
  components: readonly SharedBoundaryComponentInput[],
  options: SharedBoundaryOptions,
): SharedBoundaryResult {
  // The options remain part of the public cache contract. Canonical seams do
  // not independently round corners; their sub-cell reconstruction is fixed.
  void options;
  if (width <= 0 || height <= 0 || tiles.length !== width * height) {
    return { ringsByComponent: new Map(), edges: [], seams: [] };
  }
  const { edges, usesByComponent } = buildEdges(components, width, height);
  const ringsByComponent = new Map<number, SurfacePoint[][]>();
  for (const component of components) {
    const rings = chainUses(usesByComponent.get(component.id) ?? [])
      .map((uses) => reconstructSharedRing(uses, edges))
      .sort((a, b) => Math.abs(signedArea(b)) - Math.abs(signedArea(a)));
    ringsByComponent.set(component.id, rings);
  }
  return { ringsByComponent, edges, seams: buildCanonicalSeams(edges) };
}
