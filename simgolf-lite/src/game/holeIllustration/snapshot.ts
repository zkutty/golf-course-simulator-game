import { canonicalJson } from "../../utils/canonical";
import {
  GREEN_SURFACE_FIXED_POINT_SCALE,
  GREEN_SURFACE_MAX_OFFSET_FIXED,
  GREEN_SURFACE_MAX_TILES,
  GREEN_SURFACE_SAMPLE_COUNT,
  GREEN_SURFACE_SAMPLES_PER_AXIS,
  GREEN_SURFACE_VERSION,
} from "../greens/greenSurface";
import { sha256Hex } from "../holeTemplates/serialization";
import { BUILDING_SPECS, buildingTiles } from "../models/buildings";
import { getPinPosition, getTeeBox } from "../models/courseSetup";
import { DECORATION_KINDS, DECORATION_SPECS, decorationTiles } from "../models/decorations";
import { MAX_ESTATE_HOLES, normalizeCourseLayouts } from "../models/courseLayouts";
import { isPlantId } from "../models/plantRegistry";
import { PIN_ROTATIONS, TEE_SETS, type Course, type Decoration, type Hole, type Obstacle, type Point, type Terrain } from "../models/types";
import { computeAutoPar } from "../sim/holeMetrics";
import type {
  HoleIllustrationFrame,
  HoleIllustrationIncomplete,
  HoleIllustrationLocalPoint,
  HoleIllustrationSnapshot,
  HoleIllustrationSnapshotRequest,
  HoleIllustrationSnapshotResult,
} from "./types";

export * from "./types";

const SNAPSHOT_VERSION = 1 as const;
const DEFAULT_MARGIN_TILES = 8;
const MAX_MARGIN_TILES = 64;
const PLAYABLE_CORRIDOR_RADIUS_TILES = 4;
const MAX_TEXT_LENGTH = 4_096;
const MAX_GRID_CELLS = 256 * 256;
const MAX_FEATURES = 20_000;
const MAX_LAYOUTS = 36;
const MAX_WAYPOINTS = 64;
const TERRAIN = new Set<Terrain>([
  "fairway", "rough", "deep_rough", "sand", "waste_area",
  "water", "wetland", "green", "tee", "path",
]);
const OBSTACLE_TYPES = new Set(["tree", "bush", "rock"]);
const DECORATION_TYPES = new Set<string>(DECORATION_KINDS);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function integer(value: unknown): value is number {
  return finite(value) && Number.isInteger(value);
}

function text(value: unknown, allowEmpty = false): value is string {
  return typeof value === "string" && value.length <= MAX_TEXT_LENGTH && (allowEmpty || value.trim().length > 0);
}

function quantize(value: number, digits = 3): number {
  const rounded = Math.round(value * 10 ** digits) / 10 ** digits;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function incomplete(code: HoleIllustrationIncomplete["code"], message: string): HoleIllustrationIncomplete {
  return { complete: false, version: SNAPSHOT_VERSION, code, message };
}

function point(value: unknown, course: Pick<Course, "width" | "height">): value is Point {
  if (!isRecord(value) || !integer(value.x) || !integer(value.y)) return false;
  return value.x >= 0 && value.y >= 0 && value.x < course.width && value.y < course.height;
}

function pointKey(value: Point): string {
  return `${value.x},${value.y}`;
}

function canonicalCompare(left: unknown, right: unknown): number {
  const a = canonicalJson(left);
  const b = canonicalJson(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

function uniqueIds(values: unknown): values is string[] {
  return Array.isArray(values)
    && values.every((value) => text(value))
    && new Set(values).size === values.length;
}

function authoritativeLayouts(value: unknown, holeIds: ReadonlySet<string>): boolean {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_LAYOUTS) return false;
  const layoutIds = new Set<string>();
  const publishedOwners = new Set<string>();
  const draftOwners = new Set<string>();
  for (const raw of value) {
    if (!isRecord(raw) || !text(raw.id) || layoutIds.has(raw.id)
      || !uniqueIds(raw.publishedHoleIds) || !uniqueIds(raw.draftHoleIds)) return false;
    layoutIds.add(raw.id);
    for (const [ids, owners] of [[raw.publishedHoleIds, publishedOwners], [raw.draftHoleIds, draftOwners]] as const) {
      for (const id of ids) {
        if (!holeIds.has(id) || owners.has(id)) return false;
        owners.add(id);
      }
    }
  }
  return true;
}

function distanceToSegment(candidate: Point, from: Point, to: Point): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const squared = dx * dx + dy * dy;
  const t = squared === 0 ? 0 : Math.max(0, Math.min(1,
    ((candidate.x - from.x) * dx + (candidate.y - from.y) * dy) / squared,
  ));
  return Math.hypot(candidate.x - from.x - t * dx, candidate.y - from.y - t * dy);
}

function corridorCells(route: readonly Point[], course: Course, radius: number): Point[] {
  const minX = Math.max(0, Math.floor(Math.min(...route.map((candidate) => candidate.x)) - radius));
  const minY = Math.max(0, Math.floor(Math.min(...route.map((candidate) => candidate.y)) - radius));
  const maxX = Math.min(course.width - 1, Math.ceil(Math.max(...route.map((candidate) => candidate.x)) + radius));
  const maxY = Math.min(course.height - 1, Math.ceil(Math.max(...route.map((candidate) => candidate.y)) + radius));
  const segments = route.slice(1).map((to, index) => ({ from: route[index], to }));
  const cells: Point[] = [];
  for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
    const candidate = { x, y };
    if (segments.some(({ from, to }) => distanceToSegment(candidate, from, to) <= radius)) cells.push(candidate);
  }
  return cells;
}

