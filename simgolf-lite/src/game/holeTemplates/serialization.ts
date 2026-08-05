import { canonicalJson } from "../../utils/canonical";
import { DECORATION_KINDS, decorationSpec, decorationTiles } from "../models/decorations";
import { ELEVATION_MAX, ELEVATION_MIN } from "../models/elevation";
import { isPlantId, plantDefinition } from "../models/plantRegistry";
import { PIN_ROTATIONS, TEE_SETS, type Point, type Terrain } from "../models/types";
import {
  HOLE_TEMPLATE_FORMAT,
  HOLE_TEMPLATE_VERSION,
  type HoleTemplateDecorationV1,
  type HoleTemplateHoleV1,
  type HoleTemplateObstacleV1,
  type HoleTemplateV1,
  type HoleTemplateValidationIssue,
  type HoleTemplateValidationResult,
} from "./types";

const MAX_TEMPLATE_CELLS = 256 * 256;
const MAX_FEATURES = 20_000;
const MAX_TEXT_LENGTH = 4_096;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{1,95}$/;
const TERRAIN_VALUES = new Set<Terrain>([
  "fairway", "rough", "deep_rough", "sand", "waste_area",
  "water", "wetland", "green", "tee", "path",
]);
const SOURCE_KINDS = new Set(["player_photo", "course_web_page", "open_data", "licensed_provider", "manual"]);
const REDISTRIBUTION_VALUES = new Set(["allowed", "attribution", "share_alike", "private_only", "unknown"]);
const DECORATION_KIND_VALUES = new Set<string>(DECORATION_KINDS);
const OBSTACLE_TYPES = new Set(["tree", "bush", "rock"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function issue(
  issues: HoleTemplateValidationIssue[],
  code: HoleTemplateValidationIssue["code"],
  path: string,
  message: string,
): void {
  issues.push({ code, path, message });
}

function unknownFields(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
  issues: HoleTemplateValidationIssue[],
): void {
  const accepted = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!accepted.has(key)) issue(issues, "unknown_field", `${path}.${key}`, "This field is not part of HoleTemplate V1.");
  }
}

function validText(
  value: unknown,
  path: string,
  issues: HoleTemplateValidationIssue[],
  options: { nonEmpty?: boolean; max?: number } = {},
): value is string {
  if (typeof value !== "string") {
    issue(issues, "missing_value", path, "Expected text.");
    return false;
  }
  if (options.nonEmpty && value.trim().length === 0) issue(issues, "invalid_value", path, "Text cannot be empty.");
  if (value.length > (options.max ?? MAX_TEXT_LENGTH)) issue(issues, "invalid_value", path, "Text exceeds the V1 length limit.");
  return true;
}

function validPoint(value: unknown, path: string, issues: HoleTemplateValidationIssue[]): value is Point {
  if (!isRecord(value)) {
    issue(issues, "missing_value", path, "Expected an integer local-coordinate point.");
    return false;
  }
  unknownFields(value, ["x", "y"], path, issues);
  const valid = Number.isInteger(value.x) && Number.isInteger(value.y);
  if (!valid) issue(issues, "invalid_value", path, "Point coordinates must be integers.");
  return valid;
}

function inBounds(point: Point, width: number, height: number): boolean {
  return point.x >= 0 && point.y >= 0 && point.x < width && point.y < height;
}

function pointKey(point: Point): string {
  return `${point.x},${point.y}`;
}

function validatePointMap(
  value: unknown,
  keys: readonly string[],
  path: string,
  width: number,
  height: number,
  issues: HoleTemplateValidationIssue[],
): void {
  if (value === undefined) return;
  if (!isRecord(value)) {
    issue(issues, "invalid_value", path, "Expected a marker map.");
    return;
  }
  unknownFields(value, keys, path, issues);
  for (const [key, point] of Object.entries(value)) {
    if (point === null) continue;
    if (validPoint(point, `${path}.${key}`, issues) && !inBounds(point, width, height)) {
      issue(issues, "invalid_value", `${path}.${key}`, "Marker is outside the template bounds.");
    }
  }
}

