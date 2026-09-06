import { canonicalJson, hashCanonicalValue } from "../../utils/canonical";
import { BUILDING_SPECS } from "../models/buildings";
import { BIOME_KEYS, type LandTheme } from "../models/biomes";
import { DECORATION_KINDS } from "../models/decorations";
import { sha256Hex } from "../holeTemplates/serialization";
import { isPlantId } from "../models/plantRegistry";
import { PIN_ROTATIONS, TEE_SETS, type Terrain } from "../models/types";
import { SEASONS, type SeasonName } from "../seasons/types";
import {
  HOLE_ILLUSTRATION_CONTRASTS,
  resolveHoleIllustrationStyle,
  type HoleIllustrationContrast,
  type HoleIllustrationStylePalette,
} from "./style";
import type {
  HoleIllustrationFrame,
  HoleIllustrationLocalPoint,
  HoleIllustrationSnapshot,
} from "./types";

export const HOLE_ILLUSTRATION_RENDER_PLAN_VERSION = 1 as const;
export const HOLE_ILLUSTRATION_RENDER_LIMITS = Object.freeze({
  maxSourceCells: 256 * 256,
  maxSourceFeaturesPerCollection: 20_000,
  maxContourTiles: 30_800,
  maxFootprintPoints: 300_000,
  /** A rotated 256x256 source crop cannot exceed this diagonal span. */
  maxFrameSpan: Math.SQRT2 * 256 + 0.001,
  maxViewportDimension: 8_192,
  maxPrimitives: 400_000,
  maxPoints: 2_000_000,
});

export const HOLE_ILLUSTRATION_LAYER_ORDER = [
  "terrain",
  "elevation-contours",
  "paths",
  "vegetation-obstacles",
  "surroundings",
  "route",
  "tee",
  "pin",
] as const;

/** Minimum fill-only diameter, in logical viewport pixels, inside endpoint marker strokes. */
export const HOLE_ILLUSTRATION_ENDPOINT_MARKER_MIN_INNER_DIAMETER = 3;

export type HoleIllustrationLayerId = (typeof HOLE_ILLUSTRATION_LAYER_ORDER)[number];
export type HoleIllustrationFrameMode = HoleIllustrationFrame["mode"];

export interface HoleIllustrationRenderSettings {
  readonly frame: HoleIllustrationFrameMode;
  readonly biome: LandTheme;
  readonly season: SeasonName;
  readonly contrast: HoleIllustrationContrast;
  readonly viewport: {
    readonly width: number;
    readonly height: number;
    /** Fraction of each viewport axis reserved around the authoritative crop. */
    readonly padding: number;
  };
}

export interface HoleIllustrationRenderPoint {
  /** Normalized canvas coordinates, always finite and within 0..1. */
  readonly x: number;
  readonly y: number;
}

interface HoleIllustrationPrimitiveBase {
  readonly id: string;
  readonly fill?: string;
  readonly stroke?: string;
  /** Fraction of the shorter viewport axis. */
  readonly strokeWidth?: number;
  readonly opacity?: number;
  readonly semantic: string;
}

export interface HoleIllustrationPolygonPrimitive extends HoleIllustrationPrimitiveBase {
  readonly kind: "polygon";
  readonly points: readonly HoleIllustrationRenderPoint[];
}

export interface HoleIllustrationPolylinePrimitive extends HoleIllustrationPrimitiveBase {
  readonly kind: "polyline";
  readonly points: readonly HoleIllustrationRenderPoint[];
  readonly closed: boolean;
}

export interface HoleIllustrationEllipsePrimitive extends HoleIllustrationPrimitiveBase {
  readonly kind: "ellipse";
  readonly center: HoleIllustrationRenderPoint;
  readonly radius: { readonly x: number; readonly y: number };
}

export interface HoleIllustrationSampleGridPrimitive extends HoleIllustrationPrimitiveBase {
  readonly kind: "sample-grid";
  readonly samples: readonly {
    readonly point: HoleIllustrationRenderPoint;
    /** Signed authored green-height offset in snapshot fixed-point units. */
    readonly value: number;
  }[];
  readonly markerRadius: { readonly x: number; readonly y: number };
}

export type HoleIllustrationRenderPrimitive =
  | HoleIllustrationPolygonPrimitive
  | HoleIllustrationPolylinePrimitive
  | HoleIllustrationEllipsePrimitive
  | HoleIllustrationSampleGridPrimitive;

export interface HoleIllustrationRenderLayer {
  readonly id: HoleIllustrationLayerId;
  readonly z: number;
  readonly primitives: readonly HoleIllustrationRenderPrimitive[];
}