function routeDistance(route: readonly Point[]): number {
  let distance = 0;
  for (let index = 1; index < route.length; index++) {
    distance += Math.hypot(route[index].x - route[index - 1].x, route[index].y - route[index - 1].y);
  }
  return distance;
}

function selectedPar(hole: Hole, teeSet: HoleIllustrationSnapshotRequest["teeSet"]): { mode: "AUTO" | "MANUAL"; par?: 3 | 4 | 5 } | null {
  const configured = hole.parByTee?.[teeSet];
  if (configured !== undefined) {
    if (configured.mode === "AUTO") return { mode: "AUTO" };
    if (configured.mode === "MANUAL" && [3, 4, 5].includes(configured.par)) return configured;
    return null;
  }
  if (teeSet === "member") {
    if (hole.parMode === "AUTO") return { mode: "AUTO" };
    if (hole.parMode === "MANUAL" && [3, 4, 5].includes(hole.parManual as number)) return { mode: "MANUAL", par: hole.parManual };
    return null;
  }
  return { mode: "AUTO" };
}

interface ValidatedObstacle { x: number; y: number; type: "tree" | "bush" | "rock"; plantId?: Obstacle["plantId"] }
interface ValidatedDecoration { x: number; y: number; kind: typeof DECORATION_KINDS[number]; rotation: 0 | 1 | 2 | 3; variant?: number; plantId?: Decoration["plantId"]; span?: number }
interface ValidatedBuilding { x: number; y: number; type: keyof typeof BUILDING_SPECS; tier?: 1 | 2 | 3 }

function validateObstacles(value: unknown, course: Course): ValidatedObstacle[] | null {
  if (!Array.isArray(value) || value.length > MAX_FEATURES) return null;
  const result: ValidatedObstacle[] = [];
  for (const raw of value) {
    if (!isRecord(raw) || !integer(raw.x) || !integer(raw.y) || typeof raw.type !== "string" || !OBSTACLE_TYPES.has(raw.type)) return null;
    if (raw.x < 0 || raw.y < 0 || raw.x >= course.width || raw.y >= course.height) return null;
    if (raw.plantId !== undefined && !isPlantId(raw.plantId)) return null;
    result.push({ x: raw.x, y: raw.y, type: raw.type as ValidatedObstacle["type"], ...(raw.plantId ? { plantId: raw.plantId } : {}) });
  }
  return result.sort(canonicalCompare);
}

function validateDecorations(value: unknown, course: Course): ValidatedDecoration[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_FEATURES) return null;
  const result: ValidatedDecoration[] = [];
  for (const raw of value) {
    if (!isRecord(raw) || !integer(raw.x) || !integer(raw.y) || typeof raw.kind !== "string" || !DECORATION_TYPES.has(raw.kind) || !integer(raw.rotation) || raw.rotation < 0 || raw.rotation > 3) return null;
    if (raw.variant !== undefined && (!integer(raw.variant) || raw.variant < 0)) return null;
    if (raw.plantId !== undefined && !isPlantId(raw.plantId)) return null;
    const kind = raw.kind as ValidatedDecoration["kind"];
    const spec = DECORATION_SPECS[kind];
    if (raw.span !== undefined && (!integer(raw.span) || raw.span < 1 || raw.span > (spec.maxSpan ?? 1))) return null;
    const candidate: ValidatedDecoration = {
      x: raw.x,
      y: raw.y,
      kind,
      rotation: raw.rotation as ValidatedDecoration["rotation"],
      ...(raw.variant !== undefined ? { variant: raw.variant } : {}),
      ...(raw.plantId ? { plantId: raw.plantId } : {}),
      ...(raw.span !== undefined ? { span: raw.span } : {}),
    };
    if (decorationTiles(candidate).some((tile) => tile.x < 0 || tile.y < 0 || tile.x >= course.width || tile.y >= course.height)) return null;
    result.push(candidate);
  }
  return result.sort(canonicalCompare);
}

