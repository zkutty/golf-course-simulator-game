import { describe, expect, it } from "vitest";
import { createHoleIllustrationSnapshot } from "../holeIllustration/snapshot";
import { zk771CertificationEstate, zk771IncompleteEstate } from "./zk771HoleIllustrationFixtures";

const point = (a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }, d: { x: number; y: number }) => {
  const cross = (p: typeof a, q: typeof a, r: typeof a) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  return cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0;
};

function routeSegments(hole: { tee: { x: number; y: number } | null; green: { x: number; y: number } | null; waypoints?: { x: number; y: number }[] }) {
  const points = [hole.tee!, ...(hole.waypoints ?? []), hole.green!];
  return points.slice(1).map((end, index) => [points[index], end] as const);
}

function connected(course: ReturnType<typeof zk771CertificationEstate>, start: { x: number; y: number }, end: { x: number; y: number }, allowed: (x: number, y: number) => boolean): boolean {
  const seen = new Set<string>(); const queue = [start];
  while (queue.length) { const current = queue.shift()!; const key = `${current.x},${current.y}`; if (seen.has(key) || !allowed(current.x, current.y)) continue; if (current.x === end.x && current.y === end.y) return true; seen.add(key); for (const [x, y] of [[current.x - 1, current.y], [current.x + 1, current.y], [current.x, current.y - 1], [current.x, current.y + 1]]) if (x >= 0 && y >= 0 && x < course.width && y < course.height) queue.push({ x, y }); }
  return false;
}

describe("ZK-1136 topology-authentic illustration fixtures", () => {
  it("contains deterministic split, crossing, carry, plateau, vegetation, alternate, incomplete, title, and disjoint-layout facts", () => {
    const course = zk771CertificationEstate(18, "disjoint");
    const byKind = (kind: string) => course.holes.find((hole) => hole.id?.includes(kind))!;
    const split = byKind("split"); const water = byKind("water-carry"); const wooded = byKind("wooded"); const elevation = byKind("elevation");
    const tile = (x: number, y: number) => course.tiles[y * course.width + x];
    expect([tile(split.tee!.x + 1, split.tee!.y - 2), tile(split.tee!.x + 1, split.tee!.y + 2), tile(split.tee!.x + 5, split.tee!.y - 2), tile(split.tee!.x + 5, split.tee!.y + 2)]).toEqual(["fairway", "fairway", "fairway", "fairway"]);
    expect(tile(split.tee!.x + 5, split.tee!.y)).not.toBe("fairway");
    expect(tile(split.green!.x - 1, split.tee!.y)).toBe("fairway");
    const fairway = (x: number, y: number) => tile(x, y) === "fairway";
    const upperAllowed = (x: number, y: number) => (x === split.tee!.x && y === split.tee!.y) || (x === split.green!.x && y === split.green!.y) || fairway(x, y) && (y <= split.tee!.y - 2 || x >= split.green!.x - 2 || x === split.tee!.x + 1);
    const lowerAllowed = (x: number, y: number) => (x === split.tee!.x && y === split.tee!.y) || (x === split.green!.x && y === split.green!.y) || fairway(x, y) && (y >= split.tee!.y + 2 || x >= split.green!.x - 2 || x === split.tee!.x + 1);
    expect(connected(course, split.tee!, split.green!, upperAllowed)).toBe(true);
    expect(connected(course, split.tee!, split.green!, lowerAllowed)).toBe(true);
    expect(Array.from({ length: split.green!.x - split.tee!.x - 4 }, (_, index) => tile(split.tee!.x + index + 2, split.tee!.y) !== "fairway").every(Boolean)).toBe(true);
    const overlap = byKind("overlap");
    expect(routeSegments(split).some(([a, b]) => routeSegments(overlap).some(([c, d]) => point(a, b, c, d)))).toBe(true);
    expect([-2, -1, 0, 1, 2, 3].every((dy) => [6, 7, 8].every((dx) => tile(water.tee!.x + dx, water.tee!.y + dy) === "water"))).toBe(true);
    const carry = routeSegments(water)[0]; const barrierX = water.tee!.x + 6;
    const carryY = carry[0].y + (barrierX - carry[0].x) * (carry[1].y - carry[0].y) / (carry[1].x - carry[0].x);
    expect(carryY).toBeGreaterThanOrEqual(water.tee!.y - 2); expect(carryY).toBeLessThanOrEqual(water.tee!.y + 3);
    expect(new Set([-3, 0, 2].map((offset) => course.elevations[elevation.green!.y * course.width + elevation.green!.x + offset])).size).toBe(3);
    for (const level of [2, 4, 6]) {
      const cells = course.elevations.flatMap((value, index) => value === level ? [{ x: index % course.width, y: Math.floor(index / course.width) }] : []).filter((cell) => Math.abs(cell.x - elevation.green!.x) <= 3 && Math.abs(cell.y - elevation.green!.y) <= 3);
      expect(cells.length).toBeGreaterThan(0);
      expect(cells.every((cell) => connected(course, cells[0], cell, (x, y) => course.elevations[y * course.width + x] === level))).toBe(true);
    }
    expect(course.obstacles.filter((item) => item.type === "tree" || item.type === "bush")).toHaveLength(6);
    const alternate = byKind("alternate-tee-pin");
    expect(new Set(Object.values(alternate.teeBoxes!).map((item) => `${item!.x},${item!.y}`)).size).toBe(3);
    expect(new Set(Object.values(alternate.pinPositions!).map((item) => `${item!.x},${item!.y}`)).size).toBe(3);
    const snapshot = createHoleIllustrationSnapshot(course, { layoutId: course.activeCourseId!, routeSource: "published", holeId: wooded.id!, teeSet: "member", pinRotation: "A" });
    expect(snapshot.complete).toBe(true);
    if (snapshot.complete) {
      expect(snapshot.snapshot.obstacles.map((item) => item.type).sort()).toEqual(["bush", "tree", "tree"]);
      const source = course.obstacles.filter((item) => item.x >= wooded.tee!.x + 3 && item.x <= wooded.tee!.x + 7 && item.y >= wooded.tee!.y - 2 && item.y <= wooded.tee!.y + 2).sort((a, b) => a.x - b.x);
      const captured = [...snapshot.snapshot.obstacles].sort((a, b) => a.x - b.x);
      expect(captured.map((item) => ({ type: item.type, dx: item.x - snapshot.snapshot.tee.x, dy: item.y - snapshot.snapshot.tee.y }))).toEqual(source.map((item) => ({ type: item.type, dx: item.x - wooded.tee!.x, dy: item.y - wooded.tee!.y })));
    }
    expect(byKind("long-title").name!.length).toBeGreaterThan(96);
    const incomplete = zk771IncompleteEstate(); expect(incomplete.holes[0].green).toBeNull(); expect(incomplete.holes[0].pinPositions!.A).toBeNull();
    expect(course.layouts!).toHaveLength(2);
    expect(new Set(course.layouts!.flatMap((layout) => layout.publishedHoleIds)).size).toBe(18);
    expect(course.layouts!.every((layout) => layout.publishedHoleIds.length === 9 && layout.publishedHoleIds.every((id) => course.holes.some((hole) => hole.id === id && hole.tee && hole.green)))).toBe(true);
    for (const layout of course.layouts!) for (const holeId of layout.publishedHoleIds) {
      const complete = createHoleIllustrationSnapshot(course, { layoutId: layout.id, routeSource: "published", holeId, teeSet: "member", pinRotation: "A" });
      expect(complete.complete).toBe(true);
    }
  });
});
