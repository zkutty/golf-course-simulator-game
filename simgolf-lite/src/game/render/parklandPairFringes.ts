import type { Terrain } from "../models/types";
import type { IsoRotation } from "./iso";

export const PARKLAND_PAIR_FRINGE_SEMANTICS = [
  "fairway",
  "rough",
  "deep_rough",
  "green",
  "tee",
] as const satisfies readonly Terrain[];

export type ParklandPairFringeSemantic = typeof PARKLAND_PAIR_FRINGE_SEMANTICS[number];
export type ParklandPairFringeDirection = "n" | "e" | "s" | "w";
export type ParklandPairFringeCorner = "ne" | "se" | "sw" | "nw";
export type ParklandPairFringePair =
  | "fairway--rough"
  | "fairway--deep_rough"
  | "fairway--green"
  | "fairway--tee"
  | "rough--deep_rough"
  | "rough--green"
  | "rough--tee"
  | "deep_rough--green"
  | "deep_rough--tee"
  | "green--tee";
export type ParklandPairFringeAssetRole =
  | `edge:${ParklandPairFringePair}:${ParklandPairFringeDirection}`
  | `corner:${ParklandPairFringePair}:${ParklandPairFringeCorner}`;

export const PARKLAND_PAIR_FRINGE_DIRECTIONS = ["n", "e", "s", "w"] as const;
export const PARKLAND_PAIR_FRINGE_CORNERS = ["ne", "se", "sw", "nw"] as const;

const oppositeDirection: Readonly<Record<ParklandPairFringeDirection, ParklandPairFringeDirection>> = {
  n: "s",
  e: "w",
  s: "n",
  w: "e",
};

const cornerDirections: Readonly<Record<ParklandPairFringeCorner, readonly [ParklandPairFringeDirection, ParklandPairFringeDirection]>> = {
  ne: ["n", "e"],
  se: ["e", "s"],
  sw: ["s", "w"],
  nw: ["w", "n"],
};

const screenDirectionByRotation: Readonly<Record<IsoRotation, Readonly<Record<ParklandPairFringeDirection, ParklandPairFringeDirection>>>> = {
  0: { n: "n", e: "e", s: "s", w: "w" },
  90: { n: "e", e: "s", s: "w", w: "n" },
  180: { n: "s", e: "w", s: "n", w: "e" },
  270: { n: "w", e: "n", s: "e", w: "s" },
};

/** Low retains the original fringe-equivalent rough/deep-rough presentation. */
export function isSameParklandFringePresentation(
  a: ParklandPairFringeSemantic,
  b: ParklandPairFringeSemantic,
): boolean {
  return (a === "rough" && b === "deep_rough") || (a === "deep_rough" && b === "rough");
}

export function isParklandPairFringeSemantic(terrain: Terrain): terrain is ParklandPairFringeSemantic {
  return PARKLAND_PAIR_FRINGE_SEMANTICS.some((semantic) => semantic === terrain);
}

export function canonicalParklandFringePair(
  a: ParklandPairFringeSemantic,
  b: ParklandPairFringeSemantic,
): { pair: ParklandPairFringePair; first: ParklandPairFringeSemantic; second: ParklandPairFringeSemantic } {
  const aIndex = PARKLAND_PAIR_FRINGE_SEMANTICS.indexOf(a);
  const bIndex = PARKLAND_PAIR_FRINGE_SEMANTICS.indexOf(b);
  const first = aIndex < bIndex ? a : b;
  const second = aIndex < bIndex ? b : a;
  return { pair: `${first}--${second}` as ParklandPairFringePair, first, second };
}

export interface ParklandPairFringeEdge {
  /** Stable physical adjacency identity. */
  readonly ownerKey: string;
  readonly pair: ParklandPairFringePair;
  /** Original semantic pair used only to reject mixed-pair corner joins. */
  readonly pairIdentity: ParklandPairFringePair;
  /** Cell whose terrain is the first member of the canonical manifest pair. */
  readonly ownerCell: number;
  readonly neighborCell: number;
  /** World direction from ownerCell to neighborCell. */
  readonly direction: ParklandPairFringeDirection;
  readonly x: number;
  readonly y: number;
  readonly elevation: number;
}

export interface ParklandPairFringeCornerPatch {
  readonly ownerKey: string;
  readonly vertexKey: string;
  readonly pair: ParklandPairFringePair;
  readonly ownerCell: number;
  readonly corner: ParklandPairFringeCorner;
  readonly x: number;
  readonly y: number;
  readonly elevation: number;
  readonly compatibleEdgeOwnerKeys: readonly [string, string];
}