export interface HoleIllustrationRenderPlan {
  readonly version: typeof HOLE_ILLUSTRATION_RENDER_PLAN_VERSION;
  readonly hash: string;
  readonly hashAlgorithm: "fnv1a32-canonical-v1";
  readonly snapshotHash: string;
  readonly settings: HoleIllustrationRenderSettings;
  readonly styleId: `${LandTheme}:${SeasonName}`;
  readonly background: string;
  readonly frame: HoleIllustrationFrame;
  readonly layers: readonly HoleIllustrationRenderLayer[];
  readonly bounds: { readonly minX: 0; readonly minY: 0; readonly maxX: 1; readonly maxY: 1 };
  readonly budget: {
    readonly sourceCells: number;
    readonly sourceFeatures: number;
    readonly primitiveCount: number;
    readonly pointCount: number;
    /** Canonical ordering makes construction bounded O(n log n + pointCount). */
    readonly runtime: "bounded-n-log-n";
    /** Allocation is capped by maxPrimitives and maxPoints before plan construction. */
    readonly memory: "bounded";
  };
}

export type HoleIllustrationRenderPlanFailureCode =
  | "INVALID_SNAPSHOT"
  | "INVALID_SETTINGS"
  | "BUDGET_EXCEEDED";

export type HoleIllustrationRenderPlanResult =
  | { readonly complete: true; readonly plan: HoleIllustrationRenderPlan }
  | {
    readonly complete: false;
    readonly version: typeof HOLE_ILLUSTRATION_RENDER_PLAN_VERSION;
    readonly code: HoleIllustrationRenderPlanFailureCode;
    readonly message: string;
  };

const TERRAIN = new Set<Terrain>([
  "fairway", "rough", "deep_rough", "sand", "waste_area",
  "water", "wetland", "green", "tee", "path",
]);
const SNAPSHOT_LOCAL_QUANTIZATION_TOLERANCE = 0.000_51;
const FRAME_CONTRACT_TOLERANCE = 0.000_001;
const OBSTACLE_TYPES = new Set(["tree", "bush", "rock"]);
const DECORATION_TYPES = new Set<string>(DECORATION_KINDS);
const SNAPSHOT_HASH = /^[0-9a-f]{64}$/;

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function failure(code: HoleIllustrationRenderPlanFailureCode, message: string): HoleIllustrationRenderPlanResult {
  return { complete: false, version: HOLE_ILLUSTRATION_RENDER_PLAN_VERSION, code, message };
}

function validSettings(value: unknown): value is HoleIllustrationRenderSettings {
  if (!record(value) || (value.frame !== "north-up" && value.frame !== "tee-to-green")
    || !BIOME_KEYS.includes(value.biome as LandTheme)
    || !SEASONS.includes(value.season as SeasonName)
    || !HOLE_ILLUSTRATION_CONTRASTS.includes(value.contrast as HoleIllustrationContrast)
    || !record(value.viewport)) return false;
  const { width, height, padding } = value.viewport;
  return Number.isInteger(width) && Number.isInteger(height)
    && (width as number) >= 1 && (height as number) >= 1
    && (width as number) <= HOLE_ILLUSTRATION_RENDER_LIMITS.maxViewportDimension
    && (height as number) <= HOLE_ILLUSTRATION_RENDER_LIMITS.maxViewportDimension
    && finite(padding) && padding >= 0 && padding <= 0.45;
}

function approximately(left: number, right: number, tolerance = FRAME_CONTRACT_TOLERANCE): boolean {
  return Math.abs(left - right) <= tolerance;
}

function validFrame(frame: unknown, mode: HoleIllustrationFrameMode): frame is HoleIllustrationFrame {
  if (!record(frame) || frame.mode !== mode || !record(frame.crop) || !record(frame.matrix)
    || !record(frame.translation) || !record(frame.originCourse)) return false;
  if (!finite(frame.crop.width) || !finite(frame.crop.height) || frame.crop.width <= 0 || frame.crop.height <= 0
    || frame.crop.width > (mode === "north-up" ? 256 : HOLE_ILLUSTRATION_RENDER_LIMITS.maxFrameSpan)
    || frame.crop.height > (mode === "north-up" ? 256 : HOLE_ILLUSTRATION_RENDER_LIMITS.maxFrameSpan)
    || !finite(frame.rotationDegrees) || !finite(frame.scaleToUnit) || frame.scaleToUnit <= 0
    || !finite(frame.matrix.a) || !finite(frame.matrix.b) || !finite(frame.matrix.c) || !finite(frame.matrix.d)
    || !finite(frame.translation.x) || !finite(frame.translation.y)
    || !finite(frame.originCourse.x) || !finite(frame.originCourse.y)
    || !approximately(frame.scaleToUnit, 1 / Math.max(frame.crop.width, frame.crop.height))) return false;
  if (mode === "north-up") {
    return Number.isInteger(frame.crop.width) && Number.isInteger(frame.crop.height)
      && frame.originCourse.x === 0 && frame.originCourse.y === 0
      && frame.rotationDegrees === 0
      && frame.matrix.a === 1 && frame.matrix.b === 0 && frame.matrix.c === 0 && frame.matrix.d === 1
      && Number.isInteger(frame.translation.x) && Number.isInteger(frame.translation.y);
  }
  const firstNorm = frame.matrix.a ** 2 + frame.matrix.b ** 2;
  const secondNorm = frame.matrix.c ** 2 + frame.matrix.d ** 2;
  const dot = frame.matrix.a * frame.matrix.c + frame.matrix.b * frame.matrix.d;
  const determinant = frame.matrix.a * frame.matrix.d - frame.matrix.b * frame.matrix.c;
  const rotation = Math.atan2(frame.matrix.b, frame.matrix.a) * 180 / Math.PI;
  return Number.isInteger(frame.originCourse.x) && Number.isInteger(frame.originCourse.y)
    && frame.originCourse.x >= 0 && frame.originCourse.x < 256
    && frame.originCourse.y >= 0 && frame.originCourse.y < 256
    && approximately(firstNorm, 1) && approximately(secondNorm, 1)
    && approximately(dot, 0) && approximately(determinant, 1)
    && approximately(frame.rotationDegrees, rotation);
}

