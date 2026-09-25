/**
 * Pure occupancy-to-atlas topology for the ParklandHabitatFieldManifestV1
 * vocabulary. This module deliberately has no renderer or gameplay imports.
 */

export const PARKLAND_HABITAT_FAMILIES = [
  "woodland_floor",
  "understory_edge",
  "meadow_deep_rough_margin",
  "wet_shore",
  "rock_leaf_transition",
] as const;

export type ParklandHabitatFamily = (typeof PARKLAND_HABITAT_FAMILIES)[number];
export type HabitatCardinalDirection = "n" | "e" | "s" | "w";
export type HabitatCorner = "ne" | "se" | "sw" | "nw";
export type HabitatTopologyRole = "interior" | "boundary" | "convex" | "concave" | "termination" | "mask";
export type HabitatD4Transform =
  | "identity"
  | "rotate90"
  | "rotate180"
  | "rotate270"
  | "reflectX"
  | "reflectXRotate90"
  | "reflectXRotate180"
  | "reflectXRotate270";

export interface HabitatTileCoordinate {
  readonly x: number;
  readonly y: number;
}

export interface HabitatGridBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface BoundedHabitatOccupancy {
  readonly bounds: HabitatGridBounds;
  readonly occupied: readonly HabitatTileCoordinate[];
}

export interface HabitatAtlasPoint {
  readonly x: number;
  readonly y: number;
}

export interface HabitatAtlasRegion extends HabitatAtlasPoint {
  readonly width: number;
  readonly height: number;
}

/** The runtime-neutral subset of a generated habitat atlas frame record. */
export interface ParklandHabitatAtlasFrame {
  readonly id: string;
  readonly family: ParklandHabitatFamily;
  readonly topologyRole: HabitatTopologyRole;
  readonly direction: HabitatCardinalDirection | null;
  readonly corner: HabitatCorner | null;
  readonly variant: number;
  /** Canonical normalized 8-neighbor mask for the dense D4 vocabulary. */
  readonly canonicalMask?: number | null;
  readonly anchor: HabitatAtlasPoint;
  readonly edgeAnchors: readonly HabitatCardinalDirection[];
  readonly frame: HabitatAtlasRegion;
  readonly sourceSha256: string;
}

/** Structurally matches the checked-in high/medium/low atlas JSON sidecars. */
export interface ParklandHabitatAtlasCatalog {
  readonly schema: "ParklandHabitatFieldAtlasV1";
  readonly version: 1;
  readonly tier: "high" | "medium" | "low";
  readonly image: string;
  readonly width: number;
  readonly height: number;
  readonly gutterPx: number;
  readonly frameCount: number;
  readonly frames: Readonly<Record<string, ParklandHabitatAtlasFrame>>;
}

export interface HabitatFieldTopologyRequest {
  readonly occupancy: BoundedHabitatOccupancy;
  readonly family: ParklandHabitatFamily;
  readonly seed: number;
  readonly atlas: ParklandHabitatAtlasCatalog;
}

export interface HabitatFieldPlacement {
  readonly frameId: string;
  readonly family: ParklandHabitatFamily;
  readonly topologyRole: HabitatTopologyRole;
  readonly direction: HabitatCardinalDirection | null;
  readonly corner: HabitatCorner | null;
  readonly variant: number;
  readonly normalizedMask: number;
  readonly canonicalMask: number | null;
  readonly d4Transform: HabitatD4Transform;
  readonly tile: HabitatTileCoordinate;
  /** Anchor copied verbatim from the selected atlas frame. */
  readonly atlasAnchor: HabitatAtlasPoint;
  /**
   * Tile-world position of the atlas anchor. One tile is one world unit, so
   * the exact atlas pixel anchor is normalized by that frame's dimensions.
   */
  readonly worldAnchor: HabitatAtlasPoint;
  /** Edge anchors copied verbatim after semantic validation. */
  readonly edgeAnchors: readonly HabitatCardinalDirection[];
}

export type HabitatFieldDiagnosticCode =
  | "invalid_bounds"
  | "invalid_seed"
  | "invalid_occupied_cell"
  | "duplicate_occupied_cell"
  | "empty_patch"
  | "disconnected_patch"
  | "invalid_atlas"
  | "unsupported_topology";

