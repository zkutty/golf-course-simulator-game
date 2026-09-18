import { describe, expect, it } from "vitest";
import { buildLandscapeMeshCellSet } from "./landscapeMeshGeometry";

describe("landscape presentation mesh cells", () => {
  it("adds one cardinal-cell halo without changing authoritative ownership", () => {
    const result = buildLandscapeMeshCellSet([4], "fairway", 3, 3);
    expect(result.cells).toEqual([4]);
    expect(result.haloCells).toEqual([1, 3, 5, 7]);
    expect(result.presentationCells).toEqual([1, 3, 4, 5, 7]);
  });

  it("keeps map boundaries bounded and excludes owned cells from the halo", () => {
    const result = buildLandscapeMeshCellSet([0, 1], "water", 3, 2);
    expect(result.haloCells).toEqual([2, 3, 4]);
    expect(result.presentationCells).toEqual([0, 1, 2, 3, 4]);
  });

  it("keeps the frozen path mesh footprint byte-for-byte authoritative", () => {
    const result = buildLandscapeMeshCellSet([1, 4], "path", 3, 2);
    expect(result).toEqual({ cells: [1, 4], haloCells: [], presentationCells: [1, 4] });
  });

  it("is deterministic irrespective of incoming cell order", () => {
    expect(buildLandscapeMeshCellSet([4, 0], "rough", 3, 2))
      .toEqual(buildLandscapeMeshCellSet([0, 4], "rough", 3, 2));
  });
});
