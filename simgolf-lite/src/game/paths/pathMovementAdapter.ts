import type { Course, Point } from "../models/types";
import { findWalkPath, findWalkPathCells, walkPathAuthority } from "../live/walkPath";
import { buildContinuousPathPlan, continuousPathPlanKey, type ContinuousPathEdge, type ContinuousPathInput, type ContinuousPathNode, type ContinuousPathPlan } from "./continuousPathPlan";

const EPS = 1e-8;
const copy = (points: readonly Point[]) => points.map(point => ({ ...point }));
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const mix = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const world = (point: Point): Point => ({ x: point.x + .5, y: point.y + .5 });
/** The renderer adds .5. This is the only plan-world -> legacy conversion. */
const legacy = (point: Point): Point => ({ x: point.x - .5, y: point.y - .5 });

interface Triangle { positions: readonly number[]; a: number; b: number; c: number; }
interface PlanSegment {
  a: Point; b: Point; edgeId: string; index: number; arclength: number; length: number;
  source: ContinuousPathEdge["source"]; featureIds: readonly string[]; coverage: readonly number[];
  fromNodeId: string | null; toNodeId: string | null; footprintLegal?: boolean;
}
interface LabelledEdge { edge: ContinuousPathEdge; cumulative: number[]; length: number; coverage: ReadonlySet<number>; segments: PlanSegment[]; }
interface PlanContext {
  key: string; signature: string; revision: string | undefined; width: number; height: number;
  plan?: ContinuousPathPlan; segments?: PlanSegment[]; triangles?: Map<number, Triangle[]>;
  edges?: Map<string, LabelledEdge>; nodes?: Map<string, ContinuousPathNode>;
}
const contexts = new WeakMap<ContinuousPathInput["tiles"], PlanContext>();
function terrainRevision(course: ContinuousPathInput): string {
  let hash = 0x811c9dc5;
  for (const terrain of course.tiles) for (let i = 0; i < terrain.length; i++) { hash ^= terrain.charCodeAt(i); hash = Math.imul(hash, 0x01000193); }
  return `${course.width}x${course.height}:${hash >>> 0}`;
}
function context(course: ContinuousPathInput, revision = terrainRevision(course)): PlanContext {
  // Geometry handles/width/accepted coverage can change without terrain or a
  // caller-supplied revision. Do not stringify the full course on cache hits.
  const signature = JSON.stringify(course.surfaceIntent?.features.filter(feature => feature.terrain === "path")
    .map(feature => [feature.id, feature.order, feature.geometry, feature.coverage]));
  const previous = contexts.get(course.tiles);
  if (previous && previous.signature === signature && previous.revision === revision && previous.width === course.width && previous.height === course.height) return previous;
  const key = continuousPathPlanKey(course);
  const next = previous?.key === key ? previous : { key, signature, revision, width: course.width, height: course.height };
  next.signature = signature; next.revision = revision;
  contexts.set(course.tiles, next);
  return next;
}
/** Explicit revisions retain the existing caller-owned terrain invalidation contract. */
export function pathMovementPlanKey(course: ContinuousPathInput, revision?: string): string {
  return context(course, revision).key;
}
function prepare(course: ContinuousPathInput, entry: PlanContext): void {
  if (entry.segments) return;
  const plan = entry.plan ??= buildContinuousPathPlan(course);
  entry.segments = []; entry.edges = new Map(); entry.nodes = new Map(plan.nodes.map(node => [node.id, node]));
  for (const edge of plan.edges) {
    const cumulative = [0]; const segments: PlanSegment[] = [];
    for (let i = 1; i < edge.points.length; i++) {
      const length = distance(edge.points[i - 1], edge.points[i]); cumulative.push(cumulative.at(-1)! + length);
      if (length <= EPS) continue;
      const segment: PlanSegment = { a: edge.points[i - 1], b: edge.points[i], edgeId: edge.id, index: i - 1,
        arclength: cumulative[i - 1], length, source: edge.source, featureIds: edge.featureIds, coverage: edge.coverage,
        fromNodeId: edge.fromNodeId, toNodeId: edge.toNodeId };
      entry.segments.push(segment); segments.push(segment);
    }
    entry.edges.set(edge.id, { edge, cumulative, length: cumulative.at(-1)!, coverage: new Set(edge.coverage), segments });
  }
  entry.triangles = new Map();
  for (const layer of plan.layers) for (let i = 0; i < layer.indices.length; i += 3) {
    const [a, b, c] = layer.indices.slice(i, i + 3).map(index => index * 2); const p = layer.positions;
    const x = Math.floor((p[a] + p[b] + p[c]) / 3); const y = Math.floor((p[a + 1] + p[b + 1] + p[c + 1]) / 3);
    const cell = y * course.width + x; const list = entry.triangles.get(cell) ?? [];
    list.push({ positions: p, a, b, c }); entry.triangles.set(cell, list);
  }
}
function triangleInterval(a: Point, b: Point, triangle: Triangle): [number, number] | null {
  let lo = 0, hi = 1; const p = triangle.positions;
  for (const [u, v] of [[triangle.a, triangle.b], [triangle.b, triangle.c], [triangle.c, triangle.a]]) {
    const dx = p[v] - p[u], dy = p[v + 1] - p[u + 1];
    const start = dx * (a.y - p[u + 1]) - dy * (a.x - p[u]);
    const delta = dx * (b.y - a.y) - dy * (b.x - a.x);
    if (Math.abs(delta) < 1e-14) { if (start < -1e-10) return null; }
    else if (delta > 0) lo = Math.max(lo, (-1e-10 - start) / delta);
    else hi = Math.min(hi, (-1e-10 - start) / delta);
    if (lo > hi) return null;
  }
  return [lo, hi];
}
function footprintContains(entry: PlanContext, a: Point, b: Point): boolean {
  const intervals: [number, number][] = [];
  for (let y = Math.max(0, Math.floor(Math.min(a.y, b.y) - EPS)); y <= Math.min(entry.height - 1, Math.floor(Math.max(a.y, b.y))); y++) {
    for (let x = Math.max(0, Math.floor(Math.min(a.x, b.x) - EPS)); x <= Math.min(entry.width - 1, Math.floor(Math.max(a.x, b.x))); x++) {
      for (const triangle of entry.triangles!.get(y * entry.width + x) ?? []) {
        const interval = triangleInterval(a, b, triangle); if (interval) intervals.push(interval);
      }
    }
  }
  intervals.sort((a, b) => a[0] - b[0]); let end = 0;
  for (const interval of intervals) { if (interval[0] > end + EPS) return false; end = Math.max(end, interval[1]); if (end >= 1 - EPS) return true; }
  return false;
}

