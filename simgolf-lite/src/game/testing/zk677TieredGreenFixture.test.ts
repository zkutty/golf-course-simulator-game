import { describe, expect, it } from "vitest";
import { buildLandscapeComponents, buildVisualHeightfield, sampleVisualHeight } from "../render/landscapeGeometry";
import { createZk677TieredGreenFixture } from "./zk677TieredGreenFixture";

describe("ZK-677 tiered-green fixture", () => {
  it.each(["parkland", "links", "desert"] as const)(
    "keeps one connected %s green visibly tiered and immutable",
    (theme) => {
      const course = createZk677TieredGreenFixture(theme);
      const before = JSON.stringify(course);
      const green = buildLandscapeComponents(course.tiles, course.width, course.height)
        .filter((component) => component.terrain === "green");
      const field = buildVisualHeightfield(course);
      const heights = [10.5, 12.5, 14.5].map((x) => sampleVisualHeight(field, x, 6.5));

      expect(green).toHaveLength(1);
      expect(new Set(green[0].cells.map((index) => course.elevations[index]))).toEqual(new Set([0, 1, 3]));
      expect(heights[1]).toBeGreaterThan(heights[0] + 0.4);
      expect(heights[2]).toBeGreaterThan(heights[1] + 1.2);
      expect(JSON.stringify(course)).toBe(before);
    },
  );
});
