import type { Point } from "../models/types";
import {
  CONTROLLED_ROUND_SNAPSHOT_V2_MAX_CELLS,
  CONTROLLED_ROUND_SNAPSHOT_V2_MAX_HEIGHT,
  CONTROLLED_ROUND_SNAPSHOT_V2_MAX_WIDTH,
  buildConnectedPenaltyComponentMap,
  classificationForComponent,
  type HolePenaltyClassification,
  type PenaltyComponent,
} from "./roundSnapshot";
import type { PenaltyAreaClassification, ShotRuling } from "./contracts";

export const MAX_RULES_ROUTE_POINTS = 4_096 as const;
export const MAX_RULES_PATH_POINTS = 4_096 as const;
export const MAX_ROUTE_CELL_CHECKS = 2_000_000 as const;

export interface PenaltyRulesSnapshot {
  width: number;
  height: number;
  inBounds: readonly boolean[];
  penaltyComponents: readonly number[];
  components: readonly PenaltyComponent[];
}

export type RulesGeometryErrorCode =
  | "invalid-map"
  | "invalid-point"
  | "invalid-route"
  | "invalid-path"
  | "unclassified-component"
  | "route-too-complex";

export interface RulesGeometryError {
  code: RulesGeometryErrorCode;
  path: string;
  message: string;
}

export type RulesGeometryResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: RulesGeometryError };

export interface PenaltyAreaClassificationInput {
  snapshot: PenaltyRulesSnapshot;
  holeId: string;
  route: readonly Point[];
}

export type PointLocation =
  | { kind: "in_bounds" }
  | { kind: "out_of_bounds" }
  | {
    kind: "penalty_area";
    componentId: number;
    classification: PenaltyAreaClassification | null;
  };

export interface ShotRulingInput {
  snapshot: PenaltyRulesSnapshot;
  holeClassification: HolePenaltyClassification;
  /** The authoritative ground/roll path. Flight-only points are intentionally ignored. */
  rollPath: readonly Point[];
  /** Retained as an explicit integration seam; flying over a hazard is not a ruling event. */
  flightPath?: readonly Point[];
}

function failure(
  code: RulesGeometryErrorCode,
  path: string,
  message: string,
): RulesGeometryResult<never> {
  return { ok: false, error: { code, path, message } };
}

function success<T>(value: T): RulesGeometryResult<T> {
  return { ok: true, value };
}

function isFinitePoint(value: unknown): value is Point {
  if (typeof value !== "object" || value === null) return false;
  const point = value as { x?: unknown; y?: unknown };
  return typeof point.x === "number"
    && Number.isFinite(point.x)
    && typeof point.y === "number"
    && Number.isFinite(point.y);
}