export interface HabitatFieldDiagnostic {
  readonly code: HabitatFieldDiagnosticCode;
  readonly message: string;
  readonly tile?: HabitatTileCoordinate;
  readonly mask?: number;
  readonly normalizedMask?: number;
}

export type HabitatFieldTopologyResult =
  | {
    readonly ok: true;
    readonly placements: readonly HabitatFieldPlacement[];
  }
  | {
    readonly ok: false;
    readonly diagnostics: readonly HabitatFieldDiagnostic[];
  };

export interface HabitatMaskTopology {
  readonly role: HabitatTopologyRole;
  readonly direction: HabitatCardinalDirection | null;
  readonly corner: HabitatCorner | null;
}

export const HABITAT_OCCUPANCY_MASK_BITS = {
  n: 1,
  ne: 2,
  e: 4,
  se: 8,
  s: 16,
  sw: 32,
  w: 64,
  nw: 128,
} as const;

const CARDINALS: readonly HabitatCardinalDirection[] = ["n", "e", "s", "w"];
const CORNERS: readonly HabitatCorner[] = ["ne", "se", "sw", "nw"];
const FAMILY_SET: ReadonlySet<string> = new Set(PARKLAND_HABITAT_FAMILIES);
const DIRECTION_SET: ReadonlySet<string> = new Set(CARDINALS);
const CORNER_SET: ReadonlySet<string> = new Set(CORNERS);
const ROLE_SET: ReadonlySet<string> = new Set([
  "interior", "boundary", "convex", "concave", "termination", "mask",
]);

const DENSE_MASK_FAMILIES: ReadonlySet<ParklandHabitatFamily> = new Set([
  "woodland_floor",
  "understory_edge",
]);

export const HABITAT_D4_TRANSFORMS: readonly HabitatD4Transform[] = [
  "identity",
  "rotate90",
  "rotate180",
  "rotate270",
  "reflectX",
  "reflectXRotate90",
  "reflectXRotate180",
  "reflectXRotate270",
];

export const HABITAT_D4_CANONICAL_MASKS = [
  0, 1, 5, 7, 17, 21, 23, 31, 85, 87, 95, 119, 127, 255,
] as const;

const OFFSETS: Readonly<Record<keyof typeof HABITAT_OCCUPANCY_MASK_BITS, HabitatTileCoordinate>> = {
  n: { x: 0, y: -1 },
  ne: { x: 1, y: -1 },
  e: { x: 1, y: 0 },
  se: { x: 1, y: 1 },
  s: { x: 0, y: 1 },
  sw: { x: -1, y: 1 },
  w: { x: -1, y: 0 },
  nw: { x: -1, y: -1 },
};

const DIAGONAL_GATES: readonly {
  readonly diagonal: HabitatCorner;
  readonly sides: readonly [HabitatCardinalDirection, HabitatCardinalDirection];
}[] = [
  { diagonal: "ne", sides: ["n", "e"] },
  { diagonal: "se", sides: ["s", "e"] },
  { diagonal: "sw", sides: ["s", "w"] },
  { diagonal: "nw", sides: ["n", "w"] },
];

/**
 * Explicit reduced 3x3 truth table after standard blob-mask normalization.
 * Diagonals participate only when both adjoining cardinals are occupied.
 *
 *   role          normalized neighborhood
 *   interior      all eight neighbors
 *   boundary      exactly one cardinal side absent, remaining inner corners full
 *   convex        two adjacent cardinals present and their inner corner full
 *   concave       all cardinals present and exactly one diagonal absent
 *   termination   exactly one cardinal present
 *
 * Masks absent from this table cannot be expressed by the 19-frame reduced
 * atlas without combining semantic roles, so callers receive an unsupported
 * result instead of a visually plausible but false orientation.
 */
