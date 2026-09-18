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

export interface SharedBoundaryResult {
  /** Presentation rings keyed by the caller's component id. */
  readonly ringsByComponent: ReadonlyMap<number, SurfacePoint[][]>;
  /** One record per unordered grid seam, reused in reverse by its neighbour. */
  readonly edges: readonly SharedBoundaryEdge[];
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

function chainRings(uses: readonly DirectedEdgeUse[]): SurfacePoint[][] {
  const byStart = new Map<string, number[]>();
  uses.forEach((edge, index) => {
    const candidates = byStart.get(pointKey(edge.start)) ?? [];
    candidates.push(index);
    byStart.set(pointKey(edge.start), candidates);
  });
  const unused = new Set(uses.map((_, index) => index));
  const rings: SurfacePoint[][] = [];
  while (unused.size > 0) {
    const firstIndex = unused.values().next().value as number;
    const first = uses[firstIndex];
    const ring: SurfacePoint[] = [{ ...first.start }];
    let currentIndex = firstIndex;
    while (unused.delete(currentIndex)) {
      const current = uses[currentIndex];
      if (pointKey(current.end) === pointKey(first.start)) break;
      ring.push({ ...current.end });
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

function vertexHasSafeClearance(
  ownerByCell: Int32Array,
  width: number,
  height: number,
  vx: number,
  vy: number,
): boolean {
  // The map perimeter remains exact so the surround can never show through.
  if (vx <= 0 || vy <= 0 || vx >= width || vy >= height) return false;
  const owners = new Set<number>();
  for (const [dx, dy] of [[-1, -1], [0, -1], [-1, 0], [0, 0]] as const) {
    owners.add(ownerByCell[(vy + dy) * width + vx + dx]);
  }
  // Exactly two component owners share a reversible corner. Checkerboard
  // pinches have 3–4 owners and stay sharp, keeping diagonal islands apart.
  return owners.size === 2;
}

function canonicalCornerArc(
  entry: SurfacePoint,
  corner: SurfacePoint,
  exit: SurfacePoint,
  segments: number,
  cache: Map<string, SurfacePoint[]>,
): SurfacePoint[] {
  const entryKey = pointKey(entry);
  const exitKey = pointKey(exit);
  const flipped = entryKey > exitKey;
  const start = flipped ? exit : entry;
  const end = flipped ? entry : exit;
  const key = `${pointKey(corner)}|${pointKey(start)}|${pointKey(end)}|${segments}`;
  let canonical = cache.get(key);
  if (!canonical) {
    canonical = [];
    for (let sample = 0; sample <= segments; sample++) {
      const t = sample / segments;
      const inverse = 1 - t;
      canonical.push({
        x: inverse * inverse * start.x + 2 * inverse * t * corner.x + t * t * end.x,
        y: inverse * inverse * start.y + 2 * inverse * t * corner.y + t * t * end.y,
      });
    }
    cache.set(key, canonical);
  }
  return (flipped ? [...canonical].reverse() : canonical).map((point) => ({ ...point }));
}

function roundSharedRing(
  ring: readonly SurfacePoint[],
  ownerByCell: Int32Array,
  width: number,
  height: number,
  options: SharedBoundaryOptions,
  cornerCache: Map<string, SurfacePoint[]>,
): SurfacePoint[] {
  const requestedRadius = Math.min(0.49, Math.max(0, options.cornerRadius));
  const segments = Math.max(1, Math.min(8, Math.round(options.cornerSegments)));
  if (ring.length < 3 || requestedRadius <= 0) return ring.map((point) => ({ ...point }));
  const rounded: SurfacePoint[] = [];
  for (let index = 0; index < ring.length; index++) {
    const previous = ring[(index - 1 + ring.length) % ring.length];
    const current = ring[index];
    const next = ring[(index + 1) % ring.length];
    const incomingLength = Math.hypot(current.x - previous.x, current.y - previous.y);
    const outgoingLength = Math.hypot(next.x - current.x, next.y - current.y);
    if (incomingLength <= 1e-6 || outgoingLength <= 1e-6) continue;
    if (!vertexHasSafeClearance(ownerByCell, width, height, current.x, current.y)) {
      rounded.push({ ...current });
      continue;
    }
    const radius = Math.min(
      requestedRadius,
      incomingLength * 0.49,
      outgoingLength * 0.49,
    );
    const entry = {
      x: current.x + (previous.x - current.x) / incomingLength * radius,
      y: current.y + (previous.y - current.y) / incomingLength * radius,
    };
    const exit = {
      x: current.x + (next.x - current.x) / outgoingLength * radius,
      y: current.y + (next.y - current.y) / outgoingLength * radius,
    };
    const arc = canonicalCornerArc(entry, current, exit, segments, cornerCache);
    for (const point of arc) {
      const last = rounded[rounded.length - 1];
      if (!last || last.x !== point.x || last.y !== point.y) rounded.push(point);
    }
  }
  return rounded;
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
  if (width <= 0 || height <= 0 || tiles.length !== width * height) {
    return { ringsByComponent: new Map(), edges: [] };
  }
  const { edges, ownerByCell, usesByComponent } = buildEdges(components, width, height);
  const ringsByComponent = new Map<number, SurfacePoint[][]>();
  const cornerCache = new Map<string, SurfacePoint[]>();
  for (const component of components) {
    const rings = chainRings(usesByComponent.get(component.id) ?? [])
      .map((ring) => roundSharedRing(
        ring,
        ownerByCell,
        width,
        height,
        options,
        cornerCache,
      ))
      .sort((a, b) => Math.abs(signedArea(b)) - Math.abs(signedArea(a)));
    ringsByComponent.set(component.id, rings);
  }
  return { ringsByComponent, edges };
}