function compareNumber(a: number, b: number): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function validateSnapshot(snapshot: PenaltyRulesSnapshot): RulesGeometryResult<{
  width: number;
  height: number;
  cells: number;
  componentCount: number;
}> {
  if (typeof snapshot !== "object" || snapshot === null) {
    return failure("invalid-map", "snapshot", "A decoded controlled-round snapshot is required.");
  }
  const { width, height } = snapshot;
  if (
    !Number.isInteger(width)
    || !Number.isInteger(height)
    || width < 1
    || height < 1
    || width > CONTROLLED_ROUND_SNAPSHOT_V2_MAX_WIDTH
    || height > CONTROLLED_ROUND_SNAPSHOT_V2_MAX_HEIGHT
  ) {
    return failure("invalid-map", "snapshot.width/height", "Map dimensions exceed the controlled estate bounds.");
  }
  const cells = width * height;
  if (cells > CONTROLLED_ROUND_SNAPSHOT_V2_MAX_CELLS) {
    return failure("invalid-map", "snapshot", "Map cell count exceeds the controlled estate bound.");
  }
  if (
    !Array.isArray(snapshot.inBounds)
    || snapshot.inBounds.length !== cells
    || snapshot.inBounds.some((value) => typeof value !== "boolean")
  ) {
    return failure("invalid-map", "snapshot.inBounds", "The in-bounds mask must match the map dimensions.");
  }
  if (!Array.isArray(snapshot.penaltyComponents) || snapshot.penaltyComponents.length !== cells) {
    return failure("invalid-map", "snapshot.penaltyComponents", "The component map must match the map dimensions.");
  }
  if (!Array.isArray(snapshot.components) || snapshot.components.length > Math.ceil(cells / 2)) {
    return failure("invalid-map", "snapshot.components", "The component list exceeds the connected-map bound.");
  }
  const componentCount = snapshot.components.length;
  const ids = new Set<number>();
  for (let index = 0; index < snapshot.components.length; index++) {
    const component = snapshot.components[index];
    if (
      !Number.isInteger(component.id)
      || component.id !== index + 1
      || !Number.isInteger(component.firstCell)
      || component.firstCell < 0
      || component.firstCell >= cells
      || !Number.isInteger(component.tileCount)
      || component.tileCount < 1
      || ids.has(component.id)
    ) {
      return failure("invalid-map", `snapshot.components[${index}]`, "Components must be row-major and bounded.");
    }
    ids.add(component.id);
  }
  for (let index = 0; index < cells; index++) {
    const componentId = snapshot.penaltyComponents[index];
    if (!Number.isInteger(componentId) || componentId < 0 || componentId > componentCount) {
      return failure("invalid-map", `snapshot.penaltyComponents[${index}]`, "Component IDs must be bounded integers.");
    }
    if (componentId !== 0 && !snapshot.inBounds[index]) {
      return failure("invalid-map", `snapshot.penaltyComponents[${index}]`, "Penalty components cannot be out of bounds.");
    }
  }
  const rebuilt = buildConnectedPenaltyComponentMap(
    snapshot.penaltyComponents.map((componentId) => componentId !== 0),
    width,
    height,
  );
  if (
    !rebuilt.ok
    || rebuilt.value.values.some((componentId, index) => componentId !== snapshot.penaltyComponents[index])
    || rebuilt.value.components.length !== componentCount
    || rebuilt.value.components.some((component, index) => {
      const given = snapshot.components[index];
      return component.firstCell !== given.firstCell || component.tileCount !== given.tileCount;
    })
  ) {
    return failure("invalid-map", "snapshot.penaltyComponents", "Component IDs must use the snapshot's four-connected row-major vocabulary.");
  }
  return success({ width, height, cells, componentCount });
}

function validatePoints(
  points: readonly Point[],
  maximum: number,
  path: string,
): RulesGeometryResult<readonly Point[]> {
  if (!Array.isArray(points) || points.length < 1 || points.length > maximum) {
    return failure("invalid-path", path, `Point count must be between 1 and ${maximum}.`);
  }
  if (points.some((point) => !isFinitePoint(point))) {
    return failure("invalid-point", path, "Every point must contain finite x and y coordinates.");
  }
  return success(points);
}

function validateRoute(route: readonly Point[]): RulesGeometryResult<readonly Point[]> {
  if (!Array.isArray(route) || route.length < 1 || route.length > MAX_RULES_ROUTE_POINTS) {
    return failure("invalid-route", "route", `Route point count must be between 1 and ${MAX_RULES_ROUTE_POINTS}.`);
  }
  if (route.some((point) => !isFinitePoint(point))) {
    return failure("invalid-point", "route", "Every route point must contain finite x and y coordinates.");
  }
  return success(route);
}

function pointLocation(
  snapshot: PenaltyRulesSnapshot,
  width: number,
  height: number,
  point: Point,
  holeClassification?: HolePenaltyClassification,
): PointLocation {
  if (point.x < 0 || point.y < 0 || point.x >= width || point.y >= height) {
    return { kind: "out_of_bounds" };
  }
  const cell = Math.floor(point.y) * width + Math.floor(point.x);
  if (!snapshot.inBounds[cell]) return { kind: "out_of_bounds" };
  const componentId = snapshot.penaltyComponents[cell];
  if (componentId === 0) return { kind: "in_bounds" };
  return {
    kind: "penalty_area",
    componentId,
    classification: holeClassification ? classificationForComponent(holeClassification, componentId) : null,
  };
}

export function locatePenaltyAreaPoint(
  snapshot: PenaltyRulesSnapshot,
  point: Point,
  holeClassification?: HolePenaltyClassification,
): RulesGeometryResult<PointLocation> {
  const size = validateSnapshot(snapshot);
  if (!size.ok) return size;
  if (!isFinitePoint(point)) return failure("invalid-point", "point", "Point coordinates must be finite.");
  return success(pointLocation(snapshot, size.value.width, size.value.height, point, holeClassification));
}