export const HABITAT_OCCUPANCY_TRUTH_TABLE: Readonly<Record<number, HabitatMaskTopology>> = {
  255: { role: "interior", direction: null, corner: null },

  124: { role: "boundary", direction: "n", corner: null },
  241: { role: "boundary", direction: "e", corner: null },
  199: { role: "boundary", direction: "s", corner: null },
  31: { role: "boundary", direction: "w", corner: null },

  28: { role: "convex", direction: null, corner: "nw" },
  112: { role: "convex", direction: null, corner: "ne" },
  193: { role: "convex", direction: null, corner: "se" },
  7: { role: "convex", direction: null, corner: "sw" },

  253: { role: "concave", direction: null, corner: "ne" },
  247: { role: "concave", direction: null, corner: "se" },
  223: { role: "concave", direction: null, corner: "sw" },
  127: { role: "concave", direction: null, corner: "nw" },

  1: { role: "termination", direction: "n", corner: null },
  4: { role: "termination", direction: "e", corner: null },
  16: { role: "termination", direction: "s", corner: null },
  64: { role: "termination", direction: "w", corner: null },
};

export interface HabitatMaskClassification {
  readonly rawMask: number;
  readonly normalizedMask: number;
  readonly topology: HabitatMaskTopology | null;
}

interface AtlasIndex {
  readonly bySemantic: ReadonlyMap<string, readonly ParklandHabitatAtlasFrame[]>;
  readonly byCanonicalMask: ReadonlyMap<number, readonly ParklandHabitatAtlasFrame[]>;
}

function tileKey(x: number, y: number): string {
  return `${x},${y}`;
}

function isFiniteInteger(value: number): boolean {
  return Number.isSafeInteger(value);
}

function normalizeOccupancyMask(mask: number): number {
  let normalized = mask;
  for (const gate of DIAGONAL_GATES) {
    const diagonalBit = HABITAT_OCCUPANCY_MASK_BITS[gate.diagonal];
    const firstSide = HABITAT_OCCUPANCY_MASK_BITS[gate.sides[0]];
    const secondSide = HABITAT_OCCUPANCY_MASK_BITS[gate.sides[1]];
    if ((mask & firstSide) === 0 || (mask & secondSide) === 0) normalized &= ~diagonalBit;
  }
  return normalized;
}

export function normalizedHabitatOccupancyMask(mask: number): number {
  return normalizeOccupancyMask(mask & 0xff);
}

function transformCoordinate(
  point: HabitatTileCoordinate,
  transform: HabitatD4Transform,
): HabitatTileCoordinate {
  const reflected = transform.startsWith("reflectX") ? { x: -point.x, y: point.y } : point;
  if (transform.endsWith("Rotate90") || transform === "rotate90") return { x: -reflected.y, y: reflected.x };
  if (transform.endsWith("Rotate180") || transform === "rotate180") return { x: -reflected.x, y: -reflected.y };
  if (transform.endsWith("Rotate270") || transform === "rotate270") return { x: reflected.y, y: -reflected.x };
  return { x: reflected.x, y: reflected.y };
}

function directionForOffset(point: HabitatTileCoordinate): keyof typeof HABITAT_OCCUPANCY_MASK_BITS {
  const match = (Object.entries(OFFSETS) as [keyof typeof OFFSETS, HabitatTileCoordinate][])
    .find(([, offset]) => offset.x === point.x && offset.y === point.y);
  if (!match) throw new Error(`invalid D4-transformed habitat offset ${point.x},${point.y}`);
  return match[0];
}

export function transformHabitatMask(mask: number, transform: HabitatD4Transform): number {
  let transformed = 0;
  for (const direction of Object.keys(OFFSETS) as (keyof typeof OFFSETS)[]) {
    if ((mask & HABITAT_OCCUPANCY_MASK_BITS[direction]) === 0) continue;
    const target = directionForOffset(transformCoordinate(OFFSETS[direction], transform));
    transformed |= HABITAT_OCCUPANCY_MASK_BITS[target];
  }
  return transformed;
}

export interface HabitatCanonicalMaskTransform {
  readonly normalizedMask: number;
  readonly canonicalMask: number;
  /** Maps the canonical frame into the normalized occupancy orientation. */
  readonly transform: HabitatD4Transform;
}

export function canonicalHabitatMaskTransform(mask: number): HabitatCanonicalMaskTransform {
  const normalizedMask = normalizeOccupancyMask(mask & 0xff);
  const orbit = HABITAT_D4_TRANSFORMS.map((transform) => transformHabitatMask(normalizedMask, transform));
  const canonicalMask = Math.min(...orbit);
  const transform = HABITAT_D4_TRANSFORMS.find((candidate) => (
    transformHabitatMask(canonicalMask, candidate) === normalizedMask
  ));
  if (!transform || !(HABITAT_D4_CANONICAL_MASKS as readonly number[]).includes(canonicalMask)) {
    throw new Error(`normalized habitat mask 0x${normalizedMask.toString(16)} has no D4 canonical class`);
  }
  return { normalizedMask, canonicalMask, transform };
}

