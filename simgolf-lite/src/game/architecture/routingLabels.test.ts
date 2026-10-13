import { describe, expect, it } from "vitest";
import { buildArchitectureRouting, placeRoutingLabels, routeMidpoint } from "./routingLabels";
import { routingLabelFixture } from "./routingLabelFixtures";
import { buildArchitectureReview, defaultArchitectureFilters } from "./review";
import { DEFAULT_WORLD } from "../models/defaults";
import { courseGeometryVersion } from "../livingClub/livingClub";
import { hashCanonicalValue } from "../../utils/canonical";
import { CURRENT_SAVE_SCHEMA_VERSION, parseSaveText, payloadForPersistence } from "../../utils/save";
import { buildM62FullEstateCourse } from "../testing/m62Certification";

function filters(course = routingLabelFixture()) { return { ...defaultArchitectureFilters(course), kind: "routing" as const, teeSet: "all" as const, pinRotation: "all" as const }; }
describe("ZK-676 truthful routing identity", () => {
  it.each(["four", "compact", "overlapping", "crossing", "spread", "nine", "eighteen", "multi"] as const)("keeps exact published/draft order for %s despite reversed physical arrays and selection", kind => {
    const course = routingLabelFixture(kind), f = filters(course);
    for (const layout of course.layouts!) for (const order of ["published", "draft"] as const) {
      const expected = order === "draft" ? layout.draftHoleIds : layout.publishedHoleIds;
      const projected = buildArchitectureRouting(course, { ...f, courseId: layout.id, routingOrder: order });
      expect(projected.map(hole => hole.holeId)).toEqual(expected);
      expect(projected.map(hole => hole.number)).toEqual(expected.map((_, i) => i + 1));
      expect(projected.every(hole => hole.status === "complete")).toBe(true);
      expect(projected.every(hole => hole.pinRotation === "B")).toBe(true);
    }
  });
  it("defaults to the active pin and resolves draft-only hole details in the review", () => {
    const course = routingLabelFixture("nine");
    expect(defaultArchitectureFilters(course).pinRotation).toBe("B");
    course.layouts = course.layouts!.map(layout => ({ ...layout, publishedHoleIds: layout.publishedHoleIds.slice(0, 4) }));
    const review = buildArchitectureReview(course, DEFAULT_WORLD, { ...filters(course), routingOrder: "draft", holeId: "routing-9" });
    expect(review.selectedStrategicHole?.holeId).toBe("routing-9");
    expect(review.overlay.routing).toHaveLength(9);
    const other = buildArchitectureReview(course, DEFAULT_WORLD, { ...filters(course), holeId: "unrelated-estate-hole" });
    expect(other.overlay.selectedRoutingHoleId).toBe("all");
  });
  it("uses resolved alternate endpoints and reports missing endpoints without a complete connector", () => {
    const course = routingLabelFixture("incomplete"), f = filters(course);
    const routes = buildArchitectureRouting(course, { ...f, teeSet: "championship", pinRotation: "C" });
    expect(routes.map(hole => hole.status)).toEqual(["complete", "missing-tee", "missing-green", "missing-both"]);
    expect(routes[0].tee).toEqual({ x: 4, y: 7 });
    expect(routes[0].pin).toEqual({ x: 17, y: 6 });
    expect(routes.slice(1).every(hole => hole.spine.length === 0)).toBe(true);
    expect(routes[1].pin).toEqual({ x: 35, y: 6 });
  });
  it("identifies actual fallback setup instead of claiming an unavailable alternate", () => {
    const course = routingLabelFixture(); course.holes = course.holes.map(hole => ({ ...hole, teeBoxes: { member: hole.tee! }, pinPositions: { A: hole.green! } }));
    expect(buildArchitectureRouting(course, { ...filters(course), teeSet: "forward", pinRotation: "C" })[0]).toMatchObject({ teeSet: "member", pinRotation: "A", usedTeeFallback: true, usedPinFallback: true });
  });
  it("measures the corridor midpoint by distance and moves number anchors off hazards", () => {
    expect(routeMidpoint([{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 8 }])).toEqual({ x: 2, y: 3 });
    const course = routingLabelFixture();
    const f = filters(course), before = buildArchitectureRouting(course, f)[0].anchor;
    course.tiles[before.y * course.width + before.x] = "water";
    const after = buildArchitectureRouting({ ...course }, f)[0].anchor;
    expect(after).not.toEqual(before);
    expect(course.tiles[after.y * course.width + after.x]).not.toBe("water");
  });
  it("packs colliding labels around the midpoint without entering UI or off-course space", () => {
    const requests = Array.from({ length: 18 }, (_, i) => ({ id: `${i}`, center: { x: 300, y: 260 }, width: 42, height: 40 }));
    const result = placeRoutingLabels(requests, { x: 0, y: 0, width: 900, height: 600 }, [{ x: 450, y: 0, width: 450, height: 600 }], p => p.x > 80 && p.y > 80);
    expect(result.every(item => item.fits)).toBe(true);
    for (const item of result) expect(item.placed.x + item.width / 2).toBeLessThan(450);
    for (const [i, a] of result.entries()) for (const b of result.slice(i + 1)) expect(Math.abs(a.placed.x - b.placed.x) >= (a.width + b.width) / 2 + 3 || Math.abs(a.placed.y - b.placed.y) >= (a.height + b.height) / 2 + 3).toBe(true);
    expect(placeRoutingLabels(requests, { x: 0, y: 0, width: 900, height: 600 }, [{ x: 450, y: 0, width: 450, height: 600 }], p => p.x > 80 && p.y > 80)).toEqual(result);
  });
  it("escapes a large UI panel even when an endpoint lies beyond the local search radius", () => {
    const result = placeRoutingLabels([{ id: "green", center: { x: 900, y: 300 }, width: 40, height: 36 }], { x: 0, y: 0, width: 1200, height: 800 }, [{ x: 500, y: 0, width: 650, height: 800 }]);
    expect(result[0].fits).toBe(true);
    expect(result[0].placed.x + 20).toBeLessThan(500);
  });
  it("keeps all holes visible after selection and changes no geometry, par, gameplay state, or source arrays", () => {
    const course = routingLabelFixture("eighteen"), before = hashCanonicalValue(course), geometry = courseGeometryVersion(course);
    const f = { ...filters(course), holeId: "routing-14" };
    const review = buildArchitectureReview(course, DEFAULT_WORLD, f);
    expect(review.overlay.routing).toHaveLength(18);
    expect(review.overlay.selectedRoutingHoleId).toBe("routing-14");
    expect(review.overlay.traces).toEqual([]);
    expect(review.overlay.points).toEqual([]);
    expect(courseGeometryVersion(course)).toBe(geometry);
    expect(hashCanonicalValue(course)).toBe(before);
  });
  it("preserves exact layout routing and alternate endpoints through the real save/load normalizer", () => {
    const course = routingLabelFixture("multi"), f = { ...filters(course), courseId: "layout-2", routingOrder: "draft" as const, teeSet: "forward" as const, pinRotation: "C" as const };
    for (const hole of course.holes) for (const pin of Object.values(hole.pinPositions ?? {})) if (pin) course.tiles[pin.y * course.width + pin.x] = "green";
    const payload = { schemaVersion: CURRENT_SAVE_SCHEMA_VERSION, savedAt: 123, ...payloadForPersistence({ course, world: DEFAULT_WORLD, history: [] }) };
    const loaded = parseSaveText(JSON.stringify(payload));
    expect(loaded.ok, JSON.stringify(loaded)).toBe(true);
    if (!loaded.ok) throw new Error(JSON.stringify(loaded));
    expect(buildArchitectureRouting(loaded.payload.course, f)).toEqual(buildArchitectureRouting(course, f));
  });
  it("bounds release-estate routing work within the existing 750ms interaction budget", () => {
    const course = buildM62FullEstateCourse(), f = filters(course);
    const start = performance.now();
    for (let i = 0; i < 36; i++) {
      const routes = buildArchitectureRouting(course, f);
      expect(routes.length).toBeLessThanOrEqual(36);
      expect(routes.every(route => route.spine.length <= 34)).toBe(true);
    }
    const elapsedMs = performance.now() - start;
    console.info("ZK-676 release-estate routing x36", { elapsedMs });
    expect(elapsedMs).toBeLessThan(750);
  });
});
