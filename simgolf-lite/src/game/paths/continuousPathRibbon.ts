import type { Point } from '../models/types';
import type { ContinuousPathLayer, PathRibbonRole } from './continuousPathPlan';
import type { PathChain } from './continuousPathTopology';

const EPS = 1e-8;
type Polygon = Point[];
interface Line { a: Point; b: Point; }
interface Interval { low: Line; high: Line; }
interface CellShapes { levels: [Polygon[], Polygon[], Polygon[]]; }
const yAt = (line: Line, x: number) => line.a.y + (line.b.y - line.a.y) * (x - line.a.x) / (line.b.x - line.a.x);
const pointKey = (p: Point) => `${Math.round(p.x * 1e7)},${Math.round(p.y * 1e7)}`;
const pointFromKey = (key: string): Point => { const [x, y] = key.split(',').map(Number); return { x: x / 1e7, y: y / 1e7 }; };
const area = (points: readonly Point[]) => points.reduce((sum, p, i) => { const q = points[(i + 1) % points.length]; return sum + p.x * q.y - p.y * q.x; }, 0) / 2;

/** Convex clipping is applied to the primitive, not just its vertices. */
function clipToTile(polygon: Polygon, x: number, y: number): Polygon {
  let points = polygon;
  for (const [axis, boundary, direction] of [['x', x, 1], ['x', x + 1, -1], ['y', y, 1], ['y', y + 1, -1]] as const) {
    const clipped: Point[] = [];
    for (let i = 0; i < points.length; i++) {
      const a = points[i]; const b = points[(i + 1) % points.length];
      const da = (a[axis] - boundary) * direction; const db = (b[axis] - boundary) * direction;
      if (da >= -EPS) clipped.push(a);
      if ((da > EPS && db < -EPS) || (da < -EPS && db > EPS)) {
        const t = (boundary - a[axis]) / (b[axis] - a[axis]); clipped.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      }
    }
    points = clipped; if (points.length < 3) return [];
  }
  return Math.abs(area(points)) > 1e-12 ? points : [];
}

function circle(center: Point, radius: number): Polygon {
  return Array.from({ length: 24 }, (_, i) => ({ x: center.x + Math.cos(i * Math.PI / 12) * radius, y: center.y + Math.sin(i * Math.PI / 12) * radius }));
}

/** Quads plus exterior circular sectors form a joined round-capped stroke. */
function strokePrimitives(chain: PathChain, radius: number): Polygon[] {
  const points = chain.points; if (!points.length) return [];
  if (points.length === 1) return [circle(points[0], radius)];
  const primitives: Polygon[] = []; const directions: Point[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]; const b = points[i]; const length = Math.hypot(b.x - a.x, b.y - a.y); if (length < EPS) { directions.push({ x: 0, y: 0 }); continue; }
    const d = { x: (b.x - a.x) / length, y: (b.y - a.y) / length }; directions.push(d); const n = { x: -d.y * radius, y: d.x * radius };
    primitives.push([{ x: a.x + n.x, y: a.y + n.y }, { x: b.x + n.x, y: b.y + n.y }, { x: b.x - n.x, y: b.y - n.y }, { x: a.x - n.x, y: a.y - n.y }]);
  }
  const closed = chain.closed || pointKey(points[0]) === pointKey(points.at(-1)!);
  for (let i = closed ? 0 : 1; i < points.length - 1; i++) {
    const before = directions[(i - 1 + directions.length) % directions.length]; const after = directions[i];
    const turn = Math.atan2(before.x * after.y - before.y * after.x, before.x * after.x + before.y * after.y);
    if (Math.abs(turn) < 1e-9) continue;
    if (Math.abs(turn) > Math.PI - .01) { primitives.push(circle(points[i], radius)); continue; }
    const side = turn > 0 ? -1 : 1; const start = Math.atan2(before.x * side, -before.y * side);
    const divisions = Math.max(1, Math.ceil(Math.abs(turn) / (Math.PI / 12))); const sector: Polygon = [{ ...points[i] }];
    for (let part = 0; part <= divisions; part++) { const angle = start + turn * part / divisions; sector.push({ x: points[i].x + Math.cos(angle) * radius, y: points[i].y + Math.sin(angle) * radius }); }
    primitives.push(sector);
  }
  if (!closed) primitives.push(circle(points[0], radius), circle(points.at(-1)!, radius));
  return primitives;
}

