import { hashCanonicalValue } from "../../utils/canonical";
import { BUILDING_SPECS } from "../models/buildings";
import { BIOME_KEYS, type LandTheme } from "../models/biomes";
import { DECORATION_KINDS } from "../models/decorations";
import { isPlantId } from "../models/plantRegistry";
import { PIN_ROTATIONS, TEE_SETS } from "../models/types";
import { SEASONS, type SeasonName } from "../seasons/types";
import {
  HOLE_ILLUSTRATION_ENDPOINT_MARKER_MIN_INNER_DIAMETER,
  HOLE_ILLUSTRATION_LAYER_ORDER,
  HOLE_ILLUSTRATION_RENDER_LIMITS,
  type HoleIllustrationEllipsePrimitive,
  type HoleIllustrationLayerId,
  type HoleIllustrationPolygonPrimitive,
  type HoleIllustrationRenderPlan,
  type HoleIllustrationRenderPoint,
  type HoleIllustrationRenderPrimitive,
  type HoleIllustrationSampleGridPrimitive,
} from "./renderPlan";
import { HOLE_ILLUSTRATION_CONTRASTS, resolveHoleIllustrationStyle } from "./style";

export const HOLE_ILLUSTRATION_RENDERER_VERSION = 1 as const;
export const HOLE_ILLUSTRATION_OUTPUT_LIMITS = Object.freeze({
  maxSvgCharacters: 32 * 1024 * 1024,
  maxRasterPixelRatio: 4,
  maxRasterPixels: 16_777_216,
  maxRasterBytes: 64 * 1024 * 1024,
  maxRasterPixelVisits: 100_000_000,
});

export type HoleIllustrationRendererFailureCode =
  | "INVALID_PLAN"
  | "INVALID_OPTIONS"
  | "ALLOCATION_EXCEEDED"
  | "OUTPUT_TOO_LARGE";

interface RendererFailure {
  readonly complete: false;
  readonly version: typeof HOLE_ILLUSTRATION_RENDERER_VERSION;
  readonly code: HoleIllustrationRendererFailureCode;
  readonly message: string;
}

export interface HoleIllustrationSvgOutput {
  readonly complete: true;
  readonly version: typeof HOLE_ILLUSTRATION_RENDERER_VERSION;
  readonly mimeType: "image/svg+xml";
  readonly width: number;
  readonly height: number;
  readonly planHash: string;
  readonly svg: string;
}

export interface HoleIllustrationRgbaOptions {
  readonly pixelRatio: number;
}

export interface HoleIllustrationRgbaOutput {
  readonly complete: true;
  readonly version: typeof HOLE_ILLUSTRATION_RENDERER_VERSION;
  readonly format: "rgba8";
  readonly width: number;
  readonly height: number;
  readonly stride: number;
  readonly pixelRatio: number;
  readonly planHash: string;
  readonly data: Uint8ClampedArray;
}

export interface HoleIllustrationRenderBudgetReport {
  readonly complete: true;
  readonly version: typeof HOLE_ILLUSTRATION_RENDERER_VERSION;
  readonly planHash: string;
  readonly svg: {
    readonly characters: number;
    readonly characterLimit: number;
    readonly withinLimit: boolean;
  };
  readonly rgba: {
    readonly pixelRatio: number;
    readonly width: number;
    readonly height: number;
    readonly pixels: number;
    readonly rgbaBytes: number;
    readonly coverageBytes: number;
    readonly allocationBytes: number;
    readonly estimatedPixelVisits: number;
    /** False only when the estimate uses limit + 1 as a fail-closed exceeded sentinel. */
    readonly pixelVisitEstimateExact: boolean;
    readonly pixelLimit: number;
    readonly allocationByteLimit: number;
    readonly pixelVisitLimit: number;
    readonly withinLimits: boolean;
  };
}

export type HoleIllustrationSvgResult = HoleIllustrationSvgOutput | RendererFailure;
export type HoleIllustrationRgbaResult = HoleIllustrationRgbaOutput | RendererFailure;
export type HoleIllustrationRenderBudgetResult = HoleIllustrationRenderBudgetReport | RendererFailure;

interface Paint {
  readonly fill?: string;
  readonly stroke?: string;
  readonly strokeWidth?: number;
  readonly opacity?: number;
}

const COLOR = /^#[0-9a-fA-F]{6}$/;
const PLAN_HASH = /^[0-9a-f]{8}$/;
const SNAPSHOT_HASH = /^[0-9a-f]{64}$/;
// Exact extrema emitted by the Wave 2 producer at the legal one-pixel short axis.
// validProducerPlan still reconstructs every accepted stroke and radius exactly.
const MAX_PRODUCER_NORMALIZED_STROKE_WIDTH = 3;
const MAX_PRODUCER_NORMALIZED_ELLIPSE_RADIUS = 2;
// Snapshot courses are bounded by total area, not by either individual axis.
// With a positive opposite axis, 65,536 cells is the tightest retained-data-safe
// upper bound for a recovered zero-based course coordinate.
const MAX_COURSE_AXIS = HOLE_ILLUSTRATION_RENDER_LIMITS.maxSourceCells;
const TERRAIN_KINDS = new Set([
  "fairway", "rough", "deep_rough", "sand", "waste_area",
  "water", "wetland", "green", "tee", "path",
]);
const DECORATION_KINDS_SET = new Set<string>(DECORATION_KINDS);

function failure(code: HoleIllustrationRendererFailureCode, message: string): RendererFailure {
  return { complete: false, version: HOLE_ILLUSTRATION_RENDERER_VERSION, code, message };
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function boundedText(value: unknown, maximum = 256): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum) return false;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code === 9 || code === 10 || code === 13 || (code >= 32 && code <= 0xd7ff)
      || (code >= 0xe000 && code <= 0xfffd)) continue;
    if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
      const low = value.charCodeAt(index + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        index++;
        continue;
      }
    }
    return false;
  }
  return true;
}

function validColor(value: unknown): value is string {
  return typeof value === "string" && COLOR.test(value);
}

function point(value: unknown): HoleIllustrationRenderPoint | null {
  if (!record(value) || !finite(value.x) || !finite(value.y)
    || value.x < 0 || value.x > 1 || value.y < 0 || value.y > 1) return null;
  return { x: value.x, y: value.y };
}

function points(value: unknown, minimum: number, maximum: number): HoleIllustrationRenderPoint[] | null {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) return null;
  const result: HoleIllustrationRenderPoint[] = [];
  for (const raw of value) {
    const candidate = point(raw);
    if (!candidate) return null;
    result.push(candidate);
  }
  return result;
}

function paint(value: Record<string, unknown>, shortViewportAxis: number): Paint | null {
  if (value.fill !== undefined && !validColor(value.fill)) return null;
  if (value.stroke !== undefined && !validColor(value.stroke)) return null;
  if (value.fill === undefined && value.stroke === undefined) return null;
  if (value.stroke === undefined && value.strokeWidth !== undefined) return null;
  if (value.stroke !== undefined && (!finite(value.strokeWidth) || value.strokeWidth <= 0
    || value.strokeWidth > MAX_PRODUCER_NORMALIZED_STROKE_WIDTH
    || value.strokeWidth * shortViewportAxis + 1e-9 < 1)) return null;
  if (value.opacity !== undefined && (!finite(value.opacity) || value.opacity < 0 || value.opacity > 1)) return null;
  return {
    ...(value.fill !== undefined ? { fill: value.fill as string } : {}),
    ...(value.stroke !== undefined ? { stroke: value.stroke as string } : {}),
    ...(value.strokeWidth !== undefined ? { strokeWidth: value.strokeWidth as number } : {}),
    ...(value.opacity !== undefined ? { opacity: value.opacity as number } : {}),
  };
}

