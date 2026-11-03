import { describe, expect, it } from "vitest";
import type { Course, Point } from "../models/types";
import { corridorFeature, rasterizeSurfaceFeatureDetailed } from "../models/surfaceIntent";
import { DEFAULT_COURSE } from "../models/defaults";
import { findWalkPath, findWalkPathCells, walkPathAuthority } from "../live/walkPath";
import { TimedItineraryBuilder } from "../m51/timedItinerary";
import { LIVE } from "../live/liveConfig";
import { authoredPathFixture, continuousPathFixture, type ContinuousPathFixture } from "../testing/continuousPathFixtures";
import { buildContinuousPathPlan, classifyContinuousPathPoint } from "./continuousPathPlan";
import { adaptPathMovementRoute, createPathWalkingRouter, pathMovementPlanKey, validatePathMovementPolyline, validatePathMovementSupport, type PathMovementSupportPiece } from "./pathMovementAdapter";

function course(input: ContinuousPathFixture): Course {
  return { ...DEFAULT_COURSE, ...input, elevations: new Array(input.width * input.height).fill(0), holes: [], obstacles: [], buildings: [], decorations: [] };
}
function cellsOn(points: readonly Point[]): Point[] {
  const cells: Point[] = [];
  for (const point of points) {
    const cell = { x: Math.floor(point.x + 1e-9), y: Math.floor(point.y + 1e-9) };
    if (!cells.length || cell.x !== cells.at(-1)!.x || cell.y !== cells.at(-1)!.y) cells.push(cell);
  }
  return cells;
}
function verifyRoute(active: Course, from: Point, waypoints: readonly Point[], allowed: readonly Point[]) {
  const authority = walkPathAuthority(active); const permitted = new Set(allowed.map(point => `${point.x},${point.y}`));
  let previous = from;
  for (const point of waypoints) {
    const count = Math.max(1, Math.ceil(Math.hypot(point.x - previous.x, point.y - previous.y) / .025));
    for (let i = 0; i <= count; i++) {
      const x = Math.round(previous.x + (point.x - previous.x) * i / count), y = Math.round(previous.y + (point.y - previous.y) * i / count);
      expect(authority.isWalkable(x, y)).toBe(true);
      expect(permitted.has(`${x},${y}`)).toBe(true);
    }
    previous = point;
  }
}

