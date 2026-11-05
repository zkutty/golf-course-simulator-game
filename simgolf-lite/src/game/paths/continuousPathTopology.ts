import type { Point } from '../models/types';
import type { ContinuousPathEdge, ContinuousPathInput, ContinuousPathNode } from './continuousPathPlan';
import { sampleCorridor } from '../models/surfaceIntent';

const EPS = 1e-7;
const key = (p: Point) => `${Math.round(p.x * 1e7)},${Math.round(p.y * 1e7)}`;
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const mix = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const cellPoint = (cell: number, width: number): Point => ({ x: cell % width + .5, y: Math.floor(cell / width) + .5 });
const pairKey = (a: string, b: string) => a < b ? `${a}|${b}` : `${b}|${a}`;

export interface PathChain {
  points: Point[];
  coverage: number[];
  width: number;
  featureIds: string[];
  source: 'intent' | 'tiles';
  closed?: boolean;
}

/** Exact parameter interval of a segment inside one closed tile square. */
function tileInterval(a: Point, b: Point, x: number, y: number): [number, number] | null {
  let lo = 0; let hi = 1;
  for (const [start, delta, min, max] of [[a.x, b.x - a.x, x, x + 1], [a.y, b.y - a.y, y, y + 1]]) {
    if (Math.abs(delta) < EPS) { if (start < min - EPS || start > max + EPS) return null; continue; }
    const t0 = (min - start) / delta; const t1 = (max - start) / delta;
    lo = Math.max(lo, Math.min(t0, t1)); hi = Math.min(hi, Math.max(t0, t1));
    if (lo > hi + EPS) return null;
  }
  return hi - lo > EPS ? [lo, hi] : null;
}

/** A lattice-corner contact joins only through locally shared cardinal land. */
function cornerJoinAllowed(before: Point, at: Point, after: Point, cells: ReadonlySet<number>, width: number, height: number): boolean {
  const x = Math.round(at.x); const y = Math.round(at.y);
  if (Math.abs(at.x - x) > EPS || Math.abs(at.y - y) > EPS) return true;
  const local = [[x - 1, y - 1], [x, y - 1], [x - 1, y], [x, y]].filter(([cx, cy]) => cx >= 0 && cy >= 0 && cx < width && cy < height && cells.has(cy * width + cx));
  const nearby = (toward: Point) => {
    const length = distance(at, toward); const p = mix(at, toward, length > EPS ? Math.min(1, 1e-4 / length) : 0);
    return local.filter(([cx, cy]) => p.x >= cx - EPS && p.x <= cx + 1 + EPS && p.y >= cy - EPS && p.y <= cy + 1 + EPS).map(([cx, cy]) => cy * width + cx);
  };
  const starts = nearby(before); const targets = new Set(nearby(after)); const visited = new Set(starts); const queue = [...starts];
  for (let i = 0; i < queue.length; i++) {
    if (targets.has(queue[i])) return true;
    const cx = queue[i] % width; const cy = Math.floor(queue[i] / width);
    for (const [nx, ny] of local) if (Math.abs(nx - cx) + Math.abs(ny - cy) === 1) { const next = ny * width + nx; if (!visited.has(next)) { visited.add(next); queue.push(next); } }
  }
  return false;
}

const trimCorner = (point: Point, toward: Point): Point => mix(point, toward, Math.min(1, 1e-6 / distance(point, toward)));

export function legalSegmentIntervals(a: Point, b: Point, coverage: ReadonlySet<number>, width: number, height: number): [number, number][] {
  const intervals: [number, number][] = [];
  for (let y = Math.max(0, Math.floor(Math.min(a.y, b.y) - EPS)); y <= Math.min(height - 1, Math.floor(Math.max(a.y, b.y))); y++) {
    for (let x = Math.max(0, Math.floor(Math.min(a.x, b.x) - EPS)); x <= Math.min(width - 1, Math.floor(Math.max(a.x, b.x))); x++) {
      if (!coverage.has(y * width + x)) continue;
      const interval = tileInterval(a, b, x, y); if (interval) intervals.push(interval);
    }
  }
  intervals.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: [number, number][] = [];
  for (const interval of intervals) {
    const previous = merged.at(-1);
    if (previous && interval[0] <= previous[1] + EPS
      && (interval[0] < previous[1] - EPS || cornerJoinAllowed(a, mix(a, b, previous[1]), b, coverage, width, height))) previous[1] = Math.max(previous[1], interval[1]);
    else merged.push([...interval]);
  }
  return merged;
}