function intervalsAt(polygons: readonly Polygon[], x: number): Interval[] {
  const intervals: Interval[] = [];
  for (const polygon of polygons) {
    const crossings: { y: number; line: Line }[] = [];
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i]; const b = polygon[(i + 1) % polygon.length];
      if (Math.abs(b.x - a.x) < EPS || x <= Math.min(a.x, b.x) || x >= Math.max(a.x, b.x)) continue;
      const line = { a, b }; crossings.push({ y: yAt(line, x), line });
    }
    crossings.sort((a, b) => a.y - b.y);
    if (crossings.length >= 2) intervals.push({ low: crossings[0].line, high: crossings.at(-1)!.line });
  }
  intervals.sort((a, b) => yAt(a.low, x) - yAt(b.low, x) || yAt(a.high, x) - yAt(b.high, x));
  const union: Interval[] = [];
  for (const interval of intervals) {
    const last = union.at(-1);
    if (last && yAt(interval.low, x) <= yAt(last.high, x) + EPS) { if (yAt(interval.high, x) > yAt(last.high, x)) last.high = interval.high; }
    else union.push({ ...interval });
  }
  return union;
}

function difference(outer: readonly Interval[], inner: readonly Interval[], x: number): Interval[] {
  const result: Interval[] = [];
  for (const interval of outer) {
    let low = interval.low;
    for (const hole of inner) {
      if (yAt(hole.high, x) <= yAt(low, x) + EPS || yAt(hole.low, x) >= yAt(interval.high, x) - EPS) continue;
      if (yAt(hole.low, x) > yAt(low, x) + EPS) result.push({ low, high: hole.low });
      if (yAt(hole.high, x) > yAt(low, x)) low = hole.high;
      if (yAt(low, x) >= yAt(interval.high, x) - EPS) break;
    }
    if (yAt(low, x) < yAt(interval.high, x) - EPS) result.push({ low, high: interval.high });
  }
  return result;
}

/** Every boundary-order change is a sweep cut; interval union is then exact. */
function sweepCuts(levels: CellShapes['levels']): number[] {
  const lines: Line[] = []; const cuts: number[] = []; const seen = new Set<string>();
  for (const polygons of levels) for (const polygon of polygons) for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]; const b = polygon[(i + 1) % polygon.length]; cuts.push(a.x);
    const ka = pointKey(a); const kb = pointKey(b); const lineKey = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
    if (!seen.has(lineKey)) { lines.push({ a, b }); seen.add(lineKey); }
  }
  for (let i = 0; i < lines.length; i++) for (let j = i + 1; j < lines.length; j++) {
    const a = lines[i]; const b = lines[j];
    if (Math.min(a.a.x, a.b.x) > Math.max(b.a.x, b.b.x) + EPS || Math.min(b.a.x, b.b.x) > Math.max(a.a.x, a.b.x) + EPS || Math.min(a.a.y, a.b.y) > Math.max(b.a.y, b.b.y) + EPS || Math.min(b.a.y, b.b.y) > Math.max(a.a.y, a.b.y) + EPS) continue;
    const dx = a.b.x - a.a.x; const dy = a.b.y - a.a.y; const ex = b.b.x - b.a.x; const ey = b.b.y - b.a.y; const determinant = dx * ey - dy * ex;
    if (Math.abs(determinant) < 1e-12) continue;
    const qx = b.a.x - a.a.x; const qy = b.a.y - a.a.y; const t = (qx * ey - qy * ex) / determinant; const u = (qx * dy - qy * dx) / determinant;
    if (t > EPS && t < 1 - EPS && u > -EPS && u < 1 + EPS) cuts.push(a.a.x + dx * t);
  }
  cuts.sort((a, b) => a - b);
  return cuts.filter((x, i) => !i || x - cuts[i - 1] > EPS);
}

