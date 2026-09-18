import type { Terrain } from "../models/types";

export interface LandscapeMeshCellSet {
  /** Authoritative cells; never used to change gameplay ownership. */
  readonly cells: readonly number[];
  /** One-cardinal-cell presentation overlap for a displaced shared seam. */
  readonly haloCells: readonly number[];
  /** Cells that a connected material mesh may cover at Medium/High. */
  readonly presentationCells: readonly number[];
}

const CARDINALS = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
] as const;

/**
 * Supplies enough source geometry beneath a render-only seam displacement.
 * Paths deliberately retain their accepted mesh footprint because their
 * compositor is a separate frozen presentation contract.
 */
export function buildLandscapeMeshCellSet(
  cells: readonly number[],
  terrain: Terrain,
  width: number,
  height: number,
): LandscapeMeshCellSet {
  const owned = [...cells].sort((a, b) => a - b);
  if (terrain === "path" || width <= 0 || height <= 0) {
    return { cells: owned, haloCells: [], presentationCells: owned };
  }
  const ownedSet = new Set(owned);
  const halo = new Set<number>();
  for (const index of owned) {
    const x = index % width;
    const y = Math.floor(index / width);
    for (const [dx, dy] of CARDINALS) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const neighbor = ny * width + nx;
      if (!ownedSet.has(neighbor)) halo.add(neighbor);
    }
  }
  const haloCells = [...halo].sort((a, b) => a - b);
  return {
    cells: owned,
    haloCells,
    presentationCells: [...owned, ...haloCells].sort((a, b) => a - b),
  };
}