function validateBuildings(value: unknown, course: Course): ValidatedBuilding[] | null {
  if (!Array.isArray(value) || value.length > MAX_FEATURES) return null;
  const result: ValidatedBuilding[] = [];
  for (const raw of value) {
    if (!isRecord(raw) || !integer(raw.x) || !integer(raw.y) || typeof raw.type !== "string" || !Object.hasOwn(BUILDING_SPECS, raw.type)) return null;
    if (raw.tier !== undefined && (![1, 2, 3].includes(raw.tier as number) || !integer(raw.tier))) return null;
    const candidate: ValidatedBuilding = {
      x: raw.x,
      y: raw.y,
      type: raw.type as ValidatedBuilding["type"],
      ...(raw.tier !== undefined ? { tier: raw.tier as 1 | 2 | 3 } : {}),
    };
    if (buildingTiles(candidate).some((tile) => tile.x < 0 || tile.y < 0 || tile.x >= course.width || tile.y >= course.height)) return null;
    result.push(candidate);
  }
  return result.sort(canonicalCompare);
}

function validProvenance(value: unknown): value is NonNullable<Hole["templateAttribution"]> {
  if (!isRecord(value) || !text(value.templateId) || !text(value.sourceLabel)) return false;
  return (value.licenseName === undefined || text(value.licenseName))
    && (value.attribution === undefined || text(value.attribution));
}

function frameAndLocalizer(coverage: readonly Point[], tee: Point, pin: Point) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const candidate of coverage) {
    minX = Math.min(minX, candidate.x);
    minY = Math.min(minY, candidate.y);
    maxX = Math.max(maxX, candidate.x);
    maxY = Math.max(maxY, candidate.y);
  }
  const bearingRadians = Math.atan2(pin.x - tee.x, tee.y - pin.y);
  const rotationRadians = -bearingRadians;
  const matrix = {
    a: quantize(Math.cos(rotationRadians), 12),
    b: quantize(Math.sin(rotationRadians), 12),
    c: quantize(-Math.sin(rotationRadians), 12),
    d: quantize(Math.cos(rotationRadians), 12),
  };
  const rotate = (candidate: Point) => {
    const x = candidate.x - tee.x;
    const y = candidate.y - tee.y;
    return {
      x: quantize(matrix.a * x + matrix.c * y, 6),
      y: quantize(matrix.b * x + matrix.d * y, 6),
    };
  };
  let rotatedMinX = Infinity;
  let rotatedMinY = Infinity;
  let rotatedMaxX = -Infinity;
  let rotatedMaxY = -Infinity;
  for (const candidate of coverage) {
    for (const corner of [candidate, { x: candidate.x + 1, y: candidate.y }, { x: candidate.x, y: candidate.y + 1 }, { x: candidate.x + 1, y: candidate.y + 1 }]) {
      const rotated = rotate(corner);
      rotatedMinX = Math.min(rotatedMinX, rotated.x);
      rotatedMinY = Math.min(rotatedMinY, rotated.y);
      rotatedMaxX = Math.max(rotatedMaxX, rotated.x);
      rotatedMaxY = Math.max(rotatedMaxY, rotated.y);
    }
  }
  const northWidth = maxX - minX + 1;
  const northHeight = maxY - minY + 1;
  const rotatedWidth = quantize(rotatedMaxX - rotatedMinX, 6);
  const rotatedHeight = quantize(rotatedMaxY - rotatedMinY, 6);
  const northUp: HoleIllustrationFrame = {
    mode: "north-up",
    originCourse: { x: 0, y: 0 },
    rotationDegrees: 0,
    matrix: { a: 1, b: 0, c: 0, d: 1 },
    translation: { x: -minX, y: -minY },
    crop: { width: northWidth, height: northHeight },
    scaleToUnit: quantize(1 / Math.max(northWidth, northHeight), 6),
  };
  const teeToGreen: HoleIllustrationFrame = {
    mode: "tee-to-green",
    originCourse: { x: tee.x, y: tee.y },
    rotationDegrees: quantize(Math.atan2(matrix.b, matrix.a) * 180 / Math.PI, 9),
    matrix,
    translation: { x: quantize(-rotatedMinX, 6), y: quantize(-rotatedMinY, 6) },
    crop: { width: rotatedWidth, height: rotatedHeight },
    scaleToUnit: quantize(1 / Math.max(rotatedWidth, rotatedHeight), 6),
  };
  const local = (candidate: Point): HoleIllustrationLocalPoint => {
    const rotated = rotate(candidate);
    return {
      x: candidate.x - minX,
      y: candidate.y - minY,
      teeToGreen: { x: quantize(rotated.x - rotatedMinX), y: quantize(rotated.y - rotatedMinY) },
    };
  };
  return { northUp, teeToGreen, local };
}