function legalSegment(a: Point, b: Point, cells: ReadonlySet<number>, width: number, height: number): boolean {
  if (distance(a, b) < EPS) return legalPoint(a, cells, width, height);
  const intervals = legalSegmentIntervals(a, b, cells, width, height);
  return intervals.length === 1 && intervals[0][0] <= EPS && intervals[0][1] >= 1 - EPS;
}

function legalPoint(p: Point, cells: ReadonlySet<number>, width: number, height: number): boolean {
  for (let y = Math.max(0, Math.floor(p.y - EPS)); y <= Math.min(height - 1, Math.floor(p.y)); y++) {
    for (let x = Math.max(0, Math.floor(p.x - EPS)); x <= Math.min(width - 1, Math.floor(p.x)); x++) if (cells.has(y * width + x)) return true;
  }
  return false;
}

export function resamplePath(points: readonly Point[]): Point[] {
  const result: Point[] = [];
  for (let i = 0; i < points.length; i++) {
    if (!i) { result.push({ ...points[i] }); continue; }
    const d = distance(points[i - 1], points[i]); if (d < EPS) continue;
    const divisions = Math.ceil(d / .2);
    for (let part = 1; part <= divisions; part++) result.push(mix(points[i - 1], points[i], part / divisions));
  }
  return result;
}

function clipChain(chain: PathChain, allowed: ReadonlySet<number>, width: number, height: number): PathChain[] {
  if (chain.points.length === 1) return legalPoint(chain.points[0], allowed, width, height) ? [{ ...chain, coverage: [...allowed] }] : [];
  const result: PathChain[] = []; let current: Point[] = [];
  const flush = () => { if (current.length > 1) result.push({ ...chain, points: resamplePath(current), closed: key(current[0]) === key(current.at(-1)!), coverage: [...allowed].sort((a, b) => a - b) }); current = []; };
  for (let i = 1; i < chain.points.length; i++) {
    const a = chain.points[i - 1]; const b = chain.points[i];
    const intervals = legalSegmentIntervals(a, b, allowed, width, height);
    if (!intervals.length) { flush(); continue; }
    for (const [lo, hi] of intervals) {
      let start = mix(a, b, lo); let end = mix(a, b, hi);
      if (lo > EPS && !cornerJoinAllowed(a, start, b, allowed, width, height)) start = trimCorner(start, end);
      if (hi < 1 - EPS && !cornerJoinAllowed(a, end, b, allowed, width, height)) end = trimCorner(end, start);
      if (current.length > 1 && distance(current.at(-1)!, start) <= EPS
        && !cornerJoinAllowed(current.at(-2)!, start, end, allowed, width, height)) {
        current[current.length - 1] = trimCorner(current.at(-1)!, current.at(-2)!); flush(); start = trimCorner(start, end);
      }
      if (current.length && distance(current.at(-1)!, start) > EPS) flush();
      if (!current.length) current.push(start);
      if (distance(current.at(-1)!, end) > EPS) current.push(end);
      if (hi < 1 - EPS) flush();
    }
  }
  flush(); return result;
}

function components(cells: ReadonlySet<number>, width: number, height: number): number[][] {
  const remaining = new Set([...cells].sort((a, b) => a - b)); const result: number[][] = [];
  while (remaining.size) {
    const seed = remaining.values().next().value!; remaining.delete(seed); const part = [seed];
    for (let i = 0; i < part.length; i++) {
      const x = part[i] % width; const y = Math.floor(part[i] / width);
      for (const [dx, dy] of [[0, -1], [-1, 0], [1, 0], [0, 1]]) {
        const nx = x + dx; const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const next = ny * width + nx; if (remaining.delete(next)) part.push(next);
      }
    }
    result.push(part.sort((a, b) => a - b));
  }
  return result;
}