function primitive(value: unknown, shortViewportAxis: number): HoleIllustrationRenderPrimitive | null {
  if (!record(value) || !boundedText(value.id) || !boundedText(value.semantic, 4_096)) return null;
  const resolvedPaint = paint(value, shortViewportAxis);
  if (!resolvedPaint) return null;
  const base = { id: value.id, semantic: value.semantic, ...resolvedPaint };
  if (value.kind === "polygon") {
    const vertices = points(value.points, 3, 66);
    return vertices ? { ...base, kind: "polygon", points: vertices } : null;
  }
  if (value.kind === "polyline") {
    const vertices = points(value.points, 2, 66);
    if (!vertices || typeof value.closed !== "boolean") return null;
    if (!value.closed && resolvedPaint.fill !== undefined) return null;
    return { ...base, kind: "polyline", points: vertices, closed: value.closed };
  }
  if (value.kind === "ellipse") {
    const center = point(value.center);
    if (!center || !record(value.radius) || !finite(value.radius.x) || !finite(value.radius.y)
      || value.radius.x <= 0 || value.radius.x > MAX_PRODUCER_NORMALIZED_ELLIPSE_RADIUS
      || value.radius.y <= 0 || value.radius.y > MAX_PRODUCER_NORMALIZED_ELLIPSE_RADIUS) return null;
    return { ...base, kind: "ellipse", center, radius: { x: value.radius.x, y: value.radius.y } };
  }
  if (value.kind === "sample-grid") {
    if (!Array.isArray(value.samples) || value.samples.length !== 16 || !record(value.markerRadius)
      || !finite(value.markerRadius.x) || !finite(value.markerRadius.y)
      || value.markerRadius.x <= 0 || value.markerRadius.x > 1
      || value.markerRadius.y <= 0 || value.markerRadius.y > 1) return null;
    const samples: Array<{ point: HoleIllustrationRenderPoint; value: number }> = [];
    for (const raw of value.samples) {
      if (!record(raw) || !Number.isInteger(raw.value) || (raw.value as number) < -2_048 || (raw.value as number) > 2_048) return null;
      const samplePoint = point(raw.point);
      if (!samplePoint) return null;
      samples.push({ point: samplePoint, value: raw.value as number });
    }
    return {
      ...base,
      kind: "sample-grid",
      samples,
      markerRadius: { x: value.markerRadius.x, y: value.markerRadius.y },
    };
  }
  return null;
}

function approximately(left: number, right: number): boolean {
  return Math.abs(left - right) <= 0.000_001;
}

function frame(value: unknown, mode: HoleIllustrationRenderPlan["settings"]["frame"]): HoleIllustrationRenderPlan["frame"] | null {
  if (!record(value) || value.mode !== mode
    || !record(value.originCourse) || !record(value.matrix) || !record(value.translation) || !record(value.crop)
    || !finite(value.originCourse.x) || !finite(value.originCourse.y)
    || !finite(value.rotationDegrees) || !finite(value.matrix.a) || !finite(value.matrix.b)
    || !finite(value.matrix.c) || !finite(value.matrix.d) || !finite(value.translation.x)
    || !finite(value.translation.y) || !finite(value.crop.width) || !finite(value.crop.height)
    || value.crop.width <= 0 || value.crop.height <= 0
    || value.crop.width > (mode === "north-up" ? 256 : HOLE_ILLUSTRATION_RENDER_LIMITS.maxFrameSpan)
    || value.crop.height > (mode === "north-up" ? 256 : HOLE_ILLUSTRATION_RENDER_LIMITS.maxFrameSpan)
    || !finite(value.scaleToUnit) || value.scaleToUnit <= 0
    || !approximately(value.scaleToUnit, 1 / Math.max(value.crop.width, value.crop.height))) return null;
  if (mode === "north-up") {
    if (!Number.isInteger(value.crop.width) || !Number.isInteger(value.crop.height)
      || value.originCourse.x !== 0 || value.originCourse.y !== 0 || value.rotationDegrees !== 0
      || value.matrix.a !== 1 || value.matrix.b !== 0 || value.matrix.c !== 0 || value.matrix.d !== 1
      || !Number.isInteger(value.translation.x) || !Number.isInteger(value.translation.y)) return null;
  } else {
    const firstNorm = value.matrix.a ** 2 + value.matrix.b ** 2;
    const secondNorm = value.matrix.c ** 2 + value.matrix.d ** 2;
    const dot = value.matrix.a * value.matrix.c + value.matrix.b * value.matrix.d;
    const determinant = value.matrix.a * value.matrix.d - value.matrix.b * value.matrix.c;
    const rotation = Math.atan2(value.matrix.b, value.matrix.a) * 180 / Math.PI;
    if (!Number.isSafeInteger(value.originCourse.x) || !Number.isSafeInteger(value.originCourse.y)
      || value.originCourse.x < 0 || value.originCourse.x >= 256
      || value.originCourse.y < 0 || value.originCourse.y >= 256
      || !approximately(firstNorm, 1) || !approximately(secondNorm, 1)
      || !approximately(dot, 0) || !approximately(determinant, 1)
      || !approximately(value.rotationDegrees, rotation)) return null;
  }
  return {
    mode,
    originCourse: { x: value.originCourse.x, y: value.originCourse.y },
    rotationDegrees: value.rotationDegrees,
    matrix: { a: value.matrix.a, b: value.matrix.b, c: value.matrix.c, d: value.matrix.d },
    translation: { x: value.translation.x, y: value.translation.y },
    crop: { width: value.crop.width, height: value.crop.height },
    scaleToUnit: value.scaleToUnit,
  };
}

function primitiveMatchesLayer(
  layer: HoleIllustrationLayerId,
  item: HoleIllustrationRenderPrimitive,
  palette: ReturnType<typeof resolveHoleIllustrationStyle>,
  contrast: HoleIllustrationRenderPlan["settings"]["contrast"],
): boolean {
  const fillOnly = (color: string) => item.fill === color && item.stroke === undefined;
  const filledAndStroked = (fill: string, stroke: string) =>
    item.fill === fill && item.stroke === stroke && item.strokeWidth !== undefined;
  if (layer === "terrain") {
    if (item.kind !== "polygon" || item.points.length !== 4 || !/^terrain-\d+-\d+-\d+$/.test(item.id)
      || !item.semantic.startsWith("terrain:")) return false;
    const terrain = item.semantic.slice("terrain:".length) as keyof typeof palette.terrain;
    const color = palette.terrain[terrain];
    return TERRAIN_KINDS.has(terrain) && typeof color === "string" && item.fill === color && item.opacity === undefined
      && (contrast === "high-contrast"
        ? item.stroke === palette.ink && item.strokeWidth !== undefined
        : item.stroke === undefined);
  }
  if (layer === "elevation-contours") {
    if (item.kind === "polygon") {
      const elevation = Number(item.semantic.slice("elevation:".length));
      return item.points.length === 4 && /^elevation-\d+-\d+-\d+$/.test(item.id)
        && item.semantic === `elevation:${elevation}` && Number.isFinite(elevation)
        && (fillOnly(palette.elevation.low) || fillOnly(palette.elevation.high));
    }
    return item.kind === "sample-grid" && /^contour-\d+-\d+-\d+$/.test(item.id)
      && item.semantic === "contour:bilinear-fixed-1024"
      && fillOnly(palette.contour) && item.opacity === 0.72;
  }
  if (layer === "paths") {
    return item.kind === "polyline" && item.points.length === 4 && item.closed
      && /^path-\d+-\d+-\d+$/.test(item.id) && item.semantic === "path:authored-cell"
      && item.fill === undefined && item.stroke === palette.path && item.strokeWidth !== undefined
      && item.opacity === undefined;
  }
  if (layer === "vegetation-obstacles") {
    if (item.kind === "ellipse") {
      const match = /^obstacle:(tree|bush|rock)(?::(.+))?$/.exec(item.semantic);
      return /^obstacle-\d+-\d+-\d+$/.test(item.id) && Boolean(match)
        && (match![2] === undefined || isPlantId(match![2])) && item.opacity === undefined
        && filledAndStroked(palette.vegetation[match![1] as "tree" | "bush" | "rock"], palette.ink);
    }
    return item.kind === "polygon" && item.points.length === 4 && /^decoration-(?:\d+-){3}\d+$/.test(item.id)
      && DECORATION_KINDS_SET.has(item.semantic.slice("decoration:".length))
      && filledAndStroked(palette.vegetation.decoration, palette.ink) && item.opacity === 0.9;
  }
  if (layer === "surroundings") {
    const match = /^surrounding:([^:]+)(?::tier-([123]))?$/.exec(item.semantic);
    return item.kind === "polygon" && item.points.length === 4 && /^surrounding-(?:\d+-){3}\d+$/.test(item.id)
      && Boolean(match) && Object.hasOwn(BUILDING_SPECS, match![1])
      && filledAndStroked(palette.surroundings.fill, palette.surroundings.stroke) && item.opacity === undefined;
  }
  if (layer === "tee") {
    return item.kind === "ellipse" && item.id === "selected-tee"
      && TEE_SETS.some((tee) => item.semantic === `tee:${tee}`)
      && filledAndStroked(palette.tee.fill, palette.tee.stroke) && item.opacity === undefined;
  }
  if (layer === "pin") {
    return item.kind === "ellipse" && item.id === "selected-pin"
      && PIN_ROTATIONS.some((pin) => item.semantic === `pin:${pin}`)
      && filledAndStroked(palette.pin.fill, palette.pin.stroke) && item.opacity === undefined;
  }
  if (item.kind !== "polyline" || item.closed || item.fill !== undefined || item.strokeWidth === undefined) return false;
  return item.id === "authoritative-route-halo"
    ? item.semantic === "route:tee-waypoints-pin:halo"
      && item.stroke === palette.routeHalo && item.opacity === undefined
    : item.id === "authoritative-route" && item.semantic === "route:tee-waypoints-pin"
      && item.stroke === palette.route && item.opacity === 0.88;
}