function validLocalPoint(value: unknown): value is HoleIllustrationLocalPoint {
  return record(value) && Number.isInteger(value.x) && Number.isInteger(value.y) && record(value.teeToGreen)
    && finite(value.teeToGreen.x) && finite(value.teeToGreen.y);
}

function rawFramePoint(
  source: HoleIllustrationLocalPoint,
  frame: HoleIllustrationFrame,
  dx = 0,
  dy = 0,
): { x: number; y: number } {
  const base = frame.mode === "north-up" ? source : source.teeToGreen;
  if (frame.mode === "north-up") return { x: base.x + dx, y: base.y + dy };
  return {
    x: base.x + frame.matrix.a * dx + frame.matrix.c * dy,
    y: base.y + frame.matrix.b * dx + frame.matrix.d * dy,
  };
}

function insideFrame(point: { x: number; y: number }, frame: HoleIllustrationFrame): boolean {
  return point.x >= -SNAPSHOT_LOCAL_QUANTIZATION_TOLERANCE
    && point.y >= -SNAPSHOT_LOCAL_QUANTIZATION_TOLERANCE
    && point.x <= frame.crop.width + SNAPSHOT_LOCAL_QUANTIZATION_TOLERANCE
    && point.y <= frame.crop.height + SNAPSHOT_LOCAL_QUANTIZATION_TOLERANCE;
}

function validPointContract(
  source: unknown,
  northUp: HoleIllustrationFrame,
  teeToGreen: HoleIllustrationFrame,
  cell: boolean,
): source is HoleIllustrationLocalPoint {
  if (!validLocalPoint(source)) return false;
  const courseX = source.x - northUp.translation.x;
  const courseY = source.y - northUp.translation.y;
  const relativeX = courseX - teeToGreen.originCourse.x;
  const relativeY = courseY - teeToGreen.originCourse.y;
  const expectedX = teeToGreen.matrix.a * relativeX + teeToGreen.matrix.c * relativeY + teeToGreen.translation.x;
  const expectedY = teeToGreen.matrix.b * relativeX + teeToGreen.matrix.d * relativeY + teeToGreen.translation.y;
  if (!approximately(source.teeToGreen.x, expectedX, SNAPSHOT_LOCAL_QUANTIZATION_TOLERANCE)
    || !approximately(source.teeToGreen.y, expectedY, SNAPSHOT_LOCAL_QUANTIZATION_TOLERANCE)
    || !insideFrame(rawFramePoint(source, northUp), northUp)
    || !insideFrame(rawFramePoint(source, teeToGreen), teeToGreen)) return false;
  if (!cell) return true;
  return ([[0, 0], [1, 0], [1, 1], [0, 1]] as const).every(([dx, dy]) =>
    insideFrame(rawFramePoint(source, northUp, dx, dy), northUp)
    && insideFrame(rawFramePoint(source, teeToGreen, dx, dy), teeToGreen));
}

function boundedText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 4_096;
}