/** Zhang–Suen two-subiteration thinning, performed separately on cardinal components. */
function thin(component: readonly number[], width: number): Set<number> {
  const pixels = new Set(component);
  const original = new Set(component);
  // A one-cell staircase's tip has a redundant diagonal neighbor. Protect
  // cardinal endpoints explicitly so 8-neighbor thinning cannot eat a route.
  const protectedEnds = new Set(component.filter((cell) => {
    const x = cell % width;
    return [cell - width, cell + width, ...(x > 0 ? [cell - 1] : []), ...(x + 1 < width ? [cell + 1] : [])].filter((next) => original.has(next)).length <= 1;
  }));
  const offsets = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];
  let changed = true;
  while (changed) {
    changed = false;
    for (let pass = 0; pass < 2; pass++) {
      const remove: number[] = [];
      for (const cell of [...pixels].sort((a, b) => a - b)) {
        if (protectedEnds.has(cell)) continue;
        const x = cell % width; const y = Math.floor(cell / width);
        const n: number[] = offsets.map(([dx, dy]) => x + dx >= 0 && x + dx < width && y + dy >= 0 && pixels.has((y + dy) * width + x + dx) ? 1 : 0);
        const count = n.reduce((a, b) => a + b, 0);
        if (count < 2 || count > 6) continue;
        const transitions = n.reduce((sum, value, i) => sum + (value === 0 && n[(i + 1) % 8] === 1 ? 1 : 0), 0);
        if (transitions !== 1) continue;
        if (pass === 0 ? n[0] * n[2] * n[4] || n[2] * n[4] * n[6] : n[0] * n[2] * n[6] || n[0] * n[4] * n[6]) continue;
        remove.push(cell);
      }
      // A fully symmetric even brush (notably 2x2) can satisfy every
      // parallel deletion predicate at once. Keep its most medial remaining
      // cell before applying the subpass, rather than inventing a pad after
      // an empty skeleton. Other components retain their existing thinning.
      if (remove.length === pixels.size && remove.length) {
        const center = [...pixels].reduce((sum, cell) => ({ x: sum.x + cell % width, y: sum.y + Math.floor(cell / width) }), { x: 0, y: 0 });
        center.x /= pixels.size; center.y /= pixels.size;
        const anchor = [...pixels].sort((a, b) => {
          const da = (a % width - center.x) ** 2 + (Math.floor(a / width) - center.y) ** 2;
          const db = (b % width - center.x) ** 2 + (Math.floor(b / width) - center.y) ** 2;
          return da - db || a - b;
        })[0];
        remove.splice(remove.indexOf(anchor), 1);
      }
      for (const cell of remove) pixels.delete(cell);
      if (remove.length) changed = true;
    }
  }
  return pixels;
}

