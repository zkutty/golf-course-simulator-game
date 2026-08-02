import type { Course, Point } from "../models/types";
import { computeElevationChangeCost } from "../models/terrainEconomics";
import { isOwnedTile } from "../estate/estate";
import {
  GREEN_SURFACE_FIXED_POINT_SCALE,
  GREEN_SURFACE_MAX_OFFSET_FIXED,
  GREEN_SURFACE_SAMPLES_PER_AXIS,
  createFlatGreenSurfaceV1,
  normalizeGreenSurfaceV1,
  type GreenSurfaceTileV1,
  type GreenSurfaceV1,
} from "./greenSurface";

export type FineGreenBrush =
  | "raise"
  | "lower"
  | "smooth"
  | "tilt"
  | "ridge"
  | "bowl"
  | "flatten";

export const FINE_GREEN_BRUSHES: readonly FineGreenBrush[] = [
  "raise", "lower", "smooth", "tilt", "ridge", "bowl", "flatten",
] as const;

export const FINE_GREEN_RADII = [0.5, 1, 1.5] as const;
export type FineGreenRadius = (typeof FINE_GREEN_RADII)[number];

/** One eighth of a coarse elevation step per fully weighted brush pass. */
export const FINE_GREEN_BRUSH_STEP_FIXED = 128;
const SAMPLE_DIVISIONS = GREEN_SURFACE_SAMPLES_PER_AXIS - 1;
const MAX_STROKE_POINTS = 2_048;

export interface FineGreenSculptPreview {
  surface: GreenSurfaceV1;
  changedSamples: number;
  clippedPoints: number;
  earthworkSteps: number;
  netCost: number;
  affectedTiles: Array<{ x: number; y: number }>;
}

interface NodeMember {
  x: number;
  y: number;
  sampleX: number;
  sampleY: number;
  base: number;
}

interface FineNode {
  key: string;
  x: number;
  y: number;
  members: NodeMember[];
  height: number;
  originalHeight: number;
  boundary: boolean;
}

const finite = (value: number, fallback = 0) => Number.isFinite(value) ? value : fallback;
const clamp = (value: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(maximum, value));
const tileKey = (x: number, y: number) => `${x},${y}`;
const nodeKey = (x: number, y: number) => `${x},${y}`;

function coarseFixed(course: Course, x: number, y: number): number {
  return Math.round(finite(course.elevations?.[y * course.width + x] ?? 0) * GREEN_SURFACE_FIXED_POINT_SCALE);
}

function surfaceTileMap(surface: GreenSurfaceV1 | undefined): Map<string, readonly number[]> {
  return new Map((surface?.tiles ?? []).map((tile) => [tileKey(tile.x, tile.y), tile.offsets]));
}

function offsetAt(
  offsets: ReadonlyMap<string, readonly number[]>,
  x: number,
  y: number,
  sampleX: number,
  sampleY: number,
): number {
  return offsets.get(tileKey(x, y))?.[sampleY * GREEN_SURFACE_SAMPLES_PER_AXIS + sampleX] ?? 0;
}

function isGreen(course: Course, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < course.width && y < course.height
    && course.tiles[y * course.width + x] === "green";
}

function isBoundarySample(course: Course, member: NodeMember): boolean {
  return (member.sampleX === 0 && !isGreen(course, member.x - 1, member.y))
    || (member.sampleX === SAMPLE_DIVISIONS && !isGreen(course, member.x + 1, member.y))
    || (member.sampleY === 0 && !isGreen(course, member.x, member.y - 1))
    || (member.sampleY === SAMPLE_DIVISIONS && !isGreen(course, member.x, member.y + 1));
}

function candidateTiles(course: Course, points: readonly Point[], radius: number): Array<{ x: number; y: number }> {
  const candidates = new Map<string, { x: number; y: number }>();
  for (const point of points.slice(0, MAX_STROKE_POINTS)) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
    const minX = Math.max(0, Math.floor(point.x - radius) - 1);
    const maxX = Math.min(course.width - 1, Math.floor(point.x + radius) + 1);
    const minY = Math.max(0, Math.floor(point.y - radius) - 1);
    const maxY = Math.min(course.height - 1, Math.floor(point.y + radius) + 1);
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      if (isGreen(course, x, y) && isOwnedTile(course, x, y)) candidates.set(tileKey(x, y), { x, y });
    }
  }
  return [...candidates.values()].sort((left, right) => left.y - right.y || left.x - right.x);
}

