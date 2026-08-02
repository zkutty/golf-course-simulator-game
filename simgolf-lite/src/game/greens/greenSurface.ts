import type { FrozenCourseElevation } from "../models/shotSlope";
import type { Course, Hole, Terrain } from "../models/types";
import { canonicalJson, hashCanonicalValue } from "../../utils/canonical";

export const GREEN_SURFACE_VERSION = 1 as const;
export const GREEN_SURFACE_SAMPLES_PER_AXIS = 4 as const;
export const GREEN_SURFACE_SAMPLE_COUNT = 16 as const;
export const GREEN_SURFACE_FIXED_POINT_SCALE = 1024 as const;
/** Fine offsets are relative to the authoritative coarse tile elevation. */
export const GREEN_SURFACE_MAX_OFFSET_FIXED = 2048 as const;
export const GREEN_SURFACE_MAX_TILES = 30_800 as const;
export const GREEN_LOCAL_STATE_MAX_HOLES = 36 as const;
const GREEN_COVERAGE_MAX_CELLS = 65_536;

export type GreenSurfaceInterpolation = "bilinear";
export type GreenProgramPreset = "receptive" | "balanced" | "championship" | "custom";

export interface GreenSurfaceTileV1 {
  x: number;
  y: number;
  /** Row-major 4×4 signed fixed-point offsets from the coarse tile elevation. */
  offsets: number[];
}

export interface GreenSurfaceV1 {
  version: typeof GREEN_SURFACE_VERSION;
  samplesPerAxis: typeof GREEN_SURFACE_SAMPLES_PER_AXIS;
  fixedPointScale: typeof GREEN_SURFACE_FIXED_POINT_SCALE;
  interpolation: GreenSurfaceInterpolation;
  /** Sparse: flat tiles are canonicalized by omitting their record. */
  tiles: GreenSurfaceTileV1[];
}

export interface GreenProgramV1 {
  version: 1;
  preset: GreenProgramPreset;
  targetSpeedFeet: number;
  targetFirmness: number;
  mowingHeightMillimeters: number;
  rollingPasses: 0 | 1 | 2;
  irrigationTarget: number;
}

export type GreenProgram = GreenProgramV1;

export interface GreenHoleConditionV1 {
  holeId: string;
  health: number;
  moisture: number;
  compaction: number;
  wear: number;
}

export interface GreenLocalStateV1 {
  version: 1;
  holes: GreenHoleConditionV1[];
}

export interface GreenRoundSnapshotV1 {
  version: 1;
  geometryVersion: string;
  surface: GreenSurfaceV1;
  program: GreenProgram;
  localState: GreenLocalStateV1;
}

/** Future rollout physics consumes the established frozen-elevation carrier. */
export interface FrozenGreenElevationV1 extends FrozenCourseElevation {
  readonly greenSurface: GreenSurfaceV1;
}

export interface GreenCourseCarrier {
  width: number;
  height: number;
  tiles: readonly (Terrain | string)[];
  holes: readonly Pick<Hole, "id">[];
  elevations?: readonly number[];
  greenSurface?: GreenSurfaceV1;
  greenProgram?: GreenProgram;
  greenLocalState?: GreenLocalStateV1;
}

export type GreenContractErrorCode =
  | "invalid-shape"
  | "unsupported-version"
  | "oversized"
  | "invalid-tile"
  | "invalid-offset"
  | "noncanonical"
  | "invalid-program"
  | "invalid-local-state"
  | "geometry-mismatch";

export interface GreenContractError {
  code: GreenContractErrorCode;
  path: string;
  message: string;
}

export type GreenContractResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: GreenContractError };

const PRESETS: Readonly<Record<Exclude<GreenProgramPreset, "custom">, Omit<GreenProgramV1, "version" | "preset">>> = Object.freeze({
  receptive: Object.freeze({
    targetSpeedFeet: 8.5,
    targetFirmness: 0.35,
    mowingHeightMillimeters: 4.2,
    rollingPasses: 0 as const,
    irrigationTarget: 0.64,
  }),
  balanced: Object.freeze({
    targetSpeedFeet: 9.5,
    targetFirmness: 0.5,
    mowingHeightMillimeters: 3.5,
    rollingPasses: 1 as const,
    irrigationTarget: 0.58,
  }),
  championship: Object.freeze({
    targetSpeedFeet: 11.5,
    targetFirmness: 0.72,
    mowingHeightMillimeters: 2.8,
    rollingPasses: 2 as const,
    irrigationTarget: 0.46,
  }),
});