function tileChains(component: readonly number[], width: number, height: number, visibleWidth: number): PathChain[] {
  const activeCells = new Set(component);
  const pixels = thin(component, width); const adjacency = new Map<number, number[]>();
  for (const cell of pixels) {
    const x = cell % width; const y = Math.floor(cell / width); const neighbors: number[] = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if ((!dx && !dy) || x + dx < 0 || x + dx >= width || y + dy < 0 || y + dy >= height) continue;
      const next = (y + dy) * width + x + dx;
      if (!pixels.has(next)) continue;
      // Redundant diagonal edges create triangles at every L/T. A diagonal is
      // needed only after thinning removes both intermediate cardinal pixels.
      if (dx && dy) {
        const a = y * width + x + dx; const b = (y + dy) * width + x;
        if ((!activeCells.has(a) && !activeCells.has(b)) || pixels.has(a) || pixels.has(b)) continue;
      }
      neighbors.push(next);
    }
    adjacency.set(cell, neighbors.sort((a, b) => a - b));
  }
  const nodeOf = new Map<number, number>(); const clusters = new Map<number, number[]>();
  for (const cell of [...pixels].sort((a, b) => a - b)) {
    if (nodeOf.has(cell) || adjacency.get(cell)!.length === 2) continue;
    const cluster = [cell]; nodeOf.set(cell, cell);
    if (adjacency.get(cell)!.length > 2) for (let i = 0; i < cluster.length; i++) {
      for (const next of adjacency.get(cluster[i])!) if (!nodeOf.has(next) && adjacency.get(next)!.length > 2) { nodeOf.set(next, cell); cluster.push(next); }
    }
    clusters.set(cell, cluster);
  }
  const visited = new Set<string>(); const lines: Point[][] = [];
  const edgeKey = (a: number, b: number) => pairKey(String(a), String(b));
  for (const [root, cluster] of clusters) {
    if (adjacency.get(root)!.length === 0) { lines.push([cellPoint(root, width)]); continue; }
    for (const cell of cluster) for (const first of adjacency.get(cell)!) {
      if (nodeOf.get(first) === root || visited.has(edgeKey(cell, first))) continue;
      const points = [cellPoint(root, width)]; let previous = cell; let cursor = first;
      visited.add(edgeKey(previous, cursor));
      while (true) {
        if (nodeOf.has(cursor)) { points.push(cellPoint(nodeOf.get(cursor)!, width)); break; }
        points.push(cellPoint(cursor, width));
        const next = adjacency.get(cursor)!.find((candidate) => candidate !== previous);
        if (next == null || visited.has(edgeKey(cursor, next))) break;
        visited.add(edgeKey(cursor, next)); previous = cursor; cursor = next;
      }
      if (points.length > 1) lines.push(points);
    }
  }
  for (const seed of [...pixels].sort((a, b) => a - b)) for (const first of adjacency.get(seed)!) {
    if (visited.has(edgeKey(seed, first)) || nodeOf.has(seed)) continue;
    const points = [cellPoint(seed, width)]; let previous = seed; let cursor = first;
    while (true) {
      visited.add(edgeKey(previous, cursor)); points.push(cellPoint(cursor, width)); if (cursor === seed) break;
      const next = adjacency.get(cursor)!.find((candidate) => candidate !== previous && !visited.has(edgeKey(cursor, candidate)));
      if (next == null) break; previous = cursor; cursor = next;
    }
    lines.push(points);
  }
  const allowed = new Set(component);
  return lines.map((original) => {
    const closed = original.length > 2 && key(original[0]) === key(original.at(-1)!);
    let points = original;
    for (let pass = 0; pass < 2 && points.length > 2; pass++) {
      const source = closed ? points.slice(0, -1) : points;
      const candidate: Point[] = closed ? [] : [{ ...source[0] }];
      for (let i = 0; i < source.length - (closed ? 0 : 1); i++) {
        const a = source[i]; const b = source[(i + 1) % source.length]; candidate.push(mix(a, b, .25), mix(a, b, .75));
      }
      if (closed) candidate.push({ ...candidate[0] }); else candidate.push({ ...source.at(-1)! });
      if (candidate.every((point, i) => !i || legalSegment(candidate[i - 1], point, allowed, width, height))) points = candidate;
    }
    return { points: resamplePath(points), coverage: [...component], width: visibleWidth, source: 'tiles', featureIds: [], closed };
  });
}

function closestOnSegment(point: Point, a: Point, b: Point): Point {
  const dx = b.x - a.x; const dy = b.y - a.y; const length2 = dx * dx + dy * dy;
  return mix(a, b, length2 > EPS ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length2)) : 0);
}

