import type { PenaltyAreaClassification } from "./contracts";

export const CONTROLLED_ROUND_SNAPSHOT_VERSION = 2 as const;
export const CONTROLLED_ROUND_SNAPSHOT_V2_MAX_WIDTH = 220 as const;
export const CONTROLLED_ROUND_SNAPSHOT_V2_MAX_HEIGHT = 140 as const;
export const CONTROLLED_ROUND_SNAPSHOT_V2_MAX_HOLES = 36 as const;
export const CONTROLLED_ROUND_SNAPSHOT_V2_MAX_CELLS = 30_800 as const;
export const CONTROLLED_ROUND_SNAPSHOT_V2_MAX_COMPONENTS = 15_400 as const;
export const CONTROLLED_ROUND_SNAPSHOT_V2_MAX_HOLE_ID_LENGTH = 64 as const;
export const CONTROLLED_ROUND_SNAPSHOT_V2_MAX_RLE_CHARS = 250_000 as const;

/**
 * Covers a maximally fragmented 220×140 mask plus all 15,400 possible
 * four-connected components classified on each of 36 holes.
 */
export const CONTROLLED_ROUND_SNAPSHOT_V2_MAX_SERIALIZED_BYTES = 4_000_000 as const;

export type RoundSnapshotErrorCode =
  | "invalid-shape"
  | "unsupported-version"
  | "invalid-dimensions"
  | "invalid-mask"
  | "invalid-component-map"
  | "invalid-classification"
  | "rle-malformed"
  | "rle-truncated"
  | "rle-overflow"
  | "rle-oversized"
  | "snapshot-oversized"
  | "invalid-json";

export interface RoundSnapshotError {
  code: RoundSnapshotErrorCode;
  path: string;
  message: string;
}

export type RoundSnapshotResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: RoundSnapshotError };

export interface PenaltyComponent {
  id: number;
  firstCell: number;
  tileCount: number;
}

export interface ConnectedPenaltyComponentMap {
  values: number[];
  components: PenaltyComponent[];
}

export interface HolePenaltyClassification {
  holeId: string;
  red: number[];
  yellow: number[];
}

export interface ControlledRoundSnapshotV2 {
  version: typeof CONTROLLED_ROUND_SNAPSHOT_VERSION;
  width: number;
  height: number;
  inBoundsRle: string;
  penaltyComponentsRle: string;
  penaltyComponentCount: number;
  holeClassifications: HolePenaltyClassification[];
}

export interface ControlledRoundSnapshotV2Input {
  width: number;
  height: number;
  inBounds: readonly boolean[];
  penaltyMask: readonly boolean[];
  holeClassifications: readonly HolePenaltyClassification[];
}

export interface DecodedControlledRoundSnapshotV2 {
  snapshot: ControlledRoundSnapshotV2;
  inBounds: boolean[];
  penaltyComponents: number[];
  components: PenaltyComponent[];
}

function success<T>(value: T): RoundSnapshotResult<T> {
  return { ok: true, value };
}