interface ProducerProjection {
  readonly scale: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly width: number;
  readonly height: number;
  readonly dx: HoleIllustrationRenderPoint;
  readonly dy: HoleIllustrationRenderPoint;
}

interface TerrainFact {
  readonly index: number;
  readonly localX: number;
  readonly localY: number;
  readonly courseX: number;
  readonly courseY: number;
  readonly terrain: string;
  readonly elevation: number;
  readonly primitive: HoleIllustrationPolygonPrimitive;
}

function quantize(value: number, digits: number): number {
  const rounded = Math.round(value * 10 ** digits) / 10 ** digits;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function parseProducerId(id: string, prefix: string, count: number): number[] | null {
  if (!id.startsWith(`${prefix}-`)) return null;
  const encoded = id.slice(prefix.length + 1).split("-");
  if (encoded.length !== count || encoded.some((value) => !/^\d+$/.test(value))) return null;
  const values = id.slice(prefix.length + 1).split("-").map(Number);
  return values.length === count && values.every(Number.isSafeInteger)
    && values.map(String).join("-") === encoded.join("-") ? values : null;
}

function producerProjection(
  settings: HoleIllustrationRenderPlan["settings"],
  sourceFrame: HoleIllustrationRenderPlan["frame"],
): ProducerProjection {
  const { width, height, padding } = settings.viewport;
  const scale = Math.min(width * (1 - padding * 2) / sourceFrame.crop.width,
    height * (1 - padding * 2) / sourceFrame.crop.height);
  const matrix = sourceFrame.mode === "north-up" ? { a: 1, b: 0, c: 0, d: 1 } : sourceFrame.matrix;
  return {
    scale,
    offsetX: (width - sourceFrame.crop.width * scale) / 2,
    offsetY: (height - sourceFrame.crop.height * scale) / 2,
    width,
    height,
    dx: { x: matrix.a * scale / width, y: matrix.b * scale / height },
    dy: { x: matrix.c * scale / width, y: matrix.d * scale / height },
  };
}

function closeNumber(left: number, right: number, tolerance = 1e-9): boolean {
  return Math.abs(left - right) <= tolerance;
}

function closePoint(left: HoleIllustrationRenderPoint, right: HoleIllustrationRenderPoint, tolerance = 1e-9): boolean {
  return closeNumber(left.x, right.x, tolerance) && closeNumber(left.y, right.y, tolerance);
}

function samePoints(left: readonly HoleIllustrationRenderPoint[], right: readonly HoleIllustrationRenderPoint[]): boolean {
  return left.length === right.length && left.every((value, index) => closePoint(value, right[index]));
}

function producerStroke(projection: ProducerProjection, fraction: number): number {
  return Math.max(1, projection.scale * fraction) / Math.min(projection.width, projection.height);
}

function producerRadius(projection: ProducerProjection, fraction: number): HoleIllustrationRenderPoint {
  return { x: projection.scale * fraction / projection.width, y: projection.scale * fraction / projection.height };
}

function producerEndpointRadius(
  projection: ProducerProjection,
  fraction: number,
  strokeWidth: number,
): HoleIllustrationRenderPoint {
  const naturalRadius = projection.scale * fraction;
  const strokePixels = strokeWidth * Math.min(projection.width, projection.height);
  const radiusPixels = Math.max(naturalRadius,
    (strokePixels + HOLE_ILLUSTRATION_ENDPOINT_MARKER_MIN_INNER_DIAMETER) / 2);
  return { x: radiusPixels / projection.width, y: radiusPixels / projection.height };
}

function projectedRaw(
  projection: ProducerProjection,
  sourceFrame: HoleIllustrationRenderPlan["frame"],
  rawX: number,
  rawY: number,
): HoleIllustrationRenderPoint {
  const x = Math.min(sourceFrame.crop.width, Math.max(0, rawX));
  const y = Math.min(sourceFrame.crop.height, Math.max(0, rawY));
  return {
    x: (projection.offsetX + x * projection.scale) / projection.width,
    y: (projection.offsetY + y * projection.scale) / projection.height,
  };
}

function projectedCoursePoint(
  projection: ProducerProjection,
  sourceFrame: HoleIllustrationRenderPlan["frame"],
  fact: Pick<TerrainFact, "localX" | "localY" | "courseX" | "courseY">,
  dx = 0,
  dy = 0,
): HoleIllustrationRenderPoint {
  if (sourceFrame.mode === "north-up") {
    return projectedRaw(projection, sourceFrame, fact.localX + dx, fact.localY + dy);
  }
  const relativeX = fact.courseX - sourceFrame.originCourse.x;
  const relativeY = fact.courseY - sourceFrame.originCourse.y;
  const baseX = quantize(quantize(sourceFrame.matrix.a * relativeX + sourceFrame.matrix.c * relativeY, 6)
    + sourceFrame.translation.x, 3);
  const baseY = quantize(quantize(sourceFrame.matrix.b * relativeX + sourceFrame.matrix.d * relativeY, 6)
    + sourceFrame.translation.y, 3);
  return projectedRaw(projection, sourceFrame,
    baseX + sourceFrame.matrix.a * dx + sourceFrame.matrix.c * dy,
    baseY + sourceFrame.matrix.b * dx + sourceFrame.matrix.d * dy);
}

function expectedCell(
  projection: ProducerProjection,
  sourceFrame: HoleIllustrationRenderPlan["frame"],
  fact: Pick<TerrainFact, "localX" | "localY" | "courseX" | "courseY">,
): HoleIllustrationRenderPoint[] {
  return [
    projectedCoursePoint(projection, sourceFrame, fact),
    projectedCoursePoint(projection, sourceFrame, fact, 1, 0),
    projectedCoursePoint(projection, sourceFrame, fact, 1, 1),
    projectedCoursePoint(projection, sourceFrame, fact, 0, 1),
  ];
}

function courseCoordinateForCell(
  projection: ProducerProjection,
  sourceFrame: HoleIllustrationRenderPlan["frame"],
  localX: number,
  localY: number,
  first: HoleIllustrationRenderPoint,
): { x: number; y: number } | null {
  if (sourceFrame.mode === "north-up") {
    const x = localX - sourceFrame.translation.x;
    const y = localY - sourceFrame.translation.y;
    return Number.isSafeInteger(x) && Number.isSafeInteger(y)
      && x >= 0 && x < MAX_COURSE_AXIS && y >= 0 && y < MAX_COURSE_AXIS ? { x, y } : null;
  }
  const rawX = (first.x * projection.width - projection.offsetX) / projection.scale;
  const rawY = (first.y * projection.height - projection.offsetY) / projection.scale;
  const rotatedX = rawX - sourceFrame.translation.x;
  const rotatedY = rawY - sourceFrame.translation.y;
  const approximateX = sourceFrame.originCourse.x + sourceFrame.matrix.a * rotatedX + sourceFrame.matrix.b * rotatedY;
  const approximateY = sourceFrame.originCourse.y + sourceFrame.matrix.c * rotatedX + sourceFrame.matrix.d * rotatedY;
  const x = Math.round(approximateX);
  const y = Math.round(approximateY);
  return Number.isSafeInteger(x) && Number.isSafeInteger(y)
    && Math.abs(x - approximateX) <= 0.002 && Math.abs(y - approximateY) <= 0.002
    && x >= 0 && x < MAX_COURSE_AXIS && y >= 0 && y < MAX_COURSE_AXIS ? { x, y } : null;
}

function contiguousFootprintItems(
  values: readonly HoleIllustrationRenderPrimitive[],
  prefix: "decoration" | "surrounding",
  terrainByCoordinate: ReadonlyMap<string, TerrainFact>,
): number | null {
  let currentItem = -1;
  let nextCell = 0;
  const occupied = new Set<string>();
  let currentSemantic = "";
  for (const item of values) {
    if (item.kind !== "polygon") return null;
    const parsed = parseProducerId(item.id, prefix, 4);
    if (!parsed) return null;
    const [itemIndex, cellIndex, x, y] = parsed;
    if (itemIndex === currentItem + 1 && cellIndex === 0) {
      currentItem = itemIndex;
      nextCell = 0;
      currentSemantic = item.semantic;
    }
    if (itemIndex !== currentItem || cellIndex !== nextCell || item.semantic !== currentSemantic) return null;
    const key = `${x},${y}`;
    const terrain = terrainByCoordinate.get(key);
    if (!terrain || occupied.has(key) || !samePoints(item.points, terrain.primitive.points)) return null;
    occupied.add(key);
    nextCell++;
  }
  return currentItem + 1;
}

function validProducerPlan(
  plan: Pick<HoleIllustrationRenderPlan, "settings" | "frame" | "layers" | "budget">,
  palette: ReturnType<typeof resolveHoleIllustrationStyle>,
): boolean {
  const projection = producerProjection(plan.settings, plan.frame);
  const terrainLayer = plan.layers[0].primitives;
  const terrainFacts: TerrainFact[] = [];
  const terrainByCoordinate = new Map<string, TerrainFact>();
  let northTranslationX: number | undefined;
  let northTranslationY: number | undefined;
  for (const [position, item] of terrainLayer.entries()) {
    if (item.kind !== "polygon") return false;
    const parsed = parseProducerId(item.id, "terrain", 3);
    if (!parsed) return false;
    const [index, localX, localY] = parsed;
    if (index !== position || localX >= 256 || localY >= 256
      || (position > 0 && (localY < terrainFacts[position - 1].localY
        || localY === terrainFacts[position - 1].localY && localX <= terrainFacts[position - 1].localX))) return false;
    const course = courseCoordinateForCell(projection, plan.frame, localX, localY, item.points[0]);
    if (!course) return false;
    const translationX = localX - course.x;
    const translationY = localY - course.y;
    if (northTranslationX === undefined) {
      northTranslationX = translationX;
      northTranslationY = translationY;
    } else if (translationX !== northTranslationX || translationY !== northTranslationY) return false;
    const elevation = Number.NaN;
    const fact: TerrainFact = {
      index,
      localX,
      localY,
      courseX: course.x,
      courseY: course.y,
      terrain: item.semantic.slice("terrain:".length),
      elevation,
      primitive: item,
    };
    const key = `${localX},${localY}`;
    if (terrainByCoordinate.has(key) || !samePoints(item.points, expectedCell(projection, plan.frame, fact))
      || !closeNumber(item.strokeWidth ?? 0,
        plan.settings.contrast === "high-contrast" ? producerStroke(projection, 0.025) : 0)) return false;
    terrainFacts.push(fact);
    terrainByCoordinate.set(key, fact);
  }

  const elevationLayer = plan.layers[1].primitives;
  const elevations = elevationLayer.filter((item): item is HoleIllustrationPolygonPrimitive => item.kind === "polygon");
  const contours = elevationLayer.filter((item): item is HoleIllustrationSampleGridPrimitive => item.kind === "sample-grid");
  if (elevationLayer.some((item, index) => index < elevations.length ? item.kind !== "polygon" : item.kind !== "sample-grid")) return false;
  if (elevations.length !== 0 && elevations.length !== terrainFacts.length) return false;
  for (const [position, item] of elevations.entries()) {
    const parsed = parseProducerId(item.id, "elevation", 3);
    if (!parsed || parsed[0] !== position || parsed[1] !== terrainFacts[position].localX
      || parsed[2] !== terrainFacts[position].localY || !samePoints(item.points, terrainFacts[position].primitive.points)) return false;
    terrainFacts[position] = { ...terrainFacts[position], elevation: Number(item.semantic.slice("elevation:".length)) };
  }
  if (elevations.length === 0) {
    for (let index = 0; index < terrainFacts.length; index++) terrainFacts[index] = { ...terrainFacts[index], elevation: 0 };
  } else {
    let minimum = Infinity;
    let maximum = -Infinity;
    for (const item of terrainFacts) {
      minimum = Math.min(minimum, item.elevation);
      maximum = Math.max(maximum, item.elevation);
    }
    if (minimum === maximum) return false;
    for (const [index, item] of elevations.entries()) {
      const normalized = (terrainFacts[index].elevation - minimum) / (maximum - minimum);
      if (item.fill !== (normalized >= 0.5 ? palette.elevation.high : palette.elevation.low)
        || !closeNumber(item.opacity ?? Number.NaN, Math.abs(normalized - 0.5) * 0.24)) return false;
    }
  }

  const contourCells = new Set<string>();
  for (const [position, item] of contours.entries()) {
    const parsed = parseProducerId(item.id, "contour", 3);
    if (!parsed || parsed[0] !== position) return false;
    const terrain = terrainByCoordinate.get(`${parsed[1]},${parsed[2]}`);
    if (!terrain || contourCells.has(`${parsed[1]},${parsed[2]}`)) return false;
    contourCells.add(`${parsed[1]},${parsed[2]}`);
    for (const [sampleIndex, sample] of item.samples.entries()) {
      if (!closePoint(sample.point, projectedCoursePoint(projection, plan.frame, terrain,
        (sampleIndex % 4) / 3, Math.floor(sampleIndex / 4) / 3))) return false;
    }
    if (!closePoint(item.markerRadius, producerRadius(projection,
      plan.settings.contrast === "high-contrast" ? 0.045 : 0.03))) return false;
  }

  const expectedPaths = terrainFacts.filter((item) => item.terrain === "path");
  const paths = plan.layers[2].primitives;
  if (paths.length !== expectedPaths.length) return false;
  for (const [position, item] of paths.entries()) {
    if (item.kind !== "polyline") return false;
    const parsed = parseProducerId(item.id, "path", 3);
    const terrain = parsed ? terrainFacts[parsed[0]] : undefined;
    if (!parsed || !terrain || terrain !== expectedPaths[position] || parsed[1] !== terrain.localX || parsed[2] !== terrain.localY
      || !samePoints(item.points, terrain.primitive.points)
      || !closeNumber(item.strokeWidth ?? 0, producerStroke(projection,
        plan.settings.contrast === "high-contrast" ? 0.12 : 0.08))) return false;
  }

  let obstacleCount = 0;
  const decorationPrimitives: HoleIllustrationRenderPrimitive[] = [];
  for (const item of plan.layers[3].primitives) {
    if (item.kind === "ellipse") {
      const parsed = parseProducerId(item.id, "obstacle", 3);
      if (!parsed || parsed[0] !== obstacleCount) return false;
      const terrain = terrainByCoordinate.get(`${parsed[1]},${parsed[2]}`);
      const type = item.semantic.split(":")[1] as "tree" | "bush" | "rock";
      if (!terrain || !closePoint(item.center, projectedCoursePoint(projection, plan.frame, terrain, 0.5, 0.5))
        || !closePoint(item.radius, producerRadius(projection, type === "tree" ? 0.34 : type === "bush" ? 0.27 : 0.23))
        || !closeNumber(item.strokeWidth ?? 0, producerStroke(projection, 0.045))) return false;
      obstacleCount++;
    } else {
      decorationPrimitives.push(item);
    }
  }
  if (plan.layers[3].primitives.some((item, index) =>
    index < obstacleCount ? item.kind !== "ellipse" : item.kind !== "polygon")) return false;
  const decorationCount = contiguousFootprintItems(decorationPrimitives, "decoration", terrainByCoordinate);
  const surroundingCount = contiguousFootprintItems(plan.layers[4].primitives, "surrounding", terrainByCoordinate);
  if (decorationCount === null || surroundingCount === null) return false;
  if (contours.length > HOLE_ILLUSTRATION_RENDER_LIMITS.maxContourTiles
    || obstacleCount > HOLE_ILLUSTRATION_RENDER_LIMITS.maxSourceFeaturesPerCollection
    || decorationCount > HOLE_ILLUSTRATION_RENDER_LIMITS.maxSourceFeaturesPerCollection
    || surroundingCount > HOLE_ILLUSTRATION_RENDER_LIMITS.maxSourceFeaturesPerCollection
    || decorationPrimitives.length + plan.layers[4].primitives.length
      > HOLE_ILLUSTRATION_RENDER_LIMITS.maxFootprintPoints) return false;
  for (const item of decorationPrimitives) {
    if (!closeNumber(item.strokeWidth ?? 0, producerStroke(projection, 0.04))) return false;
  }
  for (const item of plan.layers[4].primitives) {
    if (!closeNumber(item.strokeWidth ?? 0, producerStroke(projection, 0.055))) return false;
  }
  if (plan.budget.sourceFeatures !== contours.length + obstacleCount + decorationCount + surroundingCount) return false;

  const routeHalo = plan.layers[5].primitives[0];
  const route = plan.layers[5].primitives[1];
  const tee = plan.layers[6].primitives[0];
  const pin = plan.layers[7].primitives[0];
  if (tee.kind !== "ellipse" || pin.kind !== "ellipse"
    || routeHalo.kind !== "polyline" || route.kind !== "polyline") return false;
  const centers = terrainFacts.map((item) => projectedCoursePoint(projection, plan.frame, item, 0.5, 0.5));
  const endpointStrokeWidth = producerStroke(projection, 0.08);
  if (!centers.some((center) => closePoint(tee.center, center))
    || !centers.some((center) => closePoint(pin.center, center))
    || !closePoint(tee.radius, producerEndpointRadius(projection, 0.25, endpointStrokeWidth))
    || !closePoint(pin.radius, producerEndpointRadius(projection, 0.22, endpointStrokeWidth))
    || !closeNumber(tee.strokeWidth ?? 0, endpointStrokeWidth)
    || !closeNumber(pin.strokeWidth ?? 0, endpointStrokeWidth)
    || !closeNumber(route.strokeWidth ?? 0, producerStroke(projection,
      plan.settings.contrast === "high-contrast" ? 0.1 : 0.065))
    || !closeNumber(routeHalo.strokeWidth ?? 0,
      (route.strokeWidth ?? 0) + 2 / Math.min(plan.settings.viewport.width, plan.settings.viewport.height))
    || routeHalo.points.length !== route.points.length
    || !routeHalo.points.every((point, index) => closePoint(point, route.points[index]))
    || !closePoint(route.points[0], tee.center) || !closePoint(route.points[route.points.length - 1], pin.center)
    || closePoint(tee.center, pin.center)
    || !route.points.every((point) => centers.some((center) => closePoint(point, center)))) return false;
  return true;
}

function validatedPlan(value: unknown): HoleIllustrationRenderPlan | null {
  if (!record(value) || value.version !== 1 || typeof value.hash !== "string" || !PLAN_HASH.test(value.hash)
    || value.hashAlgorithm !== "fnv1a32-canonical-v1" || typeof value.snapshotHash !== "string"
    || !SNAPSHOT_HASH.test(value.snapshotHash) || !boundedText(value.styleId)
    || !validColor(value.background) || !record(value.settings) || !record(value.settings.viewport)
    || (value.settings.frame !== "north-up" && value.settings.frame !== "tee-to-green")
    || !BIOME_KEYS.includes(value.settings.biome as LandTheme)
    || !SEASONS.includes(value.settings.season as SeasonName)
    || !HOLE_ILLUSTRATION_CONTRASTS.includes(value.settings.contrast as "standard" | "high-contrast")
    || !Number.isInteger(value.settings.viewport.width) || !Number.isInteger(value.settings.viewport.height)
    || (value.settings.viewport.width as number) < 1 || (value.settings.viewport.height as number) < 1
    || (value.settings.viewport.width as number) > HOLE_ILLUSTRATION_RENDER_LIMITS.maxViewportDimension
    || (value.settings.viewport.height as number) > HOLE_ILLUSTRATION_RENDER_LIMITS.maxViewportDimension
    || !finite(value.settings.viewport.padding) || value.settings.viewport.padding < 0 || value.settings.viewport.padding > 0.45
    || !record(value.bounds) || value.bounds.minX !== 0 || value.bounds.minY !== 0 || value.bounds.maxX !== 1 || value.bounds.maxY !== 1
    || !record(value.budget) || !Number.isInteger(value.budget.sourceCells) || !Number.isInteger(value.budget.sourceFeatures)
    || !Number.isInteger(value.budget.primitiveCount) || !Number.isInteger(value.budget.pointCount)
    || (value.budget.sourceCells as number) < 1 || (value.budget.sourceCells as number) > HOLE_ILLUSTRATION_RENDER_LIMITS.maxSourceCells
    || !Number.isSafeInteger(value.budget.sourceFeatures) || (value.budget.sourceFeatures as number) < 0
    || (value.budget.sourceFeatures as number) > HOLE_ILLUSTRATION_RENDER_LIMITS.maxContourTiles
      + HOLE_ILLUSTRATION_RENDER_LIMITS.maxSourceFeaturesPerCollection * 3
    || (value.budget.primitiveCount as number) < 1 || (value.budget.primitiveCount as number) > HOLE_ILLUSTRATION_RENDER_LIMITS.maxPrimitives
    || (value.budget.pointCount as number) < 1 || (value.budget.pointCount as number) > HOLE_ILLUSTRATION_RENDER_LIMITS.maxPoints
    || value.budget.runtime !== "bounded-n-log-n" || value.budget.memory !== "bounded"
    || !Array.isArray(value.layers) || value.layers.length !== HOLE_ILLUSTRATION_LAYER_ORDER.length) return null;
  const biome = value.settings.biome as LandTheme;
  const season = value.settings.season as SeasonName;
  const contrast = value.settings.contrast as "standard" | "high-contrast";
  const frameMode = value.settings.frame as "north-up" | "tee-to-green";
  const expectedStyleId = `${biome}:${season}`;
  const palette = resolveHoleIllustrationStyle(biome, season, contrast);
  if (value.styleId !== expectedStyleId || value.background !== palette.background) return null;
  const resolvedFrame = frame(value.frame, frameMode);
  if (!resolvedFrame) return null;
  const layers: HoleIllustrationRenderPlan["layers"][number][] = [];
  const ids = new Set<string>();
  let primitiveCount = 0;
  let pointCount = 0;
  for (let index = 0; index < HOLE_ILLUSTRATION_LAYER_ORDER.length; index++) {
    const raw = value.layers[index];
    if (!record(raw) || raw.id !== HOLE_ILLUSTRATION_LAYER_ORDER[index] || raw.z !== index
      || !Array.isArray(raw.primitives)
      || primitiveCount + raw.primitives.length > HOLE_ILLUSTRATION_RENDER_LIMITS.maxPrimitives) return null;
    const primitives: HoleIllustrationRenderPrimitive[] = [];
    for (const rawPrimitive of raw.primitives) {
      const resolved = primitive(rawPrimitive, Math.min(value.settings.viewport.width as number, value.settings.viewport.height as number));
      if (!resolved || ids.has(resolved.id) || !primitiveMatchesLayer(HOLE_ILLUSTRATION_LAYER_ORDER[index], resolved, palette, contrast)) return null;
      ids.add(resolved.id);
      primitives.push(resolved);
      primitiveCount++;
      pointCount += resolved.kind === "ellipse" ? 1
        : resolved.kind === "sample-grid" ? resolved.samples.length
          : resolved.points.length;
      if (pointCount > HOLE_ILLUSTRATION_RENDER_LIMITS.maxPoints) return null;
    }
    layers.push({ id: HOLE_ILLUSTRATION_LAYER_ORDER[index], z: index, primitives });
  }
  if (layers[0].primitives.length !== value.budget.sourceCells
    || layers[5].primitives.length !== 2 || layers[6].primitives.length !== 1 || layers[7].primitives.length !== 1) return null;
  if (primitiveCount !== value.budget.primitiveCount || pointCount !== value.budget.pointCount) return null;
  const facts = {
    version: 1 as const,
    hashAlgorithm: "fnv1a32-canonical-v1" as const,
    snapshotHash: value.snapshotHash,
    settings: {
      frame: frameMode,
      biome,
      season,
      contrast,
      viewport: {
        width: value.settings.viewport.width as number,
        height: value.settings.viewport.height as number,
        padding: value.settings.viewport.padding,
      },
    },
    styleId: expectedStyleId,
    background: palette.background,
    frame: resolvedFrame,
    layers,
    bounds: { minX: 0 as const, minY: 0 as const, maxX: 1 as const, maxY: 1 as const },
    budget: {
      sourceCells: value.budget.sourceCells as number,
      sourceFeatures: value.budget.sourceFeatures as number,
      primitiveCount,
      pointCount,
      runtime: "bounded-n-log-n" as const,
      memory: "bounded" as const,
    },
  };
  if (!validProducerPlan(facts, palette) || hashCanonicalValue(facts) !== value.hash) return null;
  return { ...facts, hash: value.hash } as HoleIllustrationRenderPlan;
}

function number(value: number): string {
  const rounded = Math.round(value * 1_000_000) / 1_000_000;
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

function xml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;").replaceAll("'", "&apos;");
}

function svgPaint(item: Paint, scale: number): string {
  const attributes = [
    `fill="${item.fill ?? "none"}"`,
    ...(item.stroke ? [`stroke="${item.stroke}"`] : []),
    ...(item.stroke ? ["stroke-linecap=\"round\"", "stroke-linejoin=\"round\""] : []),
    ...(item.strokeWidth !== undefined ? [`stroke-width="${number(item.strokeWidth * scale)}"`] : []),
    ...(item.opacity !== undefined ? [`opacity="${number(item.opacity)}"`] : []),
  ];
  return attributes.join(" ");
}

function physicalPoint(pointValue: HoleIllustrationRenderPoint, width: number, height: number): string {
  return `${number(pointValue.x * width)},${number(pointValue.y * height)}`;
}

function svgPrimitive(item: HoleIllustrationRenderPrimitive, width: number, height: number): string {
  const metadata = `id="${xml(item.id)}" data-kind="${item.kind}" data-semantic="${xml(item.semantic)}"`;
  const paintAttributes = svgPaint(item, Math.min(width, height));
  if (item.kind === "polygon") {
    return `<polygon ${metadata} points="${item.points.map((value) => physicalPoint(value, width, height)).join(" ")}" ${paintAttributes}/>`;
  }
  if (item.kind === "polyline") {
    const source = item.closed ? [...item.points, item.points[0]] : item.points;
    return `<polyline ${metadata} points="${source.map((value) => physicalPoint(value, width, height)).join(" ")}" ${paintAttributes}/>`;
  }
  if (item.kind === "ellipse") {
    return `<ellipse ${metadata} cx="${number(item.center.x * width)}" cy="${number(item.center.y * height)}" rx="${number(item.radius.x * width)}" ry="${number(item.radius.y * height)}" ${paintAttributes}/>`;
  }
  const markers = item.samples.map((sample) =>
    `<ellipse data-value="${sample.value}" cx="${number(sample.point.x * width)}" cy="${number(sample.point.y * height)}" rx="${number(item.markerRadius.x * width)}" ry="${number(item.markerRadius.y * height)}"/>`).join("");
  return `<g ${metadata} ${paintAttributes}>${markers}</g>`;
}

function svgCharacterCount(plan: HoleIllustrationRenderPlan): number {
  const { width, height } = plan.settings.viewport;
  let characters = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" data-coursecraft-plan-hash="${plan.hash}" data-snapshot-hash="${plan.snapshotHash}">`.length
    + `<rect width="${width}" height="${height}" fill="${plan.background}"/>`.length
    + 6;
  for (const layer of plan.layers) {
    characters += `<g data-layer="${layer.id}" data-z="${layer.z}">`.length + 4;
    for (const item of layer.primitives) characters += svgPrimitive(item, width, height).length;
  }
  return characters;
}

/** Deterministic DOM-free SVG serialization with the exact source plan hash embedded. */
export function renderHoleIllustrationSvg(input: HoleIllustrationRenderPlan): HoleIllustrationSvgResult {
  try {
    const plan = validatedPlan(input);
    if (!plan) return failure("INVALID_PLAN", "The render plan is malformed or its canonical hash does not match.");
    if (svgCharacterCount(plan) > HOLE_ILLUSTRATION_OUTPUT_LIMITS.maxSvgCharacters) {
      return failure("OUTPUT_TOO_LARGE", "The SVG would exceed the bounded output character budget.");
    }
    const { width, height } = plan.settings.viewport;
    const chunks = [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" data-coursecraft-plan-hash="${plan.hash}" data-snapshot-hash="${plan.snapshotHash}">`,
      `<rect width="${width}" height="${height}" fill="${plan.background}"/>`,
    ];
    let characters = chunks[0].length + chunks[1].length;
    for (const layer of plan.layers) {
      const open = `<g data-layer="${layer.id}" data-z="${layer.z}">`;
      chunks.push(open);
      characters += open.length;
      for (const item of layer.primitives) {
        const serialized = svgPrimitive(item, width, height);
        characters += serialized.length;
        if (characters + 6 > HOLE_ILLUSTRATION_OUTPUT_LIMITS.maxSvgCharacters) {
          return failure("OUTPUT_TOO_LARGE", "The SVG would exceed the bounded output character budget.");
        }
        chunks.push(serialized);
      }
      chunks.push("</g>");
      characters += 4;
    }
    chunks.push("</svg>");
    characters += 6;
    if (characters > HOLE_ILLUSTRATION_OUTPUT_LIMITS.maxSvgCharacters) {
      return failure("OUTPUT_TOO_LARGE", "The SVG would exceed the bounded output character budget.");
    }
    return {
      complete: true,
      version: HOLE_ILLUSTRATION_RENDERER_VERSION,
      mimeType: "image/svg+xml",
      width,
      height,
      planHash: plan.hash,
      svg: chunks.join(""),
    };
  } catch {
    return failure("INVALID_PLAN", "The render plan could not be serialized safely.");
  }
}

interface PixelPoint { x: number; y: number }
interface Box { minX: number; minY: number; maxX: number; maxY: number }
type Rgb = readonly [number, number, number];

function pixelPoint(value: HoleIllustrationRenderPoint, width: number, height: number): PixelPoint {
  return { x: value.x * width, y: value.y * height };
}

function boxForPoints(values: readonly PixelPoint[], expansion = 0): Box {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const value of values) {
    minX = Math.min(minX, value.x);
    minY = Math.min(minY, value.y);
    maxX = Math.max(maxX, value.x);
    maxY = Math.max(maxY, value.y);
  }
  return { minX: minX - expansion, minY: minY - expansion, maxX: maxX + expansion, maxY: maxY + expansion };
}