export const HABITAT_NORMALIZED_MASKS: readonly number[] = [...new Set(
  Array.from({ length: 256 }, (_, mask) => normalizeOccupancyMask(mask)),
)].sort((left, right) => left - right);

function transformCardinalDirection(
  direction: HabitatCardinalDirection,
  transform: HabitatD4Transform,
): HabitatCardinalDirection {
  return directionForOffset(transformCoordinate(OFFSETS[direction], transform)) as HabitatCardinalDirection;
}

/** Classifies a raw 8-neighbor mask without choosing any random orientation. */
export function classifyHabitatOccupancyMask(mask: number): HabitatMaskClassification {
  const rawMask = mask & 0xff;
  const normalizedMask = normalizeOccupancyMask(rawMask);
  return {
    rawMask,
    normalizedMask,
    topology: HABITAT_OCCUPANCY_TRUTH_TABLE[normalizedMask] ?? null,
  };
}

function semanticKey(
  role: HabitatTopologyRole,
  direction: HabitatCardinalDirection | null,
  corner: HabitatCorner | null,
): string {
  return `${role}|${direction ?? "-"}|${corner ?? "-"}`;
}

function expectedEdgeAnchors(frame: ParklandHabitatAtlasFrame): readonly HabitatCardinalDirection[] {
  if (frame.topologyRole === "mask") {
    if (!Number.isSafeInteger(frame.canonicalMask) || frame.canonicalMask === null) return [];
    return CARDINALS.filter((direction) => (
      ((frame.canonicalMask as number) & HABITAT_OCCUPANCY_MASK_BITS[direction]) !== 0
    ));
  }
  if (frame.topologyRole === "interior") return CARDINALS;
  if (frame.topologyRole === "boundary" || frame.topologyRole === "termination") {
    return frame.direction === null ? [] : [frame.direction];
  }
  return frame.corner === null ? [] : frame.corner.split("") as HabitatCardinalDirection[];
}

function sameDirectionSet(
  actual: readonly HabitatCardinalDirection[],
  expected: readonly HabitatCardinalDirection[],
): boolean {
  return actual.length === expected.length
    && new Set(actual).size === actual.length
    && expected.every((direction) => actual.includes(direction));
}

function frameMetadataError(
  frame: ParklandHabitatAtlasFrame,
  atlas: ParklandHabitatAtlasCatalog,
): string | null {
  if (!frame.id || !FAMILY_SET.has(frame.family) || !ROLE_SET.has(frame.topologyRole)) {
    return "has invalid id, family, or topology role";
  }
  if (!Number.isSafeInteger(frame.variant) || frame.variant < 0) return "has an invalid variant";
  if (!frame.sourceSha256 || !/^[a-f0-9]{64}$/.test(frame.sourceSha256)) return "has an invalid source hash";
  if (!Number.isSafeInteger(frame.anchor.x) || !Number.isSafeInteger(frame.anchor.y)
    || !Number.isSafeInteger(frame.frame.x) || !Number.isSafeInteger(frame.frame.y)
    || !Number.isSafeInteger(frame.frame.width) || !Number.isSafeInteger(frame.frame.height)
    || frame.frame.x < 0 || frame.frame.y < 0
    || frame.frame.width <= 0 || frame.frame.height <= 0
    || frame.frame.x + frame.frame.width > atlas.width
    || frame.frame.y + frame.frame.height > atlas.height
    || frame.anchor.x < 0 || frame.anchor.x > frame.frame.width
    || frame.anchor.y < 0 || frame.anchor.y > frame.frame.height) {
    return "has an invalid, fractional, or out-of-bounds frame region or anchor";
  }

  const isMask = frame.topologyRole === "mask";
  const directional = frame.topologyRole === "boundary" || frame.topologyRole === "termination";
  const cornered = frame.topologyRole === "convex" || frame.topologyRole === "concave";
  if (directional !== (frame.direction !== null)
    || (frame.direction !== null && !DIRECTION_SET.has(frame.direction))) {
    return "has direction metadata inconsistent with its topology role";
  }
  if (cornered !== (frame.corner !== null)
    || (frame.corner !== null && !CORNER_SET.has(frame.corner))) {
    return "has corner metadata inconsistent with its topology role";
  }
  if (isMask && (!Number.isSafeInteger(frame.canonicalMask)
    || !(HABITAT_D4_CANONICAL_MASKS as readonly number[]).includes(frame.canonicalMask as number)
    || frame.canonicalMask === 255)) {
    return "has invalid canonical-mask metadata";
  }
  if (frame.canonicalMask != null && !DENSE_MASK_FAMILIES.has(frame.family)) {
    return "declares dense canonical-mask metadata for a reduced-vocabulary family";
  }
  if (frame.topologyRole === "interior" && frame.canonicalMask != null && frame.canonicalMask !== 255) {
    return "declares non-interior canonical-mask metadata on an interior frame";
  }
  if (!isMask && frame.topologyRole !== "interior" && frame.canonicalMask != null) {
    return "declares canonical-mask metadata outside the dense mask vocabulary";
  }
  if (frame.topologyRole !== "interior" && frame.variant !== 0) {
    return "uses a nonzero variant outside the interior role";
  }
  if (!sameDirectionSet(frame.edgeAnchors, expectedEdgeAnchors(frame))) {
    return "has edge anchors inconsistent with its semantic orientation";
  }
  return null;
}

