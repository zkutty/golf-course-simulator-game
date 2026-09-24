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

/** The dense sampler never permits a sharper visible turn than sixty degrees. */
export const SHARED_CONTOUR_MAXIMUM_TURN_RADIANS = Math.PI / 3;

/** Maximum chord length for the public corner-segment contract. */
export function sharedContourMaximumSegmentLength(options: SharedBoundaryOptions): number {
  return 1 / (Math.max(1, Math.min(8, Math.round(options.cornerSegments))) + 1);
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

function samePoint(a: SurfacePoint, b: SurfacePoint): boolean {
  return Math.abs(a.x - b.x) <= 1e-9 && Math.abs(a.y - b.y) <= 1e-9;
}

function appendPoint(output: SurfacePoint[], point: SurfacePoint) {
  // Pair owners may traverse a quadratic in opposite floating-point order.
  // Quantising only the render-space samples makes those two evaluations a
  // byte-equal reverse without changing the bounded visible curve.
  const stable = {
    x: Math.round(point.x * 1e9) / 1e9,
    y: Math.round(point.y * 1e9) / 1e9,
  };
  if (output.length === 0 || !samePoint(output[output.length - 1], stable)) output.push(stable);
}

function appendDenseLine(
  output: SurfacePoint[],
  from: SurfacePoint,
  to: SurfacePoint,
  maximumSegmentLength: number,
) {
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  const steps = Math.max(1, Math.ceil(length / maximumSegmentLength));
  for (let step = 1; step <= steps; step++) {
    const t = step / steps;
    appendPoint(output, {
      x: from.x + (to.x - from.x) * t,
      y: from.y + (to.y - from.y) * t,
    });
  }
}

/**
 * Builds a local quadratic corner arc for every turn in a pair-owned seam.
 * The radius is deliberately less than half of either adjacent edge, keeping
 * the curve in the boundary's local cell envelope: ownership centers, narrow
 * necks, and diagonal components remain unchanged. Straight spans are also
 * sampled so a medium/high mask never falls back to a coarse staircase.
 */
function buildDenseSharedCurve(
  path: readonly SurfacePoint[],
  closed: boolean,
  options: SharedBoundaryOptions,
): SurfacePoint[] {
  const source = path.length > 1 && samePoint(path[0], path[path.length - 1])
    ? path.slice(0, -1)
    : path;
  if (source.length < (closed ? 3 : 2)) return source.map((point) => ({ ...point }));

  const segments = Math.max(1, Math.min(8, Math.round(options.cornerSegments)));
  // Retain a meaningful arc even if callers provide an out-of-range radius,
  // while keeping it safely inside the half-cell containment envelope.
  const requestedRadius = Math.max(0, Math.min(0.45, options.cornerRadius));
  const maximumSegmentLength = sharedContourMaximumSegmentLength(options);
  const entries: SurfacePoint[] = source.map((point) => ({ ...point }));
  const exits: SurfacePoint[] = source.map((point) => ({ ...point }));
  const rounded = new Uint8Array(source.length);

  const firstTurn = closed ? 0 : 1;
  const lastTurn = closed ? source.length - 1 : source.length - 2;
  for (let index = firstTurn; index <= lastTurn; index++) {
    const previous = source[(index - 1 + source.length) % source.length];
    const current = source[index];
    const next = source[(index + 1) % source.length];
    const incomingLength = Math.hypot(current.x - previous.x, current.y - previous.y);
    const outgoingLength = Math.hypot(next.x - current.x, next.y - current.y);
    if (incomingLength <= 1e-8 || outgoingLength <= 1e-8) continue;
    const incoming = {
      x: (current.x - previous.x) / incomingLength,
      y: (current.y - previous.y) / incomingLength,
    };
    const outgoing = {
      x: (next.x - current.x) / outgoingLength,
      y: (next.y - current.y) / outgoingLength,
    };
    if (Math.abs(incoming.x * outgoing.y - incoming.y * outgoing.x) <= 1e-8) continue;
    const radius = Math.min(requestedRadius, incomingLength * 0.42, outgoingLength * 0.42);
    if (radius <= 1e-8) continue;
    entries[index] = {
      x: current.x - incoming.x * radius,
      y: current.y - incoming.y * radius,
    };
    exits[index] = {
      x: current.x + outgoing.x * radius,
      y: current.y + outgoing.y * radius,
    };
    rounded[index] = 1;
  }

  const output: SurfacePoint[] = [];
  let last: SurfacePoint;
  if (closed) {
    last = exits[source.length - 1];
    appendPoint(output, last);
    for (let index = 0; index < source.length; index++) {
      appendDenseLine(output, last, entries[index], maximumSegmentLength);
      if (rounded[index]) {
        const corner = source[index];
        for (let step = 1; step <= segments; step++) {
          const t = step / segments;
          appendPoint(output, {
            x: (1 - t) * (1 - t) * entries[index].x + 2 * (1 - t) * t * corner.x + t * t * exits[index].x,
            y: (1 - t) * (1 - t) * entries[index].y + 2 * (1 - t) * t * corner.y + t * t * exits[index].y,
          });
        }
      }
      last = exits[index];
    }
    // The mask contract is an implicit ring; remove the repeated start point.
    if (samePoint(output[0], output[output.length - 1])) output.pop();
    return output;
  }

  last = source[0];
  appendPoint(output, last);
  for (let index = 1; index < source.length - 1; index++) {
    appendDenseLine(output, last, entries[index], maximumSegmentLength);
    if (rounded[index]) {
      const corner = source[index];
      for (let step = 1; step <= segments; step++) {
        const t = step / segments;
        appendPoint(output, {
          x: (1 - t) * (1 - t) * entries[index].x + 2 * (1 - t) * t * corner.x + t * t * exits[index].x,
          y: (1 - t) * (1 - t) * entries[index].y + 2 * (1 - t) * t * corner.y + t * t * exits[index].y,
        });
      }
    }
    last = exits[index];
  }
  appendDenseLine(output, last, source[source.length - 1], maximumSegmentLength);
  return output;
}

function reconstructSharedRing(
  uses: readonly DirectedEdgeUse[],
  edges: readonly SharedBoundaryEdge[],
  options: SharedBoundaryOptions,
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
      : buildDenseSharedCurve(points, segment.length === ordered.length && pair != null, options);
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

function buildCanonicalSeams(
  edges: readonly SharedBoundaryEdge[],
  options: SharedBoundaryOptions,
): SharedBoundarySeam[] {
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
        samples: buildDenseSharedCurve(closed ? raw.slice(0, -1) : raw, closed, options),
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
  if (width <= 0 || height <= 0 || tiles.length !== width * height) {
    return { ringsByComponent: new Map(), edges: [], seams: [] };
  }
  const { edges, usesByComponent } = buildEdges(components, width, height);
  const ringsByComponent = new Map<number, SurfacePoint[][]>();
  for (const component of components) {
    const rings = chainUses(usesByComponent.get(component.id) ?? [])
      .map((uses) => reconstructSharedRing(uses, edges, options))
      .sort((a, b) => Math.abs(signedArea(b)) - Math.abs(signedArea(a)));
    ringsByComponent.set(component.id, rings);
  }
  return { ringsByComponent, edges, seams: buildCanonicalSeams(edges, options) };
}