function boxVisits(box: Box, width: number, height: number): number {
  const minX = Math.max(0, Math.floor(box.minX));
  const minY = Math.max(0, Math.floor(box.minY));
  const maxX = Math.min(width - 1, Math.ceil(box.maxX));
  const maxY = Math.min(height - 1, Math.ceil(box.maxY));
  return maxX < minX || maxY < minY ? 0 : (maxX - minX + 1) * (maxY - minY + 1);
}

function ellipseBox(item: HoleIllustrationEllipsePrimitive, width: number, height: number, expansion = 0): Box {
  const center = pixelPoint(item.center, width, height);
  return {
    minX: center.x - item.radius.x * width - expansion,
    minY: center.y - item.radius.y * height - expansion,
    maxX: center.x + item.radius.x * width + expansion,
    maxY: center.y + item.radius.y * height + expansion,
  };
}

function segmentVisits(values: readonly PixelPoint[], closed: boolean, width: number, height: number, expansion: number): number {
  let visits = 0;
  const count = values.length - 1 + (closed ? 1 : 0);
  for (let index = 0; index < count; index++) {
    visits += boxVisits(boxForPoints([values[index], values[(index + 1) % values.length]], expansion), width, height);
  }
  return visits;
}

function unionBox(boxes: readonly Box[]): Box {
  return boxes.reduce((union, value) => ({
    minX: Math.min(union.minX, value.minX),
    minY: Math.min(union.minY, value.minY),
    maxX: Math.max(union.maxX, value.maxX),
    maxY: Math.max(union.maxY, value.maxY),
  }));
}