export interface PathMovementOptions {
  course: Course;
  cells: readonly Point[];
  waypoints: readonly Point[];
  from: Point;
  to: Point;
  /** Trusted terrain revision; saved geometry is checked independently. */
  geometryVersion?: string;
  /** Same mode/passability/corner/slope authority that accepted the cell route. */
  canStep?: (from: Point, to: Point) => boolean;
}
export interface PathMovementResult {
  waypoints: Point[];
  alignedRuns: number;
  fallbackRuns: number;
  reasons: string[];
  /** Additional PATH cells actually used: original-diagonal clearance or source-edge-qualified one-cardinal permission. */
  presentationClearanceCells: number[];
  /** Conservative matching/authority rejection detail, with original progress/edge when available. */
  failureDetails?: string;
}
interface Piece { a: Point; b: Point; allowed: ReadonlySet<number>; edgeId?: string; progress?: number; }
function adjacentCells(point: Point, width: number, height: number): number[] {
  const result: number[] = [];
  for (let y = Math.floor(point.y - EPS); y <= Math.floor(point.y); y++) for (let x = Math.floor(point.x - EPS); x <= Math.floor(point.x); x++) {
    if (x >= 0 && y >= 0 && x < width && y < height) result.push(y * width + x);
  }
  return result;
}
const cellPoint = (cell: number, width: number): Point => ({ x: cell % width, y: Math.floor(cell / width) });

/** Exact directed validation used by production matching and adversarial tests.
 * points are G world coordinates; endpoint cells use the existing route convention. */
export function validatePathMovementPolyline(input: {
  points: readonly Point[]; permissions: readonly ReadonlySet<number>[]; width: number; height: number;
  fromCell: Point; toCell: Point; canStep: (a: Point, b: Point) => boolean;
}): { valid: boolean; usedCells: number[] } {
  const { points, permissions, width, height, canStep } = input;
  if (!points.length || permissions.length !== points.length - 1) return { valid: false, usedCells: [] };
  const start = Math.round(input.fromCell.y) * width + Math.round(input.fromCell.x);
  const finish = Math.round(input.toCell.y) * width + Math.round(input.toCell.x);
  if (!adjacentCells(points[0], width, height).includes(start) || !adjacentCells(points.at(-1)!, width, height).includes(finish)
    || !canStep(cellPoint(start, width), cellPoint(start, width))) return { valid: false, usedCells: [] };
  // Each state carries its own trace. A losing boundary alternative cannot
  // pollute accepted clearance diagnostics or bypass the next sample seam.
  let states = new Map<number, Set<number>>([[start, new Set([start])]]);
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i]; const allowed = permissions[i - 1]; const cuts = [0, 1];
    if (distance(a, b) <= EPS) continue;
    for (const axis of ["x", "y"] as const) {
      const delta = b[axis] - a[axis]; if (Math.abs(delta) <= EPS) continue;
      for (let value = Math.floor(Math.min(a[axis], b[axis])) + 1; value < Math.max(a[axis], b[axis]) - EPS; value++) cuts.push((value - a[axis]) / delta);
    }
    cuts.sort((a, b) => a - b);
    for (let j = 1; j < cuts.length; j++) {
      if (cuts[j] - cuts[j - 1] <= EPS) continue;
      const p = mix(a, b, (cuts[j] + cuts[j - 1]) / 2); const next = new Map<number, Set<number>>();
      for (const cell of adjacentCells(p, width, height)) {
        if (!allowed.has(cell)) continue; const target = cellPoint(cell, width);
        if (!canStep(target, target)) continue;
        for (const [previous, trace] of states) {
          const source = cellPoint(previous, width);
          if (Math.abs(source.x - target.x) > 1 || Math.abs(source.y - target.y) > 1 || !canStep(source, target)) continue;
          const accepted = new Set(trace); accepted.add(cell); next.set(cell, accepted); break;
        }
      }
      if (!next.size) return { valid: false, usedCells: [] }; states = next;
    }
  }
  const destination = cellPoint(finish, width);
  if (!canStep(destination, destination) || points.length > 1 && !permissions.at(-1)!.has(finish)) return { valid: false, usedCells: [] };
  for (const [previous, trace] of states) {
    const source = cellPoint(previous, width);
    if (Math.abs(source.x - destination.x) <= 1 && Math.abs(source.y - destination.y) <= 1 && canStep(source, destination)) {
      trace.add(finish); return { valid: true, usedCells: [...trace].sort((a, b) => a - b) };
    }
  }
  return { valid: false, usedCells: [] };
}
function validatePieces(pieces: readonly Piece[], fromCell: Point, toCell: Point, entry: PlanContext, canStep: (a: Point, b: Point) => boolean) {
  if (!pieces.length) return { valid: false, usedCells: [] };
  for (let i = 1; i < pieces.length; i++) if (distance(pieces[i - 1].b, pieces[i].a) > EPS) return { valid: false, usedCells: [] };
  return validatePathMovementPolyline({ points: [pieces[0].a, ...pieces.map(piece => piece.b)], permissions: pieces.map(piece => piece.allowed),
    width: entry.width, height: entry.height, fromCell, toCell, canStep });
}
/** A fixed physical curve; connectors cannot consume intermediate route indices. */
export interface PathMovementSupportPiece {
  a: Point; b: Point; edgeId: string; connector?: "entry" | "exit";
}
export interface PathMovementSupportEvent { index: number; cell: number; edgeId: string; point: Point; }
interface OccupiedPiece extends PathMovementSupportPiece { cell: number; }
interface SupportNode extends PathMovementSupportEvent { previous: SupportNode | null; piece?: OccupiedPiece; }

