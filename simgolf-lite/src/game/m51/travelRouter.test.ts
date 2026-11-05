import { describe, expect, it } from "vitest";
import type { Course, Point, Terrain } from "../models/types";
import { DEFAULT_COURSE } from "../models/defaults";
import { findWalkPath, walkPathAuthority } from "../live/walkPath";
import { authoredPathFixture } from "../testing/continuousPathFixtures";
import { buildContinuousPathPlan, classifyContinuousPathPoint } from "../paths/continuousPathPlan";
import {
  createMobilityPresentationCanStep,
  MOBILITY_MODE_PROFILES,
  TimedMobilityLegCache,
  mobilityGeometryVersion,
  planTimedMobilityLeg,
  predictMobilityTravel,
} from "./travelRouter";

function course(width = 12, height = 8): Course {
  return {
    ...DEFAULT_COURSE,
    width, height,
    tiles: new Array(width * height).fill("fairway" as Terrain),
    elevations: new Array(width * height).fill(0),
    holes: [], obstacles: [], buildings: [], decorations: [],
  };
}

function request(courseValue: Course, mode: "walk" | "pushcart" | "riding_cart", from = { x: 1, y: 3 }, to = { x: 10, y: 3 }) {
  return { course: courseValue, courseId: "course-primary", layoutId: "course-primary", mode, from, to } as const;
}

describe("M51 deterministic weighted travel router", () => {
  it("preserves walking route parity while retaining unsimplified timed evidence", () => {
    const fixture = course();
    fixture.tiles[3 * fixture.width + 5] = "water";
    const input = request(fixture, "walk");
    const leg = planTimedMobilityLeg(input);
    expect(leg?.waypoints).toEqual(findWalkPath(fixture, input.from, input.to));
    expect(leg?.cells.length).toBeGreaterThan(leg?.waypoints.length ?? 0);
    expect(leg?.resolvedMode).toBe("walk");
  });

  it("weights pushcarts and riding carts differently, preferring authored path for riding carts", () => {
    const fixture = course();
    for (let x = 1; x <= 10; x++) fixture.tiles[1 * fixture.width + x] = "path";
    const from = { x: 1, y: 3 }; const to = { x: 10, y: 3 };
    const pushcart = planTimedMobilityLeg(request(fixture, "pushcart", from, to))!;
    const riding = planTimedMobilityLeg(request(fixture, "riding_cart", from, to))!;
    expect(riding.cells.some((point) => point.y === 1)).toBe(true);
    expect(riding.minutes).toBeLessThan(pushcart.minutes);
  });

  it("enforces wet/cart-path-only restrictions with a safe walking fallback", () => {
    const fixture = course();
    const riding = planTimedMobilityLeg({ ...request(fixture, "riding_cart"), conditions: { weather: "wet", restrictionId: "rain-a" } });
    expect(riding).toMatchObject({ requestedMode: "riding_cart", resolvedMode: "walk", fallback: "walk" });
    expect(planTimedMobilityLeg({ ...request(fixture, "riding_cart"), conditions: { weather: "wet" }, allowWalkFallback: false })).toBeNull();
  });

  it("keeps carts and pushcarts off protected surfaces and authored blockers", () => {
    const fixture = course(12, 8);
    fixture.tiles[3 * fixture.width + 10] = "green";
    fixture.tiles[2 * fixture.width + 7] = "sand";
    fixture.buildings = [{ id: "shop", type: "pro_shop", x: 5, y: 4, tier: 1, price: 10 }];
    fixture.decorations = [{ kind: "fence", x: 4, y: 2, rotation: 0, span: 3 }];
    expect(planTimedMobilityLeg(request(fixture, "riding_cart", { x: 1, y: 3 }, { x: 10, y: 3 })))
      .toMatchObject({ resolvedMode: "walk", fallback: "walk" });
    expect(planTimedMobilityLeg({ ...request(fixture, "pushcart", { x: 1, y: 2 }, { x: 7, y: 2 }), allowWalkFallback: false })).toBeNull();
  });

  it("uses bridge/boardwalk authority, diagonal corner safety, and cart slope limits", () => {
    const fixture = course(9, 5);
    for (let y = 0; y < fixture.height; y++) fixture.tiles[y * fixture.width + 4] = "water";
    fixture.decorations = [{ kind: "bridge", x: 3, y: 2, rotation: 0, span: 1 }];
    fixture.elevations[2 * fixture.width + 5] = 3;
    const walking = planTimedMobilityLeg(request(fixture, "walk", { x: 1, y: 2 }, { x: 7, y: 2 }))!;
    const cart = planTimedMobilityLeg({ ...request(fixture, "riding_cart", { x: 1, y: 2 }, { x: 7, y: 2 }), allowWalkFallback: false });
    expect(walking.cells).toContainEqual({ x: 4, y: 2 });
    expect(cart).toBeNull();
  });

  it("returns null when neither cart nor walking authority has a route", () => {
    const fixture = course(7, 5);
    for (let y = 0; y < fixture.height; y++) fixture.tiles[y * fixture.width + 3] = "water";
    expect(planTimedMobilityLeg(request(fixture, "pushcart", { x: 1, y: 2 }, { x: 5, y: 2 }))).toBeNull();
  });

  it("keys cache by mode, geometry, weather/restriction identity and supports read-only prediction", () => {
    const fixture = course(); const cache = new TimedMobilityLegCache();
    const input = request(fixture, "riding_cart");
    const first = planTimedMobilityLeg(input, cache)!;
    const second = planTimedMobilityLeg(input, cache)!;
    expect(second).toEqual(first);
    expect(cache.size).toBe(1);
    expect(predictMobilityTravel(input)).toEqual(first);
    const before = mobilityGeometryVersion(fixture);
    fixture.tiles[fixture.width + 4] = "path";
    expect(mobilityGeometryVersion(fixture)).not.toBe(before);
    planTimedMobilityLeg(input, cache);
    planTimedMobilityLeg({ ...input, conditions: { weather: "wet", restrictionId: "rain-b" } }, cache);
    expect(cache.size).toBe(3);
  });

  it("bounds 36-hole/100-golfer planning through deterministic timed-leg reuse", () => {
    const fixture = course(72, 36); const cache = new TimedMobilityLegCache();
    const legs = Array.from({ length: 36 }, (_, index) => ({ from: { x: 1, y: index }, to: { x: 70, y: index } }));
    for (let golfer = 0; golfer < 100; golfer++) for (const leg of legs) {
      expect(planTimedMobilityLeg({ ...request(fixture, "riding_cart", leg.from, leg.to), geometryVersion: "fixture-v1" }, cache)).not.toBeNull();
    }
    expect(cache.size).toBe(36);
  });
});