function markerBox(center: PixelPoint, radiusX: number, radiusY: number, stroke: number): Box {
  return {
    minX: center.x - radiusX - stroke,
    minY: center.y - radiusY - stroke,
    maxX: center.x + radiusX + stroke,
    maxY: center.y + radiusY + stroke,
  };
}

function estimatedPixelVisits(plan: HoleIllustrationRenderPlan, width: number, height: number): number {
  let visits = width * height;
  const short = Math.min(width, height);
  for (const layer of plan.layers) for (const item of layer.primitives) {
    const stroke = item.stroke ? Math.max(0.5, (item.strokeWidth ?? 0) * short / 2) : 0;
    if (item.kind === "polygon" || item.kind === "polyline") {
      const vertices = item.points.map((value) => pixelPoint(value, width, height));
      if (item.fill && (item.kind === "polygon" || item.closed)) visits += boxVisits(boxForPoints(vertices), width, height);
      if (item.stroke) visits += segmentVisits(vertices, item.kind === "polygon" || item.closed, width, height, stroke);
      visits += boxVisits(boxForPoints(vertices, stroke), width, height);
    } else if (item.kind === "ellipse") {
      visits += boxVisits(ellipseBox(item, width, height, stroke), width, height) * 2;
    } else {
      const boxes: Box[] = [];
      for (const sample of item.samples) {
        const center = pixelPoint(sample.point, width, height);
        const box = markerBox(center, item.markerRadius.x * width, item.markerRadius.y * height, stroke);
        boxes.push(box);
        visits += boxVisits(box, width, height);
      }
      visits += boxVisits(unionBox(boxes), width, height);
    }
    if (visits > HOLE_ILLUSTRATION_OUTPUT_LIMITS.maxRasterPixelVisits) return visits;
  }
  return visits;
}

