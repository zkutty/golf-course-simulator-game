import { describe, expect, it } from "vitest";
import { ringSignedArea } from "./landscapeGeometry";
import {
  buildBunkerVisualRings,
  classifyBunkerVisualType,
} from "./bunkerShapes";

describe("bunker silhouettes", () => {
  const single = [[
    { x: 4, y: 6 },
    { x: 5, y: 6 },
    { x: 5, y: 7 },
    { x: 4, y: 7 },
  ]];

  it("turns one cell into a stable compact kidney instead of a square", () => {
    const first = buildBunkerVisualRings(single, "sand-single", 1);
    const second = buildBunkerVisualRings(single, "sand-single", 1);
    expect(first).toEqual(second);
    expect(first[0]).toHaveLength(28);
    expect(Math.min(...first[0].map((point) => point.x))).toBeGreaterThan(4);
    expect(Math.max(...first[0].map((point) => point.x))).toBeLessThan(5);
    expect(Math.min(...first[0].map((point) => point.y))).toBeGreaterThan(6);
    expect(Math.max(...first[0].map((point) => point.y))).toBeLessThan(7);
    expect(ringSignedArea(first[0])).toBeGreaterThan(0);
    const radii = first[0].map((point) => Math.hypot(point.x - 4.5, point.y - 6.5));
    expect(Math.max(...radii) - Math.min(...radii)).toBeGreaterThan(0.08);
  });

  it("insets and scallops a connected outline without losing its identity", () => {
    const connected = [[
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 3, y: 1 },
      { x: 3, y: 2 },
      { x: 3, y: 3 },
      { x: 2, y: 3 },
      { x: 1, y: 3 },
      { x: 1, y: 2 },
    ]];
    const result = buildBunkerVisualRings(connected, "sand-connected", 4);
    expect(result).toHaveLength(1);
    expect(result[0].length).toBeGreaterThan(connected[0].length);
    expect(result).toEqual(
      buildBunkerVisualRings(connected, "sand-connected", 4),
    );
    expect(result).not.toEqual(
      buildBunkerVisualRings(connected, "other-topology", 4),
    );
    expect(Math.abs(ringSignedArea(result[0]))).toBeLessThan(
      Math.abs(ringSignedArea(connected[0])),
    );
    expect(Math.abs(ringSignedArea(result[0]))).toBeGreaterThan(1);
  });

  it("keeps connected lobes independent of source tessellation density", () => {
    const sparse = [[
      { x: 1, y: 1 },
      { x: 4, y: 1 },
      { x: 4, y: 2 },
      { x: 1, y: 2 },
    ]];
    const split = [[
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 3, y: 1 },
      { x: 4, y: 1 },
      { x: 4, y: 2 },
      { x: 3, y: 2 },
      { x: 2, y: 2 },
      { x: 1, y: 2 },
    ]];
    const sparseShape = buildBunkerVisualRings(
      sparse,
      "same-topology",
      3,
      "fairway",
    )[0];
    const splitShape = buildBunkerVisualRings(
      split,
      "same-topology",
      3,
      "fairway",
    )[0];
    expect(sparseShape).toHaveLength(splitShape.length);
    for (let index = 0; index < sparseShape.length; index++) {
      expect(sparseShape[index].x).toBeCloseTo(splitShape[index].x, 12);
      expect(sparseShape[index].y).toBeCloseTo(splitShape[index].y, 12);
    }
  });

  it("infers pot, greenside, and shallow fairway bunker profiles", () => {
    const tiles = new Array(15).fill("rough") as Array<
      "rough" | "sand" | "green"
    >;
    tiles[6] = "sand";
    tiles[7] = "sand";
    tiles[9] = "green";
    expect(classifyBunkerVisualType([6], tiles, 5, 3)).toBe("pot");
    expect(classifyBunkerVisualType([6, 7], tiles, 5, 3)).toBe("greenside");
    expect(classifyBunkerVisualType([0, 1], tiles, 5, 3)).toBe("fairway");

    const connected = [[
      { x: 1, y: 1 },
      { x: 3, y: 1 },
      { x: 3, y: 3 },
      { x: 1, y: 3 },
    ]];
    const greenside = buildBunkerVisualRings(
      connected,
      "typed-bunker",
      4,
      "greenside",
    );
    const fairway = buildBunkerVisualRings(
      connected,
      "typed-bunker",
      4,
      "fairway",
    );
    expect(Math.abs(ringSignedArea(fairway[0]))).toBeGreaterThan(
      Math.abs(ringSignedArea(greenside[0])),
    );
  });
});
