import { describe, expect, it, vi } from "vitest";
import { buildArchitectureRouting, placeRoutingLabels, routeMidpoint } from "./routingLabels";
import type { RoutingLabelPlacement, RoutingLabelRect, RoutingLabelRequest } from "./routingLabels";
import type { Point } from "../models/types";
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

// Frozen reference from routingLabels.ts SHA256 ac8b16eaceddfddb931c269eae68bdf30ffc97e2fad61f7d31132b00c07fa291.
function referencePlaceRoutingLabels(requests: readonly RoutingLabelRequest[], viewport: RoutingLabelRect, reserved: readonly RoutingLabelRect[], legal: (p: Point) => boolean = () => true): RoutingLabelPlacement[] {
  const occupied = [...reserved];
  const overlaps = (a: RoutingLabelRect, b: RoutingLabelRect) => a.x < b.x + b.width + 3 && a.x + a.width + 3 > b.x && a.y < b.y + b.height + 3 && a.y + a.height + 3 > b.y;
  return requests.map(request => {
    let placed = request.center;
    let fits = false;
    const accept = (p: Point) => {
      const box = { x: p.x - request.width / 2, y: p.y - request.height / 2, width: request.width, height: request.height };
      if (box.x < viewport.x + 5 || box.y < viewport.y + 5 || box.x + box.width > viewport.x + viewport.width - 5 || box.y + box.height > viewport.y + viewport.height - 5 || !legal(p) || occupied.some(other => overlaps(box, other))) return false;
      placed = p; fits = true; occupied.push(box); return true;
    };
    for (let ring = 0; ring <= 12 && !fits; ring++) {
      const count = ring === 0 ? 1 : 12;
      for (let index = 0; index < count; index++) {
        const angle = index * Math.PI * 2 / count;
        const p = { x: request.center.x + Math.cos(angle) * ring * 18, y: request.center.y + Math.sin(angle) * ring * 18 };
        if (accept(p)) break;
      }
    }
    // A large overlay panel can cover an endpoint farther than the local
    // midpoint search radius. Try its nearest edges without hiding a marker
    // underneath UI; leader lines still identify the true endpoint.
    for (const panel of reserved) {
      if (fits) break;
      const seeds = [
        { x: panel.x - request.width / 2 - 6, y: request.center.y },
        { x: panel.x + panel.width + request.width / 2 + 6, y: request.center.y },
        { x: request.center.x, y: panel.y - request.height / 2 - 6 },
        { x: request.center.x, y: panel.y + panel.height + request.height / 2 + 6 },
      ].sort((a, b) => Math.hypot(a.x - request.center.x, a.y - request.center.y) - Math.hypot(b.x - request.center.x, b.y - request.center.y));
      for (const seed of seeds) {
        if (fits) break;
        for (let offset = 0; offset <= 12 && !fits; offset++) for (const direction of offset === 0 ? [0] : [-1, 1]) {
          const vertical = seed.x !== request.center.x;
          if (accept({ x: seed.x + (vertical ? 0 : offset * 18 * direction), y: seed.y + (vertical ? offset * 18 * direction : 0) })) break;
        }
      }
    }
    return { ...request, placed, fits };
  });
}