/** Production product-state validator. Trace ownership ends with this call's
 * caller: no trace/graph is retained on cached public legs or persisted data. */
export function validatePathMovementSupport(input: {
  pieces: readonly PathMovementSupportPiece[]; originalCount: number; width: number; height: number;
  fromCell: Point; toCell: Point;
  supports: (index: number, cell: number, edgeId: string) => boolean;
  canStep: (a: Point, b: Point) => boolean;
  stateBudget?: number;
}): { valid: boolean; trace: PathMovementSupportEvent[]; pieces: OccupiedPiece[]; usedCells: number[]; failureDetails?: string } {
  const { width, height, originalCount, canStep, supports } = input;
  const fail = (failureDetails: string) => ({ valid: false, trace: [], pieces: [], usedCells: [], failureDetails });
  const boundary = (point: Point) => Math.abs(point.x - Math.round(point.x)) <= EPS || Math.abs(point.y - Math.round(point.y)) <= EPS;
  const step = (a: number, b: number) => {
    const from = cellPoint(a, width), to = cellPoint(b, width);
    return Math.abs(from.x - to.x) <= 1 && Math.abs(from.y - to.y) <= 1 && canStep(from, to);
  };
  const eligible = (piece: PathMovementSupportPiece, i: number, cell: number) =>
    i >= 0 && i < originalCount && (piece.connector === "entry" ? i === 0 : piece.connector === "exit" ? i === originalCount - 1 : true)
    && supports(i, cell, piece.edgeId) && step(cell, cell);
  const atoms: PathMovementSupportPiece[] = [];
  for (const piece of input.pieces) {
    if (distance(piece.a, piece.b) <= EPS) continue;
    if (atoms.length && distance(atoms.at(-1)!.b, piece.a) > EPS) return fail("discontinuous-fixed-curve");
    const cuts = [0, 1];
    for (const axis of ["x", "y"] as const) {
      const delta = piece.b[axis] - piece.a[axis]; if (Math.abs(delta) <= EPS) continue;
      for (let value = Math.floor(Math.min(piece.a[axis], piece.b[axis])) + 1; value < Math.max(piece.a[axis], piece.b[axis]) - EPS; value++) cuts.push((value - piece.a[axis]) / delta);
    }
    cuts.sort((a, b) => a - b);
    for (let j = 1; j < cuts.length; j++) {
      if (cuts[j] - cuts[j - 1] <= EPS) continue;
      const a = mix(piece.a, piece.b, cuts[j - 1]), b = mix(piece.a, piece.b, cuts[j]);
      const incident = adjacentCells(mix(a, b, .5), width, height);
      // A boundary interval may switch its two positive-length incident sides.
      // Finite collinear events can realize every acyclic (index,side) sequence.
      // Only indices supported on THIS interval contribute to this bound.
      let supportedIndices = 0;
      if (incident.length === 2 && !piece.connector) for (let i = 0; i < originalCount; i++) {
        if (incident.some(cell => eligible(piece, i, cell))) supportedIndices++;
      }
      const parts = supportedIndices ? 2 * supportedIndices + 1 : 1;
      for (let part = 0; part < parts; part++) atoms.push({ ...piece, a: mix(a, b, part / parts), b: mix(a, b, (part + 1) / parts) });
      if (atoms.length > 50_000) return fail("ordered-support-interval-budget");
    }
  }
  if (!atoms.length || originalCount < 1) return fail("no-positive-fixed-curve");
  const start = Math.round(input.fromCell.y) * width + Math.round(input.fromCell.x);
  const finish = Math.round(input.toCell.y) * width + Math.round(input.toCell.x);
  if (!adjacentCells(atoms[0].a, width, height).includes(start) || !eligible(atoms[0], 0, start)) return fail(`entry-occupancy-or-support:0:${start}:${atoms[0].edgeId}`);
  let nodes = 0;
  const budget = input.stateBudget ?? 250_000;
  const node = (previous: SupportNode | null, index: number, cell: number, edgeId: string, point: Point, piece?: OccupiedPiece): SupportNode => {
    nodes++; return { previous, index, cell, edgeId, point, piece };
  };
  let states = new Map<string, SupportNode>([[`0:${start}`, node(null, 0, start, atoms[0].edgeId, atoms[0].a)]]);
  // Closure changes progress only, never occupied cells. Each increment has a
  // predecessor. A SW->NE vertex still requires the ONE direct actual step.
  const closure = (seeds: Map<string, SupportNode>, piece: PathMovementSupportPiece, at: Point) => {
    if (piece.connector || !boundary(at)) return seeds;
    const result = new Map(seeds);
    for (const seed of seeds.values()) {
      let current = seed;
      while (eligible(piece, current.index + 1, current.cell)) {
        const index = current.index + 1, key = `${index}:${current.cell}`;
        const existing = result.get(key); if (existing) break;
        current = node(current, index, current.cell, piece.edgeId, at); result.set(key, current);
        if (nodes > budget) break;
      }
    }
    return result;
  };
  for (let k = 0; k < atoms.length; k++) {
    const atom = atoms[k], prior = k ? atoms[k - 1] : undefined;
    const incoming = prior ? closure(states, prior, atom.a) : states;
    const seeds = new Map<string, SupportNode>(); const cells = adjacentCells(mix(atom.a, atom.b, .5), width, height);
    for (const previous of incoming.values()) for (const cell of cells) {
      if (!step(previous.cell, cell)) continue;
      // Only an actual grid boundary can consume the next original index.
      // Connectors never advance; ordinary samples/source changes carry i.
      const indices = boundary(atom.a) && !atom.connector ? [previous.index, previous.index + 1] : [previous.index];
      for (const index of indices) {
        if (!eligible(atom, index, cell)) continue;
        const key = `${index}:${cell}`;
        if (!seeds.has(key)) seeds.set(key, node(previous, index, cell, atom.edgeId, atom.a));
      }
    }
    const supported = closure(seeds, atom, atom.a); const next = new Map<string, SupportNode>();
    for (const [key, previous] of supported) next.set(key, node(previous, previous.index, previous.cell, atom.edgeId, atom.b, { ...atom, cell: previous.cell }));
    if (!next.size) return fail(`ordered-support-or-authority:${JSON.stringify({ interval: k, edge: atom.edgeId, a: atom.a, b: atom.b, cells, incoming: [...incoming.values()].map(state => ({ index: state.index, cell: state.cell })), connector: atom.connector })}`);
    if (nodes > budget) return fail(`ordered-support-state-budget:${k}:${nodes}`);
    states = next;
  }
  const last = atoms.at(-1)!;
  states = closure(states, last, last.b);
  if (nodes > budget) return fail("ordered-support-state-budget:finish");
  if (!adjacentCells(last.b, width, height).includes(finish) || !step(finish, finish)) return fail(`exit-occupancy:${finish}`);
  for (const state of states.values()) {
    if (state.index !== originalCount - 1 || !eligible(last, state.index, finish) || !step(state.cell, finish)) continue;
    const reverse: SupportNode[] = [];
    for (let current: SupportNode | null = state; current; current = current.previous) reverse.push(current);
    reverse.reverse();
    const pieces = reverse.flatMap(event => event.piece ? [event.piece] : []);
    const trace = reverse.map(({ index, cell, edgeId, point }) => ({ index, cell, edgeId, point }));
    return { valid: true, trace, pieces, usedCells: [...new Set([start, ...pieces.map(piece => piece.cell), finish])].sort((a, b) => a - b) };
  }
  return fail(`incomplete-ordered-support:${JSON.stringify({ edge: last.edgeId, endpoint: last.b, requiredIndex: originalCount - 1, finish, states: [...states.values()].map(state => ({ index: state.index, cell: state.cell })) })}`);
}