/** Saved authored geometry is retained; fallback fills only unrepresented cells. */
export function buildPathChains(course: ContinuousPathInput, coverage: readonly number[], factor: number, defaultWidth: number): { chains: PathChain[]; clippedBreakCount: number } {
  const active = new Set(coverage); const represented = new Set<number>(); const saved: PathChain[] = []; let clippedBreakCount = 0;
  const features = [...(course.surfaceIntent?.features ?? [])].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  for (const feature of features) {
    if (feature.terrain !== 'path' || feature.geometry.kind !== 'corridor') continue;
    const geometry = feature.geometry;
    if (!Number.isFinite(geometry.width) || geometry.width <= 0 || !geometry.knots.length || !geometry.knots.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))) continue;
    const allowed = new Set(feature.coverage.filter((cell) => active.has(cell)));
    if (!allowed.size) continue;
    const points = sampleCorridor(geometry.knots, .2, geometry.tangents);
    const parts = clipChain({ points, coverage: [...allowed], width: factor * geometry.width, featureIds: [feature.id], source: 'intent' }, allowed, course.width, course.height);
    if (!parts.length) continue;
    saved.push(...parts); for (const cell of allowed) represented.add(cell);
    clippedBreakCount += Math.max(0, parts.length - 1);
  }
  const uncovered = new Set(coverage.filter((cell) => !represented.has(cell))); const fallback: PathChain[] = [];
  for (const component of components(active, course.width, course.height)) {
    for (const chain of tileChains(component, course.width, course.height, defaultWidth)) {
      const parts = represented.size ? clipChain(chain, uncovered, course.width, course.height) : [chain];
      fallback.push(...parts);
    }
  }
  // A legacy branch adjacent to authored coverage needs an actual graph link,
  // rather than two merely overlapping decals. Connections must be legal in
  // the authoritative union and terminate on the nearest authored segment.
  const links: PathChain[] = [];
  for (const chain of fallback) {
    if (chain.closed || !saved.length) continue;
    for (const endpoint of [chain.points[0], chain.points.at(-1)!]) {
      let closest: Point | null = null; let best = Infinity;
      for (const intent of saved) for (let i = 1; i < intent.points.length; i++) {
        const candidate = closestOnSegment(endpoint, intent.points[i - 1], intent.points[i]); const d = distance(endpoint, candidate);
        if (d < best && legalSegment(endpoint, candidate, active, course.width, course.height)) { best = d; closest = candidate; }
      }
      if (closest && best > EPS && best <= 2) links.push({ ...chain, points: resamplePath([endpoint, closest]), coverage: [...coverage], closed: false });
    }
  }
  return { chains: [...saved, ...fallback, ...links], clippedBreakCount };
}

interface Segment { a: Point; b: Point; chain: PathChain; cuts: number[]; }
function cross(a: Point, b: Point): number { return a.x * b.y - a.y * b.x; }
function subtract(a: Point, b: Point): Point { return { x: a.x - b.x, y: a.y - b.y }; }