function greenContours(course: Course, coverage: ReadonlySet<string>, local: (point: Point) => HoleIllustrationLocalPoint) {
  const source = course.greenSurface;
  if (source === undefined) return { ok: true as const, tiles: [] };
  if (!isRecord(source)
    || source.version !== GREEN_SURFACE_VERSION
    || source.samplesPerAxis !== GREEN_SURFACE_SAMPLES_PER_AXIS
    || source.fixedPointScale !== GREEN_SURFACE_FIXED_POINT_SCALE
    || source.interpolation !== "bilinear"
    || !Array.isArray(source.tiles)
    || source.tiles.length > GREEN_SURFACE_MAX_TILES) return { ok: false as const };
  const sorted = [...source.tiles].sort((left, right) => canonicalCompare(left, right));
  const seen = new Set<string>();
  const tiles: Array<HoleIllustrationLocalPoint & { offsets: number[] }> = [];
  for (const raw of sorted) {
    if (!isRecord(raw) || !integer(raw.x) || !integer(raw.y) || raw.x < 0 || raw.y < 0 || raw.x >= course.width || raw.y >= course.height) return { ok: false as const };
    const key = `${raw.x},${raw.y}`;
    if (seen.has(key) || course.tiles[raw.y * course.width + raw.x] !== "green") return { ok: false as const };
    seen.add(key);
    if (!Array.isArray(raw.offsets) || raw.offsets.length !== GREEN_SURFACE_SAMPLE_COUNT
      || raw.offsets.some((offset) => !integer(offset) || Math.abs(offset) > GREEN_SURFACE_MAX_OFFSET_FIXED)
      || raw.offsets.every((offset) => offset === 0)) return { ok: false as const };
    if (coverage.has(key)) tiles.push({ ...local({ x: raw.x, y: raw.y }), offsets: [...raw.offsets] as number[] });
  }
  return { ok: true as const, tiles: tiles.sort(canonicalCompare) };
}