interface Witness { edge: LabelledEdge; segment: PlanSegment; t: number; s: number; point: Point; distance: number; }
interface DirectedArc { edge: LabelledEdge; from: number; to: number; }
interface MatchState { witnesses: Witness[]; arcs: DirectedArc[][]; directions: Map<string, number>; travelled: Map<string, number>; }
function project(point: Point, segment: PlanSegment): { point: Point; t: number } {
  const dx = segment.b.x - segment.a.x, dy = segment.b.y - segment.a.y;
  const t = Math.max(0, Math.min(1, ((point.x - segment.a.x) * dx + (point.y - segment.a.y) * dy) / (dx * dx + dy * dy)));
  return { point: mix(segment.a, segment.b, t), t };
}
function edgePoint(edge: LabelledEdge, arclength: number): Point {
  const s = edge.edge.closed ? ((arclength % edge.length) + edge.length) % edge.length : Math.max(0, Math.min(edge.length, arclength));
  const segment = edge.segments.find(segment => segment.arclength + segment.length >= s - EPS) ?? edge.segments.at(-1)!;
  return mix(segment.a, segment.b, Math.max(0, Math.min(1, (s - segment.arclength) / segment.length)));
}
function arcPoints(arc: DirectedArc): Point[] {
  const { edge, from, to } = arc; if (Math.abs(to - from) <= EPS) return [edgePoint(edge, from)];
  const breaks: number[] = [from, to];
  for (const cycle of edge.edge.closed ? [-1, 0, 1, 2] : [0]) for (const s of edge.cumulative) {
    const value = s + cycle * edge.length;
    if (value > Math.min(from, to) + EPS && value < Math.max(from, to) - EPS) breaks.push(value);
  }
  breaks.sort((a, b) => to > from ? a - b : b - a);
  return breaks.filter((value, i) => !i || Math.abs(value - breaks[i - 1]) > EPS).map(value => edgePoint(edge, value));
}
function physicalKey(arcs: readonly DirectedArc[]): string {
  const merged: DirectedArc[] = [];
  for (const arc of arcs) {
    if (Math.abs(arc.to - arc.from) <= EPS) continue;
    const last = merged.at(-1);
    if (last?.edge === arc.edge && Math.sign(last.to - last.from) === Math.sign(arc.to - arc.from)
      && distance(edgePoint(last.edge, last.to), edgePoint(arc.edge, arc.from)) <= EPS) last.to += arc.to - arc.from;
    else merged.push({ ...arc });
  }
  return merged.map(arc => {
    const from = arc.edge.edge.closed ? ((arc.from % arc.edge.length) + arc.edge.length) % arc.edge.length : arc.from;
    return `${arc.edge.edge.id}:${Math.round(from * 1e7)}:${Math.round((arc.to - arc.from) * 1e7)}`;
  }).join("|");
}
function connectingArcs(a: Witness, b: Witness, entry: PlanContext): DirectedArc[][] {
  if (a.edge === b.edge) {
    if (!a.edge.edge.closed) return [[{ edge: a.edge, from: a.s, to: b.s }]];
    if (distance(a.point, b.point) <= EPS) return [[]];
    const forward = ((b.s - a.s) % a.edge.length + a.edge.length) % a.edge.length;
    return [[{ edge: a.edge, from: a.s, to: a.s + forward }], [{ edge: a.edge, from: a.s, to: a.s + forward - a.edge.length }]];
  }
  const endpoints = (edge: LabelledEdge) => [{ node: edge.edge.fromNodeId, s: 0 }, { node: edge.edge.toNodeId, s: edge.length }].filter(endpoint => endpoint.node !== null);
  const result: DirectedArc[][] = [];
  for (const from of endpoints(a.edge)) for (const to of endpoints(b.edge)) {
    const arcs: DirectedArc[] = [{ edge: a.edge, from: a.s, to: from.s }];
    let nodeId = from.node!, previousEdge = a.edge.edge.id; const visited = new Set<string>(); let valid = true;
    if (!entry.nodes!.get(nodeId)?.incidentEdgeIds.includes(previousEdge)) continue;
    while (nodeId !== to.node) {
      const node = entry.nodes!.get(nodeId);
      if (!node || node.kind !== "transition" || node.incidentEdgeIds.length !== 2 || visited.has(nodeId)) { valid = false; break; }
      visited.add(nodeId); const nextId = node.incidentEdgeIds.find(id => id !== previousEdge)!; const next = entry.edges!.get(nextId);
      if (!next || next.edge.closed) { valid = false; break; }
      const start = next.edge.fromNodeId === nodeId ? 0 : next.edge.toNodeId === nodeId ? next.length : NaN;
      if (!Number.isFinite(start)) { valid = false; break; }
      arcs.push({ edge: next, from: start, to: start === 0 ? next.length : 0 });
      nodeId = (start === 0 ? next.edge.toNodeId : next.edge.fromNodeId)!; previousEdge = nextId;
    }
    if (!valid || !entry.nodes!.get(nodeId)?.incidentEdgeIds.includes(b.edge.edge.id)) continue;
    arcs.push({ edge: b.edge, from: to.s, to: b.s });
    result.push(arcs);
  }
  return result;
}
function alignRun(course: Course, entry: PlanContext, run: readonly Point[], start: Point, end: Point, canStep: (a: Point, b: Point) => boolean): { pieces: Piece[]; clearanceCells: number[] } | { failure: string } {
  const originals = run.map(point => Math.round(point.y) * entry.width + Math.round(point.x));
  const originalSet = new Set(originals);
  const diagonal = (i: number): number[] => {
    if (i < 0 || i + 1 >= run.length) return [];
    const a = cellPoint(originals[i], entry.width), b = cellPoint(originals[i + 1], entry.width);
    if (Math.abs(a.x - b.x) !== 1 || Math.abs(a.y - b.y) !== 1 || !canStep(a, b)) return [];
    return [{ x: b.x, y: a.y }, { x: a.x, y: b.y }].filter(side => course.tiles[side.y * entry.width + side.x] === "path"
      && canStep(a, side) && canStep(side, b)).map(side => side.y * entry.width + side.x);
  };
  const permission = (indices: readonly number[], edge: LabelledEdge, diagonalSteps: readonly number[]): Set<number> => {
    const cells = new Set(indices.map(i => originals[i]).filter(cell => edge.coverage.has(cell)));
    for (const step of diagonalSteps) for (const cell of diagonal(step)) if (edge.coverage.has(cell)) cells.add(cell);
    for (const i of indices) {
      const original = originals[i]; if (!edge.coverage.has(original)) continue;
      const r = cellPoint(original, entry.width);
      for (const q of [{ x: r.x - 1, y: r.y }, { x: r.x + 1, y: r.y }, { x: r.x, y: r.y - 1 }, { x: r.x, y: r.y + 1 }]) {
        if (q.x < 0 || q.y < 0 || q.x >= entry.width || q.y >= entry.height) continue;
        const cell = q.y * entry.width + q.x;
        if (course.tiles[cell] === "path" && edge.coverage.has(cell) && canStep(q, q)) cells.add(cell);
      }
    }
    return cells;
  };
  const supported = (point: Point, cells: ReadonlySet<number>) => adjacentCells(point, entry.width, entry.height).some(cell => cells.has(cell));
  const witnesses: Witness[][] = [];
  for (let i = 0; i < run.length; i++) {
    const anchor = world(run[i]); let best = Infinity; const nearest = new Map<string, Witness>();
    for (const segment of entry.segments!) {
      const edge = entry.edges!.get(segment.edgeId)!;
      const projected = project(anchor, segment); const allowed = permission([i], edge, [i - 1, i]);
      if (!supported(projected.point, allowed)) continue;
      const d = distance(anchor, projected.point); if (d > best + EPS) continue;
      if (d < best - EPS) { nearest.clear(); best = d; }
      let s = segment.arclength + projected.t * segment.length; if (edge.edge.closed && Math.abs(s - edge.length) <= EPS) s = 0;
      nearest.set(`${edge.edge.id}:${Math.round(s * 1e7)}`, { edge, segment, t: projected.t, s, point: projected.point, distance: d });
    }
    if (!nearest.size) return { failure: `no-local-support:${i}:${originals[i]}` };
    witnesses.push([...nearest.values()]);
  }
  let geometryFailure = "";
  const piecesFor = (arcs: readonly DirectedArc[]): PathMovementSupportPiece[] | null => {
    const pieces: PathMovementSupportPiece[] = [];
    for (const arc of arcs) {
      const points = arcPoints(arc);
      for (let j = 1; j < points.length; j++) {
        const a = points[j - 1], b = points[j]; if (distance(a, b) <= EPS) continue;
        if (!footprintContains(entry, a, b)) { geometryFailure = `footprint:${arc.edge.edge.id}:${JSON.stringify({ a, b })}`; return null; }
        if (pieces.length && distance(pieces.at(-1)!.b, a) > EPS) { geometryFailure = "discontinuous-declared-itinerary"; return null; }
        pieces.push({ a, b, edgeId: arc.edge.edge.id });
      }
    }
    return pieces;
  };
  let states: MatchState[] = witnesses[0].map(witness => ({ witnesses: [witness], arcs: [], directions: new Map(), travelled: new Map() }));
  for (let i = 0; i + 1 < witnesses.length; i++) {
    const next = new Map<string, MatchState>();
    for (const state of states) for (const witness of witnesses[i + 1]) for (const arcs of connectingArcs(state.witnesses.at(-1)!, witness, entry)) {
      const directions = new Map(state.directions), travelled = new Map(state.travelled); let valid = true;
      for (const arc of arcs) {
        const delta = arc.to - arc.from; if (Math.abs(delta) <= EPS) continue;
        const id = arc.edge.edge.id, direction = Math.sign(delta);
        if (directions.has(id) && directions.get(id) !== direction) { valid = false; break; }
        directions.set(id, direction); const length = (travelled.get(id) ?? 0) + Math.abs(delta); travelled.set(id, length);
        if (length > arc.edge.length + EPS) { valid = false; break; }
      }
      if (!valid) continue;
      const candidate = { witnesses: [...state.witnesses, witness], arcs: [...state.arcs, arcs], directions, travelled };
      next.set(`${witness.edge.edge.id}:${Math.round(witness.s * 1e7)}:${physicalKey(candidate.arcs.flat())}`, candidate);
    }
    states = [...next.values()];
    if (!states.length) return { failure: `unsupported-directed-itinerary:${i}:${originals[i]}>${originals[i + 1]}:witnesses=${JSON.stringify([witnesses[i], witnesses[i + 1]].map(group => group.map(w => ({ edge: w.edge.edge.id, s: w.s, point: w.point }))))}` };
    if (states.length > 64) return { failure: `ambiguous-support-budget:${i}` };
  }
  const physical = new Map<string, MatchState>();
  for (const state of states) { const key = physicalKey(state.arcs.flat()); if (key) physical.set(key, state); }
  if (!physical.size) return { failure: "no-positive-directed-itinerary" };
  const endpointCandidates = (anchor: Point, arc: DirectedArc, index: number, entering: boolean): Witness[] => {
    const allowed = permission([index], arc.edge, entering ? [0] : [run.length - 2]); const candidates = new Map<string, Witness>();
    for (const segment of arc.edge.segments) {
      const projected = project(anchor, segment); if (!supported(projected.point, allowed)) continue;
      const raw = segment.arclength + projected.t * segment.length;
      for (const cycle of arc.edge.edge.closed ? [-1, 0, 1] : [0]) {
        const s = raw + cycle * arc.edge.length; const direction = Math.sign(arc.to - arc.from);
        if (entering ? direction * (arc.to - s) <= EPS : direction * (s - arc.from) <= EPS) continue;
        if (arc.edge.edge.closed && Math.abs(s - (entering ? arc.from : arc.to)) > arc.edge.length) continue;
        candidates.set(`${segment.edgeId}:${Math.round(s * 1e7)}`, { edge: arc.edge, segment, t: projected.t, s, point: projected.point, distance: distance(anchor, projected.point) });
      }
    }
    return [...candidates.values()].sort((a, b) => a.distance - b.distance || a.s - b.s || a.segment.index - b.segment.index || a.t - b.t);
  };
  const accepted = new Map<string, { pieces: Piece[]; clearanceCells: number[] }>();
  let failure = "no-local-directed-endpoint-pair", pairsTried = 0;
  for (const state of physical.values()) {
    const base = state.arcs.flat().filter(arc => Math.abs(arc.to - arc.from) > EPS);
    const first = base[0], last = base.at(-1)!;
    const entries = endpointCandidates(start, first, 0, true), exits = endpointCandidates(end, last, run.length - 1, false);
    if (entries.length * exits.length > 16_384) return { failure: "endpoint-pair-budget" };
    const pairs = entries.flatMap(from => exits.map(to => ({ from, to }))).sort((a, b) => a.from.distance + a.to.distance - b.from.distance - b.to.distance
      || a.from.s - b.from.s || a.to.s - b.to.s || a.from.segment.index - b.from.segment.index || a.to.segment.index - b.to.segment.index);
    for (const { from, to } of pairs) {
      if (++pairsTried > 16_384) return { failure: "whole-candidate-budget" };
      const arcs = state.arcs.map(group => group.map(arc => ({ ...arc })));
      let replacedFirst = false;
      for (const group of arcs) for (const arc of group) if (Math.abs(arc.to - arc.from) > EPS && !replacedFirst) { arc.from = from.s; replacedFirst = true; }
      let replacedLast = false;
      for (const group of [...arcs].reverse()) for (const arc of [...group].reverse()) if (Math.abs(arc.to - arc.from) > EPS && !replacedLast) { arc.to = to.s; replacedLast = true; }
      if (first.edge === last.edge && base.length === 1 && Math.sign(to.s - from.s) !== Math.sign(first.to - first.from)) continue;
      // Endpoint extension must preserve the same direction and <=one full
      // traversal bound already imposed on the witness-directed itinerary.
      const travelled = new Map<string, number>(); let bounded = true;
      for (const arc of arcs.flat()) {
        const delta = arc.to - arc.from; if (Math.abs(delta) <= EPS) continue;
        const id = arc.edge.edge.id, length = (travelled.get(id) ?? 0) + Math.abs(delta);
        if (Math.sign(delta) !== state.directions.get(id) || length > arc.edge.length + EPS) { bounded = false; break; }
        travelled.set(id, length);
      }
      if (!bounded) { failure = "endpoint-pair-direction-or-wrap"; continue; }
      const geometry = piecesFor(arcs.flat()); if (!geometry) { failure = geometryFailure; continue; }
      const fixed: PathMovementSupportPiece[] = [
        { a: start, b: from.point, edgeId: first.edge.edge.id, connector: "entry" }, ...geometry,
        { a: to.point, b: end, edgeId: last.edge.edge.id, connector: "exit" },
      ];
      const perEdge = new Map<string, Set<number>[]>();
      const supports = (index: number, cell: number, edgeId: string) => {
        let allowed = perEdge.get(edgeId);
        if (!allowed) { const edge = entry.edges!.get(edgeId)!; allowed = run.map((_, i) => permission([i], edge, [i - 1, i])); perEdge.set(edgeId, allowed); }
        return allowed[index]?.has(cell) ?? false;
      };
      const validation = validatePathMovementSupport({ pieces: fixed, originalCount: run.length, width: entry.width, height: entry.height,
        fromCell: run[0], toCell: run.at(-1)!, supports, canStep });
      if (!validation.valid) { failure = validation.failureDetails!; continue; }
      // Feed the SAME accepted occupancy trace to final assembly validation.
      // No union of losing support/authority states can authorize a seam.
      const pieces: Piece[] = validation.pieces.map(piece => ({ a: piece.a, b: piece.b, allowed: new Set([piece.cell]), edgeId: piece.edgeId }));
      accepted.set(physicalKey(arcs.flat()), { pieces, clearanceCells: validation.usedCells.filter(cell => !originalSet.has(cell)) });
      break; // Equivalent endpoint pairs stay on this frozen physical itinerary.
    }
  }
  if (accepted.size !== 1) return { failure: accepted.size ? `ambiguous-directed-itinerary:${accepted.size}` : failure };
  return [...accepted.values()][0];
}