function validateParByTee(value: unknown, issues: HoleTemplateValidationIssue[]): void {
  if (value === undefined) return;
  if (!isRecord(value)) {
    issue(issues, "invalid_value", "template.hole.parByTee", "Expected a tee-set par map.");
    return;
  }
  unknownFields(value, TEE_SETS, "template.hole.parByTee", issues);
  for (const [key, setting] of Object.entries(value)) {
    const path = `template.hole.parByTee.${key}`;
    if (!isRecord(setting)) {
      issue(issues, "invalid_value", path, "Expected an AUTO or MANUAL par setting.");
      continue;
    }
    unknownFields(setting, ["mode", "par"], path, issues);
    if (setting.mode !== "AUTO" && setting.mode !== "MANUAL") issue(issues, "invalid_value", `${path}.mode`, "Par mode must be AUTO or MANUAL.");
    if (setting.mode === "MANUAL" && setting.par !== 3 && setting.par !== 4 && setting.par !== 5) issue(issues, "invalid_value", `${path}.par`, "Manual par must be 3, 4, or 5.");
    if (setting.mode === "AUTO" && setting.par !== undefined) issue(issues, "invalid_value", `${path}.par`, "AUTO par settings cannot include a manual par.");
  }
}

function validateHole(
  value: unknown,
  width: number,
  height: number,
  cellTerrain: ReadonlyMap<string, Terrain>,
  issues: HoleTemplateValidationIssue[],
): void {
  const path = "template.hole";
  if (!isRecord(value)) {
    issue(issues, "missing_value", path, "Expected portable hole markers and par policy.");
    return;
  }
  unknownFields(value, ["tee", "green", "teeBoxes", "pinPositions", "waypoints", "parByTee", "parMode", "parManual"], path, issues);
  for (const [key, terrain] of [["tee", "tee"], ["green", "green"]] as const) {
    const point = value[key];
    if (validPoint(point, `${path}.${key}`, issues)) {
      if (!inBounds(point, width, height)) issue(issues, "invalid_value", `${path}.${key}`, "Marker is outside the template bounds.");
      else if (cellTerrain.get(pointKey(point)) !== terrain) issue(issues, "invalid_value", `${path}.${key}`, `The ${key} marker must reference an authored ${terrain} cell.`);
    }
  }
  validatePointMap(value.teeBoxes, TEE_SETS, `${path}.teeBoxes`, width, height, issues);
  validatePointMap(value.pinPositions, PIN_ROTATIONS, `${path}.pinPositions`, width, height, issues);
  for (const [mapName, expectedTerrain] of [["teeBoxes", "tee"], ["pinPositions", "green"]] as const) {
    if (!isRecord(value[mapName])) continue;
    for (const [key, point] of Object.entries(value[mapName])) {
      if (point && validPoint(point, `${path}.${mapName}.${key}`, [] as HoleTemplateValidationIssue[]) && cellTerrain.get(pointKey(point)) !== expectedTerrain) {
        issue(issues, "invalid_value", `${path}.${mapName}.${key}`, `Marker must reference an authored ${expectedTerrain} cell.`);
      }
    }
  }
  if (value.waypoints !== undefined && !Array.isArray(value.waypoints)) issue(issues, "invalid_value", `${path}.waypoints`, "Expected an array of local points.");
  for (const [index, point] of (Array.isArray(value.waypoints) ? value.waypoints : []).entries()) {
    if (validPoint(point, `${path}.waypoints[${index}]`, issues) && !inBounds(point, width, height)) issue(issues, "invalid_value", `${path}.waypoints[${index}]`, "Waypoint is outside the template bounds.");
  }
  if (value.parMode !== "AUTO" && value.parMode !== "MANUAL") issue(issues, "invalid_value", `${path}.parMode`, "Par mode must be AUTO or MANUAL.");
  if (value.parMode === "MANUAL" && value.parManual !== 3 && value.parManual !== 4 && value.parManual !== 5) issue(issues, "invalid_value", `${path}.parManual`, "Manual par must be 3, 4, or 5.");
  if (value.parMode === "AUTO" && value.parManual !== undefined) issue(issues, "invalid_value", `${path}.parManual`, "AUTO par mode cannot include parManual.");
  validateParByTee(value.parByTee, issues);
}

