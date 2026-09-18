import { describe, expect, it } from "vitest";
import { buildSignedContourRibbons } from "./contourRibbons";

const clockwiseSquare = [
  { x: 0, y: 0 },
  { x: 4, y: 0 },
  { x: 4, y: 4 },
  { x: 0, y: 4 },
  { x: 0, y: 0 },
];

describe("pair-owned signed contour ribbons", () => {
  it("emits one deterministic owner stack with continuous signed offsets", () => {
    const first = buildSignedContourRibbons("water", "rough", clockwiseSquare, {
      theme: "parkland",
      colorVision: "standard",
      profile: "high",
    });
    const second = buildSignedContourRibbons("water", "rough", clockwiseSquare, {
      theme: "parkland",
      colorVision: "standard",
      profile: "high",
    });
    expect(second).toEqual(first);
    expect(first.map((ribbon) => ribbon.band.role)).toEqual([
      "turf-shelf", "soil-bank", "reed-fringe", "water-shallow", "water-deep",
    ]);
    for (const ribbon of first) {
      expect(ribbon.owner).toBe("water");
      expect(ribbon.outer).toHaveLength(5);
      expect(ribbon.inner).toHaveLength(5);
      expect(ribbon.outer[0]).toEqual(ribbon.outer.at(-1));
      // Positive offset moves down from the square's top edge: into water.
      expect(ribbon.inner[0].y).toBeGreaterThan(ribbon.outer[0].y);
    }
  });

  it("rejects the non-owning side and preserves quality thinning for motifs", () => {
    expect(buildSignedContourRibbons("rough", "water", clockwiseSquare, {
      theme: "parkland",
      colorVision: "standard",
      profile: "high",
    })).toEqual([]);
    const high = buildSignedContourRibbons("path", "rough", clockwiseSquare, {
      theme: "parkland",
      colorVision: "standard",
      profile: "high",
    });
    const medium = buildSignedContourRibbons("path", "rough", clockwiseSquare, {
      theme: "parkland",
      colorVision: "standard",
      profile: "medium",
    });
    expect(high.flatMap((ribbon) => ribbon.details).length)
      .toBeGreaterThan(medium.flatMap((ribbon) => ribbon.details).length);
  });

  it("tapers offsets at concave corners instead of forming deep inset bulbs", () => {
    const concaveShore = [
      { x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 1 },
      { x: 1, y: 1 }, { x: 1, y: 5 }, { x: 0, y: 5 }, { x: 0, y: 0 },
    ];
    const deepest = buildSignedContourRibbons("water", "rough", concaveShore, {
      theme: "parkland",
      colorVision: "standard",
      profile: "high",
    }).find((ribbon) => ribbon.band.role === "water-deep")!;

    // Tight L corners cannot safely host the old >1-tile water inset. The
    // bounded presentation offset preserves a joined shore while preventing a
    // self-crossing/peninsula-shaped ribbon.
    for (let index = 0; index < concaveShore.length - 1; index++) {
      expect(Math.hypot(
        deepest.inner[index].x - concaveShore[index].x,
        deepest.inner[index].y - concaveShore[index].y,
      )).toBeLessThanOrEqual(0.241);
    }
  });
});