function buildNodes(course: Course, tiles: readonly { x: number; y: number }[]): Map<string, FineNode> {
  const offsets = surfaceTileMap(normalizeGreenSurfaceV1(course.greenSurface, course));
  const nodes = new Map<string, FineNode>();
  for (const tile of tiles) {
    const base = coarseFixed(course, tile.x, tile.y);
    for (let sampleY = 0; sampleY < GREEN_SURFACE_SAMPLES_PER_AXIS; sampleY++) {
      for (let sampleX = 0; sampleX < GREEN_SURFACE_SAMPLES_PER_AXIS; sampleX++) {
        const gx = tile.x * SAMPLE_DIVISIONS + sampleX;
        const gy = tile.y * SAMPLE_DIVISIONS + sampleY;
        const key = nodeKey(gx, gy);
        const member: NodeMember = { x: tile.x, y: tile.y, sampleX, sampleY, base };
        const height = base + offsetAt(offsets, tile.x, tile.y, sampleX, sampleY);
        const existing = nodes.get(key);
        if (existing) {
          const count = existing.members.length;
          existing.height = Math.round((existing.height * count + height) / (count + 1));
          existing.originalHeight = Math.round((existing.originalHeight * count + height) / (count + 1));
          existing.members.push(member);
          existing.boundary ||= isBoundarySample(course, member);
        } else {
          nodes.set(key, {
            key,
            x: gx / SAMPLE_DIVISIONS,
            y: gy / SAMPLE_DIVISIONS,
            members: [member],
            height,
            originalHeight: height,
            boundary: isBoundarySample(course, member),
          });
        }
      }
    }
  }
  return nodes;
}

function nearestHeight(nodes: ReadonlyMap<string, FineNode>, point: Point): number {
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestHeight = 0;
  for (const node of nodes.values()) {
    const distance = (node.x - point.x) ** 2 + (node.y - point.y) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      bestHeight = node.height;
    }
  }
  return bestHeight;
}

function neighborAverage(nodes: ReadonlyMap<string, FineNode>, node: FineNode): number {
  const gx = Math.round(node.x * SAMPLE_DIVISIONS);
  const gy = Math.round(node.y * SAMPLE_DIVISIONS);
  let sum = 0;
  let count = 0;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (dx === 0 && dy === 0) continue;
    const neighbor = nodes.get(nodeKey(gx + dx, gy + dy));
    if (!neighbor) continue;
    sum += neighbor.height;
    count++;
  }
  return count > 0 ? Math.round(sum / count) : node.height;
}

function strokeDirection(points: readonly Point[]): Point {
  const first = points[0];
  const last = points[points.length - 1];
  const dx = finite(last?.x ?? 0) - finite(first?.x ?? 0);
  const dy = finite(last?.y ?? 0) - finite(first?.y ?? 0);
  const length = Math.hypot(dx, dy);
  return length >= 0.05 ? { x: dx / length, y: dy / length } : { x: 1, y: 0 };
}

function boundedSharedHeight(node: FineNode, requested: number): number {
  let minimum = Number.NEGATIVE_INFINITY;
  let maximum = Number.POSITIVE_INFINITY;
  for (const member of node.members) {
    minimum = Math.max(minimum, member.base - GREEN_SURFACE_MAX_OFFSET_FIXED);
    maximum = Math.min(maximum, member.base + GREEN_SURFACE_MAX_OFFSET_FIXED);
  }
  return Math.round(clamp(finite(requested, node.originalHeight), minimum, maximum));
}

function applyBrush(
  nodes: Map<string, FineNode>,
  points: readonly Point[],
  brush: FineGreenBrush,
  radius: number,
): void {
  const direction = strokeDirection(points);
  const targetHeight = nearestHeight(nodes, points[0] ?? { x: 0, y: 0 });
  const originals = new Map([...nodes].map(([key, node]) => [key, node.height]));

  for (const node of nodes.values()) {
    if (node.boundary) {
      // The perimeter remains on its coarse survey height, creating a safe
      // interpolation handoff to surrounding non-green terrain.
      const member = node.members[0];
      node.height = boundedSharedHeight(node, member.base);
      continue;
    }
    let nearestPoint: Point | null = null;
    let distance = Number.POSITIVE_INFINITY;
    for (const point of points) {
      const candidate = Math.hypot(node.x - point.x, node.y - point.y);
      if (candidate < distance) {
        distance = candidate;
        nearestPoint = point;
      }
    }
    if (!nearestPoint || distance > radius) continue;
    const weight = Math.max(0, 1 - distance / Math.max(0.001, radius));
    const step = Math.max(1, Math.round(FINE_GREEN_BRUSH_STEP_FIXED * weight));
    let requested = node.height;
    if (brush === "raise") requested += step;
    else if (brush === "lower") requested -= step;
    else if (brush === "smooth") {
      const gx = Math.round(node.x * SAMPLE_DIVISIONS);
      const gy = Math.round(node.y * SAMPLE_DIVISIONS);
      let sum = 0;
      let count = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const neighbor = nodes.get(nodeKey(gx + dx, gy + dy));
        if (!neighbor) continue;
        sum += originals.get(neighbor.key) ?? neighbor.height;
        count++;
      }
      const average = count > 0 ? sum / count : node.height;
      requested += (average - node.height) * Math.min(1, weight * 0.75);
    } else if (brush === "flatten") {
      requested += (targetHeight - node.height) * Math.min(1, weight);
    } else {
      const relX = node.x - nearestPoint.x;
      const relY = node.y - nearestPoint.y;
      const along = relX * direction.x + relY * direction.y;
      const across = -relX * direction.y + relY * direction.x;
      if (brush === "tilt") requested += FINE_GREEN_BRUSH_STEP_FIXED * weight * along / Math.max(radius, 0.5);
      else if (brush === "ridge") requested += FINE_GREEN_BRUSH_STEP_FIXED * weight * (1 - Math.min(1, Math.abs(across) / Math.max(radius, 0.5)));
      else requested -= FINE_GREEN_BRUSH_STEP_FIXED * weight;
    }
    node.height = boundedSharedHeight(node, requested);
  }

  // One final local relaxation prevents sharp one-sample spikes while keeping
  // authored tiers and ridges. The 3/4 authored + 1/4 neighborhood blend is
  // deterministic and still preserves brush direction.
  if (brush !== "smooth" && brush !== "flatten") {
    const authored = new Map([...nodes].map(([key, node]) => [key, node.height]));
    for (const node of nodes.values()) {
      if (node.boundary || node.height === node.originalHeight) continue;
      const average = neighborAverage(nodes, node);
      node.height = boundedSharedHeight(node, (authored.get(node.key) ?? node.height) * 0.75 + average * 0.25);
    }
  }
}