function validateObstacle(value: unknown, index: number, width: number, height: number, issues: HoleTemplateValidationIssue[]): void {
  const path = `template.obstacles[${index}]`;
  if (!isRecord(value)) {
    issue(issues, "invalid_value", path, "Expected a natural feature.");
    return;
  }
  unknownFields(value, ["x", "y", "type", "plantId"], path, issues);
  if (validPoint({ x: value.x, y: value.y }, path, issues) && !inBounds(value as unknown as Point, width, height)) issue(issues, "invalid_value", path, "Natural feature is outside the template bounds.");
  if (!OBSTACLE_TYPES.has(value.type as string)) issue(issues, "invalid_value", `${path}.type`, "Unsupported natural feature type.");
  if (value.plantId !== undefined && !isPlantId(value.plantId)) issue(issues, "invalid_value", `${path}.plantId`, "Unknown semantic plant identity.");
  if (isPlantId(value.plantId)) {
    const semantics = plantDefinition(value.plantId).semantics;
    if (value.type === "rock" || semantics.kind !== "obstacle" || semantics.obstacleType !== value.type) issue(issues, "invalid_value", `${path}.plantId`, "Plant identity does not match this natural feature type.");
  }
}

function validateDecoration(value: unknown, index: number, width: number, height: number, issues: HoleTemplateValidationIssue[]): void {
  const path = `template.decorations[${index}]`;
  if (!isRecord(value)) {
    issue(issues, "invalid_value", path, "Expected a decoration.");
    return;
  }
  unknownFields(value, ["kind", "x", "y", "rotation", "variant", "plantId", "span"], path, issues);
  if (validPoint({ x: value.x, y: value.y }, path, issues) && !inBounds(value as unknown as Point, width, height)) issue(issues, "invalid_value", path, "Decoration anchor is outside the template bounds.");
  if (!DECORATION_KIND_VALUES.has(value.kind as string)) issue(issues, "invalid_value", `${path}.kind`, "Unsupported decoration kind.");
  if (value.rotation !== 0 && value.rotation !== 1 && value.rotation !== 2 && value.rotation !== 3) issue(issues, "invalid_value", `${path}.rotation`, "Rotation must be 0, 1, 2, or 3.");
  if (value.variant !== undefined && !Number.isInteger(value.variant)) issue(issues, "invalid_value", `${path}.variant`, "Variant must be an integer.");
  if (value.span !== undefined && (!Number.isInteger(value.span) || (value.span as number) < 1)) issue(issues, "invalid_value", `${path}.span`, "Span must be a positive integer.");
  if (value.plantId !== undefined && !isPlantId(value.plantId)) issue(issues, "invalid_value", `${path}.plantId`, "Unknown semantic plant identity.");
  if (isPlantId(value.plantId)) {
    const semantics = plantDefinition(value.plantId).semantics;
    if (semantics.kind !== "decoration" || semantics.decorationKind !== value.kind) issue(issues, "invalid_value", `${path}.plantId`, "Plant identity does not match this decoration kind.");
  }
  if (DECORATION_KIND_VALUES.has(value.kind as string) && (value.rotation === 0 || value.rotation === 1 || value.rotation === 2 || value.rotation === 3)) {
    const decoration = value as unknown as HoleTemplateDecorationV1;
    const spec = decorationSpec(decoration.kind);
    if (spec.category === "structure" && (decoration.span === undefined || decoration.span > (spec.maxSpan ?? 1))) issue(issues, "invalid_value", `${path}.span`, `Span must be between 1 and ${spec.maxSpan ?? 1}.`);
    const outside = decorationTiles(decoration).filter((point) => !inBounds(point, width, height));
    if (outside.length > 0) issue(issues, "invalid_value", path, "The full decoration footprint must remain inside the template bounds.");
  }
}

function sortPointLike<T extends Point>(values: readonly T[]): T[] {
  return [...values].sort((a, b) => a.y - b.y || a.x - b.x || canonicalJson(a).localeCompare(canonicalJson(b)));
}