function validSnapshot(snapshot: unknown): snapshot is HoleIllustrationSnapshot {
  if (!record(snapshot) || snapshot.version !== 1 || typeof snapshot.hash !== "string" || !SNAPSHOT_HASH.test(snapshot.hash)
    || !record(snapshot.route) || !boundedText(snapshot.route.layoutId) || !boundedText(snapshot.route.holeId)
    || (snapshot.route.source !== "published" && snapshot.route.source !== "draft")
    || !Number.isInteger(snapshot.route.order) || (snapshot.route.order as number) < 0
    || !Number.isInteger(snapshot.route.length) || (snapshot.route.length as number) < 1
    || !Array.isArray(snapshot.route.routingIds) || snapshot.route.routingIds.length > 36
    || snapshot.route.routingIds.length !== snapshot.route.length
    || !snapshot.route.routingIds.every(boundedText) || new Set(snapshot.route.routingIds).size !== snapshot.route.routingIds.length
    || (snapshot.route.order as number) >= snapshot.route.routingIds.length
    || !record(snapshot.framing) || !validFrame(snapshot.framing.northUp, "north-up")
    || !validFrame(snapshot.framing.teeToGreen, "tee-to-green")
    || !Number.isInteger(snapshot.framing.marginTiles) || (snapshot.framing.marginTiles as number) < 0
    || (snapshot.framing.marginTiles as number) > 64
    || snapshot.framing.corridorRadiusTiles !== (snapshot.framing.marginTiles as number) + 4
    || !record(snapshot.selection) || !TEE_SETS.includes(snapshot.selection.teeSet as never)
    || !PIN_ROTATIONS.includes(snapshot.selection.pinRotation as never)
    || (snapshot.par !== 3 && snapshot.par !== 4 && snapshot.par !== 5)
    || (snapshot.parMode !== "AUTO" && snapshot.parMode !== "MANUAL")
    || !finite(snapshot.distanceTiles) || snapshot.distanceTiles <= 0
    || !finite(snapshot.yardage) || snapshot.yardage <= 0
    || !finite(snapshot.yardsPerTile) || snapshot.yardsPerTile <= 0
    || !record(snapshot.north) || snapshot.north.x !== 0 || snapshot.north.y !== -1
    || !Array.isArray(snapshot.terrain) || snapshot.terrain.length < 1
    || snapshot.terrain.length > HOLE_ILLUSTRATION_RENDER_LIMITS.maxSourceCells
    || !record(snapshot.contours) || snapshot.contours.version !== 1 || snapshot.contours.samplesPerAxis !== 4
    || snapshot.contours.fixedPointScale !== 1024 || snapshot.contours.interpolation !== "bilinear"
    || !Array.isArray(snapshot.contours.tiles) || snapshot.contours.tiles.length > HOLE_ILLUSTRATION_RENDER_LIMITS.maxContourTiles
    || !Array.isArray(snapshot.obstacles) || !Array.isArray(snapshot.decorations) || !Array.isArray(snapshot.surroundings)
    || snapshot.obstacles.length > HOLE_ILLUSTRATION_RENDER_LIMITS.maxSourceFeaturesPerCollection
    || snapshot.decorations.length > HOLE_ILLUSTRATION_RENDER_LIMITS.maxSourceFeaturesPerCollection
    || snapshot.surroundings.length > HOLE_ILLUSTRATION_RENDER_LIMITS.maxSourceFeaturesPerCollection) return false;
  const northUp = snapshot.framing.northUp;
  const teeToGreen = snapshot.framing.teeToGreen;
  if (!validPointContract(snapshot.tee, northUp, teeToGreen, true)
    || !validPointContract(snapshot.pin, northUp, teeToGreen, true)
    || !Array.isArray(snapshot.waypoints) || snapshot.waypoints.length > 64
    || !snapshot.waypoints.every((point) => validPointContract(point, northUp, teeToGreen, true))) return false;
  const terrainCells = new Set<string>();
  for (const cell of snapshot.terrain) {
    if (!record(cell) || !validPointContract(cell, northUp, teeToGreen, true)
      || !TERRAIN.has(cell.terrain as Terrain) || !finite(cell.elevation)) return false;
    const key = `${cell.x},${cell.y}`;
    if (terrainCells.has(key)) return false;
    terrainCells.add(key);
  }
  const contourCells = new Set<string>();
  for (const tile of snapshot.contours.tiles) {
    if (!record(tile) || !validPointContract(tile, northUp, teeToGreen, true) || !Array.isArray(tile.offsets)
      || tile.offsets.length !== 16
      || !tile.offsets.every((offset: unknown) => Number.isInteger(offset) && Math.abs(offset as number) <= 2_048)) return false;
    const key = `${tile.x},${tile.y}`;
    if (contourCells.has(key)) return false;
    contourCells.add(key);
  }
  if (!snapshot.obstacles.every((item) => record(item) && validPointContract(item, northUp, teeToGreen, true)
    && boundedText(item.type) && OBSTACLE_TYPES.has(item.type)
    && (item.plantId === undefined || isPlantId(item.plantId)))) return false;
  let footprintPoints = 0;
  const decorationCells = new Set<string>();
  for (const item of snapshot.decorations) {
    if (!record(item) || !validPointContract(item, northUp, teeToGreen, true)
      || !boundedText(item.kind) || !DECORATION_TYPES.has(item.kind)
      || !Number.isInteger(item.rotation) || (item.rotation as number) < 0 || (item.rotation as number) > 3
      || (item.variant !== undefined && (!Number.isInteger(item.variant) || (item.variant as number) < 0))
      || (item.span !== undefined && (!Number.isInteger(item.span) || (item.span as number) < 1))
      || (item.plantId !== undefined && !isPlantId(item.plantId))
      || !Array.isArray(item.footprint)) return false;
    footprintPoints += item.footprint.length;
    if (footprintPoints > HOLE_ILLUSTRATION_RENDER_LIMITS.maxFootprintPoints) return false;
    const ownCells = new Set<string>();
    for (const point of item.footprint) {
      if (!validPointContract(point, northUp, teeToGreen, true)) return false;
      const key = `${point.x},${point.y}`;
      if (ownCells.has(key) || decorationCells.has(key)) return false;
      ownCells.add(key);
      decorationCells.add(key);
    }
  }
  const surroundingCells = new Set<string>();
  for (const item of snapshot.surroundings) {
    if (!record(item) || !validPointContract(item, northUp, teeToGreen, true)
      || !boundedText(item.type) || !Object.hasOwn(BUILDING_SPECS, item.type)
      || (item.tier !== undefined && (!Number.isInteger(item.tier) || ![1, 2, 3].includes(item.tier as number)))
      || !Array.isArray(item.footprint)) return false;
    footprintPoints += item.footprint.length;
    if (footprintPoints > HOLE_ILLUSTRATION_RENDER_LIMITS.maxFootprintPoints) return false;
    const ownCells = new Set<string>();
    for (const point of item.footprint) {
      if (!validPointContract(point, northUp, teeToGreen, true)) return false;
      const key = `${point.x},${point.y}`;
      if (ownCells.has(key) || surroundingCells.has(key)) return false;
      ownCells.add(key);
      surroundingCells.add(key);
    }
  }
  if (snapshot.provenance !== undefined && (!record(snapshot.provenance)
    || !boundedText(snapshot.provenance.templateId) || !boundedText(snapshot.provenance.sourceLabel)
    || (snapshot.provenance.licenseName !== undefined && !boundedText(snapshot.provenance.licenseName))
    || (snapshot.provenance.attribution !== undefined && !boundedText(snapshot.provenance.attribution)))) return false;
  return snapshot.hash === holeIllustrationSnapshotIntegrityHash(snapshot as unknown as HoleIllustrationSnapshot);
}