describe("continuous path travel authority", () => {
  it.each(["walk", "pushcart", "riding_cart"] as const)("changes %s presentation without changing cell evidence or economics", mode => {
    const saved = authoredPathFixture([{ x: 2.5, y: 4.25 }, { x: 12.5, y: 4.25 }], 1);
    const active = { ...course(16, 16), ...saved };
    const input = request(active, mode, { x: 2, y: 4 }, { x: 12, y: 4 });
    const baseline = planTimedMobilityLeg({ ...input, course: { ...active, surfaceIntent: undefined } })!;
    const leg = planTimedMobilityLeg(input)!;
    expect(leg.pathAlignment?.alignedRuns).toBe(1); expect(leg.waypoints.some(point => point.y === 3.75)).toBe(true);
    for (const key of ["cells", "cost", "minutes", "expansions", "fallback", "resolvedMode", "requestedMode"] as const) expect(leg[key]).toEqual(baseline[key]);
    expect(leg.waypoints.at(-1)).toEqual(input.to);
  });

  it("invalidates geometry edits even with a caller-supplied unchanged version and clones alignment evidence", () => {
    const active = { ...course(16, 16), ...authoredPathFixture([{ x: 2.5, y: 4.25 }, { x: 12.5, y: 4.25 }], 1) };
    const cache = new TimedMobilityLegCache(); const input = { ...request(active, "walk", { x: 2, y: 4 }, { x: 12, y: 4 }), geometryVersion: "trusted-terrain" };
    const first = planTimedMobilityLeg(input, cache)!; const feature = active.surfaceIntent!.features[0];
    if (feature.geometry.kind !== "corridor") throw new Error("fixture");
    feature.geometry.width = 1.5; const second = planTimedMobilityLeg(input, cache)!;
    expect(second.cacheKey).not.toBe(first.cacheKey); expect(second.cells).toEqual(first.cells); expect(second.minutes).toBe(first.minutes);
    feature.geometry.tangents = feature.geometry.knots.map(point => ({ in: { ...point }, out: { ...point } }));
    const third = planTimedMobilityLeg(input, cache)!; expect(third.cacheKey).not.toBe(second.cacheKey); expect(cache.size).toBe(3);
    third.waypoints[0].x = -100; third.pathAlignment!.reasons.push("external"); third.pathAlignment!.presentationClearanceCells.push(-1);
    const hit = planTimedMobilityLeg(input, cache)!; expect(hit.waypoints[0].x).not.toBe(-100); expect(hit.pathAlignment!.reasons).not.toContain("external"); expect(hit.pathAlignment!.presentationClearanceCells).not.toContain(-1);
  });

  it("retains no-version invalidation after in-place terrain mutations", () => {
    const active = course(); const cache = new TimedMobilityLegCache(); const input = request(active, "walk");
    const first = planTimedMobilityLeg(input, cache)!;
    active.tiles[3 * active.width + 5] = "water";
    const changed = planTimedMobilityLeg(input, cache)!;
    expect(changed.cacheKey).not.toBe(first.cacheKey); expect(changed.cells).not.toEqual(first.cells);
    expect(changed.cells).not.toContainEqual({ x: 5, y: 3 });
  });
});