function normalizeHole(value: HoleTemplateHoleV1): HoleTemplateHoleV1 {
  return {
    tee: { ...value.tee },
    green: { ...value.green },
    ...(value.teeBoxes ? { teeBoxes: Object.fromEntries(TEE_SETS.flatMap((key) => key in value.teeBoxes! ? [[key, value.teeBoxes![key] ? { ...value.teeBoxes![key]! } : null]] : [])) } : {}),
    ...(value.pinPositions ? { pinPositions: Object.fromEntries(PIN_ROTATIONS.flatMap((key) => key in value.pinPositions! ? [[key, value.pinPositions![key] ? { ...value.pinPositions![key]! } : null]] : [])) } : {}),
    ...(value.waypoints ? { waypoints: value.waypoints.map((point) => ({ ...point })) } : {}),
    ...(value.parByTee ? { parByTee: Object.fromEntries(TEE_SETS.flatMap((key) => key in value.parByTee! ? [[key, { ...value.parByTee![key]! }]] : [])) } : {}),
    parMode: value.parMode,
    ...(value.parManual !== undefined ? { parManual: value.parManual } : {}),
  };
}

function normalizeTemplate(value: HoleTemplateV1): HoleTemplateV1 {
  return {
    format: HOLE_TEMPLATE_FORMAT,
    version: HOLE_TEMPLATE_VERSION,
    id: value.id,
    title: value.title,
    description: value.description,
    width: value.width,
    height: value.height,
    yardsPerTile: value.yardsPerTile,
    cells: sortPointLike(value.cells).map((cell) => ({ x: cell.x, y: cell.y, terrain: cell.terrain, elevationOffset: cell.elevationOffset })),
    hole: normalizeHole(value.hole),
    obstacles: sortPointLike(value.obstacles).map((obstacle): HoleTemplateObstacleV1 => ({ x: obstacle.x, y: obstacle.y, type: obstacle.type, ...(obstacle.plantId ? { plantId: obstacle.plantId } : {}) })),
    decorations: sortPointLike(value.decorations).map((decoration): HoleTemplateDecorationV1 => ({
      kind: decoration.kind,
      x: decoration.x,
      y: decoration.y,
      rotation: decoration.rotation,
      ...(decoration.variant !== undefined ? { variant: decoration.variant } : {}),
      ...(decoration.plantId ? { plantId: decoration.plantId } : {}),
      ...(decoration.span !== undefined ? { span: decoration.span } : {}),
    })),
    provenance: {
      sourceKind: value.provenance.sourceKind,
      sourceLabel: value.provenance.sourceLabel,
      importedAt: value.provenance.importedAt,
      rightsAttested: value.provenance.rightsAttested,
      ...(value.provenance.licenseName !== undefined ? { licenseName: value.provenance.licenseName } : {}),
      ...(value.provenance.attribution !== undefined ? { attribution: value.provenance.attribution } : {}),
      redistribution: value.provenance.redistribution,
      sourceAssetRetained: value.provenance.sourceAssetRetained,
    },
    confidence: {
      scale: value.confidence.scale,
      terrain: value.confidence.terrain,
      elevation: value.confidence.elevation,
      notes: [...value.confidence.notes],
    },
  };
}

