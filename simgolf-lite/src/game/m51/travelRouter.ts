import type { Course, Point, Terrain } from "../models/types";
import { getElevation } from "../models/elevation";
import { findWalkPath, findWalkPathCells, walkPathAuthority, type WalkPathAuthority } from "../live/walkPath";
import type { MobilityMode } from "./types";
import { mobilityRouteCacheKey } from "./mobility";

export type MobilityWeatherRestriction = "dry" | "wet" | "cart_path_only";

export interface MobilityRouteConditions {
  weather?: MobilityWeatherRestriction;
  /** Operational restriction identity is deliberately part of the cache key. */
  restrictionId?: string;
  cartPathOnly?: boolean;
}

export interface MobilityModeProfile {
  mode: MobilityMode;
  minutesPerTile: number;
  diagonalMultiplier: number;
  uphillMinutesPerStep: number;
  /** Carts are allowed off path in dry weather but prefer authored paths. */
  terrainMinutes: Partial<Record<Terrain, number>>;
  permitsBoardwalk: boolean;
  maxSlope: number;
}

export const MOBILITY_MODE_PROFILES: Record<MobilityMode, MobilityModeProfile> = {
  walk: {
    mode: "walk", minutesPerTile: .15, diagonalMultiplier: Math.SQRT2, uphillMinutesPerStep: .03,
    terrainMinutes: {}, permitsBoardwalk: true, maxSlope: Number.MAX_SAFE_INTEGER,
  },
  pushcart: {
    mode: "pushcart", minutesPerTile: .115, diagonalMultiplier: Math.SQRT2, uphillMinutesPerStep: .075,
    terrainMinutes: { path: .7, fairway: 1, rough: 1.25, deep_rough: 1.8, sand: 2.2, waste_area: 1.7, green: 1.1, tee: 1.1 },
    permitsBoardwalk: true, maxSlope: 1,
  },
  riding_cart: {
    mode: "riding_cart", minutesPerTile: .065, diagonalMultiplier: Math.SQRT2, uphillMinutesPerStep: .045,
    terrainMinutes: { path: .45, fairway: 1.35, rough: 2.5, deep_rough: 4, sand: 5, waste_area: 3.2, green: 2, tee: 1.7 },
    permitsBoardwalk: false, maxSlope: 1,
  },
};

export interface TimedMobilityLeg {
  requestedMode: MobilityMode;
  resolvedMode: MobilityMode;
  cacheKey: string;
  /** Full tile-by-tile evidence. Never simplify this before computing cost. */
  cells: Point[];
  /** Render-friendly corners only; derived from the complete evidence above. */
  waypoints: Point[];
  cost: number;
  minutes: number;
  expansions: number;
  fallback: "walk" | null;
}

export interface MobilityRouteRequest {
  course: Course;
  courseId: string;
  layoutId: string;
  mode: MobilityMode;
  from: Point;
  to: Point;
  conditions?: MobilityRouteConditions;
  /** Explicit geometry revision makes editor/restored snapshots cheap to invalidate. */
  geometryVersion?: string;
  maxExpansions?: number;
  allowWalkFallback?: boolean;
}

