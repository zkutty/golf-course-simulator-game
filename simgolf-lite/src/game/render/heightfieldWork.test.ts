import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { Course, Terrain } from "../models/types";
import { createM27ReleaseReferenceCourse, createParklandVisualReferenceCourse } from "../testing/referenceCourse";
import { normalizeCourseLayouts } from "../models/courseLayouts";
import { buildVisualHeightfield } from "./landscapeGeometry";
import * as shared from "./sharedBoundaryContours";
import * as mesh from "./landscapeMeshGeometry";

function corpus(): Course[] {
  const courses: Course[] = [];
  for (const theme of ["parkland", "links", "desert"] as const) {
    courses.push(normalizeCourseLayouts(createM27ReleaseReferenceCourse(theme)));
    courses.push({ ...createParklandVisualReferenceCourse(), theme });
    for (const elevations of [[0, 2, 3, -0, 1, 4, 0, 2, 3], [NaN, Infinity, -Infinity, 0, 1, 2, 3, 4, 5]]) {
      const c: Course = { ...createParklandVisualReferenceCourse(), theme, width: 3, height: 3,
        tiles: ["water", "rough", "wetland", "water", "rough", "wetland", "rough", "water", "rough"] as Terrain[],
        elevations: [...elevations], buildings: [{ id: "p", type: "pro_shop" as const, x: 1, y: 1, tier: 1 }] };
      c.property = { ...c.property!, assets: [
        { id: "pad", enabled: true, x: -1, y: 0, width: 2, height: 2 },
        { id: "off", enabled: false, x: 0, y: 0, width: 3, height: 3 },
      ] as NonNullable<Course["property"]>["assets"] };
      courses.push(c);
    }
    courses.push({ ...createParklandVisualReferenceCourse(), theme, width: 0, height: 0, tiles: [], elevations: [] });
  }
  return courses;
}
function digest(value: unknown): string {
  const encoded = JSON.stringify(value, (_key, v: unknown) => {
    if (typeof v === "number") {
      if (Number.isNaN(v)) return "NaN";
      const b = Buffer.alloc(8); b.writeDoubleBE(v); return b.toString("hex");
    }
    if (ArrayBuffer.isView(v)) return Array.from(v as unknown as ArrayLike<number>);
    return v;
  });
  return createHash("sha256").update(encoded).digest("hex");
}
// TESTS
 describe("heightfield topology-only work", () => {
  it("preserves the untouched a3 ordered IEEE heightfields", () => {
    const original = corpus().map(c => buildVisualHeightfield(c));
    expect(digest(original)).toBe("7476ca25a05645c0c50d4375c853f38cd48c69df32de5e563fcda62e6f889400");
    const reduced = corpus().map(c => buildVisualHeightfield(c, undefined, "topology-only"));
    expect(digest(reduced)).toBe(digest(original));
  });
  it("skips shared contour construction rather than computing discarded rings", () => {
    const spy = vi.spyOn(shared, "buildSharedBoundaryContours");
    const materializeSpy = vi.spyOn(mesh, "buildLandscapeMeshCellSet");
    try {
      const c = normalizeCourseLayouts(createM27ReleaseReferenceCourse());
      const full = buildVisualHeightfield(c);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(materializeSpy).toHaveBeenCalledTimes(144);
      spy.mockClear(); materializeSpy.mockClear();
      expect(digest(buildVisualHeightfield(c, undefined, "topology-only"))).toBe(digest(full));
      expect(spy).not.toHaveBeenCalled();
      expect(materializeSpy).not.toHaveBeenCalled();
    } finally { spy.mockRestore(); materializeSpy.mockRestore(); }
  });
  it("recomputes in-place tile, elevation, building and asset mutations", () => {
    const c = corpus()[2];
    const compare = () => expect(digest(buildVisualHeightfield(c, undefined, "topology-only"))).toBe(digest(buildVisualHeightfield(c)));
    compare(); c.tiles[1] = "water"; compare(); c.elevations[0] = 9; compare();
    c.buildings[0].x = 0; compare(); c.property!.assets[0].enabled = false; compare();
  });
  it("retains default malformed getter exceptions and reads", () => {
    const c = corpus()[2]; let reads = 0;
    Object.defineProperty(c, "width", { get() { reads++; if (reads === 3) throw new Error("third width read"); return 3; } });
    expect(() => buildVisualHeightfield(c)).toThrow("third width read");
    expect(reads).toBe(3);
  });
 });