function pointFacts(point: HoleIllustrationLocalPoint): HoleIllustrationLocalPoint {
  return { x: point.x, y: point.y, teeToGreen: { x: point.teeToGreen.x, y: point.teeToGreen.y } };
}

function frameFacts(frame: HoleIllustrationFrame): HoleIllustrationFrame {
  return {
    mode: frame.mode,
    originCourse: { x: frame.originCourse.x, y: frame.originCourse.y },
    rotationDegrees: frame.rotationDegrees,
    matrix: { a: frame.matrix.a, b: frame.matrix.b, c: frame.matrix.c, d: frame.matrix.d },
    translation: { x: frame.translation.x, y: frame.translation.y },
    crop: { width: frame.crop.width, height: frame.crop.height },
    scaleToUnit: frame.scaleToUnit,
  };
}

function sortDeclared<T>(values: readonly T[]): T[] {
  return values.map((value) => ({ value, key: canonicalJson(value) }))
    .sort((left, right) => left.key < right.key ? -1 : left.key > right.key ? 1 : 0)
    .map(({ value }) => value);
}

function canonicalSnapshotFacts(snapshot: HoleIllustrationSnapshot): Omit<HoleIllustrationSnapshot, "hash"> {
  const terrain = snapshot.terrain.map((cell) => ({
    ...pointFacts(cell),
    terrain: cell.terrain,
    elevation: cell.elevation,
  })).sort((left, right) => left.y - right.y || left.x - right.x);
  const contourTiles = sortDeclared(snapshot.contours.tiles.map((tile) => ({
    ...pointFacts(tile),
    offsets: [...tile.offsets],
  })));
  const obstacles = sortDeclared(snapshot.obstacles.map((item) => ({
    ...pointFacts(item),
    type: item.type,
    ...(item.plantId ? { plantId: item.plantId } : {}),
  })));
  const decorations = sortDeclared(snapshot.decorations.map((item) => ({
    ...pointFacts(item),
    kind: item.kind,
    rotation: item.rotation,
    ...(item.variant !== undefined ? { variant: item.variant } : {}),
    ...(item.plantId ? { plantId: item.plantId } : {}),
    ...(item.span !== undefined ? { span: item.span } : {}),
    footprint: sortDeclared(item.footprint.map(pointFacts)),
  })));
  const surroundings = sortDeclared(snapshot.surroundings.map((item) => ({
    ...pointFacts(item),
    type: item.type,
    ...(item.tier !== undefined ? { tier: item.tier } : {}),
    footprint: sortDeclared(item.footprint.map(pointFacts)),
  })));
  const provenance = snapshot.provenance ? {
    templateId: snapshot.provenance.templateId,
    sourceLabel: snapshot.provenance.sourceLabel,
    ...(snapshot.provenance.licenseName ? { licenseName: snapshot.provenance.licenseName } : {}),
    ...(snapshot.provenance.attribution ? { attribution: snapshot.provenance.attribution } : {}),
  } : undefined;
  return {
    version: 1,
    route: {
      layoutId: snapshot.route.layoutId,
      source: snapshot.route.source,
      holeId: snapshot.route.holeId,
      order: snapshot.route.order,
      length: snapshot.route.length,
      routingIds: [...snapshot.route.routingIds],
    },
    selection: { teeSet: snapshot.selection.teeSet, pinRotation: snapshot.selection.pinRotation },
    tee: pointFacts(snapshot.tee),
    pin: pointFacts(snapshot.pin),
    waypoints: snapshot.waypoints.map(pointFacts),
    par: snapshot.par,
    parMode: snapshot.parMode,
    distanceTiles: snapshot.distanceTiles,
    yardage: snapshot.yardage,
    yardsPerTile: snapshot.yardsPerTile,
    north: { x: 0, y: -1 },
    framing: {
      marginTiles: snapshot.framing.marginTiles,
      corridorRadiusTiles: snapshot.framing.corridorRadiusTiles,
      northUp: frameFacts(snapshot.framing.northUp),
      teeToGreen: frameFacts(snapshot.framing.teeToGreen),
    },
    terrain,
    contours: {
      version: 1,
      samplesPerAxis: 4,
      fixedPointScale: 1024,
      interpolation: "bilinear",
      tiles: contourTiles,
    },
    obstacles,
    decorations,
    surroundings,
    ...(provenance ? { provenance } : {}),
  };
}

