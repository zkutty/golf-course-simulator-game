import { describe, expect, it } from "vitest";
import type { Terrain } from "../models/types";
import { buildLandscapeComponents } from "./landscapeGeometry";
import { createParklandVisualReferenceCourse } from "../testing/referenceCourse";
import {
  buildPathMaterialCrossSection,
  classifyPathMaterialPoint,
  pathOwnsBoundaryWith,
} from "./pathMaterialCrossSection";

function fixture() {
  const width = 7;
  const height = 6;
  const tiles = Array<Terrain>(width * height).fill("rough");
  for (const [x, y] of [[2, 1], [2, 2], [2, 3], [3, 3], [4, 3]]) tiles[y * width + x] = "path";
  // A higher-priority water neighbor must retain the seam on the east side.
  tiles[2 * width + 3] = "water";
  const component = buildLandscapeComponents(tiles, width, height, {
    cornerRadius: 0.32,
    cornerSegments: 3,
  }).find((candidate) => candidate.terrain === "path")!;
  return { width, height, tiles, component };
}

describe("path material cross-section", () => {
  it("is deterministic, pair-owned, and leaves authoritative cells unchanged", () => {
    const { width, height, tiles, component } = fixture();
    const before = [...tiles];
    const first = buildPathMaterialCrossSection(component, tiles, width, height)!;
    const second = buildPathMaterialCrossSection(component, tiles, width, height)!;
    expect(second).toEqual(first);
    expect(tiles).toEqual(before);
    expect(first.strips.length).toBeGreaterThan(0);
    expect(first.strips.filter((strip) => strip.role === "shoulder")).toHaveLength(
      first.strips.filter((strip) => strip.role === "edge").length,
    );
    expect(first.ownedOutsideTerrains).toEqual(["rough"]);
    expect(pathOwnsBoundaryWith("rough")).toBe(true);
    expect(pathOwnsBoundaryWith("water")).toBe(false);
    expect(pathOwnsBoundaryWith("wetland")).toBe(false);
    expect(pathOwnsBoundaryWith("sand")).toBe(false);
  });

  it("classifies non-overlapping shoulder, edge, and core zones from boundary distance", () => {
    const { width, height, tiles, component } = fixture();
    const section = buildPathMaterialCrossSection(component, tiles, width, height)!;
    expect(classifyPathMaterialPoint(section, { x: 1.88, y: 2.5 }, tiles, width, height)).toBe("shoulder");
    expect(classifyPathMaterialPoint(section, { x: 2.08, y: 2.5 }, tiles, width, height)).toBe("edge");
    expect(classifyPathMaterialPoint(section, { x: 2.5, y: 2.5 }, tiles, width, height)).toBe("core");
    // Water owns this pair, so no path shoulder or edge is emitted into it.
    expect(classifyPathMaterialPoint(section, { x: 3.08, y: 2.5 }, tiles, width, height)).toBeNull();
  });

  it("bounds elbow joins and keeps world geometry independent of camera rotation", () => {
    const { width, height, tiles, component } = fixture();
    const section = buildPathMaterialCrossSection(component, tiles, width, height)!;
    const repeated = [0, 1, 2, 3].map(() => buildPathMaterialCrossSection(component, tiles, width, height));
    expect(repeated.every((candidate) => JSON.stringify(candidate) === JSON.stringify(section))).toBe(true);
    for (const strip of section.strips) {
      const limit = (strip.role === "shoulder" ? section.shoulderWidth : section.edgeWidth) * 1.46;
      const boundary = strip.role === "shoulder" ? strip.inner : strip.outer;
      const offset = strip.role === "shoulder" ? strip.outer : strip.inner;
      for (let index = 0; index < boundary.length; index++) {
        expect(Math.hypot(offset[index].x - boundary[index].x, offset[index].y - boundary[index].y))
          .toBeLessThanOrEqual(limit);
      }
    }
  });

  it("keeps the exact M19 component compositor below the 8 ms renderer budget", () => {
    const course = createParklandVisualReferenceCourse();
    const component = buildLandscapeComponents(course.tiles, course.width, course.height, {
      cornerRadius: 0.4,
      cornerSegments: 4,
    }).find((candidate) => candidate.terrain === "path")!;
    buildPathMaterialCrossSection(component, course.tiles, course.width, course.height);
    const startedAt = performance.now();
    for (let iteration = 0; iteration < 100; iteration++) {
      buildPathMaterialCrossSection(component, course.tiles, course.width, course.height);
    }
    expect((performance.now() - startedAt) / 100).toBeLessThan(8);
  });
});