// Partition each segment at every final triangle boundary. Membership is
// constant on each open partition, so these checks prove complete containment.
function assertFootprint(active: Course, legacyPoints: readonly Point[]) {
  const plan = buildContinuousPathPlan(active);
  for (let n = 1; n < legacyPoints.length; n++) {
    const a = { x: legacyPoints[n - 1].x + .5, y: legacyPoints[n - 1].y + .5 };
    const b = { x: legacyPoints[n].x + .5, y: legacyPoints[n].y + .5 };
    const dx = b.x - a.x, dy = b.y - a.y, cuts = [0, 1];
    for (const layer of plan.layers) for (let i = 0; i < layer.indices.length; i += 3) {
      const triangle = layer.indices.slice(i, i + 3);
      for (let e = 0; e < 3; e++) {
        const u = triangle[e] * 2, v = triangle[(e + 1) % 3] * 2, p = layer.positions;
        const ex = p[v] - p[u], ey = p[v + 1] - p[u + 1], denominator = dx * ey - dy * ex;
        if (Math.abs(denominator) < 1e-12) continue;
        const t = ((p[u] - a.x) * ey - (p[u + 1] - a.y) * ex) / denominator;
        const q = ((p[u] - a.x) * dy - (p[u + 1] - a.y) * dx) / denominator;
        if (t > 0 && t < 1 && q >= -1e-9 && q <= 1 + 1e-9) cuts.push(t);
      }
    }
    cuts.sort((x, y) => x - y);
    for (let i = 1; i < cuts.length; i++) {
      const t = (cuts[i - 1] + cuts[i]) / 2;
      expect(classifyContinuousPathPoint(plan, { x: a.x + dx * t, y: a.y + dy * t }), JSON.stringify({ a, b, t })).not.toBeNull();
    }
  }
}