function atlasDiagnostics(
  atlas: ParklandHabitatAtlasCatalog,
  family: ParklandHabitatFamily,
): { readonly diagnostics: readonly HabitatFieldDiagnostic[]; readonly index: AtlasIndex } {
  const messages: string[] = [];
  const byFamily = new Map<ParklandHabitatFamily, Map<string, ParklandHabitatAtlasFrame[]>>(
    PARKLAND_HABITAT_FAMILIES.map((candidate) => [candidate, new Map()]),
  );
  const byMaskFamily = new Map<ParklandHabitatFamily, Map<number, ParklandHabitatAtlasFrame[]>>(
    PARKLAND_HABITAT_FAMILIES.map((candidate) => [candidate, new Map()]),
  );
  const seenIds = new Set<string>();

  const validHeader = atlas.schema === "ParklandHabitatFieldAtlasV1"
    && atlas.version === 1
    && (atlas.tier === "high" || atlas.tier === "medium" || atlas.tier === "low")
    && typeof atlas.image === "string" && atlas.image.length > 0
    && Number.isSafeInteger(atlas.width) && atlas.width > 0
    && Number.isSafeInteger(atlas.height) && atlas.height > 0
    && Number.isSafeInteger(atlas.gutterPx) && atlas.gutterPx > 0
    && Number.isSafeInteger(atlas.frameCount) && atlas.frameCount > 0
    && Boolean(atlas.frames);
  if (!validHeader) {
    messages.push("atlas header does not match a finite positive-integer ParklandHabitatFieldAtlasV1 catalog");
  } else {
    const recordCount = Object.keys(atlas.frames).length;
    const expectedRecordCount = 89;
    if (atlas.frameCount !== recordCount) {
      messages.push(`atlas frameCount ${atlas.frameCount} does not match ${recordCount} frame records`);
    }
    if (recordCount !== expectedRecordCount) {
      messages.push(`atlas has ${recordCount} frame records; expected exactly ${expectedRecordCount}`);
    }
    for (const [recordId, frame] of Object.entries(atlas.frames).sort(([left], [right]) => left.localeCompare(right))) {
      if (recordId !== frame.id) messages.push(`${recordId}: record key does not match frame id ${frame.id}`);
      if (seenIds.has(frame.id)) messages.push(`${recordId}: duplicate frame id ${frame.id}`);
      seenIds.add(frame.id);

      const metadataError = frameMetadataError(frame, atlas);
      if (metadataError !== null) messages.push(`${recordId}: ${metadataError}`);
      if (!FAMILY_SET.has(frame.family)) continue;
      const key = semanticKey(frame.topologyRole, frame.direction, frame.corner);
      const familyIndex = byFamily.get(frame.family);
      if (!familyIndex) continue;
      const matches = familyIndex.get(key) ?? [];
      matches.push(frame);
      familyIndex.set(key, matches);
      if (frame.canonicalMask != null) {
        const maskIndex = byMaskFamily.get(frame.family) as Map<number, ParklandHabitatAtlasFrame[]>;
        const maskMatches = maskIndex.get(frame.canonicalMask) ?? [];
        maskMatches.push(frame);
        maskIndex.set(frame.canonicalMask, maskMatches);
      }
    }
  }

  const expectedSemantics: HabitatMaskTopology[] = [
    { role: "interior", direction: null, corner: null },
    ...CARDINALS.map((direction) => ({ role: "boundary" as const, direction, corner: null })),
    ...CORNERS.map((corner) => ({ role: "convex" as const, direction: null, corner })),
    ...CORNERS.map((corner) => ({ role: "concave" as const, direction: null, corner })),
    ...CARDINALS.map((direction) => ({ role: "termination" as const, direction, corner: null })),
  ];

  for (const candidateFamily of PARKLAND_HABITAT_FAMILIES) {
    if (DENSE_MASK_FAMILIES.has(candidateFamily)) {
      const maskIndex = byMaskFamily.get(candidateFamily) as Map<number, ParklandHabitatAtlasFrame[]>;
      for (const canonicalMask of HABITAT_D4_CANONICAL_MASKS) {
        const matches = maskIndex.get(canonicalMask) ?? [];
        const expectedCount = canonicalMask === 255 ? 3 : 1;
        if (matches.length !== expectedCount) {
          messages.push(`${candidateFamily}: canonical mask ${canonicalMask} requires exactly ${expectedCount} frame(s)`);
        }
        const variants = matches.map((frame) => frame.variant).sort((left, right) => left - right);
        const expectedVariants = canonicalMask === 255 ? [0, 1, 2] : [0];
        if (variants.join(",") !== expectedVariants.join(",")) {
          messages.push(`${candidateFamily}: canonical mask ${canonicalMask} variants are ${variants.join(",") || "missing"}`);
        }
      }
      continue;
    }
    const familyIndex = byFamily.get(candidateFamily) as Map<string, ParklandHabitatAtlasFrame[]>;
    for (const semantic of expectedSemantics) {
      const key = semanticKey(semantic.role, semantic.direction, semantic.corner);
      const matches = familyIndex.get(key) ?? [];
      if (matches.length === 0) messages.push(`${candidateFamily}: missing ${key}`);
      const variants = new Set<number>();
      for (const frame of matches) {
        if (variants.has(frame.variant)) messages.push(`${candidateFamily}: duplicate ${key} variant ${frame.variant}`);
        variants.add(frame.variant);
      }
      if (semantic.role === "interior") {
        for (const required of [0, 1, 2]) {
          if (!variants.has(required)) messages.push(`${candidateFamily}: missing ${key} variant ${required}`);
        }
        for (const variant of variants) {
          if (variant > 2) messages.push(`${candidateFamily}: unexpected ${key} variant ${variant}`);
        }
        if (matches.length !== 3) messages.push(`${candidateFamily}: interior must contain exactly 3 frames`);
      } else if (matches.length > 1) {
        messages.push(`${candidateFamily}: duplicate semantic frame ${key}`);
      }
    }
  }

  const sortedIndex = new Map<string, readonly ParklandHabitatAtlasFrame[]>();
  for (const [key, frames] of byFamily.get(family) as Map<string, ParklandHabitatAtlasFrame[]>) {
    sortedIndex.set(key, frames.slice().sort((left, right) => left.variant - right.variant || left.id.localeCompare(right.id)));
  }
  const sortedMaskIndex = new Map<number, readonly ParklandHabitatAtlasFrame[]>();
  for (const [mask, frames] of byMaskFamily.get(family) as Map<number, ParklandHabitatAtlasFrame[]>) {
    sortedMaskIndex.set(mask, frames.slice().sort((left, right) => left.variant - right.variant || left.id.localeCompare(right.id)));
  }

  return {
    diagnostics: [...new Set(messages)].sort().map((message) => ({ code: "invalid_atlas", message })),
    index: { bySemantic: sortedIndex, byCanonicalMask: sortedMaskIndex },
  };
}