function segmentIntersectsCell(a: Point, b: Point, cellX: number, cellY: number): boolean {
  const minX = Math.min(a.x, b.x);
  const maxX = Math.max(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxY = Math.max(a.y, b.y);
  if (maxX < cellX || minX > cellX + 1 || maxY < cellY || minY > cellY + 1) return false;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let low = 0;
  let high = 1;
  const clip = (p: number, q: number): boolean => {
    if (p === 0) return q >= 0;
    const ratio = q / p;
    if (p < 0) {
      if (ratio > high) return false;
      if (ratio > low) low = ratio;
    } else {
      if (ratio < low) return false;
      if (ratio < high) high = ratio;
    }
    return true;
  };
  return clip(-dx, a.x - cellX)
    && clip(dx, cellX + 1 - a.x)
    && clip(-dy, a.y - cellY)
    && clip(dy, cellY + 1 - a.y)
    && low <= high;
}

function routeIntersectsComponent(
  route: readonly Point[],
  snapshot: PenaltyRulesSnapshot,
  width: number,
  height: number,
  componentId: number,
): RulesGeometryResult<boolean> {
  let checks = 0;
  for (let segmentIndex = 0; segmentIndex < route.length; segmentIndex++) {
    const a = route[segmentIndex];
    const b = route[Math.min(segmentIndex + 1, route.length - 1)];
    const minX = Math.max(0, Math.floor(Math.min(a.x, b.x)) - 1);
    const maxX = Math.min(width - 1, Math.floor(Math.max(a.x, b.x)) + 1);
    const minY = Math.max(0, Math.floor(Math.min(a.y, b.y)) - 1);
    const maxY = Math.min(height - 1, Math.floor(Math.max(a.y, b.y)) + 1);
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        checks++;
        if (checks > MAX_ROUTE_CELL_CHECKS) {
          return failure("route-too-complex", "route", "Route-to-component intersection exceeded its bounded work budget.");
        }
        const cell = y * width + x;
        if (snapshot.penaltyComponents[cell] === componentId && segmentIntersectsCell(a, b, x, y)) {
          return success(true);
        }
      }
    }
  }
  return success(false);
}

export function classifyPenaltyAreaComponents(
  input: PenaltyAreaClassificationInput,
): RulesGeometryResult<HolePenaltyClassification> {
  const size = validateSnapshot(input.snapshot);
  if (!size.ok) return size;
  if (typeof input.holeId !== "string" || input.holeId.length === 0 || input.holeId.length > 64) {
    return failure("invalid-route", "holeId", "Hole IDs must be bounded non-empty strings.");
  }
  const route = validateRoute(input.route);
  if (!route.ok) return route;
  const red: number[] = [];
  const yellow: number[] = [];
  for (const component of input.snapshot.components) {
    const intersects = routeIntersectsComponent(
      route.value,
      input.snapshot,
      size.value.width,
      size.value.height,
      component.id,
    );
    if (!intersects.ok) return intersects;
    (intersects.value ? yellow : red).push(component.id);
  }
  return success({ holeId: input.holeId, red, yellow });
}

export const classifyPenaltyAreas = classifyPenaltyAreaComponents;

interface PathInterval {
  start: number;
  end: number;
  location: PointLocation;
}

function uniqueSorted(values: number[]): number[] {
  values.sort(compareNumber);
  const result: number[] = [];
  for (const value of values) {
    if (result.length === 0 || Math.abs(result[result.length - 1] - value) > 1e-12) result.push(value);
  }
  return result;
}