function failure(code: RoundSnapshotErrorCode, path: string, message: string): RoundSnapshotResult<never> {
  return { ok: false, error: { code, path, message } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function serializedByteLength(value: string): number {
  if (value.length > CONTROLLED_ROUND_SNAPSHOT_V2_MAX_SERIALIZED_BYTES) return value.length;
  return new TextEncoder().encode(value).byteLength;
}

function dimensions(
  width: unknown,
  height: unknown,
): RoundSnapshotResult<{ width: number; height: number; cells: number; maxComponents: number }> {
  if (
    !Number.isInteger(width)
    || !Number.isInteger(height)
    || (width as number) < 1
    || (height as number) < 1
    || (width as number) > CONTROLLED_ROUND_SNAPSHOT_V2_MAX_WIDTH
    || (height as number) > CONTROLLED_ROUND_SNAPSHOT_V2_MAX_HEIGHT
  ) {
    return failure("invalid-dimensions", "width/height", "Snapshot dimensions exceed the 220x140 estate.");
  }
  const cells = (width as number) * (height as number);
  return success({
    width: width as number,
    height: height as number,
    cells,
    maxComponents: Math.ceil(cells / 2),
  });
}

function encodeRuns(values: readonly number[]): string {
  if (values.length === 0) return "";
  const runs: string[] = [];
  let value = values[0];
  let count = 1;
  for (let index = 1; index <= values.length; index++) {
    if (index < values.length && values[index] === value) {
      count++;
      continue;
    }
    runs.push(`${value.toString(36)}:${count.toString(36)}`);
    value = values[index];
    count = 1;
  }
  return runs.join(",");
}

function base36Digit(char: string): number {
  const code = char.charCodeAt(0);
  if (code >= 48 && code <= 57) return code - 48;
  if (code >= 97 && code <= 122) return code - 87;
  return -1;
}

function parseBase36(
  raw: string,
  maximum: number,
  allowZero: boolean,
  path: string,
): RoundSnapshotResult<number> {
  if (!raw || (raw.length > 1 && raw[0] === "0")) {
    return failure("rle-malformed", path, "RLE values must use canonical lowercase base-36.");
  }
  let value = 0;
  for (const char of raw) {
    const digit = base36Digit(char);
    if (digit < 0) return failure("rle-malformed", path, "RLE contains a non-base-36 digit.");
    if (value > Math.floor((maximum - digit) / 36)) {
      return failure("rle-overflow", path, "RLE numeric value exceeds its allowed bound.");
    }
    value = value * 36 + digit;
  }
  if (!allowZero && value === 0) return failure("rle-malformed", path, "RLE run lengths must be positive.");
  return success(value);
}

function decodeRuns(
  encoded: unknown,
  expectedLength: number,
  maximumValue: number,
  path: string,
): RoundSnapshotResult<number[]> {
  if (typeof encoded !== "string") return failure("invalid-shape", path, "RLE must be a string.");
  if (encoded.length > CONTROLLED_ROUND_SNAPSHOT_V2_MAX_RLE_CHARS) {
    return failure("rle-oversized", path, "RLE exceeds the controlled-round map size cap.");
  }
  if (!encoded) return failure("rle-truncated", path, "RLE ended before the expected map length.");

  const values: number[] = [];
  let offset = 0;
  while (offset < encoded.length) {
    const comma = encoded.indexOf(",", offset);
    const end = comma < 0 ? encoded.length : comma;
    const colon = encoded.indexOf(":", offset);
    const secondColon = colon < 0 ? -1 : encoded.indexOf(":", colon + 1);
    if (
      colon <= offset
      || colon >= end
      || (secondColon >= 0 && secondColon < end)
    ) {
      return failure("rle-malformed", path, "RLE runs must have exactly one value:count pair.");
    }
    const rawValue = encoded.slice(offset, colon);
    const rawCount = encoded.slice(colon + 1, end);
    const parsedValue = parseBase36(rawValue, maximumValue, true, path);
    if (!parsedValue.ok) return parsedValue;
    const remaining = expectedLength - values.length;
    const parsedCount = parseBase36(rawCount, remaining, false, path);
    if (!parsedCount.ok) return parsedCount;
    for (let count = 0; count < parsedCount.value; count++) values.push(parsedValue.value);

    if (comma < 0) break;
    offset = comma + 1;
    if (offset === encoded.length) {
      return failure("rle-malformed", path, "RLE cannot end with an empty run.");
    }
  }

  if (values.length < expectedLength) {
    return failure("rle-truncated", path, "RLE ended before the expected map length.");
  }
  if (encodeRuns(values) !== encoded) {
    return failure("rle-malformed", path, "RLE is valid but not in canonical deterministic form.");
  }
  return success(values);
}

function booleanMask(
  value: readonly boolean[],
  expectedLength: number,
  path: string,
): RoundSnapshotResult<boolean[]> {
  if (!Array.isArray(value) || value.length !== expectedLength || value.some((item) => typeof item !== "boolean")) {
    return failure("invalid-mask", path, "Mask length and boolean values must match snapshot dimensions.");
  }
  return success(value.slice());
}

export function buildConnectedPenaltyComponentMap(
  penaltyMask: readonly boolean[],
  width: number,
  height: number,
): RoundSnapshotResult<ConnectedPenaltyComponentMap> {
  const size = dimensions(width, height);
  if (!size.ok) return size;
  const mask = booleanMask(penaltyMask, size.value.cells, "penaltyMask");
  if (!mask.ok) return mask;

  const values = new Array<number>(size.value.cells).fill(0);
  const components: PenaltyComponent[] = [];
  for (let seed = 0; seed < mask.value.length; seed++) {
    if (!mask.value[seed] || values[seed] !== 0) continue;
    const id = components.length + 1;
    const queue = [seed];
    values[seed] = id;
    let tileCount = 0;
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const cell = queue[cursor];
      tileCount++;
      const x = cell % width;
      const y = Math.floor(cell / width);
      const neighbours = [
        x > 0 ? cell - 1 : -1,
        x + 1 < width ? cell + 1 : -1,
        y > 0 ? cell - width : -1,
        y + 1 < height ? cell + width : -1,
      ];
      for (const neighbour of neighbours) {
        if (neighbour >= 0 && mask.value[neighbour] && values[neighbour] === 0) {
          values[neighbour] = id;
          queue.push(neighbour);
        }
      }
    }
    components.push({ id, firstCell: seed, tileCount });
  }
  return success({ values, components });
}

function componentIds(
  value: unknown,
  componentCount: number,
  path: string,
): RoundSnapshotResult<number[]> {
  if (!Array.isArray(value) || value.length > componentCount) {
    return failure("invalid-classification", path, "Classification must be a bounded component ID array.");
  }
  const seen = new Set<number>();
  for (const item of value) {
    if (!Number.isInteger(item) || item < 1 || item > componentCount || seen.has(item)) {
      return failure("invalid-classification", path, "Classification contains an invalid or duplicate component ID.");
    }
    seen.add(item);
  }
  return success([...seen].sort((a, b) => a - b));
}

function normalizeHoleClassifications(
  value: unknown,
  componentCount: number,
): RoundSnapshotResult<HolePenaltyClassification[]> {
  if (!Array.isArray(value) || value.length > CONTROLLED_ROUND_SNAPSHOT_V2_MAX_HOLES) {
    return failure("invalid-classification", "holeClassifications", "A snapshot can classify at most 36 holes.");
  }
  const holeIds = new Set<string>();
  const normalized: HolePenaltyClassification[] = [];
  for (let index = 0; index < value.length; index++) {
    const item = value[index];
    const path = `holeClassifications[${index}]`;
    if (!isRecord(item)) return failure("invalid-classification", path, "Hole classification must be an object.");
    const holeId = item.holeId;
    if (
      typeof holeId !== "string"
      || !holeId
      || holeId !== holeId.trim()
      || holeId.length > CONTROLLED_ROUND_SNAPSHOT_V2_MAX_HOLE_ID_LENGTH
      || holeIds.has(holeId)
    ) {
      return failure("invalid-classification", `${path}.holeId`, "Hole IDs must be unique, bounded, non-empty strings.");
    }
    const red = componentIds(item.red, componentCount, `${path}.red`);
    if (!red.ok) return red;
    const yellow = componentIds(item.yellow, componentCount, `${path}.yellow`);
    if (!yellow.ok) return yellow;
    const yellowIds = new Set(yellow.value);
    if (red.value.some((componentId) => yellowIds.has(componentId))) {
      return failure("invalid-classification", path, "A component cannot be both red and yellow on one hole.");
    }
    holeIds.add(holeId);
    normalized.push({ holeId, red: red.value, yellow: yellow.value });
  }
  normalized.sort((a, b) => compareText(a.holeId, b.holeId));
  return success(normalized);
}

function validateConnectedComponentMap(
  values: readonly number[],
  componentCount: number,
  width: number,
  height: number,
): RoundSnapshotResult<PenaltyComponent[]> {
  const rebuilt = buildConnectedPenaltyComponentMap(values.map((value) => value !== 0), width, height);
  if (!rebuilt.ok) return rebuilt;
  if (
    rebuilt.value.components.length !== componentCount
    || rebuilt.value.values.some((value, index) => value !== values[index])
  ) {
    return failure(
      "invalid-component-map",
      "penaltyComponentsRle",
      "Penalty component IDs must be four-connected and assigned by row-major first cell.",
    );
  }
  return success(rebuilt.value.components);
}

export function createControlledRoundSnapshotV2(
  input: ControlledRoundSnapshotV2Input,
): RoundSnapshotResult<ControlledRoundSnapshotV2> {
  const size = dimensions(input.width, input.height);
  if (!size.ok) return size;
  const inBounds = booleanMask(input.inBounds, size.value.cells, "inBounds");
  if (!inBounds.ok) return inBounds;
  const penaltyMask = booleanMask(input.penaltyMask, size.value.cells, "penaltyMask");
  if (!penaltyMask.ok) return penaltyMask;
  if (penaltyMask.value.some((penalty, index) => penalty && !inBounds.value[index])) {
    return failure("invalid-mask", "penaltyMask", "Penalty-area cells must be inside the controlled boundary.");
  }
  const connected = buildConnectedPenaltyComponentMap(penaltyMask.value, input.width, input.height);
  if (!connected.ok) return connected;
  const holes = normalizeHoleClassifications(input.holeClassifications, connected.value.components.length);
  if (!holes.ok) return holes;

  const snapshot: ControlledRoundSnapshotV2 = {
    version: CONTROLLED_ROUND_SNAPSHOT_VERSION,
    width: input.width,
    height: input.height,
    inBoundsRle: encodeRuns(inBounds.value.map((value) => value ? 1 : 0)),
    penaltyComponentsRle: encodeRuns(connected.value.values),
    penaltyComponentCount: connected.value.components.length,
    holeClassifications: holes.value,
  };
  const serialized = JSON.stringify(snapshot);
  if (serializedByteLength(serialized) > CONTROLLED_ROUND_SNAPSHOT_V2_MAX_SERIALIZED_BYTES) {
    return failure("snapshot-oversized", "$", "Controlled-round snapshot exceeds its serialized size cap.");
  }
  return success(snapshot);
}

export function decodeControlledRoundSnapshotV2(
  value: unknown,
): RoundSnapshotResult<DecodedControlledRoundSnapshotV2> {
  if (!isRecord(value)) return failure("invalid-shape", "$", "Snapshot must be an object.");
  if (value.version !== CONTROLLED_ROUND_SNAPSHOT_VERSION) {
    return failure("unsupported-version", "version", "Only controlled-round snapshot version 2 is supported.");
  }
  const size = dimensions(value.width, value.height);
  if (!size.ok) return size;
  if (
    !Number.isInteger(value.penaltyComponentCount)
    || (value.penaltyComponentCount as number) < 0
    || (value.penaltyComponentCount as number) > size.value.maxComponents
  ) {
    return failure("invalid-component-map", "penaltyComponentCount", "Penalty component count exceeds the map bound.");
  }
  const componentCount = value.penaltyComponentCount as number;
  const inBoundsValues = decodeRuns(value.inBoundsRle, size.value.cells, 1, "inBoundsRle");
  if (!inBoundsValues.ok) return inBoundsValues;
  const penaltyValues = decodeRuns(
    value.penaltyComponentsRle,
    size.value.cells,
    componentCount,
    "penaltyComponentsRle",
  );
  if (!penaltyValues.ok) return penaltyValues;
  if (penaltyValues.value.some((componentId, index) => componentId !== 0 && inBoundsValues.value[index] === 0)) {
    return failure("invalid-component-map", "penaltyComponentsRle", "Penalty components cannot extend out of bounds.");
  }
  const components = validateConnectedComponentMap(
    penaltyValues.value,
    componentCount,
    size.value.width,
    size.value.height,
  );
  if (!components.ok) return components;
  const holes = normalizeHoleClassifications(value.holeClassifications, componentCount);
  if (!holes.ok) return holes;

  const snapshot: ControlledRoundSnapshotV2 = {
    version: CONTROLLED_ROUND_SNAPSHOT_VERSION,
    width: size.value.width,
    height: size.value.height,
    inBoundsRle: value.inBoundsRle as string,
    penaltyComponentsRle: value.penaltyComponentsRle as string,
    penaltyComponentCount: componentCount,
    holeClassifications: holes.value,
  };
  const serialized = JSON.stringify(snapshot);
  if (serializedByteLength(serialized) > CONTROLLED_ROUND_SNAPSHOT_V2_MAX_SERIALIZED_BYTES) {
    return failure("snapshot-oversized", "$", "Controlled-round snapshot exceeds its serialized size cap.");
  }
  return success({
    snapshot,
    inBounds: inBoundsValues.value.map((item) => item === 1),
    penaltyComponents: penaltyValues.value,
    components: components.value,
  });
}

export function serializeControlledRoundSnapshotV2(
  value: unknown,
): RoundSnapshotResult<string> {
  const decoded = decodeControlledRoundSnapshotV2(value);
  if (!decoded.ok) return decoded;
  const serialized = JSON.stringify(decoded.value.snapshot);
  if (serializedByteLength(serialized) > CONTROLLED_ROUND_SNAPSHOT_V2_MAX_SERIALIZED_BYTES) {
    return failure("snapshot-oversized", "$", "Controlled-round snapshot exceeds its serialized size cap.");
  }
  return success(serialized);
}

export function parseControlledRoundSnapshotV2(
  serialized: string,
): RoundSnapshotResult<DecodedControlledRoundSnapshotV2> {
  if (typeof serialized !== "string") return failure("invalid-shape", "$", "Serialized snapshot must be a string.");
  if (serializedByteLength(serialized) > CONTROLLED_ROUND_SNAPSHOT_V2_MAX_SERIALIZED_BYTES) {
    return failure("snapshot-oversized", "$", "Controlled-round snapshot exceeds its serialized size cap.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    return failure("invalid-json", "$", "Controlled-round snapshot is not valid JSON.");
  }
  return decodeControlledRoundSnapshotV2(parsed);
}

export function classificationForComponent(
  hole: HolePenaltyClassification,
  componentId: number,
): PenaltyAreaClassification | null {
  if (hole.red.includes(componentId)) return "red";
  if (hole.yellow.includes(componentId)) return "yellow";
  return null;
}