function writeSurface(course: Course, nodes: ReadonlyMap<string, FineNode>, touchedTiles: readonly { x: number; y: number }[]): GreenSurfaceV1 {
  const before = normalizeGreenSurfaceV1(course.greenSurface, course);
  const tileOffsets = new Map(before.tiles.map((tile) => [tileKey(tile.x, tile.y), [...tile.offsets]]));
  for (const tile of touchedTiles) tileOffsets.set(tileKey(tile.x, tile.y), new Array(16).fill(0));
  for (const node of nodes.values()) {
    for (const member of node.members) {
      const offsets = tileOffsets.get(tileKey(member.x, member.y));
      if (!offsets) continue;
      offsets[member.sampleY * GREEN_SURFACE_SAMPLES_PER_AXIS + member.sampleX] = clamp(
        Math.round(node.height - member.base),
        -GREEN_SURFACE_MAX_OFFSET_FIXED,
        GREEN_SURFACE_MAX_OFFSET_FIXED,
      );
    }
  }
  const tiles: GreenSurfaceTileV1[] = [];
  for (const [key, offsets] of tileOffsets) {
    const [x, y] = key.split(",").map(Number);
    if (offsets.some((offset) => offset !== 0)) tiles.push({ x, y, offsets });
  }
  return normalizeGreenSurfaceV1({ ...createFlatGreenSurfaceV1(), tiles }, course);
}

export function fineGreenEarthworkSteps(
  course: Pick<Course, "width" | "height" | "tiles">,
  beforeValue: unknown,
  afterValue: unknown,
): number {
  const before = surfaceTileMap(normalizeGreenSurfaceV1(beforeValue, course));
  const after = surfaceTileMap(normalizeGreenSurfaceV1(afterValue, course));
  const keys = new Set([...before.keys(), ...after.keys()]);
  let fixed = 0;
  for (const key of keys) for (let index = 0; index < 16; index++) {
    fixed += Math.abs((after.get(key)?.[index] ?? 0) - (before.get(key)?.[index] ?? 0));
  }
  // Sixteen samples constitute one tile-height field. This keeps fine work
  // proportional to existing coarse earthwork without a per-event minimum.
  return fixed / (GREEN_SURFACE_FIXED_POINT_SCALE * 16);
}

export function computeFineGreenSculptPreview(args: {
  course: Course;
  points: readonly Point[];
  brush: FineGreenBrush;
  radius: FineGreenRadius;
  costMult?: number;
}): FineGreenSculptPreview {
  const points = args.points.slice(0, MAX_STROKE_POINTS).filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  const current = normalizeGreenSurfaceV1(args.course.greenSurface, args.course);
  if (points.length === 0) return {
    surface: current,
    changedSamples: 0,
    clippedPoints: args.points.length,
    earthworkSteps: 0,
    netCost: 0,
    affectedTiles: [],
  };
  const tiles = candidateTiles(args.course, points, args.radius);
  if (tiles.length === 0) return {
    surface: current,
    changedSamples: 0,
    clippedPoints: points.length,
    earthworkSteps: 0,
    netCost: 0,
    affectedTiles: [],
  };
  const nodes = buildNodes(args.course, tiles);
  applyBrush(nodes, points, args.brush, args.radius);
  const surface = writeSurface(args.course, nodes, tiles);
  const before = surfaceTileMap(current);
  const after = surfaceTileMap(surface);
  const keys = new Set([...before.keys(), ...after.keys()]);
  let changedSamples = 0;
  for (const key of keys) for (let index = 0; index < 16; index++) {
    if ((before.get(key)?.[index] ?? 0) !== (after.get(key)?.[index] ?? 0)) changedSamples++;
  }
  const earthworkSteps = fineGreenEarthworkSteps(args.course, current, surface);
  return {
    surface,
    changedSamples,
    clippedPoints: points.filter((point) => !isGreen(args.course, Math.floor(point.x), Math.floor(point.y))).length,
    earthworkSteps,
    netCost: computeElevationChangeCost(earthworkSteps, args.costMult ?? 1, args.course.theme).net,
    affectedTiles: tiles,
  };
}