function occupancyDiagnostics(occupancy: BoundedHabitatOccupancy): readonly HabitatFieldDiagnostic[] {
  const { bounds } = occupancy;
  if (!isFiniteInteger(bounds.x) || !isFiniteInteger(bounds.y)
    || !isFiniteInteger(bounds.width) || !isFiniteInteger(bounds.height)
    || bounds.width <= 0 || bounds.height <= 0) {
    return [{ code: "invalid_bounds", message: "bounds must contain finite integer coordinates and positive dimensions" }];
  }
  if (occupancy.occupied.length === 0) {
    return [{ code: "empty_patch", message: "occupancy patch must contain at least one cell" }];
  }

  const diagnostics: HabitatFieldDiagnostic[] = [];
  const seen = new Set<string>();
  for (const tile of occupancy.occupied) {
    if (!isFiniteInteger(tile.x) || !isFiniteInteger(tile.y)
      || tile.x < bounds.x || tile.y < bounds.y
      || tile.x >= bounds.x + bounds.width || tile.y >= bounds.y + bounds.height) {
      diagnostics.push({
        code: "invalid_occupied_cell",
        message: `occupied cell ${tileKey(tile.x, tile.y)} is not an integer coordinate inside bounds`,
        tile: { x: tile.x, y: tile.y },
      });
      continue;
    }
    const key = tileKey(tile.x, tile.y);
    if (seen.has(key)) {
      diagnostics.push({
        code: "duplicate_occupied_cell",
        message: `occupied cell ${key} appears more than once`,
        tile: { x: tile.x, y: tile.y },
      });
    }
    seen.add(key);
  }
  if (diagnostics.length > 0) return diagnostics.sort(compareDiagnostics);

  const first = occupancy.occupied
    .slice()
    .sort((left, right) => left.y - right.y || left.x - right.x)[0];
  const visited = new Set<string>([tileKey(first.x, first.y)]);
  const queue: HabitatTileCoordinate[] = [{ x: first.x, y: first.y }];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const tile = queue[cursor];
    for (const direction of CARDINALS) {
      const offset = OFFSETS[direction];
      const neighbor = { x: tile.x + offset.x, y: tile.y + offset.y };
      const key = tileKey(neighbor.x, neighbor.y);
      if (seen.has(key) && !visited.has(key)) {
        visited.add(key);
        queue.push(neighbor);
      }
    }
  }
  if (visited.size !== seen.size) {
    return [{
      code: "disconnected_patch",
      message: `occupancy patch is not cardinally connected (${visited.size}/${seen.size} cells reachable)`,
    }];
  }
  return [];
}

