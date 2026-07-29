import { describe, expect, it } from "vitest";
import {
  buildLandscapeBoundaryRuns,
  buildShoreRockPlacements,
  landscapeEdgeStyle,
} from "./landscapeEdges";

describe("connected landscape edge hierarchy", () => {
  it("gives fairways and bunkers a rough collar", () => {
    for (const terrain of ["fairway", "sand"] as const) {
      const style = landscapeEdgeStyle(terrain);
      expect(style).not.toBeNull();
      expect(style!.bands[0].color).toEqual({
        terrain: "rough",
        shade: terrain === "fairway" ? 0.78 : 0.72,
      });
      expect(style!.bands[0].width).toBeGreaterThan(style!.bands[1].width);
    }
  });

  it("feathers authored deep rough into the base rough", () => {
    const style = landscapeEdgeStyle("deep_rough");
    expect(style?.bands[0].color).toEqual({ terrain: "rough", shade: 0.7 });
    expect(style!.bands[0].width).toBeGreaterThan(style!.bands[1].width);
    expect(style?.priority).toBeLessThan(landscapeEdgeStyle("fairway")!.priority);
  });

  it("pads a green with rough, fringe, then putting surface", () => {
    const style = landscapeEdgeStyle("green");
    expect(style?.bands.map((band) => (
      "terrain" in band.color ? band.color.terrain : "fixed"
    ))).toEqual(["rough", "fairway", "green"]);
    expect(style?.bands.map((band) => band.width)).toEqual([8, 5, 1.2]);
  });

  it("gives water a rocky bank stack while wetland stays vegetated", () => {
    const water = landscapeEdgeStyle("water");
    const wetland = landscapeEdgeStyle("wetland");
    expect(water?.shoreRocks).toBe(true);
    expect(water?.bands[0].color).toEqual({ terrain: "rough", shade: 0.68 });
    expect(water?.bands[1].color).toEqual({ color: 0x747569 });
    expect(wetland?.shoreRocks).toBeUndefined();
  });

  it("assigns every shared terrain pair to one edge owner", () => {
    expect(landscapeEdgeStyle("fairway", "rough")).not.toBeNull();
    expect(landscapeEdgeStyle("rough", "fairway")).toBeNull();
    expect(landscapeEdgeStyle("sand", "green")).not.toBeNull();
    expect(landscapeEdgeStyle("green", "sand")).toBeNull();
    expect(landscapeEdgeStyle("water", "sand")).not.toBeNull();
    expect(landscapeEdgeStyle("sand", "water")).toBeNull();
  });

  it("renders pot bunkers steeper than fairway bunkers", () => {
    const pot = landscapeEdgeStyle("sand", "rough", "pot")!;
    const fairway = landscapeEdgeStyle("sand", "rough", "fairway")!;
    expect(pot.bands[0].width).toBeGreaterThan(fairway.bands[0].width);
    expect(pot.bands[1].width).toBeGreaterThan(fairway.bands[1].width);
  });

  it("splits a rounded contour by the actual neighboring terrain", () => {
    const rings = [[
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ]];
    const runs = buildLandscapeBoundaryRuns(
      rings,
      "fairway",
      ["fairway", "rough"],
      2,
      1,
    );
    expect(runs.some((run) => run.outsideTerrain === "rough")).toBe(true);
    expect(runs.some((run) => run.outsideTerrain === null)).toBe(true);
    expect(runs.every((run) => run.points.length >= 2)).toBe(true);
  });
});

describe("shore rock placement", () => {
  const rings = [[
    { x: 1, y: 1 },
    { x: 9, y: 1 },
    { x: 9, y: 6 },
    { x: 1, y: 6 },
  ]];

  it("is deterministic, world anchored, and hard capped", () => {
    const first = buildShoreRockPlacements(rings, "water-fixture", 12);
    const second = buildShoreRockPlacements(rings, "water-fixture", 12);
    expect(first).toEqual(second);
    expect(first.length).toBeGreaterThan(0);
    expect(first.length).toBeLessThanOrEqual(12);
    expect(first.every((rock) => rock.x >= 0.8 && rock.x <= 9.2)).toBe(true);
    expect(first.every((rock) => rock.y >= 0.8 && rock.y <= 6.2)).toBe(true);
  });

  it("changes its sparse pattern with topology and honors a zero budget", () => {
    expect(buildShoreRockPlacements(rings, "water-fixture", 0)).toEqual([]);
    expect(buildShoreRockPlacements(rings, "water-fixture", 8))
      .not.toEqual(buildShoreRockPlacements(rings, "other-water", 8));
  });
});