/** Strict, non-throwing V1 validation plus semantic array canonicalization. */
export function validateHoleTemplateV1(input: unknown): HoleTemplateValidationResult {
  const issues: HoleTemplateValidationIssue[] = [];
  if (!isRecord(input)) return { ok: false, issues: [{ code: "missing_value", path: "template", message: "Expected a HoleTemplate object." }] };
  unknownFields(input, ["format", "version", "id", "title", "description", "width", "height", "yardsPerTile", "cells", "hole", "obstacles", "decorations", "provenance", "confidence"], "template", issues);
  if (input.format !== HOLE_TEMPLATE_FORMAT || input.version !== HOLE_TEMPLATE_VERSION) {
    issue(issues, "unsupported_version", "template.version", `Only ${HOLE_TEMPLATE_FORMAT} V${HOLE_TEMPLATE_VERSION} is supported.`);
  }
  if (!validText(input.id, "template.id", issues, { nonEmpty: true, max: 96 }) || !ID_PATTERN.test(input.id)) issue(issues, "invalid_value", "template.id", "Use a 2–96 character portable ID containing letters, numbers, dot, dash, or underscore.");
  validText(input.title, "template.title", issues, { nonEmpty: true, max: 160 });
  validText(input.description, "template.description", issues);
  const dimensionsValid = Number.isInteger(input.width) && Number.isInteger(input.height) && (input.width as number) > 0 && (input.height as number) > 0 && (input.width as number) * (input.height as number) <= MAX_TEMPLATE_CELLS;
  if (!dimensionsValid) issue(issues, "invalid_value", "template.width", "Dimensions must be positive integers with at most 65,536 cells.");
  const width = dimensionsValid ? input.width as number : 0;
  const height = dimensionsValid ? input.height as number : 0;
  if (!Number.isFinite(input.yardsPerTile) || (input.yardsPerTile as number) <= 0) issue(issues, "invalid_value", "template.yardsPerTile", "Scale must be a positive finite number.");

  const cells = Array.isArray(input.cells) ? input.cells : [];
  if (!Array.isArray(input.cells) || cells.length === 0 || cells.length > MAX_TEMPLATE_CELLS) issue(issues, "invalid_value", "template.cells", "Provide 1–65,536 authored cells.");
  const cellKeys = new Set<string>();
  const cellTerrain = new Map<string, Terrain>();
  for (const [index, cell] of cells.entries()) {
    const path = `template.cells[${index}]`;
    if (!isRecord(cell)) {
      issue(issues, "invalid_value", path, "Expected an authored terrain cell.");
      continue;
    }
    unknownFields(cell, ["x", "y", "terrain", "elevationOffset"], path, issues);
    const point = { x: cell.x, y: cell.y };
    if (validPoint(point, path, issues)) {
      const key = pointKey(point as Point);
      if (cellKeys.has(key)) issue(issues, "duplicate_value", path, `Cell ${key} is duplicated.`);
      cellKeys.add(key);
      if (!inBounds(point as Point, width, height)) issue(issues, "invalid_value", path, "Cell is outside the template bounds.");
      if (TERRAIN_VALUES.has(cell.terrain as Terrain)) cellTerrain.set(key, cell.terrain as Terrain);
    }
    if (!TERRAIN_VALUES.has(cell.terrain as Terrain)) issue(issues, "invalid_value", `${path}.terrain`, "Unsupported terrain value.");
    if (!Number.isInteger(cell.elevationOffset) || (cell.elevationOffset as number) < ELEVATION_MIN - ELEVATION_MAX || (cell.elevationOffset as number) > ELEVATION_MAX - ELEVATION_MIN) issue(issues, "invalid_value", `${path}.elevationOffset`, "Elevation offset must be an integer within the supported relief range.");
  }
  validateHole(input.hole, width, height, cellTerrain, issues);

  if (!Array.isArray(input.obstacles) || input.obstacles.length > MAX_FEATURES) issue(issues, "invalid_value", "template.obstacles", "Expected at most 20,000 natural features.");
  const obstacleKeys = new Set<string>();
  for (const [index, obstacle] of (Array.isArray(input.obstacles) ? input.obstacles : []).entries()) {
    validateObstacle(obstacle, index, width, height, issues);
    if (isRecord(obstacle) && Number.isInteger(obstacle.x) && Number.isInteger(obstacle.y)) {
      const key = `${obstacle.x},${obstacle.y}`;
      if (obstacleKeys.has(key)) issue(issues, "duplicate_value", `template.obstacles[${index}]`, `Natural feature ${key} is duplicated.`);
      obstacleKeys.add(key);
    }
  }
  if (!Array.isArray(input.decorations) || input.decorations.length > MAX_FEATURES) issue(issues, "invalid_value", "template.decorations", "Expected at most 20,000 decorations.");
  for (const [index, decoration] of (Array.isArray(input.decorations) ? input.decorations : []).entries()) validateDecoration(decoration, index, width, height, issues);

  if (!isRecord(input.provenance)) issue(issues, "missing_value", "template.provenance", "Provenance is required.");
  else {
    unknownFields(input.provenance, ["sourceKind", "sourceLabel", "importedAt", "rightsAttested", "licenseName", "attribution", "redistribution", "sourceAssetRetained"], "template.provenance", issues);
    if (!SOURCE_KINDS.has(input.provenance.sourceKind as string)) issue(issues, "invalid_value", "template.provenance.sourceKind", "Unsupported source kind.");
    validText(input.provenance.sourceLabel, "template.provenance.sourceLabel", issues, { nonEmpty: true });
    if (!validText(input.provenance.importedAt, "template.provenance.importedAt", issues) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(input.provenance.importedAt) || Number.isNaN(Date.parse(input.provenance.importedAt))) issue(issues, "invalid_value", "template.provenance.importedAt", "Use a canonical ISO-8601 UTC timestamp.");
    if (typeof input.provenance.rightsAttested !== "boolean") issue(issues, "invalid_value", "template.provenance.rightsAttested", "Rights attestation must be true or false.");
    if (input.provenance.licenseName !== undefined) validText(input.provenance.licenseName, "template.provenance.licenseName", issues);
    if (input.provenance.attribution !== undefined) validText(input.provenance.attribution, "template.provenance.attribution", issues);
    if (!REDISTRIBUTION_VALUES.has(input.provenance.redistribution as string)) issue(issues, "invalid_value", "template.provenance.redistribution", "Unsupported redistribution policy.");
    if (typeof input.provenance.sourceAssetRetained !== "boolean") issue(issues, "invalid_value", "template.provenance.sourceAssetRetained", "Source retention must be true or false.");
  }

  if (!isRecord(input.confidence)) issue(issues, "missing_value", "template.confidence", "Confidence evidence is required.");
  else {
    unknownFields(input.confidence, ["scale", "terrain", "elevation", "notes"], "template.confidence", issues);
    for (const key of ["scale", "terrain", "elevation"] as const) if (!Number.isFinite(input.confidence[key]) || (input.confidence[key] as number) < 0 || (input.confidence[key] as number) > 1) issue(issues, "invalid_value", `template.confidence.${key}`, "Confidence must be between 0 and 1.");
    if (!Array.isArray(input.confidence.notes) || input.confidence.notes.length > 100) issue(issues, "invalid_value", "template.confidence.notes", "Expected at most 100 confidence notes.");
    for (const [index, note] of (Array.isArray(input.confidence.notes) ? input.confidence.notes : []).entries()) validText(note, `template.confidence.notes[${index}]`, issues);
  }

  if (issues.length > 0) return { ok: false, issues };
  const value = normalizeTemplate(input as unknown as HoleTemplateV1);
  return { ok: true, value, canonicalJson: canonicalJson(value) };
}

