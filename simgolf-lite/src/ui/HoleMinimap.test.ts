import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { worldToIso } from "../game/render/iso";
import { makeMinimapTransform, minimapCanvasPoint, minimapPointToWorld } from "../game/render/minimap";
import { createParklandVisualReferenceCourse } from "../game/testing/referenceCourse";
import { HoleMinimap } from "./HoleMinimap";

describe("isometric minimap navigation", () => {
  it("collapses only when the owner opts normal gameplay into the compact default", () => {
    const course = createParklandVisualReferenceCourse();
    const cozy = renderToStaticMarkup(createElement(HoleMinimap, { course, closed: true }));
    const architect = renderToStaticMarkup(createElement(HoleMinimap, { course, closed: false }));
    const thumbnail = renderToStaticMarkup(createElement(HoleMinimap, { course, hole: course.holes[0], thumbnail: true }));
    expect(cozy).toContain('aria-label="Open course minimap"');
    expect(cozy).not.toContain('aria-label="Isometric course minimap"');
    expect(architect).toContain('aria-label="Collapse course minimap"');
    expect(architect).toContain('aria-label="Isometric course minimap"');
    expect(thumbnail).toContain('aria-label="Isometric preview of hole 1"');
  });

  it("round-trips north-up world points through the minimap transform", () => {
    const transform = makeMinimapTransform({ minX: 0, minY: 0, maxX: 63, maxY: 63 });
    for (const world of [{ x: 0, y: 0 }, { x: 18.25, y: 37.5 }, { x: 63, y: 63 }]) {
      const canvas = minimapCanvasPoint(worldToIso(world.x, world.y), transform);
      const actual = minimapPointToWorld(canvas, transform);
      expect(actual.x).toBeCloseTo(world.x, 5);
      expect(actual.y).toBeCloseTo(world.y, 5);
    }
  });
});
