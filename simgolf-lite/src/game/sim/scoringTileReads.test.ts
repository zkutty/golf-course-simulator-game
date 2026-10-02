import { describe, expect, it } from "vitest";
import type { Terrain } from "../models/types";
import { readScoringTile, withScoringTileReads } from "./scoringTileReads";

describe("scoring terrain read recorder", () => {
  it("preserves exact values, sparse/out-of-range reads and first-consumed order", () => {
    const tiles: Terrain[] = ["fairway", "green"];
    tiles.length = 3;
    const dependencies = new Map<number, Terrain>();
    withScoringTileReads(tiles, dependencies, () => {
      for (const index of [1, 0, 1, 2, 5, -1, .5]) expect(readScoringTile(tiles, index)).toBe(tiles[index]);
    });
    expect([...dependencies]).toEqual([[1, "green"], [0, "fairway"], [2, undefined], [5, undefined]]);
    readScoringTile(tiles, 7);
    expect(dependencies.has(7)).toBe(false);
  });
  it("restores nested scopes and cleans up after thrown scoring", () => {
    const outer: Terrain[] = ["tee", "fairway"];
    const inner: Terrain[] = ["rough"];
    const a = new Map<number, Terrain>();
    const b = new Map<number, Terrain>();
    withScoringTileReads(outer, a, () => {
      readScoringTile(outer, 0);
      expect(() => withScoringTileReads(inner, b, () => { readScoringTile(inner, 0); throw new Error("stop"); })).toThrow("stop");
      readScoringTile(outer, 1);
    });
    expect([...a]).toEqual([[0, "tee"], [1, "fairway"]]);
    expect([...b]).toEqual([[0, "rough"]]);
  });
});