type PackingFixture = {
  id: string;
  requests: RoutingLabelRequest[];
  viewport: RoutingLabelRect;
  reserved: RoutingLabelRect[];
  legal: "all" | "none" | "stateful";
};
type PackingFunction = typeof placeRoutingLabels;
function exactPackingValue(a: unknown, b: unknown): boolean {
  if (typeof a === "number" || typeof b === "number") return Object.is(a, b);
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return a === b;
  const left = Object.keys(a), right = Object.keys(b);
  return left.length === right.length && left.every((key, i) => key === right[i] && exactPackingValue((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
}
function freezePackingValue(value: object, seen = new Set<object>()) {
  if (seen.has(value)) return;
  seen.add(value);
  for (const child of Object.values(value)) if (child && typeof child === "object") freezePackingValue(child, seen);
  Object.freeze(value);
}
function observeRoutingPacking(fn: PackingFunction, fixture: PackingFixture) {
  const input = structuredClone(fixture), before = structuredClone(input);
  freezePackingValue(input);
  const points: Point[] = [], observations: { x: number; y: number; accepted: boolean }[] = [];
  const output = fn(input.requests, input.viewport, input.reserved, point => {
    points.push(point);
    const accepted = input.legal === "all" || (input.legal === "stateful" && points.length % 7 === 0);
    observations.push({ x: point.x, y: point.y, accepted });
    return accepted;
  });
  return {
    output, observations,
    identities: output.map((item, i) => ({
      newOutput: item !== input.requests[i],
      sameCenter: item.center === input.requests[i].center,
      centerAlias: input.requests.findIndex(request => request.center === item.center),
      placedIsCenter: item.placed === input.requests[i].center,
      placedObservation: points.indexOf(item.placed),
    })),
    freshLegalPoints: new Set(points).size === points.length,
    inputUnchanged: exactPackingValue(input, before),
  };
}
const packingRequest = (id: string, x: number, y: number, width = 42, height = 40): RoutingLabelRequest => ({ id, center: { x, y }, width, height });
const packingViewport = (width = 900, height = 600, x = 0, y = 0): RoutingLabelRect => ({ x, y, width, height });
const packingSharedCenter = { x: 310.25, y: 260.75 };
const packingFixtures: PackingFixture[] = [
  { id: "empty", requests: [], viewport: packingViewport(), reserved: [], legal: "all" },
  { id: "first-center", requests: [packingRequest("free", 300, 260)], viewport: packingViewport(), reserved: [], legal: "all" },
  { id: "viewport-edges", requests: [packingRequest("top-left", -0, -0), packingRequest("bottom-right", 899.5, 599.5), packingRequest("outside", -250, 300)], viewport: packingViewport(), reserved: [], legal: "all" },
  { id: "dense-centers", requests: Array.from({ length: 36 }, (_, i) => packingRequest(`dense-${i}`, 300, 260)), viewport: packingViewport(), reserved: [{ x: 450, y: 0, width: 450, height: 600 }], legal: "all" },
  { id: "panel-fallback", requests: [packingRequest("green", 900, 300, 40, 36)], viewport: packingViewport(1200, 800), reserved: [{ x: 500, y: 0, width: 650, height: 800 }], legal: "all" },
  { id: "all-legal-false", requests: [packingRequest("reject-all", 500, 500)], viewport: packingViewport(2000, 2000), reserved: [], legal: "none" },
  { id: "fractional-signed-zero", requests: [packingRequest("minus-zero", -0, -0, 0, 0), packingRequest("plus-zero", +0, +0, 0, 0), packingRequest("fraction", 123.45678901234567, -98.76543210987654, 17.5, 9.25), packingRequest("boundary", -974.5, -974.5, 41, 41)], viewport: packingViewport(2000, 2000, -1000, -1000), reserved: [], legal: "all" },
  { id: "stateful-ties-panels", requests: Array.from({ length: 4 }, (_, i) => ({ id: `tie-${i}`, center: packingSharedCenter, width: 51, height: 49 })), viewport: packingViewport(620.5, 521.5), reserved: [{ x: 250.25, y: 150.75, width: 119, height: 219 }, { x: 10.25, y: 10.75, width: 51, height: 51 }], legal: "stateful" },
];

describe("ZK-676 fixed ring offset operation reduction", () => {
  it.each(packingFixtures)("preserves exact packing behavior for $id", fixture => {
    const expected = observeRoutingPacking(referencePlaceRoutingLabels, fixture);
    const actual = observeRoutingPacking(placeRoutingLabels, fixture);
    expect(exactPackingValue(actual, expected)).toBe(true);
    expect(actual.freshLegalPoints).toBe(true);
    expect(actual.inputUnchanged).toBe(true);
    expect(actual.identities.every(item => item.newOutput && item.sameCenter)).toBe(true);
    for (const [i, output] of actual.output.entries()) {
      expect(actual.identities[i].placedIsCenter).toBe(!output.fits);
      if (output.fits) expect(actual.identities[i].placedObservation).toBeGreaterThanOrEqual(0);
    }
    if (fixture.id === "all-legal-false") expect(actual.observations).toHaveLength(145);
  });
  it("performs no steady-state trigonometry after the 145-offset module setup", () => {
    // The private table costs 145 sin + 145 cos calls at module initialization.
    // Empty/first-candidate calls do not imply a universal startup benefit.
    const sin = vi.spyOn(Math, "sin"), cos = vi.spyOn(Math, "cos");
    try {
      const fixture = packingFixtures[5];
      const result = placeRoutingLabels(fixture.requests, fixture.viewport, fixture.reserved, () => false);
      expect(result[0].fits).toBe(false);
      expect({ sin: sin.mock.calls.length, cos: cos.mock.calls.length }).toEqual({ sin: 0, cos: 0 });
    } finally { sin.mockRestore(); cos.mockRestore(); }
  });
});