describe("actual route selection on the shared saved S", () => {
  it.each(["walk", "pushcart", "riding_cart"] as const)("aligns %s after its own authoritative search", mode => {
    const active = { ...course(16, 16), ...authoredPathFixture() };
    // This path is the only traversable corridor. Authority must still choose
    // its own full cells; the test does not hand the adapter G's coverage.
    active.tiles = active.tiles.map(terrain => terrain === "path" ? terrain : "water");
    const leg = planTimedMobilityLeg({ ...request(active, mode, { x: 2, y: 3 }, { x: 13, y: 5 }), allowWalkFallback: false });
    expect(leg).not.toBeNull();
    const allowed = new Set(leg!.cells.map(point => point.y * active.width + point.x));
    const additions: number[] = [];
    for (let i = 1; i < leg!.cells.length; i++) {
      const a = leg!.cells[i - 1], b = leg!.cells[i];
      if (a.x === b.x || a.y === b.y) continue;
      for (const cell of [a.y * active.width + b.x, b.y * active.width + a.x]) if (active.tiles[cell] === "path") { if (!allowed.has(cell)) additions.push(cell); allowed.add(cell); }
    }
    const plan = buildContinuousPathPlan(active);
    const missing = [...new Set(plan.edges.flatMap(edge => edge.points.map(point => Math.floor(point.y + 1e-9) * active.width + Math.floor(point.x + 1e-9))).filter(cell => !allowed.has(cell)))];
    expect(leg!.pathAlignment, JSON.stringify({ mode, alignment: leg!.pathAlignment, route: leg!.cells, additions, missing: missing.map(cell => [cell % active.width, Math.floor(cell / active.width)]) })).toMatchObject({ alignedRuns: 1, fallbackRuns: 0 });
    const baseline = planTimedMobilityLeg({ ...request({ ...active, surfaceIntent: undefined }, mode, { x: 2, y: 3 }, { x: 13, y: 5 }), allowWalkFallback: false })!;
    for (const key of ["cells", "cost", "minutes", "expansions", "requestedMode", "resolvedMode", "fallback"] as const) expect(leg![key]).toEqual(baseline[key]);
    const points = [{ x: 2, y: 3 }, ...leg!.waypoints];
    expect(points.at(-1)).toEqual({ x: 13, y: 5 });
    // The endpoints are already on G: there are no off-mesh connectors here.
    assertFootprint(active, points);
    for (const sample of plan.edges.flatMap(edge => edge.points)) {
      expect(points.slice(1).some((b, i) => {
        const a = points[i], dx = b.x - a.x, dy = b.y - a.y;
        const t = Math.max(0, Math.min(1, ((sample.x - .5 - a.x) * dx + (sample.y - .5 - a.y) * dy) / (dx * dx + dy * dy || 1)));
        return Math.hypot(a.x + dx * t + .5 - sample.x, a.y + dy * t + .5 - sample.y) < 1e-7;
      }), JSON.stringify(sample)).toBe(true);
    }
    const expectedAdded = [...Array.from({ length: 5 }, (_, i) => 2 * 16 + 3 + i), ...Array.from({ length: 5 }, (_, i) => 6 * 16 + 8 + i)];
    expect(leg!.pathAlignment!.presentationClearanceCells).toEqual(expect.arrayContaining(expectedAdded));
    for (const cell of leg!.pathAlignment!.presentationClearanceCells) {
      expect(active.tiles[cell]).toBe("path");
      expect(leg!.cells.some(p => Math.abs(p.x - cell % 16) + Math.abs(p.y - Math.floor(cell / 16)) === 1)).toBe(true);
    }
  });
});