function success<T>(value: T): GreenContractResult<T> {
  return { ok: true, value };
}

function failure(code: GreenContractErrorCode, path: string, message: string): GreenContractResult<never> {
  return { ok: false, error: { code, path, message } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function finite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function quantize(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function holeIds(carrier: Pick<GreenCourseCarrier, "holes">): string[] {
  const used = new Set<string>();
  return carrier.holes.slice(0, GREEN_LOCAL_STATE_MAX_HOLES).map((hole, index) => {
    const requested = typeof hole.id === "string" && hole.id.trim() ? hole.id.trim().slice(0, 64) : `hole-${index + 1}`;
    let id = requested;
    let suffix = 2;
    while (used.has(id)) id = `${requested.slice(0, 59)}-${suffix++}`;
    used.add(id);
    return id;
  }).sort(compareText);
}

function healthyHole(holeId: string): GreenHoleConditionV1 {
  return { holeId, health: 1, moisture: 0.58, compaction: 0, wear: 0 };
}

export function createFlatGreenSurfaceV1(): GreenSurfaceV1 {
  return {
    version: GREEN_SURFACE_VERSION,
    samplesPerAxis: GREEN_SURFACE_SAMPLES_PER_AXIS,
    fixedPointScale: GREEN_SURFACE_FIXED_POINT_SCALE,
    interpolation: "bilinear",
    tiles: [],
  };
}

export function createGreenProgram(preset: Exclude<GreenProgramPreset, "custom"> = "balanced"): GreenProgram {
  return { version: 1, preset, ...PRESETS[preset] };
}

export function createHealthyGreenLocalState(carrier: Pick<GreenCourseCarrier, "holes">): GreenLocalStateV1 {
  return { version: 1, holes: holeIds(carrier).map(healthyHole) };
}

function normalizeOffsets(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length !== GREEN_SURFACE_SAMPLE_COUNT) return null;
  return value.map((item) => clamp(
    Math.round(finite(item, 0)),
    -GREEN_SURFACE_MAX_OFFSET_FIXED,
    GREEN_SURFACE_MAX_OFFSET_FIXED,
  ));
}

function compareTile(left: GreenSurfaceTileV1, right: GreenSurfaceTileV1): number {
  return left.y - right.y || left.x - right.x;
}

function compareOffsets(left: readonly number[], right: readonly number[]): number {
  for (let index = 0; index < GREEN_SURFACE_SAMPLE_COUNT; index++) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

/**
 * Cleans coverage against the authoritative coarse green mask. Malformed,
 * out-of-bounds, non-green, flat, duplicate, and excess records are removed;
 * output is row-major and has one deterministic record per green tile.
 */
export function normalizeGreenSurfaceV1(value: unknown, carrier: Pick<GreenCourseCarrier, "width" | "height" | "tiles">): GreenSurfaceV1 {
  const width = Math.max(0, Math.floor(finite(carrier.width, 0)));
  const height = Math.max(0, Math.floor(finite(carrier.height, 0)));
  const rawTiles = isRecord(value) && Array.isArray(value.tiles) ? value.tiles : [];
  const candidates = new Map<number, GreenSurfaceTileV1>();
  for (const raw of rawTiles.slice(0, GREEN_SURFACE_MAX_TILES * 2)) {
    if (!isRecord(raw) || !Number.isInteger(raw.x) || !Number.isInteger(raw.y)) continue;
    const x = raw.x as number;
    const y = raw.y as number;
    if (x < 0 || y < 0 || x >= width || y >= height) continue;
    const index = y * width + x;
    if (carrier.tiles[index] !== "green") continue;
    const offsets = normalizeOffsets(raw.offsets);
    if (!offsets || offsets.every((offset) => offset === 0)) continue;
    const candidate = { x, y, offsets };
    const existing = candidates.get(index);
    if (!existing || compareOffsets(candidate.offsets, existing.offsets) < 0) candidates.set(index, candidate);
  }
  return {
    ...createFlatGreenSurfaceV1(),
    tiles: [...candidates.values()].sort(compareTile).slice(0, GREEN_SURFACE_MAX_TILES),
  };
}

export function validateGreenSurfaceV1(value: unknown, carrier: Pick<GreenCourseCarrier, "width" | "height" | "tiles">): GreenContractResult<GreenSurfaceV1> {
  if (!isRecord(value)) return failure("invalid-shape", "greenSurface", "Green surface must be an object.");
  if (value.version !== GREEN_SURFACE_VERSION) return failure("unsupported-version", "greenSurface.version", "Only green-surface version 1 is supported.");
  if (
    value.samplesPerAxis !== GREEN_SURFACE_SAMPLES_PER_AXIS
    || value.fixedPointScale !== GREEN_SURFACE_FIXED_POINT_SCALE
    || value.interpolation !== "bilinear"
  ) return failure("invalid-shape", "greenSurface", "Green interpolation metadata must use the canonical 4x4 fixed-point bilinear contract.");
  if (!Array.isArray(value.tiles)) return failure("invalid-shape", "greenSurface.tiles", "Green surface tiles must be an array.");
  if (value.tiles.length > GREEN_SURFACE_MAX_TILES) return failure("oversized", "greenSurface.tiles", `Green surface exceeds ${GREEN_SURFACE_MAX_TILES} sparse tiles.`);
  const width = carrier.width;
  const height = carrier.height;
  let previousIndex = -1;
  const tiles: GreenSurfaceTileV1[] = [];
  for (let itemIndex = 0; itemIndex < value.tiles.length; itemIndex++) {
    const item = value.tiles[itemIndex];
    const path = `greenSurface.tiles[${itemIndex}]`;
    if (!isRecord(item) || !Number.isInteger(item.x) || !Number.isInteger(item.y)) return failure("invalid-tile", path, "Green tile coordinates must be integers.");
    const x = item.x as number;
    const y = item.y as number;
    const index = y * width + x;
    if (x < 0 || y < 0 || x >= width || y >= height || carrier.tiles[index] !== "green") return failure("invalid-tile", path, "Fine contours may cover only in-bounds green tiles.");
    if (index <= previousIndex) return failure("noncanonical", path, "Green tiles must be unique and ordered row-major.");
    if (
      !Array.isArray(item.offsets)
      || item.offsets.length !== GREEN_SURFACE_SAMPLE_COUNT
      || item.offsets.some((offset) => !Number.isInteger(offset) || Math.abs(offset) > GREEN_SURFACE_MAX_OFFSET_FIXED)
    ) return failure("invalid-offset", `${path}.offsets`, `Each tile needs 16 signed fixed-point offsets within ±${GREEN_SURFACE_MAX_OFFSET_FIXED}.`);
    if (item.offsets.every((offset) => offset === 0)) return failure("noncanonical", `${path}.offsets`, "Flat fine-contour tiles must be omitted from the sparse surface.");
    tiles.push({ x, y, offsets: [...item.offsets] as number[] });
    previousIndex = index;
  }
  return success({
    version: GREEN_SURFACE_VERSION,
    samplesPerAxis: GREEN_SURFACE_SAMPLES_PER_AXIS,
    fixedPointScale: GREEN_SURFACE_FIXED_POINT_SCALE,
    interpolation: "bilinear",
    tiles,
  });
}

export function normalizeGreenProgram(value: unknown): GreenProgram {
  const candidate = isRecord(value) ? value : {};
  const requestedPreset = candidate.preset;
  const preset: GreenProgramPreset = requestedPreset === "receptive"
    || requestedPreset === "championship"
    || requestedPreset === "custom"
    ? requestedPreset
    : "balanced";
  const baseline = PRESETS[preset === "custom" ? "balanced" : preset];
  return {
    version: 1,
    preset,
    targetSpeedFeet: quantize(clamp(finite(candidate.targetSpeedFeet, baseline.targetSpeedFeet), 6, 15)),
    targetFirmness: quantize(clamp(finite(candidate.targetFirmness, baseline.targetFirmness), 0, 1)),
    mowingHeightMillimeters: quantize(clamp(finite(candidate.mowingHeightMillimeters, baseline.mowingHeightMillimeters), 2, 6)),
    rollingPasses: clamp(Math.round(finite(candidate.rollingPasses, baseline.rollingPasses)), 0, 2) as 0 | 1 | 2,
    irrigationTarget: quantize(clamp(finite(candidate.irrigationTarget, baseline.irrigationTarget), 0.2, 0.9)),
  };
}

export function validateGreenProgram(value: unknown): GreenContractResult<GreenProgram> {
  if (!isRecord(value) || value.version !== 1) return failure("invalid-program", "greenProgram", "Green program version 1 is required.");
  if (!["receptive", "balanced", "championship", "custom"].includes(String(value.preset))) return failure("invalid-program", "greenProgram.preset", "Green program preset is invalid.");
  const normalized = normalizeGreenProgram(value);
  const candidate = value as unknown as GreenProgram;
  if (canonicalJson(normalized) !== canonicalJson(candidate)) return failure("invalid-program", "greenProgram", "Green program values must be finite, bounded, and canonically quantized.");
  return success(normalized);
}

function normalizedCondition(value: unknown, id: string): GreenHoleConditionV1 {
  const candidate = isRecord(value) ? value : {};
  return {
    holeId: id,
    health: quantize(clamp(finite(candidate.health, 1), 0, 1)),
    moisture: quantize(clamp(finite(candidate.moisture, 0.58), 0, 1)),
    compaction: quantize(clamp(finite(candidate.compaction, 0), 0, 1)),
    wear: quantize(clamp(finite(candidate.wear, 0), 0, 1)),
  };
}

export function normalizeGreenLocalState(value: unknown, carrier: Pick<GreenCourseCarrier, "holes">): GreenLocalStateV1 {
  const allowedIds = holeIds(carrier);
  const allowed = new Set(allowedIds);
  const rawHoles = isRecord(value) && Array.isArray(value.holes) ? value.holes.slice(0, GREEN_LOCAL_STATE_MAX_HOLES * 2) : [];
  const candidates = new Map<string, GreenHoleConditionV1>();
  for (const raw of rawHoles) {
    if (!isRecord(raw) || typeof raw.holeId !== "string" || !allowed.has(raw.holeId)) continue;
    const normalized = normalizedCondition(raw, raw.holeId);
    const existing = candidates.get(raw.holeId);
    if (!existing || canonicalJson(normalized) < canonicalJson(existing)) candidates.set(raw.holeId, normalized);
  }
  return {
    version: 1,
    holes: allowedIds.map((id) => candidates.get(id) ?? healthyHole(id)),
  };
}

export function validateGreenLocalState(value: unknown, carrier: Pick<GreenCourseCarrier, "holes">): GreenContractResult<GreenLocalStateV1> {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.holes)) return failure("invalid-local-state", "greenLocalState", "Green local state version 1 is required.");
  if (value.holes.length > GREEN_LOCAL_STATE_MAX_HOLES) return failure("oversized", "greenLocalState.holes", "Green local state exceeds 36 holes.");
  const normalized = normalizeGreenLocalState(value, carrier);
  if (canonicalJson(normalized) !== canonicalJson(value)) return failure("invalid-local-state", "greenLocalState", "Green local state must cover each stable hole once in canonical order with bounded values.");
  return success(normalized);
}

export function withNormalizedGreenContract<T extends GreenCourseCarrier>(carrier: T): T & Required<Pick<GreenCourseCarrier, "greenSurface" | "greenProgram" | "greenLocalState">> {
  return {
    ...carrier,
    greenSurface: normalizeGreenSurfaceV1(carrier.greenSurface, carrier),
    greenProgram: normalizeGreenProgram(carrier.greenProgram),
    greenLocalState: normalizeGreenLocalState(carrier.greenLocalState, carrier),
  };
}

export function greenContractValidationErrors(carrier: GreenCourseCarrier): GreenContractError[] {
  const results = [
    validateGreenSurfaceV1(carrier.greenSurface, carrier),
    validateGreenProgram(carrier.greenProgram),
    validateGreenLocalState(carrier.greenLocalState, carrier),
  ];
  return results.flatMap((result) => result.ok ? [] : [result.error]);
}

export function canonicalGreenSurfaceJson(value: GreenSurfaceV1): string {
  return canonicalJson(value);
}

export function greenSurfaceHash(value: GreenSurfaceV1): string {
  return hashCanonicalValue(value);
}

function greenCoverageRle(value: Pick<GreenCourseCarrier, "width" | "height" | "tiles">): string {
  const width = Math.max(0, Math.floor(finite(value.width, 0)));
  const height = Math.max(0, Math.floor(finite(value.height, 0)));
  const cells = Math.min(GREEN_COVERAGE_MAX_CELLS, width * height);
  if (cells < 1) return "";
  const runs: string[] = [];
  let green = value.tiles[0] === "green";
  let count = 1;
  for (let index = 1; index <= cells; index++) {
    const next = index < cells && value.tiles[index] === "green";
    if (index < cells && next === green) {
      count++;
      continue;
    }
    runs.push(`${green ? 1 : 0}:${count.toString(36)}`);
    green = next;
    count = 1;
  }
  return runs.join(",");
}

export function greenGeometryVersion(value: Pick<GreenCourseCarrier, "width" | "height" | "tiles" | "greenSurface">): string {
  const surface = normalizeGreenSurfaceV1(value.greenSurface, value);
  return `green-v1-${hashCanonicalValue({
    width: Math.max(0, Math.floor(finite(value.width, 0))),
    height: Math.max(0, Math.floor(finite(value.height, 0))),
    coverageRle: greenCoverageRle(value),
    surface,
  })}`;
}

export function createGreenRoundSnapshot(carrier: GreenCourseCarrier): GreenRoundSnapshotV1 {
  const normalized = withNormalizedGreenContract(carrier);
  return {
    version: 1,
    geometryVersion: greenGeometryVersion(normalized),
    surface: structuredClone(normalized.greenSurface),
    program: { ...normalized.greenProgram },
    localState: structuredClone(normalized.greenLocalState),
  };
}

export function decodeGreenRoundSnapshot(value: unknown, carrier: Pick<GreenCourseCarrier, "width" | "height" | "tiles" | "holes">): GreenContractResult<GreenRoundSnapshotV1> {
  if (!isRecord(value) || value.version !== 1 || typeof value.geometryVersion !== "string") return failure("invalid-shape", "greenSnapshot", "Green round snapshot version 1 is required.");
  const surface = validateGreenSurfaceV1(value.surface, carrier);
  if (!surface.ok) return surface;
  const program = validateGreenProgram(value.program);
  if (!program.ok) return program;
  const localState = validateGreenLocalState(value.localState, carrier);
  if (!localState.ok) return localState;
  const geometryVersion = greenGeometryVersion({ ...carrier, greenSurface: surface.value });
  if (value.geometryVersion !== geometryVersion) return failure("geometry-mismatch", "greenSnapshot.geometryVersion", "Green snapshot geometry identity does not match its canonical surface.");
  return success({
    version: 1,
    geometryVersion,
    surface: surface.value,
    program: program.value,
    localState: localState.value,
  });
}

export function frozenGreenElevation(carrier: GreenCourseCarrier & Required<Pick<GreenCourseCarrier, "elevations">>): FrozenGreenElevationV1 {
  return Object.freeze({
    width: carrier.width,
    height: carrier.height,
    elevations: Object.freeze([...carrier.elevations]),
    greenSurface: Object.freeze(normalizeGreenSurfaceV1(carrier.greenSurface, carrier)),
  });
}

export function remapGreenLocalState(
  value: GreenLocalStateV1 | undefined,
  holeIdMap: ReadonlyMap<string, string>,
  holes: readonly Pick<Hole, "id">[],
): GreenLocalStateV1 {
  const remapped = value && {
    ...value,
    holes: value.holes.map((condition) => ({
      ...condition,
      holeId: holeIdMap.get(condition.holeId) ?? condition.holeId,
    })),
  };
  return normalizeGreenLocalState(remapped, { holes });
}

export type GreenCourse = Course & Required<Pick<Course, "greenSurface" | "greenProgram" | "greenLocalState">>;