function unionBoundary(polygons: readonly Polygon[]): Point[][] {
  interface Directed { a: Point; b: Point; lo: number; hi: number; forward: boolean; }
  const groups = new Map<string, { dx: number; dy: number; segments: Directed[]; cuts: number[] }>();
  for (const polygon of polygons) for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]; const b = polygon[(i + 1) % polygon.length]; const length = Math.hypot(b.x - a.x, b.y - a.y); if (length < EPS) continue;
    const forward = b.x > a.x + EPS || Math.abs(b.x - a.x) <= EPS && b.y > a.y;
    const dx = (b.x - a.x) / length * (forward ? 1 : -1); const dy = (b.y - a.y) / length * (forward ? 1 : -1); const normal = -dy * a.x + dx * a.y;
    // Sweep slabs share vertical edges; tile bins additionally share
    // horizontal edges. Other edges are genuine stroke boundaries. Grouping
    // approximately collinear curved boundaries can accidentally cancel a
    // narrow wedge, so only axis-aligned partitions receive split points.
    const ka = pointKey(a); const kb = pointKey(b);
    const groupKey = Math.abs(b.x - a.x) < EPS
      ? `vertical:${Math.round(a.x * 1e7)}`
      : Math.abs(b.y - a.y) < EPS
        ? `horizontal:${Math.round(a.y * 1e7)}`
        : `boundary:${ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`}`;
    void normal;
    let group = groups.get(groupKey); if (!group) { group = { dx, dy, segments: [], cuts: [] }; groups.set(groupKey, group); }
    const pa = a.x * group.dx + a.y * group.dy; const pb = b.x * group.dx + b.y * group.dy;
    group.segments.push({ a, b, lo: Math.min(pa, pb), hi: Math.max(pa, pb), forward }); group.cuts.push(pa, pb);
  }
  const boundary = new Map<string, { a: string; b: string }>();
  const counts = new Map<string, { a: string; b: string; count: number }>();
  const countEdge = (target: typeof counts, a: string, b: string) => {
    if (a === b) return;
    const forward = a < b; const lo = forward ? a : b; const hi = forward ? b : a; const id = `${lo}|${hi}`;
    const entry = target.get(id) ?? { a: lo, b: hi, count: 0 };
    entry.count += forward ? 1 : -1; target.set(id, entry);
  };
  for (const group of groups.values()) {
    group.cuts.sort((a, b) => a - b); const cuts = group.cuts.filter((p, i) => !i || p - group.cuts[i - 1] > EPS);
    for (const segment of group.segments) {
      const local = cuts.filter((v) => v >= segment.lo - EPS && v <= segment.hi + EPS);
      const startProjection = segment.a.x * group.dx + segment.a.y * group.dy; const endProjection = segment.b.x * group.dx + segment.b.y * group.dy;
      const at = (v: number): Point => { const t = (v - startProjection) / (endProjection - startProjection); return { x: segment.a.x + (segment.b.x - segment.a.x) * t, y: segment.a.y + (segment.b.y - segment.a.y) * t }; };
      for (let i = 1; i < local.length; i++) {
        const a = pointKey(at(segment.forward ? local[i - 1] : local[i])); const b = pointKey(at(segment.forward ? local[i] : local[i - 1])); if (a === b) continue;
        countEdge(counts, a, b);
      }
    }
  }
  // Use signed multiplicity, not a boolean edge set: several extremely
  // narrow sweep slabs can quantize to the same endpoints before their
  // opposing partition edges arrive. A set loses those multiplicities and
  // leaves dangling vertical edges in otherwise closed curved boundaries.
  for (const edge of counts.values()) if (edge.count) {
    const a = edge.count > 0 ? edge.a : edge.b; const b = edge.count > 0 ? edge.b : edge.a; boundary.set(`${a}|${b}`, { a, b });
  }
  // Intersections computed from two primitive pairs can differ by a few
  // floating ulps. Weld only sub-micropixel boundary endpoints before tracing;
  // this does not modify or expand any final clipped mesh triangle.
  const aliases = new Map<string, string>();
  const anchors = new Map<string, string>();
  const endpointKeys = [...new Set([...boundary.values()].flatMap((edge) => [edge.a, edge.b]))].sort((a, b) => {
    const pa = pointFromKey(a); const pb = pointFromKey(b); return pa.y - pb.y || pa.x - pb.x;
  });
  for (const endpoint of endpointKeys) {
    const [x, y] = endpoint.split(',').map(Number); let anchor: string | undefined;
    for (let dy = -2; dy <= 2 && !anchor; dy++) for (let dx = -2; dx <= 2 && !anchor; dx++) anchor = anchors.get(`${x + dx},${y + dy}`);
    aliases.set(endpoint, anchor ?? endpoint); if (!anchor) anchors.set(endpoint, endpoint);
  }
  const weldedCounts: typeof counts = new Map();
  for (const edge of boundary.values()) {
    const a = aliases.get(edge.a)!; const b = aliases.get(edge.b)!; if (a === b) continue;
    countEdge(weldedCounts, a, b);
  }
  boundary.clear();
  for (const edge of weldedCounts.values()) if (edge.count) {
    const a = edge.count > 0 ? edge.a : edge.b; const b = edge.count > 0 ? edge.b : edge.a; boundary.set(`${a}|${b}`, { a, b });
  }
  const outgoing = new Map<string, string[]>();
  for (const [id, segment] of boundary) { const list = outgoing.get(segment.a) ?? []; list.push(id); outgoing.set(segment.a, list); }
  const rings: Point[][] = [];
  for (const [firstId, first] of boundary) {
    if (!boundary.has(firstId)) continue; const ring: Point[] = []; let id = firstId;
    while (boundary.has(id)) {
      const segment = boundary.get(id)!; boundary.delete(id); ring.push(pointFromKey(segment.a)); if (segment.b === first.a) break;
      const choices = (outgoing.get(segment.b) ?? []).filter((candidate) => boundary.has(candidate)); if (!choices.length) { ring.length = 0; break; }
      const a = pointFromKey(segment.a); const b = pointFromKey(segment.b); const angle = Math.atan2(b.y - a.y, b.x - a.x);
      choices.sort((one, two) => {
        const turn = (candidate: string) => { const end = pointFromKey(boundary.get(candidate)!.b); return (Math.atan2(end.y - b.y, end.x - b.x) - angle + Math.PI * 2) % (Math.PI * 2); };
        return turn(one) - turn(two) || one.localeCompare(two);
      }); id = choices[0];
    }
    if (ring.length >= 3 && Math.abs(area(ring)) > 1e-10) rings.push(ring.filter((p, i) => {
      const before = ring[(i - 1 + ring.length) % ring.length]; const after = ring[(i + 1) % ring.length]; return Math.abs((p.x - before.x) * (after.y - p.y) - (p.y - before.y) * (after.x - p.x)) > 1e-10;
    }));
  }
  return rings.filter((ring) => ring.length >= 3).sort((a, b) => Math.abs(area(b)) - Math.abs(area(a)) || pointKey(a[0]).localeCompare(pointKey(b[0])));
}

/**
 * Exact vector interval unions, decomposed at primitive intersections. Tiles
 * are clipping bins only: there is no tile inset, tile cap or texture reset.
 * The nested unions make every junction one uninterrupted core.
 */
export function buildPathRibbon(chains: readonly PathChain[], coverage: readonly number[], width: number, height: number): ContinuousPathLayer[] {
  const active = new Set(coverage); const cells = new Map<number, CellShapes>();
  for (const chain of chains) {
    const allowed = new Set(chain.coverage); const radii = [.36, .44, .5];
    for (let level = 0; level < 3; level++) for (const primitive of strokePrimitives(chain, chain.width * radii[level])) {
      const minX = Math.max(0, Math.floor(Math.min(...primitive.map((p) => p.x)))); const maxX = Math.min(width - 1, Math.floor(Math.max(...primitive.map((p) => p.x))));
      const minY = Math.max(0, Math.floor(Math.min(...primitive.map((p) => p.y)))); const maxY = Math.min(height - 1, Math.floor(Math.max(...primitive.map((p) => p.y))));
      for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
        const cell = y * width + x; if (!active.has(cell) || !allowed.has(cell)) continue; const clipped = clipToTile(primitive, x, y); if (!clipped.length) continue;
        let shapes = cells.get(cell); if (!shapes) { shapes = { levels: [[], [], []] }; cells.set(cell, shapes); } shapes.levels[level].push(clipped);
      }
    }
  }
  const polygons: Record<PathRibbonRole, Polygon[]> = { core: [], edge: [], shoulder: [] };
  for (const [, cell] of [...cells].sort(([a], [b]) => a - b)) {
    const cuts = sweepCuts(cell.levels);
    for (let i = 1; i < cuts.length; i++) {
      const x0 = cuts[i - 1]; const x1 = cuts[i]; if (x1 - x0 < EPS) continue; const middle = (x0 + x1) / 2;
      const unions = cell.levels.map((level) => intervalsAt(level, middle));
      const zones: Record<PathRibbonRole, Interval[]> = { core: unions[0], edge: difference(unions[1], unions[0], middle), shoulder: difference(unions[2], unions[1], middle) };
      for (const role of ['core', 'edge', 'shoulder'] as const) for (const interval of zones[role]) {
        const trapezoid = [{ x: x0, y: yAt(interval.low, x0) }, { x: x1, y: yAt(interval.low, x1) }, { x: x1, y: yAt(interval.high, x1) }, { x: x0, y: yAt(interval.high, x0) }];
        if (area(trapezoid) > 1e-12) polygons[role].push(trapezoid);
      }
    }
  }
  return (['shoulder', 'edge', 'core'] as const).map((role) => {
    const positions: number[] = []; const indices: number[] = [];
    for (const polygon of polygons[role]) {
      const base = positions.length / 2; for (const p of polygon) positions.push(p.x, p.y);
      for (const [a, b, c] of [[0, 1, 2], [0, 2, 3]]) if (area([polygon[a], polygon[b], polygon[c]]) > 1e-12) indices.push(base + a, base + b, base + c);
    }
    return { role, rings: unionBoundary(polygons[role]), positions, indices };
  });
}
