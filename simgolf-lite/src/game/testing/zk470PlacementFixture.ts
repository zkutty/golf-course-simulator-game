import { DEFAULT_COURSE, DEFAULT_WORLD } from "../models/defaults";
import type { Course, Point, Terrain, World } from "../models/types";
import type { SavePayload } from "../../utils/save";
import { hashCanonicalValue } from "../../utils/stateHash";
import { canonicalJson } from "../../utils/canonical";

export const ZK470_FIXTURE_SLOT = "zk470a-deterministic-fixture";

export type Zk470TargetKind =
  | "flat" | "slope" | "shoulder" | "bunker-rim" | "water-bank"
  | "tee" | "pin" | "prop" | "occlusion" | "engineering-ring-valid";

export interface Zk470PlacementTarget { readonly id: string; readonly kind: Zk470TargetKind; readonly point: Point; readonly footprint: readonly Point[]; }

const target = (id: string, kind: Zk470TargetKind, x: number, y: number, footprint: readonly Point[] = [{ x, y }]): Zk470PlacementTarget => ({ id, kind, point: { x, y }, footprint });

export const ZK470_TARGETS: readonly Zk470PlacementTarget[] = [
  target("flat-center", "flat", 20, 20), target("slope-east", "slope", 30, 20),
  target("shoulder-north", "shoulder", 30, 14), target("bunker-rim-west", "bunker-rim", 14, 24),
  target("water-bank-south", "water-bank", 20, 31), target("tee-forward", "tee", 9, 10),
  target("pin-a", "pin", 39, 20), target("prop-tree", "prop", 45, 12),
  target("occlusion-building", "occlusion", 50, 24, [{ x: 50, y: 24 }, { x: 51, y: 24 }, { x: 50, y: 25 }, { x: 51, y: 25 }]),
  target("engineering-ring-valid", "engineering-ring-valid", 60, 20, [{ x: 60, y: 20 }, { x: 61, y: 20 }, { x: 60, y: 21 }, { x: 61, y: 21 }]),
];

function set(course: Course, x: number, y: number, terrain: Terrain, elevation: number): void {
  const index = y * course.width + x;
  course.tiles[index] = terrain;
  course.elevations[index] = elevation;
}

export function createZk470PlacementFixture(): { course: Course; world: World; paused: true; targets: readonly Zk470PlacementTarget[] } {
  const course = structuredClone(DEFAULT_COURSE);
  const world = structuredClone(DEFAULT_WORLD);
  course.name = "ZK-470A deterministic placement fixture";
  course.tiles.fill("fairway"); course.elevations.fill(0);
  for (let y = 0; y < course.height; y++) for (let x = 0; x < course.width; x++) {
    if ((x + y) % 11 === 0) set(course, x, y, "rough", 1);
    if (x >= 12 && x <= 18 && y >= 22 && y <= 25) set(course, x, y, "sand", 0);
    if (x >= 18 && x <= 24 && y >= 30 && y <= 34) set(course, x, y, "water", -1);
    if (x >= 28 && x <= 34 && y >= 17 && y <= 23) set(course, x, y, "fairway", x - 28);
  }
  set(course, 9, 10, "tee", 0); set(course, 39, 20, "green", 2);
  course.buildings = [
    { id: "zk470-occlusion", type: "clubhouse", x: 50, y: 24 },
    { id: "zk470-engineering-ring", type: "pro_shop", x: 60, y: 20, tier: 2, price: 28 },
  ];
  course.obstacles = [{ x: 45, y: 12, type: "tree" }, { x: 46, y: 12, type: "bush" }];
  course.holes[0] = { ...course.holes[0], tee: { x: 9, y: 10 }, green: { x: 39, y: 20 }, pinPositions: { A: { x: 39, y: 20 }, B: { x: 38, y: 20 }, C: { x: 39, y: 19 } } };
  world.cash = 250_000;
  return { course, world, paused: true, targets: ZK470_TARGETS };
}

export function createZk470SavePayload(): SavePayload {
  const fixture = createZk470PlacementFixture();
  return { course: fixture.course, world: fixture.world };
}

export function firstCanonicalDifference(before: unknown, after: unknown, path: string = "$" ): { path: string; before: unknown; after: unknown } | null {
  if (Object.is(before, after)) return null;
  if (typeof before !== "object" || before === null || typeof after !== "object" || after === null) return { path, before, after };
  if (canonicalJson(before) === canonicalJson(after)) return null;
  const keys = [...new Set([...Object.keys(before as object), ...Object.keys(after as object)])].sort();
  for (const key of keys) { const difference = firstCanonicalDifference((before as Record<string, unknown>)[key], (after as Record<string, unknown>)[key], `${path}.${key}`); if (difference) return difference; }
  return { path, before, after };
}

export function persistenceProbe(payload: SavePayload): { slot: string; beforeHash: string; afterHash: string; firstDifference: ReturnType<typeof firstCanonicalDifference> } {
  const before = payload;
  const storage = new Map<string, string>();
  storage.set(ZK470_FIXTURE_SLOT, JSON.stringify(before));
  const after = JSON.parse(storage.get(ZK470_FIXTURE_SLOT)!);
  storage.delete(ZK470_FIXTURE_SLOT);
  return { slot: ZK470_FIXTURE_SLOT, beforeHash: hashCanonicalValue(before), afterHash: hashCanonicalValue(after), firstDifference: firstCanonicalDifference(before, after) };
}