function compareDiagnostics(left: HabitatFieldDiagnostic, right: HabitatFieldDiagnostic): number {
  return (left.tile?.y ?? -1) - (right.tile?.y ?? -1)
    || (left.tile?.x ?? -1) - (right.tile?.x ?? -1)
    || left.code.localeCompare(right.code)
    || left.message.localeCompare(right.message);
}

function occupancyMask(tile: HabitatTileCoordinate, occupied: ReadonlySet<string>): number {
  let mask = 0;
  for (const direction of Object.keys(OFFSETS) as (keyof typeof OFFSETS)[]) {
    const offset = OFFSETS[direction];
    if (occupied.has(tileKey(tile.x + offset.x, tile.y + offset.y))) {
      mask |= HABITAT_OCCUPANCY_MASK_BITS[direction];
    }
  }
  return mask;
}

function mix32(value: number): number {
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
  return (value ^ (value >>> 16)) >>> 0;
}

function familySalt(family: ParklandHabitatFamily): number {
  let salt = 0x811c9dc5;
  for (let index = 0; index < family.length; index += 1) {
    salt = Math.imul(salt ^ family.charCodeAt(index), 0x01000193);
  }
  return salt >>> 0;
}

function selectFrame(
  frames: readonly ParklandHabitatAtlasFrame[],
  seed: number,
  family: ParklandHabitatFamily,
  tile: HabitatTileCoordinate,
): ParklandHabitatAtlasFrame {
  const hash = mix32(seed
    ^ familySalt(family)
    ^ Math.imul(tile.x, 0x9e3779b1)
    ^ Math.imul(tile.y, 0x85ebca6b));
  return frames[hash % frames.length];
}