function canonicalizedSnapshot(snapshot: HoleIllustrationSnapshot): HoleIllustrationSnapshot {
  return { ...canonicalSnapshotFacts(snapshot), hash: snapshot.hash };
}

/** Exact SHA-256 contract used by the released snapshot builder, over bounded declared facts only. */
export function holeIllustrationSnapshotIntegrityHash(snapshot: HoleIllustrationSnapshot): string {
  return sha256Hex(canonicalJson(canonicalSnapshotFacts(snapshot)));
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function ownedFrame(frame: HoleIllustrationFrame): HoleIllustrationFrame {
  return frameFacts(frame);
}

function sanitizedSettings(settings: HoleIllustrationRenderSettings): HoleIllustrationRenderSettings {
  return {
    frame: settings.frame,
    biome: settings.biome,
    season: settings.season,
    contrast: settings.contrast,
    viewport: {
      width: settings.viewport.width,
      height: settings.viewport.height,
      padding: settings.viewport.padding,
    },
  };
}

function estimateBudget(snapshot: HoleIllustrationSnapshot) {
  const pathCells = snapshot.terrain.filter((cell) => cell.terrain === "path").length;
  const decorationCells = snapshot.decorations.reduce((total, item) => total + item.footprint.length, 0);
  const surroundingCells = snapshot.surroundings.reduce((total, item) => total + item.footprint.length, 0);
  const variableElevation = new Set(snapshot.terrain.map((cell) => cell.elevation)).size > 1;
  const primitiveCount = snapshot.terrain.length
    + (variableElevation ? snapshot.terrain.length : 0)
    + snapshot.contours.tiles.length
    + pathCells
    + snapshot.obstacles.length
    + decorationCells
    + surroundingCells
    + 4;
  const pointCount = snapshot.terrain.length * 4
    + (variableElevation ? snapshot.terrain.length * 4 : 0)
    + snapshot.contours.tiles.length * 16
    + pathCells * 4
    + snapshot.obstacles.length
    + decorationCells * 4
    + surroundingCells * 4
    + 2
    + (snapshot.waypoints.length + 2) * 2;
  return {
    sourceCells: snapshot.terrain.length,
    sourceFeatures: snapshot.contours.tiles.length + snapshot.obstacles.length
      + snapshot.decorations.length + snapshot.surroundings.length,
    primitiveCount,
    pointCount,
    variableElevation,
  };
}

interface Projection {
  point(source: HoleIllustrationLocalPoint, dx?: number, dy?: number): HoleIllustrationRenderPoint;
  cell(source: HoleIllustrationLocalPoint): readonly HoleIllustrationRenderPoint[];
  radius(cellFraction: number): { readonly x: number; readonly y: number };
  endpointRadius(cellFraction: number, strokeWidth: number): { readonly x: number; readonly y: number };
  stroke(cellFraction: number): number;
}

function projection(frame: HoleIllustrationFrame, settings: HoleIllustrationRenderSettings): Projection {
  const { width, height, padding } = settings.viewport;
  const availableWidth = width * (1 - padding * 2);
  const availableHeight = height * (1 - padding * 2);
  const scale = Math.min(availableWidth / frame.crop.width, availableHeight / frame.crop.height);
  const offsetX = (width - frame.crop.width * scale) / 2;
  const offsetY = (height - frame.crop.height * scale) / 2;
  const raw = (source: HoleIllustrationLocalPoint, dx = 0, dy = 0) => {
    const base = frame.mode === "north-up" ? source : source.teeToGreen;
    if (frame.mode === "north-up") return { x: base.x + dx, y: base.y + dy };
    return {
      x: base.x + frame.matrix.a * dx + frame.matrix.c * dy,
      y: base.y + frame.matrix.b * dx + frame.matrix.d * dy,
    };
  };
  const point = (source: HoleIllustrationLocalPoint, dx = 0, dy = 0): HoleIllustrationRenderPoint => {
    const candidate = raw(source, dx, dy);
    if (candidate.x < -SNAPSHOT_LOCAL_QUANTIZATION_TOLERANCE
      || candidate.y < -SNAPSHOT_LOCAL_QUANTIZATION_TOLERANCE
      || candidate.x > frame.crop.width + SNAPSHOT_LOCAL_QUANTIZATION_TOLERANCE
      || candidate.y > frame.crop.height + SNAPSHOT_LOCAL_QUANTIZATION_TOLERANCE) {
      throw new Error("Snapshot geometry exceeds its authoritative crop.");
    }
    const x = Math.min(frame.crop.width, Math.max(0, candidate.x));
    const y = Math.min(frame.crop.height, Math.max(0, candidate.y));
    return {
      x: (offsetX + x * scale) / width,
      y: (offsetY + y * scale) / height,
    };
  };
  return {
    point,
    cell: (source) => [point(source), point(source, 1, 0), point(source, 1, 1), point(source, 0, 1)],
    radius: (cellFraction) => ({ x: scale * cellFraction / width, y: scale * cellFraction / height }),
    endpointRadius: (cellFraction, strokeWidth) => {
      const naturalRadius = scale * cellFraction;
      const strokePixels = strokeWidth * Math.min(width, height);
      const radiusPixels = Math.max(naturalRadius,
        (strokePixels + HOLE_ILLUSTRATION_ENDPOINT_MARKER_MIN_INNER_DIAMETER) / 2);
      return { x: radiusPixels / width, y: radiusPixels / height };
    },
    stroke: (cellFraction) => Math.max(1, scale * cellFraction) / Math.min(width, height),
  };
}

function polygon(
  id: string,
  semantic: string,
  points: readonly HoleIllustrationRenderPoint[],
  paint: Pick<HoleIllustrationPrimitiveBase, "fill" | "stroke" | "strokeWidth" | "opacity">,
): HoleIllustrationPolygonPrimitive {
  return { id, kind: "polygon", semantic, points, ...paint };
}

function featureColor(type: string, palette: HoleIllustrationStylePalette): string {
  if (type === "tree" || type === "bush" || type === "rock") return palette.vegetation[type];
  return palette.vegetation.decoration;
}

/**
 * Purely projects a released snapshot into a deterministic, canvas-agnostic vector plan.
 * It reads no clock, random source, product state, assets, DOM, or rendering backend.
 */
export function createHoleIllustrationRenderPlan(
  snapshot: HoleIllustrationSnapshot,
  settings: HoleIllustrationRenderSettings,
): HoleIllustrationRenderPlanResult {
  try {
    if (!validSettings(settings)) return failure("INVALID_SETTINGS", "Frame, registered style, viewport, contrast, and padding must be explicit and bounded.");
    if (!validSnapshot(snapshot)) return failure("INVALID_SNAPSHOT", "The released illustration snapshot is malformed or exceeds source bounds.");
    const source = canonicalizedSnapshot(snapshot);
    const estimate = estimateBudget(source);
    if (estimate.primitiveCount > HOLE_ILLUSTRATION_RENDER_LIMITS.maxPrimitives
      || estimate.pointCount > HOLE_ILLUSTRATION_RENDER_LIMITS.maxPoints) {
      return failure("BUDGET_EXCEEDED", "The render plan would exceed its primitive or point allocation bound.");
    }

    const renderSettings = sanitizedSettings(settings);
    const sourceFrame = renderSettings.frame === "north-up" ? source.framing.northUp : source.framing.teeToGreen;
    const frame = ownedFrame(sourceFrame);
    const project = projection(frame, renderSettings);
    const palette = resolveHoleIllustrationStyle(renderSettings.biome, renderSettings.season, renderSettings.contrast);
    const layers = new Map<HoleIllustrationLayerId, HoleIllustrationRenderPrimitive[]>(
      HOLE_ILLUSTRATION_LAYER_ORDER.map((id) => [id, []]),
    );
    const add = (layer: HoleIllustrationLayerId, primitive: HoleIllustrationRenderPrimitive) => {
      layers.get(layer)!.push(primitive);
    };

    const terrain = source.terrain;
    let elevationMin = Infinity;
    let elevationMax = -Infinity;
    for (const cell of terrain) {
      elevationMin = Math.min(elevationMin, cell.elevation);
      elevationMax = Math.max(elevationMax, cell.elevation);
    }
    for (const [index, cell] of terrain.entries()) {
      const id = `terrain-${index}-${cell.x}-${cell.y}`;
      add("terrain", polygon(id, `terrain:${cell.terrain}`, project.cell(cell), {
        fill: palette.terrain[cell.terrain],
        stroke: renderSettings.contrast === "high-contrast" ? palette.ink : undefined,
        strokeWidth: renderSettings.contrast === "high-contrast" ? project.stroke(0.025) : undefined,
      }));
      if (estimate.variableElevation) {
        const normalized = (cell.elevation - elevationMin) / (elevationMax - elevationMin);
        add("elevation-contours", polygon(`elevation-${index}-${cell.x}-${cell.y}`, `elevation:${cell.elevation}`, project.cell(cell), {
          fill: normalized >= 0.5 ? palette.elevation.high : palette.elevation.low,
          opacity: Math.abs(normalized - 0.5) * 0.24,
        }));
      }
      if (cell.terrain === "path") {
        add("paths", {
          id: `path-${index}-${cell.x}-${cell.y}`,
          kind: "polyline",
          semantic: "path:authored-cell",
          points: project.cell(cell),
          closed: true,
          stroke: palette.path,
          strokeWidth: project.stroke(renderSettings.contrast === "high-contrast" ? 0.12 : 0.08),
        });
      }
    }

    for (const [index, tile] of source.contours.tiles.entries()) {
      const samples = tile.offsets.map((value, sampleIndex) => ({
        point: project.point(tile, (sampleIndex % 4) / 3, Math.floor(sampleIndex / 4) / 3),
        value,
      }));
      add("elevation-contours", {
        id: `contour-${index}-${tile.x}-${tile.y}`,
        kind: "sample-grid",
        semantic: `contour:bilinear-fixed-${source.contours.fixedPointScale}`,
        samples,
        markerRadius: project.radius(renderSettings.contrast === "high-contrast" ? 0.045 : 0.03),
        fill: palette.contour,
        opacity: 0.72,
      });
    }

    for (const [index, item] of source.obstacles.entries()) {
      add("vegetation-obstacles", {
        id: `obstacle-${index}-${item.x}-${item.y}`,
        kind: "ellipse",
        semantic: `obstacle:${item.type}${item.plantId ? `:${item.plantId}` : ""}`,
        center: project.point(item, 0.5, 0.5),
        radius: project.radius(item.type === "tree" ? 0.34 : item.type === "bush" ? 0.27 : 0.23),
        fill: featureColor(item.type, palette),
        stroke: palette.ink,
        strokeWidth: project.stroke(0.045),
      });
    }
    for (const [itemIndex, item] of source.decorations.entries()) {
      for (const [cellIndex, cell] of item.footprint.entries()) {
        add("vegetation-obstacles", polygon(
          `decoration-${itemIndex}-${cellIndex}-${cell.x}-${cell.y}`,
          `decoration:${item.kind}`,
          project.cell(cell),
          { fill: featureColor(item.kind, palette), stroke: palette.ink, strokeWidth: project.stroke(0.04), opacity: 0.9 },
        ));
      }
    }
    for (const [itemIndex, item] of source.surroundings.entries()) {
      for (const [cellIndex, cell] of item.footprint.entries()) {
        add("surroundings", polygon(
          `surrounding-${itemIndex}-${cellIndex}-${cell.x}-${cell.y}`,
          `surrounding:${item.type}${item.tier ? `:tier-${item.tier}` : ""}`,
          project.cell(cell),
          { fill: palette.surroundings.fill, stroke: palette.surroundings.stroke, strokeWidth: project.stroke(0.055) },
        ));
      }
    }

    const routePoints = [source.tee, ...source.waypoints, source.pin]
      .map((point) => project.point(point, 0.5, 0.5));
    const routeStrokeWidth = project.stroke(renderSettings.contrast === "high-contrast" ? 0.1 : 0.065);
    add("route", {
      id: "authoritative-route-halo",
      kind: "polyline",
      semantic: "route:tee-waypoints-pin:halo",
      points: routePoints,
      closed: false,
      stroke: palette.routeHalo,
      strokeWidth: routeStrokeWidth + 2 / Math.min(renderSettings.viewport.width, renderSettings.viewport.height),
    });
    add("route", {
      id: "authoritative-route",
      kind: "polyline",
      semantic: "route:tee-waypoints-pin",
      points: routePoints,
      closed: false,
      stroke: palette.route,
      strokeWidth: routeStrokeWidth,
      opacity: 0.88,
    });
    const endpointStrokeWidth = project.stroke(0.08);
    add("tee", {
      id: "selected-tee",
      kind: "ellipse",
      semantic: `tee:${source.selection.teeSet}`,
      center: project.point(source.tee, 0.5, 0.5),
      radius: project.endpointRadius(0.25, endpointStrokeWidth),
      fill: palette.tee.fill,
      stroke: palette.tee.stroke,
      strokeWidth: endpointStrokeWidth,
    });
    add("pin", {
      id: "selected-pin",
      kind: "ellipse",
      semantic: `pin:${source.selection.pinRotation}`,
      center: project.point(source.pin, 0.5, 0.5),
      radius: project.endpointRadius(0.22, endpointStrokeWidth),
      fill: palette.pin.fill,
      stroke: palette.pin.stroke,
      strokeWidth: endpointStrokeWidth,
    });
    const orderedLayers = HOLE_ILLUSTRATION_LAYER_ORDER.map((id, z): HoleIllustrationRenderLayer => ({
      id,
      z,
      primitives: layers.get(id)!,
    }));
    const facts = {
      version: HOLE_ILLUSTRATION_RENDER_PLAN_VERSION,
      hashAlgorithm: "fnv1a32-canonical-v1" as const,
      snapshotHash: source.hash,
      settings: renderSettings,
      styleId: `${renderSettings.biome}:${renderSettings.season}` as const,
      background: palette.background,
      frame,
      layers: orderedLayers,
      bounds: { minX: 0 as const, minY: 0 as const, maxX: 1 as const, maxY: 1 as const },
      budget: {
        sourceCells: estimate.sourceCells,
        sourceFeatures: estimate.sourceFeatures,
        primitiveCount: estimate.primitiveCount,
        pointCount: estimate.pointCount,
        runtime: "bounded-n-log-n" as const,
        memory: "bounded" as const,
      },
    };
    return {
      complete: true,
      plan: deepFreeze({ ...facts, hash: hashCanonicalValue(facts) }),
    };
  } catch {
    return failure("INVALID_SNAPSHOT", "Snapshot geometry could not be projected inside its authoritative crop.");
  }
}