/** Throws only when an explicit serialization caller supplies invalid input. */
export function canonicalHoleTemplateJson(input: unknown): string {
  const result = validateHoleTemplateV1(input);
  if (!result.ok) throw new TypeError(result.issues.map((item) => `${item.path}: ${item.message}`).join("\n"));
  return result.canonicalJson;
}

/** Browser-safe synchronous SHA-256 used by pure placement plans. */
export function sha256Hex(text: string): string {
  const constants = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const bytes = new TextEncoder().encode(text);
  const bitLength = bytes.length * 8;
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const data = new DataView(padded.buffer);
  data.setUint32(paddedLength - 8, Math.floor(bitLength / 0x1_0000_0000), false);
  data.setUint32(paddedLength - 4, bitLength >>> 0, false);
  const state = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const words = new Uint32Array(64);
  const rotate = (value: number, amount: number) => (value >>> amount) | (value << (32 - amount));
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index++) words[index] = data.getUint32(offset + index * 4, false);
    for (let index = 16; index < 64; index++) {
      const a = words[index - 15];
      const b = words[index - 2];
      const s0 = rotate(a, 7) ^ rotate(a, 18) ^ (a >>> 3);
      const s1 = rotate(b, 17) ^ rotate(b, 19) ^ (b >>> 10);
      words[index] = (words[index - 16] + s0 + words[index - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = state;
    for (let index = 0; index < 64; index++) {
      const sum1 = rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temp1 = (h + sum1 + choice + constants[index] + words[index]) >>> 0;
      const sum0 = rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (sum0 + majority) >>> 0;
      h = g; g = f; f = e; e = (d + temp1) >>> 0; d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    state[0] = (state[0] + a) >>> 0; state[1] = (state[1] + b) >>> 0;
    state[2] = (state[2] + c) >>> 0; state[3] = (state[3] + d) >>> 0;
    state[4] = (state[4] + e) >>> 0; state[5] = (state[5] + f) >>> 0;
    state[6] = (state[6] + g) >>> 0; state[7] = (state[7] + h) >>> 0;
  }
  return state.map((value) => value.toString(16).padStart(8, "0")).join("");
}