export interface ParklandPairFringePlan {
  readonly edges: readonly ParklandPairFringeEdge[];
  readonly corners: readonly ParklandPairFringeCornerPatch[];
  readonly diagnostics: {
    readonly authoritativeDifferingTurfAdjacencies: number;
    readonly sameElevationDifferingTurfAdjacencies: number;
    readonly omittedDifferentElevation: number;
    readonly omittedSamePresentation: number;
    readonly omittedBlocked: number;
    readonly plannedStrips: number;
    readonly cornerCandidates: number;
    readonly plannedCorners: number;
    readonly omittedMixedPairCorners: number;
    readonly mixedPairMasks: 0;
    readonly fullCellSprites: 0;
    readonly ownershipOverlaps: 0;
    readonly doubleOwners: 0;
    readonly pairCounts: Readonly<Record<string, number>>;
    readonly directionCounts: Readonly<Record<ParklandPairFringeDirection, number>>;
  };
}

export interface ParklandPairFringePlanInput {
  readonly tiles: readonly Terrain[];
  readonly elevations: readonly number[];
  readonly width: number;
  readonly height: number;
  /** Building/exclusion cells never own or consume a presentation strip. */
  readonly blockedCells?: ReadonlySet<number>;
  /** Optional pre-presentation semantics used to preserve true pair corners. */
  readonly pairIdentityTiles?: readonly Terrain[];
  /** High/medium fields expose the authored rough/deep-rough density crossover. */
  readonly includeDensityCrossovers?: boolean;
}

function directionBetween(ownerCell: number, neighborCell: number, width: number): ParklandPairFringeDirection {
  const delta = neighborCell - ownerCell;
  if (delta === -width) return "n";
  if (delta === 1) return "e";
  if (delta === width) return "s";
  if (delta === -1) return "w";
  throw new Error("Parkland fringe adjacency is not cardinal");
}

function vertexForCorner(x: number, y: number, corner: ParklandPairFringeCorner): readonly [number, number] {
  switch (corner) {
    case "ne": return [x + 1, y];
    case "se": return [x + 1, y + 1];
    case "sw": return [x, y + 1];
    case "nw": return [x, y];
  }
}