describe("M2 presentation retains existing mode authority", () => {
  function saved() {
    const active = { ...course(16, 16), ...authoredPathFixture() };
    active.tiles = active.tiles.map(terrain => terrain === "path" ? terrain : "water");
    return active;
  }
  function compare(active: Course, mode: "walk" | "pushcart" | "riding_cart", conditions?: { weather?: "wet"; cartPathOnly?: boolean }) {
    const input = { ...request(active, mode, { x: 2, y: 3 }, { x: 13, y: 5 }), conditions, allowWalkFallback: false };
    const leg = planTimedMobilityLeg(input), baseline = planTimedMobilityLeg({ ...input, course: { ...active, surfaceIntent: undefined } });
    expect(leg).not.toBeNull(); expect(baseline).not.toBeNull();
    for (const key of ["cells", "cost", "minutes", "expansions", "requestedMode", "resolvedMode", "fallback"] as const) expect(leg![key]).toEqual(baseline![key]);
    return leg!;
  }
  it.each(["walk", "pushcart", "riding_cart"] as const)("keeps %s away from a fence on a newly permitted cell", mode => {
    const active = saved(); active.decorations = [{ kind: "fence", x: 4, y: 2, rotation: 0, span: 1 }];
    const leg = compare(active, mode);
    expect(leg.pathAlignment).toMatchObject({ alignedRuns: 0, fallbackRuns: 1 });
    expect(leg.pathAlignment!.presentationClearanceCells).toEqual([]);
  });
  it.each(["pushcart", "riding_cart"] as const)("retains %s route evidence when the authored curve has a steep added cell", mode => {
    const active = saved(); active.elevations[2 * 16 + 4] = 4;
    const leg = compare(active, mode);
    expect(leg.pathAlignment).toMatchObject({ alignedRuns: 0, fallbackRuns: 1 });
    expect(leg.cells).not.toContainEqual({ x: 4, y: 2 });
  });
  it.each(["water", "wetland", "green", "sand"] as const)("does not borrow a formerly PATH cell now %s", terrain => {
    const active = saved(); active.tiles[2 * 16 + 4] = terrain;
    const leg = compare(active, "riding_cart");
    expect(leg.pathAlignment).toMatchObject({ alignedRuns: 0, fallbackRuns: 1 });
    expect(leg.pathAlignment!.presentationClearanceCells).not.toContain(2 * 16 + 4);
  });
  it.each(["walk", "pushcart", "riding_cart"] as const)("preserves wet/path-only %s restrictions and reversed alignment", mode => {
    const active = saved(); const leg = compare(active, mode, { weather: "wet", cartPathOnly: true });
    expect(leg.pathAlignment).toMatchObject({ alignedRuns: 1, fallbackRuns: 0 });
    const reverseInput = { ...request(active, mode, { x: 13, y: 5 }, { x: 2, y: 3 }), allowWalkFallback: false, conditions: { weather: "wet" as const, cartPathOnly: true } };
    const reverse = planTimedMobilityLeg(reverseInput)!, baseline = planTimedMobilityLeg({ ...reverseInput, course: { ...active, surfaceIntent: undefined } })!;
    expect(reverse.pathAlignment).toMatchObject({ alignedRuns: 1, fallbackRuns: 0 });
    for (const key of ["cells", "cost", "minutes", "expansions", "requestedMode", "resolvedMode", "fallback"] as const) expect(reverse[key]).toEqual(baseline[key]);
    assertFootprint(active, [reverseInput.from, ...reverse.waypoints]);
    const reversePoints = [reverseInput.from, ...reverse.waypoints];
    for (const sample of buildContinuousPathPlan(active).edges.flatMap(edge => edge.points)) {
      expect(reversePoints.slice(1).some((b, i) => {
        const a = reversePoints[i], dx = b.x - a.x, dy = b.y - a.y;
        const t = Math.max(0, Math.min(1, ((sample.x - .5 - a.x) * dx + (sample.y - .5 - a.y) * dy) / (dx * dx + dy * dy || 1)));
        return Math.hypot(a.x + dx * t + .5 - sample.x, a.y + dy * t + .5 - sample.y) < 1e-7;
      }), JSON.stringify({ mode, sample })).toBe(true);
    }
  });
  it("retains authored building and bridge/boardwalk authority without changing economic fallback", () => {
    for (const mode of ["walk", "pushcart", "riding_cart"] as const) {
      const active = saved();
      // A remote blocker preserves the actual S route; covered bridge cells
      // retain the authority's existing weather and equipment semantics.
      active.buildings = [{ id: "remote-shop", type: "pro_shop", x: 0, y: 10, tier: 1, price: 10 }];
      active.tiles[3 * 16 + 5] = "wetland";
      active.decorations = [{ kind: "bridge", x: 4, y: 3, rotation: 0, span: 1 }];
      const input = { ...request(active, mode, { x: 2, y: 3 }, { x: 13, y: 5 }), conditions: { weather: "wet" as const } };
      const leg = planTimedMobilityLeg(input), baseline = planTimedMobilityLeg({ ...input, course: { ...active, surfaceIntent: undefined } });
      expect(leg).not.toBeNull(); expect(baseline).not.toBeNull();
      for (const key of ["cells", "cost", "minutes", "expansions", "requestedMode", "resolvedMode", "fallback"] as const) expect(leg![key]).toEqual(baseline![key]);
    }
  });
});