function budgetForPlan(
  plan: HoleIllustrationRenderPlan,
  pixelRatio: number,
): HoleIllustrationRenderBudgetReport {
  const width = plan.settings.viewport.width * pixelRatio;
  const height = plan.settings.viewport.height * pixelRatio;
  const pixels = width * height;
  const rgbaBytes = pixels * 4;
  const coverageBytes = pixels;
  const allocationBytes = rgbaBytes + coverageBytes;
  const estimatedVisits = estimatedPixelVisits(plan, width, height);
  const exceededVisits = estimatedVisits > HOLE_ILLUSTRATION_OUTPUT_LIMITS.maxRasterPixelVisits;
  const reportedVisits = exceededVisits
    ? HOLE_ILLUSTRATION_OUTPUT_LIMITS.maxRasterPixelVisits + 1
    : estimatedVisits;
  const svgCharacters = svgCharacterCount(plan);
  return {
    complete: true,
    version: HOLE_ILLUSTRATION_RENDERER_VERSION,
    planHash: plan.hash,
    svg: {
      characters: svgCharacters,
      characterLimit: HOLE_ILLUSTRATION_OUTPUT_LIMITS.maxSvgCharacters,
      withinLimit: svgCharacters <= HOLE_ILLUSTRATION_OUTPUT_LIMITS.maxSvgCharacters,
    },
    rgba: {
      pixelRatio,
      width,
      height,
      pixels,
      rgbaBytes,
      coverageBytes,
      allocationBytes,
      estimatedPixelVisits: reportedVisits,
      pixelVisitEstimateExact: !exceededVisits,
      pixelLimit: HOLE_ILLUSTRATION_OUTPUT_LIMITS.maxRasterPixels,
      allocationByteLimit: HOLE_ILLUSTRATION_OUTPUT_LIMITS.maxRasterBytes,
      pixelVisitLimit: HOLE_ILLUSTRATION_OUTPUT_LIMITS.maxRasterPixelVisits,
      withinLimits: Number.isSafeInteger(pixels)
        && pixels <= HOLE_ILLUSTRATION_OUTPUT_LIMITS.maxRasterPixels
        && allocationBytes <= HOLE_ILLUSTRATION_OUTPUT_LIMITS.maxRasterBytes
        && !exceededVisits,
    },
  };
}

