import type { Terrain } from "../models/types";

interface TileReadScope {
  tiles: Terrain[];
  dependencies: Map<number, Terrain>;
  seen: Uint8Array;
}
let currentScope: TileReadScope | undefined;

/** Synchronous scoring scope; restore an outer scope even if scoring throws. */
export function withScoringTileReads<T>(tiles: Terrain[], dependencies: Map<number, Terrain>, score: () => T): T {
  const previous = currentScope;
  currentScope = { tiles, dependencies, seen: new Uint8Array(tiles.length) };
  try { return score(); } finally { currentScope = previous; }
}

/** Preserve direct array-read semantics, recording each consumed cell once. */
export function readScoringTile(tiles: Terrain[], index: number): Terrain {
  const value = tiles[index];
  if (currentScope?.tiles === tiles && currentScope.seen[index] !== 1 && Number.isInteger(index) && index >= 0) {
    currentScope.dependencies.set(index, value);
    currentScope.seen[index] = 1;
  }
  return value;
}