/** Split actual curve intersections, dedupe coincident segments, trace chains. */
export function pathGraph(chains: readonly PathChain[]): { nodes: ContinuousPathNode[]; edges: ContinuousPathEdge[] } {
  const segments: Segment[] = [];
  for (const chain of chains) for (let i = 1; i < chain.points.length; i++) if (distance(chain.points[i - 1], chain.points[i]) > EPS) segments.push({ a: chain.points[i - 1], b: chain.points[i], chain, cuts: [0, 1] });
  const bins = new Map<string, number[]>(); const compared = new Set<string>();
  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index];
    for (let y = Math.floor(Math.min(segment.a.y, segment.b.y)); y <= Math.floor(Math.max(segment.a.y, segment.b.y)); y++) for (let x = Math.floor(Math.min(segment.a.x, segment.b.x)); x <= Math.floor(Math.max(segment.a.x, segment.b.x)); x++) {
      const binKey = `${x},${y}`; const previous = bins.get(binKey) ?? [];
      for (const otherIndex of previous) {
        const comparison = `${otherIndex}:${index}`; if (compared.has(comparison)) continue; compared.add(comparison);
        const other = segments[otherIndex]; const r = subtract(segment.b, segment.a); const s = subtract(other.b, other.a); const q = subtract(other.a, segment.a); const denominator = cross(r, s);
        if (Math.abs(denominator) > EPS * EPS) {
          const t = cross(q, s) / denominator; const u = cross(q, r) / denominator;
          if (t >= -EPS && t <= 1 + EPS && u >= -EPS && u <= 1 + EPS) { segment.cuts.push(Math.max(0, Math.min(1, t))); other.cuts.push(Math.max(0, Math.min(1, u))); }
        } else if (Math.abs(cross(q, r)) < EPS * EPS) {
          for (const p of [other.a, other.b]) { const projection = closestOnSegment(p, segment.a, segment.b); if (distance(p, projection) < EPS) segment.cuts.push(distance(segment.a, projection) / distance(segment.a, segment.b)); }
          for (const p of [segment.a, segment.b]) { const projection = closestOnSegment(p, other.a, other.b); if (distance(p, projection) < EPS) other.cuts.push(distance(other.a, projection) / distance(other.a, other.b)); }
        }
      }
      previous.push(index); bins.set(binKey, previous);
    }
  }
  const positions = new Map<string, Point>(); const adjacency = new Map<string, Set<string>>(); const metadata = new Map<string, PathChain[]>();
  const addPoint = (p: Point) => { const id = key(p); if (!positions.has(id)) positions.set(id, { ...p }); if (!adjacency.has(id)) adjacency.set(id, new Set()); return id; };
  for (const chain of chains) if (chain.points.length === 1) addPoint(chain.points[0]);
  for (const segment of segments) {
    const cuts = [...new Set(segment.cuts.map((v) => Math.round(v * 1e10) / 1e10))].sort((a, b) => a - b);
    for (let i = 1; i < cuts.length; i++) {
      const a = addPoint(mix(segment.a, segment.b, cuts[i - 1])); const b = addPoint(mix(segment.a, segment.b, cuts[i])); if (a === b) continue;
      adjacency.get(a)!.add(b); adjacency.get(b)!.add(a); const id = pairKey(a, b); const list = metadata.get(id) ?? []; if (!list.includes(segment.chain)) list.push(segment.chain); metadata.set(id, list);
    }
  }
  const comparePointIds = (a: string, b: string) => positions.get(a)!.y - positions.get(b)!.y || positions.get(a)!.x - positions.get(b)!.x;
  const ordered = [...positions.keys()].sort(comparePointIds); const nodeIds = new Map<string, string>();
  const mutableNodes: { id: string; point: Point; kind: ContinuousPathNode['kind']; incidentEdgeIds: string[] }[] = [];
  const signature = (id: string) => [...new Set((metadata.get(id) ?? []).map((source) => JSON.stringify([source.width, source.source, [...source.featureIds].sort()])))].sort().join('|');
  for (const id of ordered) {
    const neighbors = [...adjacency.get(id)!]; const degree = neighbors.length;
    const transition = degree === 2 && signature(pairKey(id, neighbors[0])) !== signature(pairKey(id, neighbors[1]));
    if (degree === 2 && !transition) continue;
    const nodeId = `path-node:${id}`; nodeIds.set(id, nodeId);
    mutableNodes.push({ id: nodeId, point: { ...positions.get(id)! }, kind: degree === 0 ? 'isolated' : degree === 1 ? 'endpoint' : degree === 2 ? 'transition' : 'junction', incidentEdgeIds: [] });
  }
  const visited = new Set<string>(); const edges: ContinuousPathEdge[] = [];
  const trace = (start: string, next: string) => {
    const pointIds = [start]; const sources = new Set<PathChain>(); let previous = start; let cursor = next;
    while (true) {
      const segmentId = pairKey(previous, cursor); if (visited.has(segmentId)) break; visited.add(segmentId); for (const source of metadata.get(segmentId) ?? []) sources.add(source);
      pointIds.push(cursor); if (nodeIds.has(cursor) || cursor === start) break;
      const following = [...adjacency.get(cursor)!].sort(comparePointIds).find((id) => id !== previous && !visited.has(pairKey(cursor, id))); if (!following) break; previous = cursor; cursor = following;
    }
    const id = `path-edge:${edges.length}`; const closed = pointIds.at(-1) === start;
    const sourceList = [...sources]; const from = nodeIds.get(start) ?? null; const to = nodeIds.get(pointIds.at(-1)!) ?? null;
    const points = resamplePath(pointIds.map((pointId) => positions.get(pointId)!));
    edges.push({ id, fromNodeId: from, toNodeId: to, closed, source: sourceList.some((source) => source.source === 'intent') ? 'intent' : 'tiles', featureIds: [...new Set(sourceList.flatMap((source) => source.featureIds))].sort(), coverage: [...new Set(sourceList.flatMap((source) => source.coverage))].sort((a, b) => a - b), points, width: Math.max(...sourceList.map((source) => source.width)) });
    for (const node of mutableNodes) if (node.id === from || node.id === to) node.incidentEdgeIds.push(id);
  };
  for (const id of ordered.filter((id) => nodeIds.has(id))) for (const next of [...adjacency.get(id)!].sort(comparePointIds)) if (!visited.has(pairKey(id, next))) trace(id, next);
  for (const id of ordered) for (const next of [...adjacency.get(id)!].sort(comparePointIds)) if (!visited.has(pairKey(id, next))) trace(id, next);
  return { nodes: mutableNodes, edges };
}