/** Deterministic output/work preflight without allocating the final SVG or raster buffers. */
export function preflightHoleIllustrationRender(
  input: HoleIllustrationRenderPlan,
  options: HoleIllustrationRgbaOptions,
): HoleIllustrationRenderBudgetResult {
  try {
    const plan = validatedPlan(input);
    if (!plan) return failure("INVALID_PLAN", "The render plan is malformed or its canonical hash does not match.");
    if (!record(options) || !Number.isInteger(options.pixelRatio) || options.pixelRatio < 1
      || options.pixelRatio > HOLE_ILLUSTRATION_OUTPUT_LIMITS.maxRasterPixelRatio) {
      return failure("INVALID_OPTIONS", "pixelRatio must be an integer from 1 through 4.");
    }
    return budgetForPlan(plan, options.pixelRatio);
  } catch {
    return failure("INVALID_PLAN", "The render plan could not be preflighted safely.");
  }
}

function rgb(color: string): Rgb {
  return [Number.parseInt(color.slice(1, 3), 16), Number.parseInt(color.slice(3, 5), 16), Number.parseInt(color.slice(5, 7), 16)];
}

function composite(data: Uint8ClampedArray, index: number, color: Rgb, opacity: number): void {
  const sourceAlpha = Math.max(0, Math.min(1, opacity));
  const destinationAlpha = data[index + 3] / 255;
  const outputAlpha = sourceAlpha + destinationAlpha * (1 - sourceAlpha);
  if (outputAlpha <= 0) return;
  data[index] = Math.round((color[0] * sourceAlpha + data[index] * destinationAlpha * (1 - sourceAlpha)) / outputAlpha);
  data[index + 1] = Math.round((color[1] * sourceAlpha + data[index + 1] * destinationAlpha * (1 - sourceAlpha)) / outputAlpha);
  data[index + 2] = Math.round((color[2] * sourceAlpha + data[index + 2] * destinationAlpha * (1 - sourceAlpha)) / outputAlpha);
  data[index + 3] = Math.round(outputAlpha * 255);
}