describe("M3 building directly on presentation clearance", () => {
  it.each(["walk", "pushcart", "riding_cart"] as const)("retains legal %s search and exact economics around an added-cell building", mode => {
    const active = { ...course(16, 16), ...authoredPathFixture() };
    active.tiles = active.tiles.map(tile => tile === "path" ? tile : "water");
    // This 2x2 footprint includes required added cells (4,2)/(5,2), while the
    // authoritative row3 route remains outside the building.
    active.buildings = [{ id: "added-cell-shop", type: "pro_shop", x: 4, y: 1, tier: 1, price: 10 }];
    const input = { ...request(active, mode, { x: 2, y: 3 }, { x: 13, y: 5 }), allowWalkFallback: false };
    const leg = planTimedMobilityLeg(input)!, baseline = planTimedMobilityLeg({ ...input, course: { ...active, surfaceIntent: undefined } })!;
    expect(leg).not.toBeNull(); expect(baseline).not.toBeNull();
    for (const key of ["cells", "cost", "minutes", "expansions", "requestedMode", "resolvedMode", "fallback"] as const) expect(leg[key]).toEqual(baseline[key]);
    expect(leg.cells).not.toContainEqual({ x: 4, y: 2 });
    expect(leg.pathAlignment).toMatchObject({ alignedRuns: 0, fallbackRuns: 1, presentationClearanceCells: [] });
  });
});


describe("M4 shared presentation predicate parity", () => {
  it("keeps the pre-extraction terrain/weather/bridge/boardwalk/slope/diagonal decisions and walk delegation", () => {
    const active = course(9, 7); active.tiles.fill("path");
    active.tiles[2 * 9 + 3] = "water"; active.tiles[2 * 9 + 4] = "wetland";
    active.tiles[3 * 9 + 4] = "green"; active.tiles[3 * 9 + 5] = "sand"; active.tiles[4 * 9 + 4] = "tee";
    active.decorations = [{ kind: "bridge", x: 2, y: 2, rotation: 0, span: 2 }, { kind: "fence", x: 6, y: 4, rotation: 0, span: 1 }];
    active.buildings = [{ id: "block", type: "pro_shop", x: 0, y: 4, tier: 1, price: 10 }];
    active.elevations[3 * 9 + 6] = 3;
    for (const conditions of [{ weather: "dry" as const }, { weather: "wet" as const }, { cartPathOnly: true }, { weather: "cart_path_only" as const }]) {
      expect(createMobilityPresentationCanStep({ course: active, conditions }, "walk")).toBeUndefined();
      for (const mode of ["pushcart", "riding_cart"] as const) {
        const profile = MOBILITY_MODE_PROFILES[mode], authority = walkPathAuthority(active);
        // Frozen old destination/diagonal-side predicate, independent of the
        // newly extracted factory. No search or profile values are mocked.
        const pass = (x: number, y: number, from: Point) => {
          if (!authority.isWalkable(x, y)) return false;
          const cell = y * 9 + x, terrain = active.tiles[cell], bridge = authority.bridges.has(cell);
          if (["green", "tee", "sand"].includes(terrain) || terrain === "water" && !bridge || terrain === "wetland" && (!bridge || !profile.permitsBoardwalk)) return false;
          if ((conditions.cartPathOnly || conditions.weather === "wet" || conditions.weather === "cart_path_only") && terrain !== "path" && !bridge) return false;
          return Math.abs(active.elevations[cell] - active.elevations[from.y * 9 + from.x]) <= profile.maxSlope;
        };
        const current = createMobilityPresentationCanStep({ course: active, conditions }, mode)!;
        for (let y = 0; y < active.height; y++) for (let x = 0; x < active.width; x++) for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1]]) {
          const from = { x, y }, to = { x: x + dx, y: y + dy };
          const old = pass(to.x, to.y, from) && (!(dx && dy) || pass(to.x, from.y, from) && pass(from.x, to.y, from));
          expect(current(from, to), JSON.stringify({ mode, conditions, from, to })).toBe(old);
        }
      }
    }
  });
  it("does not retain predicates/authority/traces in cached legs and preserves copied cache evidence", () => {
    const active = course(), cache = new TimedMobilityLegCache(), input = request(active, "riding_cart");
    const first = planTimedMobilityLeg(input, cache)!;
    const plain = JSON.parse(JSON.stringify(first));
    expect(Object.values(first).some(value => typeof value === "function")).toBe(false);
    expect(Object.keys(first)).not.toContain("canStep"); expect(Object.keys(first)).not.toContain("trace");
    first.cells[0].x = -999; first.waypoints[0].y = -999;
    expect(planTimedMobilityLeg(input, cache)).toEqual(plain);
    expect(createMobilityPresentationCanStep({ course: active }, "riding_cart")).not.toBe(createMobilityPresentationCanStep({ course: active }, "riding_cart"));
  });
});