/**
 * Resolves a cardinally connected occupancy patch transactionally. Either all
 * occupied cells receive truthful atlas frames or no placements are returned.
 */
export function resolveHabitatFieldTopology(
  request: HabitatFieldTopologyRequest,
): HabitatFieldTopologyResult {
  const invalidOccupancy = occupancyDiagnostics(request.occupancy);
  if (invalidOccupancy.length > 0) return { ok: false, diagnostics: invalidOccupancy };
  if (!isFiniteInteger(request.seed)) {
    return {
      ok: false,
      diagnostics: [{ code: "invalid_seed", message: "seed must be a finite integer" }],
    };
  }

  const validatedAtlas = atlasDiagnostics(request.atlas, request.family);
  if (validatedAtlas.diagnostics.length > 0) return { ok: false, diagnostics: validatedAtlas.diagnostics };

  const tiles = request.occupancy.occupied
    .map((tile) => ({ x: tile.x, y: tile.y }))
    .sort((left, right) => left.y - right.y || left.x - right.x);
  const occupied = new Set(tiles.map((tile) => tileKey(tile.x, tile.y)));
  const classified = tiles.map((tile) => ({ tile, mask: classifyHabitatOccupancyMask(occupancyMask(tile, occupied)) }));
  const denseMaskFamily = DENSE_MASK_FAMILIES.has(request.family);
  const unsupported = denseMaskFamily ? [] : classified
    .filter((entry) => entry.mask.topology === null)
    .map<HabitatFieldDiagnostic>((entry) => ({
      code: "unsupported_topology",
      message: `cell ${tileKey(entry.tile.x, entry.tile.y)} has unsupported occupancy mask 0x${entry.mask.normalizedMask.toString(16).padStart(2, "0")}`,
      tile: entry.tile,
      mask: entry.mask.rawMask,
      normalizedMask: entry.mask.normalizedMask,
    }))
    .sort(compareDiagnostics);
  if (unsupported.length > 0) return { ok: false, diagnostics: unsupported };

  const placements = classified.map(({ tile, mask }) => {
    if (denseMaskFamily) {
      const canonical = canonicalHabitatMaskTransform(mask.normalizedMask);
      const matches = validatedAtlas.index.byCanonicalMask.get(canonical.canonicalMask) as readonly ParklandHabitatAtlasFrame[];
      const frame = selectFrame(matches, request.seed, request.family, tile);
      return {
        frameId: frame.id,
        family: frame.family,
        topologyRole: frame.topologyRole,
        direction: null,
        corner: null,
        variant: frame.variant,
        normalizedMask: canonical.normalizedMask,
        canonicalMask: canonical.canonicalMask,
        d4Transform: canonical.transform,
        tile,
        atlasAnchor: { x: frame.anchor.x, y: frame.anchor.y },
        worldAnchor: {
          x: tile.x + frame.anchor.x / frame.frame.width,
          y: tile.y + frame.anchor.y / frame.frame.height,
        },
        edgeAnchors: frame.edgeAnchors.map((direction) => transformCardinalDirection(direction, canonical.transform)),
      } satisfies HabitatFieldPlacement;
    }
    const topology = mask.topology as HabitatMaskTopology;
    const matches = validatedAtlas.index.bySemantic.get(
      semanticKey(topology.role, topology.direction, topology.corner),
    ) as readonly ParklandHabitatAtlasFrame[];
    const frame = selectFrame(matches, request.seed, request.family, tile);
    return {
      frameId: frame.id,
      family: frame.family,
      topologyRole: frame.topologyRole,
      direction: frame.direction,
      corner: frame.corner,
      variant: frame.variant,
      normalizedMask: mask.normalizedMask,
      canonicalMask: null,
      d4Transform: "identity",
      tile,
      atlasAnchor: { x: frame.anchor.x, y: frame.anchor.y },
      worldAnchor: {
        x: tile.x + frame.anchor.x / frame.frame.width,
        y: tile.y + frame.anchor.y / frame.frame.height,
      },
      edgeAnchors: [...frame.edgeAnchors],
    } satisfies HabitatFieldPlacement;
  });

  return { ok: true, placements };
}