function visitBox(box: Box, width: number, height: number, visitor: (x: number, y: number) => void): void {
  const minX = Math.max(0, Math.floor(box.minX));
  const minY = Math.max(0, Math.floor(box.minY));
  const maxX = Math.min(width - 1, Math.ceil(box.maxX));
  const maxY = Math.min(height - 1, Math.ceil(box.maxY));
  for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) visitor(x, y);
}

function insidePolygon(x: number, y: number, vertices: readonly PixelPoint[]): boolean {
  let inside = false;
  for (let index = 0, previous = vertices.length - 1; index < vertices.length; previous = index++) {
    const a = vertices[index];
    const b = vertices[previous];
    if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function distanceToSegmentSquared(x: number, y: number, from: PixelPoint, to: PixelPoint): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = dx * dx + dy * dy;
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((x - from.x) * dx + (y - from.y) * dy) / length));
  const offsetX = x - (from.x + t * dx);
  const offsetY = y - (from.y + t * dy);
  return offsetX * offsetX + offsetY * offsetY;
}

function markSegments(
  coverage: Uint8Array,
  width: number,
  height: number,
  vertices: readonly PixelPoint[],
  closed: boolean,
  strokeWidth: number,
): void {
  const radius = Math.max(0.5, strokeWidth / 2);
  const count = vertices.length - 1 + (closed ? 1 : 0);
  for (let index = 0; index < count; index++) {
    const from = vertices[index];
    const to = vertices[(index + 1) % vertices.length];
    visitBox(boxForPoints([from, to], radius), width, height, (x, y) => {
      if (distanceToSegmentSquared(x + 0.5, y + 0.5, from, to) <= radius * radius) {
        coverage[y * width + x] = 2;
      }
    });
  }
}

function markEllipse(
  coverage: Uint8Array,
  width: number,
  height: number,
  center: PixelPoint,
  radiusX: number,
  radiusY: number,
  item: Paint,
): void {
  const strokeWidth = (item.strokeWidth ?? 0) * Math.min(width, height);
  const halfStroke = item.stroke ? Math.max(0.5, strokeWidth / 2) : 0;
  const outerX = radiusX + halfStroke;
  const outerY = radiusY + halfStroke;
  const innerX = Math.max(0, radiusX - halfStroke);
  const innerY = Math.max(0, radiusY - halfStroke);
  visitBox({ minX: center.x - outerX, minY: center.y - outerY, maxX: center.x + outerX, maxY: center.y + outerY }, width, height, (x, y) => {
    const dx = x + 0.5 - center.x;
    const dy = y + 0.5 - center.y;
    const outer = outerX > 0 && outerY > 0 && dx * dx / (outerX * outerX) + dy * dy / (outerY * outerY) <= 1;
    if (!outer) return;
    const insideFill = radiusX > 0 && radiusY > 0 && dx * dx / (radiusX * radiusX) + dy * dy / (radiusY * radiusY) <= 1;
    const index = y * width + x;
    if (item.fill && insideFill) coverage[index] = Math.max(coverage[index], 1);
    const insideInner = innerX > 0 && innerY > 0 && dx * dx / (innerX * innerX) + dy * dy / (innerY * innerY) < 1;
    if (item.stroke && !insideInner) coverage[index] = 2;
  });
}

function compositeCoverage(
  data: Uint8ClampedArray,
  coverage: Uint8Array,
  width: number,
  height: number,
  box: Box,
  item: Paint,
): void {
  const opacity = item.opacity ?? 1;
  const fill = item.fill ? rgb(item.fill) : null;
  const stroke = item.stroke ? rgb(item.stroke) : null;
  visitBox(box, width, height, (x, y) => {
    const pixelIndex = y * width + x;
    const covered = coverage[pixelIndex];
    coverage[pixelIndex] = 0;
    const color = covered === 2 ? stroke : covered === 1 ? fill : null;
    if (color) composite(data, pixelIndex * 4, color, opacity);
  });
}

function drawPrimitive(
  data: Uint8ClampedArray,
  coverage: Uint8Array,
  width: number,
  height: number,
  item: HoleIllustrationRenderPrimitive,
): void {
  const short = Math.min(width, height);
  const stroke = item.stroke ? Math.max(0.5, (item.strokeWidth ?? 0) * short / 2) : 0;
  if (item.kind === "polygon" || item.kind === "polyline") {
    const vertices = item.points.map((value) => pixelPoint(value, width, height));
    if (item.fill && (item.kind === "polygon" || item.closed)) {
      visitBox(boxForPoints(vertices), width, height, (x, y) => {
        if (insidePolygon(x + 0.5, y + 0.5, vertices)) coverage[y * width + x] = 1;
      });
    }
    if (item.stroke) {
      markSegments(coverage, width, height, vertices, item.kind === "polygon" || item.closed,
        (item.strokeWidth ?? 0) * short);
    }
    compositeCoverage(data, coverage, width, height, boxForPoints(vertices, stroke), item);
    return;
  }
  if (item.kind === "ellipse") {
    markEllipse(coverage, width, height, pixelPoint(item.center, width, height), item.radius.x * width, item.radius.y * height, item);
    compositeCoverage(data, coverage, width, height, ellipseBox(item, width, height, stroke), item);
    return;
  }
  const boxes: Box[] = [];
  for (const sample of item.samples) {
    const center = pixelPoint(sample.point, width, height);
    boxes.push(markerBox(center, item.markerRadius.x * width, item.markerRadius.y * height, stroke));
    markEllipse(coverage, width, height, center, item.markerRadius.x * width, item.markerRadius.y * height, item);
  }
  compositeCoverage(data, coverage, width, height, unionBox(boxes), item);
}

/** Deterministic bounded RGBA8 software rasterization; no DOM, canvas, network, clock, or random source. */
export function renderHoleIllustrationRgba(
  input: HoleIllustrationRenderPlan,
  options: HoleIllustrationRgbaOptions,
): HoleIllustrationRgbaResult {
  try {
    const plan = validatedPlan(input);
    if (!plan) return failure("INVALID_PLAN", "The render plan is malformed or its canonical hash does not match.");
    if (!record(options) || !Number.isInteger(options.pixelRatio) || options.pixelRatio < 1
      || options.pixelRatio > HOLE_ILLUSTRATION_OUTPUT_LIMITS.maxRasterPixelRatio) {
      return failure("INVALID_OPTIONS", "pixelRatio must be an integer from 1 through 4.");
    }
    const budget = budgetForPlan(plan, options.pixelRatio);
    if (!budget.rgba.withinLimits) {
      return failure("ALLOCATION_EXCEEDED", "The requested raster exceeds pixel, byte, or bounded-work limits.");
    }
    const { width, height, pixels, rgbaBytes: bytes } = budget.rgba;
    const data = new Uint8ClampedArray(bytes);
    const background = rgb(plan.background);
    for (let index = 0; index < data.length; index += 4) {
      data[index] = background[0];
      data[index + 1] = background[1];
      data[index + 2] = background[2];
      data[index + 3] = 255;
    }
    const coverage = new Uint8Array(pixels);
    for (const layer of plan.layers) for (const item of layer.primitives) drawPrimitive(data, coverage, width, height, item);
    return {
      complete: true,
      version: HOLE_ILLUSTRATION_RENDERER_VERSION,
      format: "rgba8",
      width,
      height,
      stride: width * 4,
      pixelRatio: options.pixelRatio,
      planHash: plan.hash,
      data,
    };
  } catch {
    return failure("INVALID_PLAN", "The render plan could not be rasterized safely.");
  }
}