describe("continuous-path movement presentation", () => {
  it.each(["straight", "diagonal", "bend", "T", "cross", "loop"] as const)("uses the accepted %s graph without leaving the original route cells", kind => {
    const active = course(continuousPathFixture(kind)); const plan = buildContinuousPathPlan(active); const edge = plan.edges[0];
    // A legal preselected branch/loop arc; the adapter never searches terrain.
    const points = edge.closed ? edge.points.slice(0, Math.floor(edge.points.length * .7)) : edge.points;
    const cells = cellsOn(points); const from = { ...cells[0] }, to = { ...cells.at(-1)! };
    const before = JSON.stringify({ active, cells });
    const result = adaptPathMovementRoute({ course: active, cells, from, to, waypoints: cells.slice(1) });
    expect(result.alignedRuns).toBe(1); expect(result.fallbackRuns).toBe(0);
    expect(result.waypoints.at(-1)).toEqual(to);
    verifyRoute(active, from, result.waypoints, cells);
    expect(JSON.stringify({ active, cells })).toBe(before);
    expect(result.waypoints.some(point => classifyContinuousPathPoint(plan, { x: point.x + .5, y: point.y + .5 }) !== null)).toBe(true);
  });

  it("follows the saved S samples and converts world coordinates exactly once", () => {
    const active = course(authoredPathFixture()); const plan = buildContinuousPathPlan(active); const edge = plan.edges[0];
    const cells = cellsOn(edge.points); const from = cells[0], to = cells.at(-1)!;
    const result = adaptPathMovementRoute({ course: active, cells, from, to, waypoints: cells.slice(1) });
    expect(result.alignedRuns).toBe(1);
    for (const sample of edge.points.slice(1, -1)) {
      const points = [from, ...result.waypoints];
      expect(points.slice(1).some((point, index) => {
        const a = points[index], b = point; const dx = b.x - a.x, dy = b.y - a.y;
        const t = Math.max(0, Math.min(1, ((sample.x - .5 - a.x) * dx + (sample.y - .5 - a.y) * dy) / (dx * dx + dy * dy)));
        return Math.hypot(a.x + dx * t + .5 - sample.x, a.y + dy * t + .5 - sample.y) < 1e-6;
      })).toBe(true);
    }
    verifyRoute(active, from, result.waypoints, cells);
  });

  it("keeps disconnected corner coverage on the original legal route and explains the fallback", () => {
    const active = course(continuousPathFixture("corner")); const from = { x: 3, y: 3 }, to = { x: 4, y: 4 };
    const cells = findWalkPathCells(active, from, to)!, original = findWalkPath(active, from, to)!;
    const result = adaptPathMovementRoute({ course: active, cells, from, to, waypoints: original });
    expect(result.waypoints).toEqual(original); expect(result.alignedRuns).toBe(0); expect(result.fallbackRuns).toBe(1);
    expect(result.reasons).toEqual(["no-legal-centerline-match"]);
  });

  it("retains off-path destinations and the legal detour around overwritten cells/blockers", () => {
    const active = course(authoredPathFixture([{ x: 2.5, y: 4.25 }, { x: 12.5, y: 4.25 }], 1));
    active.tiles[4 * active.width + 7] = "water";
    const from = { x: 2, y: 4 }, to = { x: 13.2, y: 6.1 };
    const cells = findWalkPathCells(active, from, to)!, original = findWalkPath(active, from, to)!;
    const result = adaptPathMovementRoute({ course: active, cells, from, to, waypoints: original });
    if (result.alignedRuns) expect(result.waypoints.at(-1)).toEqual(to);
    verifyRoute(active, from, result.waypoints, cells);
    expect(active.tiles[Math.round(to.y) * active.width + Math.round(to.x)]).not.toBe("path");
  });

  it("does not substitute a different branch or leave the route to find a matching curve", () => {
    const active = course(continuousPathFixture("T")); const cells = [{ x: 3, y: 7 }, { x: 4, y: 7 }, { x: 5, y: 7 }, { x: 6, y: 7 }];
    const result = adaptPathMovementRoute({ course: active, from: cells[0], to: cells.at(-1)!, cells, waypoints: [cells.at(-1)!] });
    expect(result.alignedRuns).toBe(1); verifyRoute(active, cells[0], result.waypoints, cells);
    expect(result.waypoints.every(point => point.x <= 6)).toBe(true);
  });

  it("keeps no-path legacy routing/timing shape and clones cached routes", () => {
    const active = course(continuousPathFixture("empty")); const cache = new Map<string, Point[] | null>(); const route = createPathWalkingRouter(active, cache);
    const from = { x: 1, y: 2 }, to = { x: 10, y: 9 };
    const first = route(from, to) as Point[];
    expect(first).toEqual(findWalkPath(active, from, to)); first[0].x = -50;
    expect(route(from, to)).toEqual(findWalkPath(active, from, to)); expect(cache.size).toBe(1);
  });

  it("keeps rounded fractional collisions, null hits, and original clones authoritative without PATH", () => {
    const active = course(continuousPathFixture("empty")), cache = new Map<string, Point[] | null>();
    const route = createPathWalkingRouter(active, cache), from = { x: 3, y: 3 }, firstTo = { x: 3.1, y: 3.1 }, secondTo = { x: 3.2, y: 3.2 };
    const first = route(from, firstTo) as Point[];
    expect(first).toEqual([firstTo]); first[0].x = -100;
    expect(route(from, secondTo)).toEqual([firstTo]); expect([...cache.keys()]).toEqual(["3,3>3,3"]);
    const currentFrom = { x: 3.05, y: 3.05 };
    const builder = new TimedItineraryBuilder({ course: active, cursor: currentFrom,
      personality: { skill: .6, consistency: .6, patience: .5, spendPropensity: 1, prefs: { difficulty: 0, scenery: 0, price: 0 } }, rng: () => .5, route });
    builder.appendWalk(currentFrom, secondTo, 0);
    expect(builder.segments).toEqual([{ kind: "walk", from: currentFrom, to: firstTo, holeIndex: 0,
      dur: Math.hypot(firstTo.x - currentFrom.x, firstTo.y - currentFrom.y) * LIVE.pace.walkPerTile }]);
    // A seeded null must remain final authority even though a new search works.
    cache.set("3,3>5,5", null);
    expect(findWalkPath(active, from, { x: 5.1, y: 5.1 })).not.toBeNull();
    expect(route(from, { x: 5.1, y: 5.1 })).toBeNull(); expect(cache.get("3,3>5,5")).toBeNull();
  });

  it("keeps fractional PATH target mismatches on exact original arrays and timing", () => {
    const active = course(authoredPathFixture()), cache = new Map<string, Point[] | null>(), route = createPathWalkingRouter(active, cache);
    const from = { x: 2, y: 3 }, to = { x: 13.2, y: 5.2 }, original = findWalkPath(active, from, to)!;
    expect(original.at(-1)).toEqual({ x: 13, y: 5 });
    expect(route(from, to)).toEqual(original); expect(Array.isArray(route(from, to))).toBe(true);
    expect(route(from, { x: 13.1, y: 5.1 })).toEqual(original);
    expect(cache.get("2,3>13,5")).toEqual(original); expect(cache.size).toBe(1);
    const builder = new TimedItineraryBuilder({ course: active, cursor: from,
      personality: { skill: .6, consistency: .6, patience: .5, spendPropensity: 1, prefs: { difficulty: 0, scenery: 0, price: 0 } }, rng: () => .5, route });
    builder.appendWalk(from, to, 0);
    let cursor = from;
    expect(builder.segments).toEqual(original.map(point => {
      const segment = { kind: "walk", from: cursor, to: point, holeIndex: 0, dur: Math.hypot(point.x - cursor.x, point.y - cursor.y) * LIVE.pace.walkPerTile };
      cursor = point; return segment;
    }));
  });

  it("falls back to preseeded or unknown-revision original PATH evidence without re-searching", () => {
    const active = course(authoredPathFixture()), from = { x: 2, y: 3 }, to = { x: 13, y: 5 };
    const seeded = [{ x: 4, y: 3 }, { x: 13, y: 5 }], cache = new Map<string, Point[] | null>([["2,3>13,5", seeded]]);
    const route = createPathWalkingRouter(active, cache), first = route(from, to) as Point[];
    expect(first).toEqual(seeded); first[0].x = -1; expect(route(from, to)).toEqual(seeded);
    cache.clear(); const known = route(from, to); expect(known && !Array.isArray(known)).toBe(true);
    const original = cache.get("2,3>13,5")!;
    // A new terrain snapshot cannot reuse presentation certified for old cells.
    active.tiles = [...active.tiles]; active.tiles[0] = "water";
    expect(createPathWalkingRouter(active, cache)(from, to)).toEqual(original);
    expect(cache.get("2,3>13,5")).toBe(original);
  });

  it("recomputes aligned original distance for each exact start on rounded hits", () => {
    const active = course(authoredPathFixture()), cache = new Map<string, Point[] | null>(), route = createPathWalkingRouter(active, cache);
    const from = { x: 2, y: 3 }, currentFrom = { x: 2.1, y: 3.1 }, to = { x: 13, y: 5 };
    const first = route(from, to), next = route(currentFrom, to);
    if (!first || Array.isArray(first) || !next || Array.isArray(next)) throw new Error("fixture must align both starts");
    expect(first.originalWaypoints).toEqual(findWalkPath(active, from, to));
    expect(next.originalWaypoints).toEqual(first.originalWaypoints); expect(cache.size).toBe(1);
    let cursor = currentFrom, expected = 0;
    for (const point of first.originalWaypoints) { expected += Math.hypot(point.x - cursor.x, point.y - cursor.y); cursor = point; }
    expect(next.distance).toBe(expected); expect(next.distance).not.toBe(first.distance);
    next.originalWaypoints[0].x = -100; next.waypoints[0].x = -100;
    expect(route(currentFrom, to)).not.toEqual(next);
    expect(cache.get("2,3>13,5")).toEqual(first.originalWaypoints);
  });

  it("invalidates only presentation for same-object width/tangent edits with a trusted terrain revision", () => {
    const active = course(authoredPathFixture([{ x: 2.5, y: 4.25 }, { x: 12.5, y: 4.25 }], 1));
    const cache = new Map<string, Point[] | null>(); const route = createPathWalkingRouter(active, cache);
    const from = { x: 2, y: 4 }, to = { x: 12, y: 4 };
    const first = route(from, to); expect(Array.isArray(first)).toBe(false);
    const original = cache.get("2,4>12,4"), originalSnapshot = original!.map(point => ({ ...point }));
    const feature = active.surfaceIntent!.features[0]; if (feature.geometry.kind !== "corridor") throw new Error("fixture");
    const before = pathMovementPlanKey(active, "same-terrain"), firstMesh = buildContinuousPathPlan(active).layers.map(layer => layer.positions);
    feature.geometry.width = 1.5;
    expect(pathMovementPlanKey(active, "same-terrain")).not.toBe(before);
    expect(buildContinuousPathPlan(active).layers.map(layer => layer.positions)).not.toEqual(firstMesh);
    const wider = route(from, to); expect(Array.isArray(wider)).toBe(false);
    const widthKey = pathMovementPlanKey(active, "same-terrain");
    feature.geometry.tangents = [{ in: { x: 2.2, y: 4.25 }, out: { x: 5.5, y: 4.05 } },
      { in: { x: 9.5, y: 4.05 }, out: { x: 12.8, y: 4.25 } }];
    expect(pathMovementPlanKey(active, "same-terrain")).not.toBe(widthKey);
    const bent = route(from, to); expect(bent && !Array.isArray(bent)).toBe(true); expect(bent).not.toEqual(wider);
    expect(route(from, to)).toEqual(bent); expect(cache.size).toBe(1);
    expect(cache.get("2,4>12,4")).toBe(original); expect(original).toEqual(originalSnapshot);
    if (bent && !Array.isArray(bent)) { bent.waypoints[0].x = -100; bent.originalWaypoints[0].x = -100; expect(route(from, to)).not.toEqual(bent); }
    expect(original).toEqual(originalSnapshot);
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
function actualWalk(active: Course, from: Point, to: Point) {
  const cells = findWalkPathCells(active, from, to)!, waypoints = findWalkPath(active, from, to)!;
  expect(cells).not.toBeNull();
  return { cells, waypoints, result: adaptPathMovementRoute({ course: active, from, to, cells, waypoints }) };
}
function onlyPaths(active: Course): Course { active.tiles = active.tiles.map(tile => tile === "path" ? tile : "water"); return active; }
function savedLines(lines: { knots: Point[]; width?: number; coverage?: number[] }[]): Course {
  const active = course(continuousPathFixture("empty"));
  const features = lines.map((line, i) => {
    const feature = corridorFeature(active, "path", line.knots, line.width ?? 1);
    feature.id = `fixture-${i}`; feature.order = i;
    const raster = rasterizeSurfaceFeatureDetailed(feature, active.width, active.height);
    feature.coverage = line.coverage ?? raster.tiles.map(p => p.y * active.width + p.x);
    feature.renderRings = raster.rings;
    for (const cell of feature.coverage) active.tiles[cell] = "path";
    return feature;
  });
  active.surfaceIntent = { version: 1, nextId: features.length + 1, features };
  return active;
}
const row = (y: number, from = 2, to = 12) => Array.from({ length: to - from + 1 }, (_, i) => y * 16 + from + i);
function fallback(active: Course, cells: Point[]) {
  const from = cells[0], to = cells.at(-1)!, waypoints = cells.slice(1);
  const result = adaptPathMovementRoute({ course: active, cells, from, to, waypoints });
  expect(result, result.failureDetails).toMatchObject({ alignedRuns: 0, fallbackRuns: 1, waypoints, presentationClearanceCells: [] });
  expect(result.failureDetails).toBeTruthy();
  return result;
}

describe("M2 bounded provenance and directed itinerary", () => {
  it("does not cascade to a second cardinal or diagonal-only neighbor", () => {
    const coverage = [2, 3, 4, 5, 6, 7].flatMap(y => row(y));
    const active = savedLines([{ knots: [{ x: 2.5, y: 4.25 }, { x: 12.5, y: 4.25 }], width: 6, coverage }]);
    fallback(active, row(6).map(cell => ({ x: cell % 16, y: 6 })));
    const diagonal = savedLines([{ knots: [{ x: 2.5, y: 4.25 }, { x: 12.5, y: 4.25 }], width: 6, coverage: [...coverage, 5 * 16 + 1, 6 * 16 + 1] }]);
    fallback(diagonal, [{ x: 1, y: 5 }, { x: 1, y: 6 }]);
  });

  it("does not use a removed cell or borrow another feature's accepted neighbor", () => {
    const removed = savedLines([{ knots: [{ x: 2.5, y: 4.25 }, { x: 12.5, y: 4.25 }], width: 2, coverage: [...row(4), ...row(5)] }]);
    removed.tiles[4 * 16 + 7] = "water";
    fallback(removed, row(5).map(cell => ({ x: cell % 16, y: 5 })));
    const excluded = savedLines([
      { knots: [{ x: 2.5, y: 4.25 }, { x: 12.5, y: 4.25 }], coverage: row(4) },
      { knots: [{ x: 2.5, y: 7.25 }, { x: 12.5, y: 7.25 }], width: 5, coverage: [5, 6, 7].flatMap(y => row(y)) },
    ]);
    fallback(excluded, row(5).map(cell => ({ x: cell % 16, y: 5 })));
  });

  it.each([
    ["T", { x: 3, y: 7 }, { x: 11, y: 7 }],
    ["T", { x: 3, y: 7 }, { x: 7, y: 3 }],
    ["cross", { x: 7, y: 7 }, { x: 7, y: 11 }],
    ["cross", { x: 3, y: 7 }, { x: 6, y: 7 }],
  ] as const)("preserves real %s branch support %j to %j", (kind, from, to) => {
    const active = onlyPaths(course(continuousPathFixture(kind)));
    const before = JSON.stringify(active), { cells, result } = actualWalk(active, from, to);
    expect(result, result.failureDetails).toMatchObject({ alignedRuns: 1, fallbackRuns: 0 });
    assertFootprint(active, [from, ...result.waypoints]);
    verifyRoute(active, from, result.waypoints, cells);
    expect(JSON.stringify(active)).toBe(before);
    if (from.y === to.y) expect(result.waypoints.every(p => Math.abs(p.y - from.y) < 1e-7)).toBe(true);
  });

  it("uses a forced width/source transition and an overlapping saved junction by declared incidence", () => {
    const transition = onlyPaths(savedLines([
      { knots: [{ x: 2.5, y: 7.5 }, { x: 7.5, y: 7.5 }], width: 1 },
      { knots: [{ x: 7.5, y: 7.5 }, { x: 12.5, y: 7.5 }], width: 2.5 },
    ]));
    expect(buildContinuousPathPlan(transition).nodes.some(node => node.kind === "transition")).toBe(true);
    const first = actualWalk(transition, { x: 2, y: 7 }, { x: 12, y: 7 });
    expect(first.result, first.result.failureDetails).toMatchObject({ alignedRuns: 1, fallbackRuns: 0 });
    assertFootprint(transition, [{ x: 2, y: 7 }, ...first.result.waypoints]);
    const cross = onlyPaths(savedLines([
      { knots: [{ x: 3.5, y: 7.5 }, { x: 11.5, y: 7.5 }] },
      { knots: [{ x: 7.5, y: 3.5 }, { x: 7.5, y: 11.5 }] },
    ]));
    const second = actualWalk(cross, { x: 3, y: 7 }, { x: 7, y: 11 });
    expect(second.result, second.result.failureDetails).toMatchObject({ alignedRuns: 1, fallbackRuns: 0 });
    expect(second.result.waypoints.some(p => Math.abs(p.x - 7) < 1e-7 && Math.abs(p.y - 7) < 1e-7)).toBe(true);
    assertFootprint(cross, [{ x: 3, y: 7 }, ...second.result.waypoints]);
  });

  it("follows the full U rather than its adjacent parallel arm or a chord", () => {
    const active = onlyPaths(savedLines([{ knots: [{ x: 3.5, y: 9.5 }, { x: 3.5, y: 3.5 }, { x: 5.5, y: 3.5 }, { x: 5.5, y: 9.5 }], width: .8 }]));
    const from = { x: 3, y: 9 }, to = { x: 5, y: 9 }, { result } = actualWalk(active, from, to);
    expect(result, result.failureDetails).toMatchObject({ alignedRuns: 1, fallbackRuns: 0 });
    expect(Math.min(...result.waypoints.map(p => p.y))).toBeLessThan(4);
    assertFootprint(active, [from, ...result.waypoints]);
  });

  it.each([
    [{ x: 3, y: 8 }, { x: 8, y: 3 }],
    [{ x: 8, y: 3 }, { x: 3, y: 8 }],
    [{ x: 3, y: 4 }, { x: 4, y: 3 }],
    [{ x: 4, y: 3 }, { x: 3, y: 4 }],
    [{ x: 11, y: 5 }, { x: 5, y: 11 }],
  ])("uses only the original loop arc, including arbitrary closed start %j to %j", (from, to) => {
    const active = onlyPaths(course(continuousPathFixture("loop"))), { cells, result } = actualWalk(active, from, to);
    expect(result, result.failureDetails).toMatchObject({ alignedRuns: 1, fallbackRuns: 0 });
    assertFootprint(active, [from, ...result.waypoints]);
    verifyRoute(active, from, result.waypoints, cells);
    const length = [from, ...result.waypoints].slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - [from, ...result.waypoints][i].x, p.y - [from, ...result.waypoints][i].y), 0);
    expect(length).toBeLessThan(20);
  });

  it("honestly rejects a tiny loop whose two directed arcs fit the same two-cell strip", () => {
    const active = savedLines([{ knots: [{ x: 4.3, y: 4.5 }, { x: 4.9, y: 4.2 }, { x: 5.5, y: 4.5 }, { x: 4.9, y: 4.8 }, { x: 4.3, y: 4.5 }], width: .25 }]);
    expect(buildContinuousPathPlan(active).edges.some(edge => edge.closed)).toBe(true);
    const result = fallback(active, [{ x: 4, y: 4 }, { x: 5, y: 4 }]);
    expect(result.failureDetails).toContain("ambiguous-directed-itinerary");
  });

  it.each([false, true])("preserves fractional endpoint pairs on the same sample and reverse=%s", reverse => {
    const active = course(authoredPathFixture([{ x: 2.5, y: 4.25 }, { x: 12.5, y: 4.25 }], 1));
    for (const pair of [[{ x: 2.15, y: 4.1 }, { x: 11.8, y: 4.15 }], [{ x: 4.49, y: 4 }, { x: 4.51, y: 4 }]]) {
      const [from, to] = reverse ? [...pair].reverse() : pair, { result } = actualWalk(active, from, to);
      expect(result, result.failureDetails).toMatchObject({ alignedRuns: 1, fallbackRuns: 0 });
      expect(result.waypoints.at(-1)).toEqual(to);
      expect(result.waypoints[0].x).toBeCloseTo(from.x, 8);
      // Only first/last connector can leave the rendered ribbon.
      assertFootprint(active, result.waypoints.slice(0, -1));
    }
  });

  it("does not disguise a missing distant prefix as an endpoint connector", () => {
    const active = savedLines([{ knots: [{ x: 5.5, y: 4.25 }, { x: 12.5, y: 4.25 }], width: 1, coverage: row(4) }]);
    fallback(active, row(4).map(cell => ({ x: cell % 16, y: 4 })));
  });

  it("falls back only the unsupported section of a mixed route and retains exact off-path target", () => {
    const active = course(continuousPathFixture("empty"));
    for (const x of [2, 3, 4, 7]) active.tiles[4 * 16 + x] = "path";
    const from = { x: 2, y: 4 }, to = { x: 9.2, y: 4.1 }, { result } = actualWalk(active, from, to);
    expect(result).toMatchObject({ alignedRuns: 1, fallbackRuns: 1 });
    expect(result.waypoints.at(-1)).toEqual(to);
  });
});

describe("M2 carried directed cell-state validator", () => {
  const cell = (p: Point) => p.y * 3 + p.x;
  const check = (points: Point[], allowed: number[], fromCell: Point, toCell: Point, forbidden: string[] = []) => validatePathMovementPolyline({
    points, permissions: points.slice(1).map(() => new Set(allowed)), width: 3, height: 3, fromCell, toCell,
    canStep: (a, b) => allowed.includes(cell(b)) && !forbidden.includes(`${cell(a)}>${cell(b)}`),
  });
  it("does not reset across a sample/node/connector at a forbidden diagonal vertex", () => {
    const points = [{ x: .5, y: .5 }, { x: 1, y: 1 }, { x: 1.5, y: 1.5 }];
    expect(check(points.slice(0, 2), [0, 4], { x: 0, y: 0 }, { x: 0, y: 0 }, ["0>4"]).valid).toBe(true);
    expect(check(points.slice(1), [0, 4], { x: 1, y: 1 }, { x: 1, y: 1 }, ["0>4"]).valid).toBe(true);
    expect(check(points, [0, 4], { x: 0, y: 0 }, { x: 1, y: 1 }, ["0>4"]).valid).toBe(false);
  });
  it("carries slope and directed exit/side-to-next authority across zero-length seams", () => {
    const slope = [{ x: .5, y: .5 }, { x: 1, y: .5 }, { x: 1, y: .5 }, { x: 1.5, y: .5 }];
    expect(check(slope, [0, 1], { x: 0, y: 0 }, { x: 1, y: 0 }, ["0>1"]).valid).toBe(false);
    expect(check([...slope].reverse(), [0, 1], { x: 1, y: 0 }, { x: 0, y: 0 }, ["0>1"]).valid).toBe(true);
    const side = [{ x: .5, y: .5 }, { x: 1.5, y: .5 }, { x: 1.5, y: 1.5 }];
    expect(check(side, [0, 1, 4], { x: 0, y: 0 }, { x: 1, y: 1 }, ["1>4"]).valid).toBe(false);
  });
  it("allows a boundary-aligned polyline with one feasible legal side", () => {
    const points = [{ x: 1, y: .2 }, { x: 1, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 1.8 }];
    expect(check(points, [1, 4], { x: 1, y: 0 }, { x: 1, y: 1 })).toEqual({ valid: true, usedCells: [1, 4] });
  });
  it("rejects a real inter-edge seam even when its old cardinal route is legal", () => {
    const coverage = [4 * 16 + 4, 4 * 16 + 5, 5 * 16 + 4, 5 * 16 + 5];
    const active = savedLines([
      { knots: [{ x: 4.5, y: 4.5 }, { x: 5, y: 5 }], width: 1, coverage },
      { knots: [{ x: 5, y: 5 }, { x: 5.5, y: 5.5 }], width: 2, coverage },
    ]);
    const cells = [{ x: 4, y: 4 }, { x: 5, y: 4 }, { x: 5, y: 5 }];
    const canStep = (a: Point, b: Point) => !(a.x === 4 && a.y === 4 && b.x === 5 && b.y === 5);
    expect(cells.slice(1).every((p, i) => canStep(cells[i], p))).toBe(true);
    const result = adaptPathMovementRoute({ course: active, cells, from: cells[0], to: cells.at(-1)!, waypoints: cells.slice(1), canStep });
    expect(result).toMatchObject({ alignedRuns: 0, fallbackRuns: 1, waypoints: cells.slice(1) });
  });
});


describe("M3 common monotone support and authority trace", () => {
  const pieces = (points: Point[], edgeId = "source") => points.slice(1).map((b, i) => ({ a: points[i], b, edgeId }));
  const point = (cell: number, width = 16) => ({ x: cell % width, y: Math.floor(cell / width) });
  it("advances the real S at x=6/x=7 independently of the old nearest-witness partition", () => {
    const active = onlyPaths(course(authoredPathFixture())), plan = buildContinuousPathPlan(active);
    const from = { x: 2, y: 3 }, to = { x: 13, y: 5 }, cells = findWalkPathCells(active, from, to)!;
    const authority = walkPathAuthority(active);
    const canStep = (a: Point, b: Point) => authority.isWalkable(b.x, b.y) && (a.x === b.x || a.y === b.y || authority.isWalkable(a.x, b.y) && authority.isWalkable(b.x, a.y));
    const fixed = plan.edges.flatMap(edge => pieces([...edge.points], edge.id));
    const supports = (i: number, q: number, edgeId: string) => {
      const edge = plan.edges.find(edge => edge.id === edgeId)!, r = cells[i]; if (!r) return false;
      const p = point(q), original = r.y * 16 + r.x;
      if (!edge.coverage.includes(q) || !edge.coverage.includes(original) || active.tiles[q] !== "path") return false;
      if (Math.abs(p.x - r.x) + Math.abs(p.y - r.y) <= 1) return true;
      return [i - 1, i].some(step => {
        const a = cells[step], b = cells[step + 1];
        return a && b && Math.abs(a.x - b.x) === 1 && Math.abs(a.y - b.y) === 1 && canStep(a, b)
          && (p.x === a.x && p.y === b.y || p.x === b.x && p.y === a.y) && canStep(a, p) && canStep(p, b);
      });
    };
    const before = JSON.stringify({ active, plan, cells });
    const result = validatePathMovementSupport({ pieces: fixed, originalCount: cells.length, width: 16, height: 16, fromCell: from, toCell: to, supports, canStep });
    expect(result, result.failureDetails).toMatchObject({ valid: true });
    expect([...new Set(result.trace.map(event => event.index))]).toEqual(cells.map((_, i) => i));
    for (const [index, cell, x] of [[4, 2 * 16 + 6, 6], [5, 2 * 16 + 7, 7]]) {
      expect(result.trace.some(event => event.index === index && event.cell === cell && Math.abs(event.point.x - x) < 1e-7)).toBe(true);
    }
    expect(result.trace.every((event, i) => !i || event.index - result.trace[i - 1].index >= 0 && event.index - result.trace[i - 1].index <= 1)).toBe(true);
    expect(result.pieces.every(piece => supports(result.trace.find(event => event.cell === piece.cell && event.edgeId === piece.edgeId)!.index, piece.cell, piece.edgeId))).toBe(true);
    // With index5 deliberately unsupported, geometry and authority alone cannot
    // skip it or let index4 occupy the required (7,2) cell.
    expect(supports(4, 2 * 16 + 7, plan.edges[0].id)).toBe(false);
    expect(validatePathMovementSupport({ pieces: fixed, originalCount: cells.length, width: 16, height: 16, fromCell: from, toCell: to,
      supports: (i, q, e) => i !== 5 && supports(i, q, e), canStep }).valid).toBe(false);
    expect(JSON.stringify({ active, plan, cells })).toBe(before);
  });

  it("cannot skip a missing middle index, reverse progress, or use an interior sample as an advance event", () => {
    const fixed = pieces([{ x: .5, y: .5 }, { x: 1.5, y: .5 }, { x: 2.5, y: .5 }, { x: 3.5, y: .5 }]);
    const base = { pieces: fixed, originalCount: 3, width: 16, height: 16, fromCell: { x: 0, y: 0 }, toCell: { x: 3, y: 0 }, canStep: () => true };
    expect(validatePathMovementSupport({ ...base, supports: (i, q) => i === 0 ? q <= 1 : i === 2 && q >= 2 }).valid).toBe(false);
    expect(validatePathMovementSupport({ ...base, supports: (i, q) => i === 0 ? q === 0 : i === 1 ? q >= 2 : q === 1 }).valid).toBe(false);
    const interior = validatePathMovementSupport({ ...base, originalCount: 2, pieces: pieces([{ x: .2, y: .2 }, { x: .4, y: .4 }, { x: .6, y: .6 }]),
      fromCell: { x: 0, y: 0 }, toCell: { x: 0, y: 0 }, supports: () => true });
    expect(interior).toMatchObject({ valid: false }); expect(interior.failureDetails).toContain("incomplete-ordered-support");
  });

  it("requires the initial original index itself to have source support", () => {
    const result = validatePathMovementSupport({ pieces: pieces([{ x: 1, y: .2 }, { x: 1.5, y: .2 }]), originalCount: 2, width: 16, height: 16,
      fromCell: { x: 1, y: 0 }, toCell: { x: 1, y: 0 }, supports: i => i === 1, canStep: () => true });
    expect(result.valid).toBe(false);
  });

  it.each(["sample", "node", "entry", "exit"] as const)("does not hop through a point-only side cell at a %s corner", seam => {
    const sw = { x: .5, y: .5 }, vertex = { x: 1, y: 1 }, ne = { x: 1.5, y: 1.5 };
    const fixed: PathMovementSupportPiece[] = [
      { a: sw, b: vertex, edgeId: "sw", connector: seam === "entry" ? "entry" : undefined },
      { a: vertex, b: vertex, edgeId: "side" },
      { a: vertex, b: ne, edgeId: seam === "node" ? "ne" : "sw", connector: seam === "exit" ? "exit" : undefined },
    ];
    const result = validatePathMovementSupport({ pieces: fixed, originalCount: 2, width: 16, height: 16,
      fromCell: { x: 0, y: 0 }, toCell: { x: 1, y: 1 }, supports: () => true,
      canStep: (a, b) => !(a.x === 0 && a.y === 0 && b.x === 1 && b.y === 1) });
    expect(result.valid).toBe(false);
  });

  it("does not let an original legal diagonal waive a forbidden actual side-to-next step", () => {
    const result = validatePathMovementSupport({ pieces: pieces([{ x: .5, y: .5 }, { x: 1.5, y: .5 }, { x: 1.5, y: 1.5 }]),
      originalCount: 2, width: 16, height: 16, fromCell: { x: 0, y: 0 }, toCell: { x: 1, y: 1 }, supports: () => true,
      canStep: (a, b) => !(a.x === 1 && a.y === 0 && b.x === 1 && b.y === 1) });
    expect(result.valid).toBe(false);
  });

  it("realizes a directed side switch over positive geometry along a grid edge", () => {
    const fixed = pieces([{ x: 1, y: .2 }, { x: 1, y: .8 }]);
    const base = { pieces: fixed, originalCount: 2, width: 16, height: 16, fromCell: { x: 0, y: 0 }, toCell: { x: 1, y: 0 },
      supports: (i: number, q: number) => i === 0 ? q === 0 : q === 1 };
    const result = validatePathMovementSupport({ ...base, canStep: () => true });
    expect(result, result.failureDetails).toMatchObject({ valid: true, usedCells: [0, 1] });
    const advance = result.trace.find(event => event.index === 1)!;
    expect(advance.point.y).toBeGreaterThan(.2); expect(advance.point.y).toBeLessThan(.8);
    expect(result.pieces.every(piece => piece.b.y > piece.a.y && piece.a.x === 1 && piece.b.x === 1)).toBe(true);
    expect(validatePathMovementSupport({ ...base, canStep: (a, b) => !(a.x === 0 && b.x === 1) }).valid).toBe(false);
  });

  it("rejects incompatible support-only and authority-only boundary traces", () => {
    const fixed = [
      ...pieces([{ x: 1, y: .2 }, { x: 1, y: 1 }], "head"),
      ...pieces([{ x: 1, y: 1 }, { x: 1, y: 2 }], "left-only"),
      ...pieces([{ x: 1, y: 2 }, { x: 1, y: 2.8 }], "tail"),
    ];
    const base = { pieces: fixed, originalCount: 2, width: 16, height: 16, fromCell: { x: 1, y: 0 }, toCell: { x: 1, y: 2 } };
    const supports = (i: number, q: number, e: string) => e === "head" ? i === 0 && (q === 0 || q === 1)
      : e === "left-only" ? i === 1 && q === 16 : i === 1 && (q === 32 || q === 33);
    const authority = (_a: Point, b: Point) => b.x === 1;
    expect(validatePathMovementSupport({ ...base, supports, canStep: () => true }).valid).toBe(true);
    expect(validatePathMovementSupport({ ...base, supports: () => true, canStep: authority }).valid).toBe(true);
    expect(validatePathMovementSupport({ ...base, supports, canStep: authority }).valid).toBe(false);
  });

  it("does not count a losing boundary side in accepted clearance cells", () => {
    const result = validatePathMovementSupport({ pieces: pieces([{ x: 1, y: .2 }, { x: 1, y: 1.8 }]), originalCount: 2, width: 16, height: 16,
      fromCell: { x: 0, y: 0 }, toCell: { x: 0, y: 1 }, supports: (i, q) => i === 0 ? q === 0 || q === 1 : q === 16,
      canStep: (a, b) => !(a.x === 1 && b.x === 0) });
    expect(result, result.failureDetails).toMatchObject({ valid: true, usedCells: [0, 16] });
  });

  it.each(["entry", "exit"] as const)("does not consume middle indices in a long %s connector", connector => {
    const result = validatePathMovementSupport({ pieces: pieces([{ x: .5, y: .5 }, { x: 3.5, y: .5 }]).map(p => ({ ...p, connector })),
      originalCount: 4, width: 16, height: 16, fromCell: { x: 0, y: 0 }, toCell: { x: 3, y: 0 }, supports: (i, q) => i === q, canStep: () => true });
    expect(result.valid).toBe(false);
  });

  it("reports bounded state exhaustion rather than truncating ambiguity to success", () => {
    const result = validatePathMovementSupport({ pieces: pieces([{ x: 1, y: .2 }, { x: 1, y: 1.8 }]), originalCount: 4, width: 16, height: 16,
      fromCell: { x: 0, y: 0 }, toCell: { x: 0, y: 1 }, supports: () => true, canStep: () => true, stateBudget: 3 });
    expect(result.valid).toBe(false); expect(result.failureDetails).toContain("state-budget");
  });

  it("rejects two genuinely surviving saved branches instead of choosing a shorter one", () => {
    const coverage = row(5);
    const active = onlyPaths(savedLines([
      { knots: [{ x: 2.5, y: 5.5 }, { x: 7.5, y: 5.1 }, { x: 12.5, y: 5.5 }], width: .4, coverage },
      { knots: [{ x: 2.5, y: 5.5 }, { x: 7.5, y: 5.9 }, { x: 12.5, y: 5.5 }], width: .4, coverage },
    ]));
    const { result, waypoints } = actualWalk(active, { x: 2, y: 5 }, { x: 12, y: 5 });
    expect(result).toMatchObject({ alignedRuns: 0, fallbackRuns: 1, waypoints });
    expect(result.failureDetails).toContain("ambiguous-directed-itinerary");
  });

  it("filters an apparently ambiguous saved branch by complete directed authority before choosing the unique survivor", () => {
    const active = onlyPaths(savedLines([
      { knots: [{ x: 2.5, y: 5.5 }, { x: 7.5, y: 4.5 }, { x: 12.5, y: 5.5 }], width: 1, coverage: [...row(4), ...row(5)] },
      { knots: [{ x: 2.5, y: 5.5 }, { x: 7.5, y: 6.5 }, { x: 12.5, y: 5.5 }], width: 1, coverage: [...row(5), ...row(6)] },
    ]));
    const from = { x: 2, y: 5 }, to = { x: 12, y: 5 }, cells = findWalkPathCells(active, from, to)!, original = findWalkPath(active, from, to)!;
    const result = adaptPathMovementRoute({ course: active, cells, from, to, waypoints: original,
      canStep: (a, b) => !(a.x === 6 && a.y === 4 && b.x === 7 && b.y === 4) });
    expect(result, result.failureDetails).toMatchObject({ alignedRuns: 1, fallbackRuns: 0 });
    expect(result.waypoints.some(p => p.y > 5.5)).toBe(true);
    expect(result.waypoints.every(p => p.y >= 5 - 1e-7)).toBe(true);
    assertFootprint(active, [from, ...result.waypoints]);
  });

  it("can reject a closer illegal entry and choose a farther legal projection on the frozen edge", () => {
    const coverage = [4 * 16 + 4, 4 * 16 + 5, 5 * 16 + 4, 5 * 16 + 5];
    const active = savedLines([{ knots: [{ x: 5.1, y: 4.8 }, { x: 4.6, y: 5.1 }, { x: 5.5, y: 5.5 }], width: 1.5, coverage }]);
    const from = { x: 4.49, y: 4.49 }, to = { x: 5, y: 5 }, cells = [{ x: 4, y: 4 }, { x: 4, y: 5 }, { x: 5, y: 5 }];
    const canStep = (a: Point, b: Point) => !(a.x === 4 && a.y === 4 && b.x === 5 && b.y === 4);
    expect(cells.slice(1).every((p, i) => canStep(cells[i], p))).toBe(true);
    const result = adaptPathMovementRoute({ course: active, cells, from, to, waypoints: cells.slice(1), canStep });
    expect(result, result.failureDetails).toMatchObject({ alignedRuns: 1, fallbackRuns: 0 });
    expect(result.waypoints[0].x).toBeLessThan(4.5);
    expect(result.waypoints.at(-1)).toEqual(to);
  });
});


describe("M3 close loop sides and post-authority ambiguity", () => {
  it.each([false, true])("keeps the real selected arc between close parallel loop sides, reverse=%s", reverse => {
    const active = course(continuousPathFixture("empty"));
    for (let y = 3; y <= 10; y++) for (const x of [4, 6]) active.tiles[y * 16 + x] = "path";
    for (const y of [3, 10]) active.tiles[y * 16 + 5] = "path";
    onlyPaths(active);
    const endpoints = [{ x: 4, y: 6 }, { x: 6, y: 6 }], [from, to] = reverse ? endpoints.reverse() : endpoints;
    const { result, cells } = actualWalk(active, from, to);
    expect(result, result.failureDetails).toMatchObject({ alignedRuns: 1, fallbackRuns: 0 });
    expect(Math.min(...result.waypoints.map(p => p.y))).toBeLessThan(4);
    assertFootprint(active, [from, ...result.waypoints]);
    verifyRoute(active, from, result.waypoints, cells);
  });

  it("keeps the unique loop arc when the other initially plausible direction fails actual authority", () => {
    const coverage = [3, 4, 5].flatMap(y => row(y, 4, 6));
    const active = onlyPaths(savedLines([{ knots: [
      { x: 4.25, y: 4.5 }, { x: 5.5, y: 3.25 }, { x: 6.75, y: 4.5 }, { x: 5.5, y: 5.75 }, { x: 4.25, y: 4.5 },
    ], width: .25, coverage }]));
    const plan = buildContinuousPathPlan(active); expect(plan.edges.some(edge => edge.closed)).toBe(true);
    // Exact G endpoints make connector choice unique even though cell-center
    // witnesses on the two symmetric arcs have equivalent representations.
    const from = { x: 3.75, y: 4 }, to = { x: 6.25, y: 4 }, cells = findWalkPathCells(active, from, to)!, waypoints = findWalkPath(active, from, to)!;
    const ambiguous = adaptPathMovementRoute({ course: active, cells, from, to, waypoints });
    expect(ambiguous.failureDetails).toContain("ambiguous-directed-itinerary");
    const result = adaptPathMovementRoute({ course: active, cells, from, to, waypoints,
      canStep: (a, b) => !(a.x === 4 && a.y === 3 && b.x === 5 && b.y === 3) });
    expect(result, result.failureDetails).toMatchObject({ alignedRuns: 1, fallbackRuns: 0 });
    expect(result.waypoints.some(p => p.y > 4.5)).toBe(true);
    expect(result.waypoints.every(p => p.y >= 4 - 1e-7)).toBe(true);
    // Endpoint connectors may leave the mesh; the consumed interior remains G.
    assertFootprint(active, result.waypoints.slice(0, -1));
  });
});