export function buildParklandPairFringePlan(input: ParklandPairFringePlanInput): ParklandPairFringePlan {
  const { tiles, elevations, width, height } = input;
  if (
    tiles.length !== width * height
    || elevations.length !== tiles.length
    || (input.pairIdentityTiles && input.pairIdentityTiles.length !== tiles.length)
  ) {
    throw new Error("Parkland fringe input dimensions are inconsistent");
  }
  const blocked = input.blockedCells ?? new Set<number>();
  const edges: ParklandPairFringeEdge[] = [];
  let authoritativeDifferingTurfAdjacencies = 0;
  let sameElevationDifferingTurfAdjacencies = 0;
  let omittedDifferentElevation = 0;
  let omittedSamePresentation = 0;
  let omittedBlocked = 0;
  const pairCounts: Record<string, number> = {};
  const directionCounts: Record<ParklandPairFringeDirection, number> = { n: 0, e: 0, s: 0, w: 0 };

  // E/S scanning makes each physical cardinal join reachable exactly once.
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const cell = y * width + x;
    const a = tiles[cell];
    if (!isParklandPairFringeSemantic(a)) continue;
    for (const [dx, dy] of [[1, 0], [0, 1]] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= width || ny >= height) continue;
      const neighbor = ny * width + nx;
      const b = tiles[neighbor];
      if (!isParklandPairFringeSemantic(b) || a === b) continue;
      authoritativeDifferingTurfAdjacencies++;
      if ((elevations[cell] ?? 0) !== (elevations[neighbor] ?? 0)) {
        omittedDifferentElevation++;
        continue;
      }
      sameElevationDifferingTurfAdjacencies++;
      // Low keeps the original compact presentation. High/medium consume the
      // derived two-material crossover atlas without changing tile authority.
      if (!input.includeDensityCrossovers && isSameParklandFringePresentation(a, b)) {
        omittedSamePresentation++;
        continue;
      }
      if (blocked.has(cell) || blocked.has(neighbor)) {
        omittedBlocked++;
        continue;
      }
      const canonical = canonicalParklandFringePair(a, b);
      const identityA = input.pairIdentityTiles?.[cell] ?? a;
      const identityB = input.pairIdentityTiles?.[neighbor] ?? b;
      const pairIdentity = isParklandPairFringeSemantic(identityA)
        && isParklandPairFringeSemantic(identityB)
        && identityA !== identityB
        ? canonicalParklandFringePair(identityA, identityB).pair
        : canonical.pair;
      const ownerCell = a === canonical.first ? cell : neighbor;
      const neighborCell = ownerCell === cell ? neighbor : cell;
      const direction = directionBetween(ownerCell, neighborCell, width);
      const ownerX = ownerCell % width;
      const ownerY = Math.floor(ownerCell / width);
      const ownerKey = `${Math.min(cell, neighbor)}:${Math.max(cell, neighbor)}`;
      edges.push({
        ownerKey,
        pair: canonical.pair,
        pairIdentity,
        ownerCell,
        neighborCell,
        direction,
        x: ownerX,
        y: ownerY,
        elevation: elevations[ownerCell] ?? 0,
      });
      pairCounts[canonical.pair] = (pairCounts[canonical.pair] ?? 0) + 1;
      directionCounts[direction]++;
    }
  }

  edges.sort((a, b) => a.ownerCell - b.ownerCell || a.direction.localeCompare(b.direction) || a.pair.localeCompare(b.pair));
  const edgeByCellPairDirection = new Map<string, ParklandPairFringeEdge>();
  for (const edge of edges) edgeByCellPairDirection.set(`${edge.ownerCell}:${edge.pair}:${edge.direction}`, edge);
  const cornerCandidates: ParklandPairFringeCornerPatch[] = [];
  let omittedMixedPairCorners = 0;
  for (const edge of edges) {
    for (const corner of PARKLAND_PAIR_FRINGE_CORNERS) {
      const [a, b] = cornerDirections[corner];
      if (edge.direction !== a) continue;
      const other = edgeByCellPairDirection.get(`${edge.ownerCell}:${edge.pair}:${b}`);
      if (!other) continue;
      // Presentation coalescing may make differently authored pairs share one
      // visible material pair. A single L join is still one exact presentation
      // pair, but three incident sides would wrap a cell into the forbidden
      // near-full-diamond enclosure. Reject both corners of that compound cap.
      const incidentPairEdges = edges.filter((candidate) => (
        candidate.ownerCell === edge.ownerCell && candidate.pair === edge.pair
      )).length;
      if (other.pairIdentity !== edge.pairIdentity && incidentPairEdges > 2) {
        omittedMixedPairCorners++;
        continue;
      }
      const [vx, vy] = vertexForCorner(edge.x, edge.y, corner);
      cornerCandidates.push({
        ownerKey: `${edge.pair}:${vx},${vy}`,
        vertexKey: `${vx},${vy}`,
        pair: edge.pair,
        ownerCell: edge.ownerCell,
        corner,
        x: edge.x,
        y: edge.y,
        elevation: edge.elevation,
        compatibleEdgeOwnerKeys: [edge.ownerKey, other.ownerKey],
      });
    }
  }
  cornerCandidates.sort((a, b) => a.ownerKey.localeCompare(b.ownerKey) || a.ownerCell - b.ownerCell || a.corner.localeCompare(b.corner));
  const corners: ParklandPairFringeCornerPatch[] = [];
  const cornerOwners = new Set<string>();
  for (const candidate of cornerCandidates) {
    if (cornerOwners.has(candidate.ownerKey)) continue;
    cornerOwners.add(candidate.ownerKey);
    corners.push(candidate);
  }

  return {
    edges,
    corners,
    diagnostics: {
      authoritativeDifferingTurfAdjacencies,
      sameElevationDifferingTurfAdjacencies,
      omittedDifferentElevation,
      omittedSamePresentation,
      omittedBlocked,
      plannedStrips: edges.length,
      cornerCandidates: cornerCandidates.length,
      plannedCorners: corners.length,
      omittedMixedPairCorners,
      mixedPairMasks: 0,
      fullCellSprites: 0,
      ownershipOverlaps: 0,
      doubleOwners: 0,
      pairCounts: Object.fromEntries(Object.entries(pairCounts).sort(([a], [b]) => a.localeCompare(b))),
      directionCounts,
    },
  };
}

export function parklandPairFringeAssetRole(
  item: ParklandPairFringeEdge | ParklandPairFringeCornerPatch,
): ParklandPairFringeAssetRole {
  return "direction" in item
    ? `edge:${item.pair}:${item.direction}`
    : `corner:${item.pair}:${item.corner}`;
}

export function parklandPairFringeRotationMapping(rotation: IsoRotation) {
  return PARKLAND_PAIR_FRINGE_DIRECTIONS.map((worldDirection) => ({
    worldDirection,
    assetDirection: worldDirection,
    screenDirection: screenDirectionByRotation[rotation][worldDirection],
  }));
}

export function oppositeParklandPairFringeDirection(direction: ParklandPairFringeDirection) {
  return oppositeDirection[direction];
}