/** Pure, renderer-independent extraction of one explicitly routed hole. */
export function createHoleIllustrationSnapshot(input: Course, request: HoleIllustrationSnapshotRequest): HoleIllustrationSnapshotResult {
  try {
    if (!isRecord(input) || !integer(input.width) || !integer(input.height) || input.width < 1 || input.height < 1
      || input.width * input.height > MAX_GRID_CELLS
      || !Array.isArray(input.tiles) || input.tiles.length !== input.width * input.height || input.tiles.some((tile) => !TERRAIN.has(tile as Terrain))
      || !Array.isArray(input.elevations) || input.elevations.length !== input.width * input.height || input.elevations.some((value) => !finite(value))
      || !finite(input.yardsPerTile) || input.yardsPerTile <= 0
      || !Array.isArray(input.holes) || input.holes.length > MAX_ESTATE_HOLES
      || !Array.isArray(input.obstacles) || !Array.isArray(input.buildings)) {
      return incomplete("INVALID_COURSE", "Course dimensions, geometry, or feature collections are invalid.");
    }
    if (!isRecord(request) || !text(request.layoutId) || !text(request.holeId)
      || (request.routeSource !== "published" && request.routeSource !== "draft")
      || !TEE_SETS.includes(request.teeSet) || !PIN_ROTATIONS.includes(request.pinRotation)
      || (request.marginTiles !== undefined && !integer(request.marginTiles))) {
      return incomplete("INVALID_SELECTION", "The layout, route, hole, tee, pin, and integer margin must be explicit.");
    }

    if (input.layouts !== undefined) {
      const explicitHoleIds = input.holes.map((hole) => isRecord(hole) && text(hole.id) ? hole.id : null);
      if (explicitHoleIds.some((id) => id === null)
        || new Set(explicitHoleIds).size !== explicitHoleIds.length) {
        return incomplete("INVALID_COURSE", "Explicit layouts require unique estate-hole identities.");
      }
      if (!authoritativeLayouts(input.layouts, new Set(explicitHoleIds as string[]))) {
        return incomplete("INVALID_LAYOUT", "Explicit layouts must use unique, owned hole identities.");
      }
    }
    const course = normalizeCourseLayouts(input);
    if (!Array.isArray(course.layouts)) return incomplete("INVALID_LAYOUT", "The course has no authoritative layout collection.");
    if (course.holes.some((hole) => !isRecord(hole) || !text(hole.id))
      || new Set(course.holes.map((hole) => hole.id)).size !== course.holes.length) {
      return incomplete("INVALID_COURSE", "Hole identities must be present and unique.");
    }
    if (course.layouts.some((layout) => !isRecord(layout) || !text(layout.id))
      || new Set(course.layouts.map((layout) => layout.id)).size !== course.layouts.length) {
      return incomplete("INVALID_LAYOUT", "Layout identities must be present and unique.");
    }
    const layout = course.layouts.find((candidate) => candidate.id === request.layoutId);
    if (!layout) return incomplete("INVALID_LAYOUT", "The requested layout does not exist.");
    const routingIds = request.routeSource === "published" ? layout.publishedHoleIds : layout.draftHoleIds;
    if (!uniqueIds(routingIds)) return incomplete("INVALID_LAYOUT", "The selected route must contain unique hole identities.");
    const order = routingIds.indexOf(request.holeId);
    if (order < 0) return incomplete("HOLE_NOT_ROUTED", "The requested hole is not present in the selected route.");
    const hole = course.holes.find((candidate) => candidate.id === request.holeId);
    if (!hole) return incomplete("MISSING_HOLE", "The routed hole is missing from the estate inventory.");

    const tee = getTeeBox(hole, request.teeSet);
    if (!tee) return incomplete("MISSING_TEE", `The requested ${request.teeSet} tee is unavailable.`);
    if (!point(tee, course)) return incomplete("INVALID_TEE", "The requested tee is outside the course bounds.");
    const pin = getPinPosition(hole, request.pinRotation);
    if (!pin) return incomplete("MISSING_PIN", `The requested ${request.pinRotation} pin is unavailable.`);
    if (!point(pin, course)) return incomplete("INVALID_PIN", "The requested pin is outside the course bounds.");
    const waypoints = hole.waypoints ?? [];
    if (!Array.isArray(waypoints) || waypoints.length > MAX_WAYPOINTS || !waypoints.every((candidate) => point(candidate, course))) {
      return incomplete("INVALID_ROUTE", "Every routed waypoint must be an in-bounds integer point.");
    }
    const parSetting = selectedPar(hole, request.teeSet);
    if (!parSetting) return incomplete("INVALID_ROUTE", "The selected tee has an invalid par policy.");
    if (hole.templateAttribution !== undefined && !validProvenance(hole.templateAttribution)) {
      return incomplete("INVALID_ROUTE", "The hole template provenance is invalid.");
    }

    const route = [tee, ...waypoints, pin];
    const authoritativeDistanceTiles = routeDistance(route);
    if (!finite(authoritativeDistanceTiles) || authoritativeDistanceTiles <= 0) return incomplete("INVALID_ROUTE", "The tee-to-pin route must have positive finite length.");
    const distanceTiles = quantize(authoritativeDistanceTiles);
    const marginTiles = Math.max(0, Math.min(MAX_MARGIN_TILES, request.marginTiles ?? DEFAULT_MARGIN_TILES));
    const corridorRadiusTiles = PLAYABLE_CORRIDOR_RADIUS_TILES + marginTiles;
    const corridor = corridorCells(route, course, corridorRadiusTiles);
    const corridorKeys = new Set(corridor.map(pointKey));

    const obstacleSource = validateObstacles(course.obstacles, course);
    const decorationSource = validateDecorations(course.decorations, course);
    const buildingSource = validateBuildings(course.buildings, course);
    if (!obstacleSource || !decorationSource || !buildingSource) {
      return incomplete("INVALID_COURSE", "Obstacle, decoration, or building geometry is invalid.");
    }
    const selectedObstacles = obstacleSource.filter((candidate) => corridorKeys.has(pointKey(candidate)));
    const selectedDecorations = decorationSource
      .map((candidate) => ({ candidate, footprint: decorationTiles(candidate) }))
      .filter(({ footprint }) => footprint.some((candidate) => corridorKeys.has(pointKey(candidate))));
    const selectedBuildings = buildingSource
      .map((candidate) => ({ candidate, footprint: buildingTiles(candidate) }))
      .filter(({ footprint }) => footprint.some((candidate) => corridorKeys.has(pointKey(candidate))));

    const coverageByKey = new Map(corridor.map((candidate) => [pointKey(candidate), candidate]));
    for (const { footprint } of [...selectedDecorations, ...selectedBuildings]) {
      for (const candidate of footprint) coverageByKey.set(pointKey(candidate), candidate);
    }
    const coverage = [...coverageByKey.values()].sort((left, right) => left.y - right.y || left.x - right.x);
    const coverageKeys = new Set(coverageByKey.keys());
    const { northUp, teeToGreen, local } = frameAndLocalizer(coverage, tee, pin);
    const contours = greenContours(course, coverageKeys, local);
    if (!contours.ok) return incomplete("INVALID_COURSE", "Fine contour geometry is malformed or noncanonical.");

    const terrain = coverage.map((candidate) => ({
      ...local(candidate),
      terrain: course.tiles[candidate.y * course.width + candidate.x],
      elevation: course.elevations[candidate.y * course.width + candidate.x],
    }));
    const obstacles = selectedObstacles.map((candidate) => ({ ...local(candidate), type: candidate.type, ...(candidate.plantId ? { plantId: candidate.plantId } : {}) })).sort(canonicalCompare);
    const decorations = selectedDecorations.map(({ candidate, footprint }) => ({
      ...local(candidate),
      kind: candidate.kind,
      rotation: candidate.rotation,
      ...(candidate.variant !== undefined ? { variant: candidate.variant } : {}),
      ...(candidate.plantId ? { plantId: candidate.plantId } : {}),
      ...(candidate.span !== undefined ? { span: candidate.span } : {}),
      footprint: footprint.map(local).sort(canonicalCompare),
    })).sort(canonicalCompare);
    const surroundings = selectedBuildings.map(({ candidate, footprint }) => ({
      ...local(candidate),
      type: candidate.type,
      ...(candidate.tier !== undefined ? { tier: candidate.tier } : {}),
      footprint: footprint.map(local).sort(canonicalCompare),
    })).sort(canonicalCompare);
    const provenance = hole.templateAttribution ? {
      templateId: hole.templateAttribution.templateId,
      sourceLabel: hole.templateAttribution.sourceLabel,
      ...(hole.templateAttribution.licenseName ? { licenseName: hole.templateAttribution.licenseName } : {}),
      ...(hole.templateAttribution.attribution ? { attribution: hole.templateAttribution.attribution } : {}),
    } : undefined;
    const facts = {
      version: SNAPSHOT_VERSION,
      route: { layoutId: layout.id, source: request.routeSource, holeId: request.holeId, order, length: routingIds.length, routingIds: [...routingIds] },
      selection: { teeSet: request.teeSet, pinRotation: request.pinRotation },
      tee: local(tee),
      pin: local(pin),
      waypoints: waypoints.map(local),
      par: parSetting.mode === "MANUAL" ? parSetting.par! : computeAutoPar(authoritativeDistanceTiles),
      parMode: parSetting.mode,
      distanceTiles,
      yardage: quantize(authoritativeDistanceTiles * course.yardsPerTile),
      yardsPerTile: course.yardsPerTile,
      north: { x: 0 as const, y: -1 as const },
      framing: { marginTiles, corridorRadiusTiles, northUp, teeToGreen },
      terrain,
      contours: {
        version: GREEN_SURFACE_VERSION,
        samplesPerAxis: GREEN_SURFACE_SAMPLES_PER_AXIS,
        fixedPointScale: GREEN_SURFACE_FIXED_POINT_SCALE,
        interpolation: "bilinear" as const,
        tiles: contours.tiles,
      },
      obstacles,
      decorations,
      surroundings,
      ...(provenance ? { provenance } : {}),
    };
    return { complete: true, snapshot: { ...facts, hash: sha256Hex(canonicalJson(facts)) } as HoleIllustrationSnapshot };
  } catch {
    return incomplete("INVALID_COURSE", "Hostile course data was rejected without producing a partial snapshot.");
  }
}

export const snapshotHoleIllustration = createHoleIllustrationSnapshot;