const MAX_CACHE_ENTRIES = 4_096;
const MAX_EXPANSIONS = 18_000;
const DIRS: Array<[number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const compare = (a: number, b: number) => a - b;

function inBounds(course: Course, x: number, y: number) { return x >= 0 && y >= 0 && x < course.width && y < course.height; }
function index(course: Course, x: number, y: number) { return y * course.width + x; }
function conditionsKey(conditions: MobilityRouteConditions | undefined) {
  return `${conditions?.weather ?? "dry"}:${conditions?.cartPathOnly ? "path" : "open"}:${conditions?.restrictionId ?? "none"}`;
}

/** Stable geometry fingerprint for cache invalidation after edits or restored snapshots. */
export function mobilityGeometryVersion(course: Course): string {
  let hash = 0x811c9dc5;
  const add = (value: string) => { for (let i = 0; i < value.length; i++) { hash ^= value.charCodeAt(i); hash = Math.imul(hash, 0x01000193); } };
  add(`${course.width}x${course.height}|${course.tiles.join(",")}|${course.elevations.join(",")}`);
  add((course.buildings ?? []).map((b) => `${b.id}:${b.type}:${b.x}:${b.y}`).sort().join("|"));
  add((course.decorations ?? []).map((d) => `${d.kind}:${d.x}:${d.y}:${d.rotation}:${d.span ?? 0}`).sort().join("|"));
  return (hash >>> 0).toString(16);
}

export function mobilityTimedLegCacheKey(request: MobilityRouteRequest): string {
  const geometry = request.geometryVersion ?? mobilityGeometryVersion(request.course);
  return `${mobilityRouteCacheKey({ courseId: request.courseId, layoutId: request.layoutId, mode: request.mode, from: request.from, to: request.to })}:g${geometry}:r${conditionsKey(request.conditions)}`;
}

function cloneLeg(leg: TimedMobilityLeg): TimedMobilityLeg {
  return { ...leg, cells: leg.cells.map((point) => ({ ...point })), waypoints: leg.waypoints.map((point) => ({ ...point })) };
}

/** Bounded deterministic cache. A geometry/restriction key change is invalidation. */
export class TimedMobilityLegCache {
  private readonly entries = new Map<string, TimedMobilityLeg>();
  get(key: string): TimedMobilityLeg | undefined { const hit = this.entries.get(key); return hit ? cloneLeg(hit) : undefined; }
  set(key: string, leg: TimedMobilityLeg): void {
    if (!this.entries.has(key) && this.entries.size >= MAX_CACHE_ENTRIES) this.entries.delete(this.entries.keys().next().value as string);
    this.entries.set(key, cloneLeg(leg));
  }
  clear(): void { this.entries.clear(); }
  get size(): number { return this.entries.size; }
}

function simplify(cells: Point[]): Point[] {
  if (cells.length <= 1) return cells.map((point) => ({ ...point }));
  const result: Point[] = [];
  let dx = 0; let dy = 0;
  for (let i = 1; i < cells.length; i++) {
    const nextDx = Math.sign(cells[i].x - cells[i - 1].x); const nextDy = Math.sign(cells[i].y - cells[i - 1].y);
    if (i > 1 && (nextDx !== dx || nextDy !== dy)) result.push({ ...cells[i - 1] });
    dx = nextDx; dy = nextDy;
  }
  result.push({ ...cells[cells.length - 1] });
  return result;
}

function timedWalkLeg(request: MobilityRouteRequest, cacheKey: string): TimedMobilityLeg | null {
  const cells = findWalkPathCells(request.course, request.from, request.to, request.maxExpansions ?? MAX_EXPANSIONS);
  if (!cells) return null;
  let cost = 0;
  for (let i = 1; i < cells.length; i++) cost += Math.hypot(cells[i].x - cells[i - 1].x, cells[i].y - cells[i - 1].y);
  return { requestedMode: request.mode, resolvedMode: "walk", cacheKey, cells, waypoints: findWalkPath(request.course, request.from, request.to, request.maxExpansions ?? MAX_EXPANSIONS) ?? simplify(cells), cost, minutes: cost * MOBILITY_MODE_PROFILES.walk.minutesPerTile, expansions: cells.length, fallback: request.mode === "walk" ? null : "walk" };
}

function cartPassable(request: MobilityRouteRequest, profile: MobilityModeProfile, authority: WalkPathAuthority, x: number, y: number, fromIndex: number | null): boolean {
  const { course, conditions } = request;
  if (!authority.isWalkable(x, y)) return false;
  const tileIndex = index(course, x, y);
  const terrain = course.tiles[tileIndex];
  const onBridge = authority.bridges.has(tileIndex);
  const boardwalk = onBridge && terrain === "wetland";
  // Rental equipment never enters authored play surfaces or hazards. When an
  // itinerary endpoint is there, the caller receives the legal walk fallback.
  if (terrain === "green" || terrain === "tee" || terrain === "sand") return false;
  if ((terrain === "water" && !onBridge) || (boardwalk && !profile.permitsBoardwalk)) return false;
  if (terrain === "wetland" && !onBridge) return false;
  if ((conditions?.cartPathOnly || conditions?.weather === "wet" || conditions?.weather === "cart_path_only") && terrain !== "path" && !onBridge) return false;
  if (fromIndex != null && Math.abs(getElevation(course, x, y) - getElevation(course, fromIndex % course.width, Math.floor(fromIndex / course.width))) > profile.maxSlope) return false;
  return true;
}

function stepCost(course: Course, profile: MobilityModeProfile, from: number, to: number): number {
  const x = to % course.width; const y = Math.floor(to / course.width);
  const px = from % course.width; const py = Math.floor(from / course.width);
  const terrain = course.tiles[to];
  const diagonal = x !== px && y !== py;
  const elevation = Math.max(0, getElevation(course, x, y) - getElevation(course, px, py));
  return profile.minutesPerTile * (profile.terrainMinutes[terrain] ?? 1) * (diagonal ? profile.diagonalMultiplier : 1) + elevation * profile.uphillMinutesPerStep;
}

interface HeapEntry { cell: number; cost: number; }
function push(heap: HeapEntry[], entry: HeapEntry) { heap.push(entry); for (let i = heap.length - 1; i > 0;) { const parent = Math.floor((i - 1) / 2); if (compare(heap[parent].cost, entry.cost) <= 0) break; heap[i] = heap[parent]; i = parent; heap[i] = entry; } }
function pop(heap: HeapEntry[]): HeapEntry | undefined { const top = heap[0]; const last = heap.pop(); if (!top || !last || heap.length === 0) return top; let i = 0; while (true) { let child = i * 2 + 1; if (child >= heap.length) break; if (child + 1 < heap.length && compare(heap[child + 1].cost, heap[child].cost) < 0) child++; if (compare(heap[child].cost, last.cost) >= 0) break; heap[i] = heap[child]; i = child; } heap[i] = last; return top; }

function weightedCartLeg(request: MobilityRouteRequest, cacheKey: string): TimedMobilityLeg | null {
  const profile = MOBILITY_MODE_PROFILES[request.mode];
  const sx = Math.round(request.from.x); const sy = Math.round(request.from.y); const tx = Math.round(request.to.x); const ty = Math.round(request.to.y);
  const authority = walkPathAuthority(request.course);
  if (!inBounds(request.course, sx, sy) || !inBounds(request.course, tx, ty) || !cartPassable(request, profile, authority, sx, sy, null) || !cartPassable(request, profile, authority, tx, ty, null)) return null;
  const start = index(request.course, sx, sy); const goal = index(request.course, tx, ty); const costs = new Float64Array(request.course.width * request.course.height); costs.fill(Number.POSITIVE_INFINITY); costs[start] = 0;
  const previous = new Int32Array(costs.length); previous.fill(-1); const heap: HeapEntry[] = []; push(heap, { cell: start, cost: 0 });
  let expansions = 0;
  while (heap.length && expansions < (request.maxExpansions ?? MAX_EXPANSIONS)) {
    const current = pop(heap)!; if (current.cost !== costs[current.cell]) continue; if (++expansions && current.cell === goal) break;
    const cx = current.cell % request.course.width; const cy = Math.floor(current.cell / request.course.width);
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx; const ny = cy + dy;
      if (!cartPassable(request, profile, authority, nx, ny, current.cell)) continue;
      if (dx && dy && (!cartPassable(request, profile, authority, cx + dx, cy, current.cell) || !cartPassable(request, profile, authority, cx, cy + dy, current.cell))) continue;
      const next = index(request.course, nx, ny); const candidate = current.cost + stepCost(request.course, profile, current.cell, next);
      if (candidate >= costs[next]) continue;
      costs[next] = candidate; previous[next] = current.cell; push(heap, { cell: next, cost: candidate });
    }
  }
  if (!Number.isFinite(costs[goal])) return null;
  const cells: Point[] = []; for (let cell = goal; cell >= 0; cell = previous[cell]) { cells.push({ x: cell % request.course.width, y: Math.floor(cell / request.course.width) }); if (cell === start) break; }
  cells.reverse();
  return { requestedMode: request.mode, resolvedMode: request.mode, cacheKey, cells, waypoints: simplify(cells), cost: costs[goal], minutes: costs[goal], expansions, fallback: null };
}

/** One deterministic router for all mobility modes. Walk deliberately delegates to the legacy authority. */
export function planTimedMobilityLeg(request: MobilityRouteRequest, cache?: TimedMobilityLegCache): TimedMobilityLeg | null {
  const cacheKey = mobilityTimedLegCacheKey(request); const cached = cache?.get(cacheKey); if (cached) return cached;
  const direct = request.mode === "walk" ? timedWalkLeg(request, cacheKey) : weightedCartLeg(request, cacheKey);
  const result = direct ?? (request.mode !== "walk" && request.allowWalkFallback !== false ? timedWalkLeg(request, cacheKey) : null);
  if (result) cache?.set(cacheKey, result);
  return result;
}

/** Read-only prediction seam for Architecture Review and later mobility decisions. */
export function predictMobilityTravel(request: MobilityRouteRequest): TimedMobilityLeg | null {
  return planTimedMobilityLeg(request);
}