function collapseCollinear(points: readonly Point[]): Point[] {
  const result: Point[] = [];
  for (const point of points) {
    if (result.length && distance(result.at(-1)!, point) < EPS) continue;
    while (result.length > 1) {
      const a = result.at(-2)!, b = result.at(-1)!;
      const ux = b.x - a.x, uy = b.y - a.y, vx = point.x - b.x, vy = point.y - b.y;
      if (Math.abs(ux * vy - uy * vx) > 1e-12 || ux * vx + uy * vy <= 0) break;
      result.pop();
    }
    result.push({ ...point });
  }
  return result;
}

/** Only presentation waypoints change. No search, economic, or terrain authority is replaced. */
export function adaptPathMovementRoute(options: PathMovementOptions): PathMovementResult {
  const result: PathMovementResult = { waypoints: copy(options.waypoints), alignedRuns: 0, fallbackRuns: 0, reasons: [], presentationClearanceCells: [] };
  const { course, cells } = options;
  if (cells.length < 2 || !cells.some(point => course.tiles[Math.round(point.y) * course.width + Math.round(point.x)] === "path")) return result;
  const entry = context(course, options.geometryVersion); prepare(course, entry);
  const authority = options.canStep ? null : walkPathAuthority(course);
  const canStep = options.canStep ?? ((a, b) => authority!.isWalkable(b.x, b.y) && (!((a.x !== b.x) && (a.y !== b.y)) || authority!.isWalkable(a.x, b.y) && authority!.isWalkable(b.x, a.y)));
  const pieces: Piece[] = []; const originalPermission = new Set(cells.map(point => Math.round(point.y) * course.width + Math.round(point.x)));
  let cursor = world(options.from);
  const append = (point: Point, allowed = originalPermission) => {
    const target = world(point); pieces.push({ a: cursor, b: target, allowed }); cursor = target;
  };
  let pathRuns = 0;
  for (let i = 0; i < cells.length;) {
    if (course.tiles[Math.round(cells[i].y) * course.width + Math.round(cells[i].x)] !== "path") { append(cells[i]); i++; continue; }
    pathRuns++;
    let endIndex = i; while (endIndex + 1 < cells.length && course.tiles[Math.round(cells[endIndex + 1].y) * course.width + Math.round(cells[endIndex + 1].x)] === "path") endIndex++;
    const start = i === 0 ? options.from : cells[i], end = endIndex === cells.length - 1 ? options.to : cells[endIndex];
    append(start);
    const match = endIndex > i ? alignRun(course, entry, cells.slice(i, endIndex + 1), world(start), world(end), canStep) : { failure: "isolated-route-cell" };
    if ("pieces" in match) {
      pieces.push(...match.pieces); cursor = world(end); result.alignedRuns++;
      result.presentationClearanceCells.push(...match.clearanceCells);
    } else {
      for (let index = i; index <= endIndex; index++) append(cells[index]);
      result.fallbackRuns++; result.reasons.push(endIndex === i ? "isolated-route-cell" : "no-legal-centerline-match");
      result.failureDetails = [result.failureDetails, match.failure].filter(Boolean).join(";");
    }
    i = endIndex + 1;
  }
  if (result.alignedRuns) {
    append(options.to);
    const validation = validatePieces(pieces, options.from, options.to, entry, canStep);
    if (!validation.valid) {
      result.alignedRuns = 0; result.fallbackRuns = pathRuns; result.presentationClearanceCells = [];
      result.reasons = ["whole-polyline-authority-fallback"]; result.failureDetails = "sample/node/connector seam or endpoint occupancy";
    } else {
      // collapseCollinear preserves the same forward geometric polyline. All
      // original progress/edge permissions were checked before removing vertices.
      result.waypoints = collapseCollinear([pieces[0].a, ...pieces.map(piece => piece.b)]).slice(1).map(legacy);
      const accepted = new Set(validation.usedCells);
      result.presentationClearanceCells = [...new Set(result.presentationClearanceCells)].filter(cell => accepted.has(cell)).sort((a, b) => a - b);
    }
  }
  return result;
}