function segmentIntervals(
  a: Point,
  b: Point,
  snapshot: PenaltyRulesSnapshot,
  width: number,
  height: number,
  classification: HolePenaltyClassification,
): PathInterval[] {
  const parameters = [0, 1];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx !== 0) {
    const start = Math.ceil(Math.min(a.x, b.x));
    const end = Math.floor(Math.max(a.x, b.x));
    for (let coordinate = start; coordinate <= end; coordinate++) {
      const t = (coordinate - a.x) / dx;
      if (t > 0 && t < 1) parameters.push(t);
    }
  }
  if (dy !== 0) {
    const start = Math.ceil(Math.min(a.y, b.y));
    const end = Math.floor(Math.max(a.y, b.y));
    for (let coordinate = start; coordinate <= end; coordinate++) {
      const t = (coordinate - a.y) / dy;
      if (t > 0 && t < 1) parameters.push(t);
    }
  }
  const sorted = uniqueSorted(parameters);
  const intervals: PathInterval[] = [];
  for (let index = 0; index < sorted.length - 1; index++) {
    const start = sorted[index];
    const end = sorted[index + 1];
    const middle = start + (end - start) / 2;
    const point = { x: a.x + dx * middle, y: a.y + dy * middle };
    intervals.push({
      start,
      end,
      location: pointLocation(snapshot, width, height, point, classification),
    });
  }
  if (intervals.length === 0) {
    intervals.push({ start: 0, end: 1, location: pointLocation(snapshot, width, height, a, classification) });
  }
  return intervals;
}

function sameTerminalLocation(a: PointLocation, b: PointLocation): boolean {
  if (a.kind !== b.kind) return false;
  return a.kind !== "penalty_area" || (b.kind === "penalty_area" && a.componentId === b.componentId);
}

function lerp(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function finalEntry(
  path: readonly Point[],
  terminal: PointLocation,
  snapshot: PenaltyRulesSnapshot,
  width: number,
  height: number,
  classification: HolePenaltyClassification,
): { crossingPoint: Point; referencePoint: Point | null } | null {
  let previous: PointLocation | null = null;
  let latest: { crossingPoint: Point; referencePoint: Point | null } | null = null;
  for (let segmentIndex = 0; segmentIndex < path.length - 1; segmentIndex++) {
    const a = path[segmentIndex];
    const b = path[segmentIndex + 1];
    for (const interval of segmentIntervals(a, b, snapshot, width, height, classification)) {
      if (sameTerminalLocation(interval.location, terminal)) {
        if (previous === null || !sameTerminalLocation(previous, terminal)) {
          const crossingPoint = lerp(a, b, interval.start);
          const beforeT = Math.max(0, interval.start - 1e-7);
          latest = {
            crossingPoint,
            referencePoint: terminal.kind === "out_of_bounds" ? lerp(a, b, beforeT) : crossingPoint,
          };
        }
      }
      previous = interval.location;
    }
  }
  if (latest !== null) return latest;
  return { crossingPoint: path[path.length - 1], referencePoint: terminal.kind === "out_of_bounds" ? null : path[path.length - 1] };
}

export function deriveShotRuling(input: ShotRulingInput): RulesGeometryResult<ShotRuling> {
  const size = validateSnapshot(input.snapshot);
  if (!size.ok) return size;
  const path = validatePoints(input.rollPath, MAX_RULES_PATH_POINTS, "rollPath");
  if (!path.ok) return path;
  if (
    !input.holeClassification
    || input.holeClassification.holeId.length === 0
    || input.holeClassification.red.some((id) => !Number.isInteger(id))
    || input.holeClassification.yellow.some((id) => !Number.isInteger(id))
  ) {
    return failure("unclassified-component", "holeClassification", "A valid frozen hole classification is required.");
  }
  const final = pointLocation(
    input.snapshot,
    size.value.width,
    size.value.height,
    path.value[path.value.length - 1],
    input.holeClassification,
  );
  if (final.kind === "in_bounds") {
    return success({
      status: "in_play",
      penaltyKind: "none",
      penaltyStrokes: 0,
      penaltyComponentId: null,
      penaltyAreaClassification: null,
      referencePoint: null,
      crossingPoint: null,
    });
  }
  if (final.kind === "penalty_area" && final.classification === null) {
    return failure("unclassified-component", "holeClassification", `Component ${final.componentId} has no frozen classification.`);
  }
  const entry = finalEntry(
    path.value,
    final,
    input.snapshot,
    size.value.width,
    size.value.height,
    input.holeClassification,
  );
  return success({
    status: "penalty",
    penaltyKind: final.kind === "out_of_bounds" ? "out_of_bounds" : "penalty_area",
    penaltyStrokes: 1,
    penaltyComponentId: final.kind === "penalty_area" ? final.componentId : null,
    penaltyAreaClassification: final.kind === "penalty_area" ? final.classification : null,
    referencePoint: entry?.referencePoint ?? null,
    crossingPoint: entry?.crossingPoint ?? null,
  });
}

export function distanceBetween(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