const routeAuthorities = new WeakMap<Point[], { distance: number; originalWaypoints: Point[] }>();
/** Bound once per live planning/reconcile snapshot; walkCache remains the cache owner. */
export function createPathWalkingRouter(course: Course, cache: Map<string, Point[] | null>) {
  // Existing live reconciliation recreates this router after terrain edits.
  // Saved handles/width are still checked on each query, even on the same course.
  const revision = terrainRevision(course);
  return (from: Point, to: Point): Point[] | { waypoints: Point[]; distance: number; originalWaypoints: Point[] } | null => {
    const geometry = pathMovementPlanKey(course, revision);
    const key = `${geometry}:${from.x},${from.y}>${to.x},${to.y}`;
    if (cache.has(key)) { const hit = cache.get(key)!; if (!hit) return null; const authority = routeAuthorities.get(hit); return authority === undefined ? copy(hit) : { waypoints: copy(hit), distance: authority.distance, originalWaypoints: copy(authority.originalWaypoints) }; }
    const original = findWalkPath(course, from, to); if (!original) { cache.set(key, null); return null; }
    const cells = findWalkPathCells(course, from, to)!;
    const adapted = adaptPathMovementRoute({ course, from, to, cells, waypoints: original, geometryVersion: revision });
    cache.set(key, adapted.waypoints);
    if (!adapted.alignedRuns) return copy(adapted.waypoints);
    let cursor = from, originalDistance = 0;
    for (const point of original) { originalDistance += distance(cursor, point); cursor = point; }
    routeAuthorities.set(adapted.waypoints, { distance: originalDistance, originalWaypoints: copy(original) });
    return { waypoints: copy(adapted.waypoints), distance: originalDistance, originalWaypoints: copy(original) };
  };
}
