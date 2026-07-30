import type { Course, LandTheme, ObstacleType, Point } from "../models/types";
import { getBiomeDefinition } from "../models/biomes";

export type CoastEdge = "north" | "east" | "south" | "west";
export type ScenicPatchKind = "meadow" | "field" | "wood" | "scrub" | "dune" | "wash";

export interface ScenicPatch {
  x: number;
  y: number;
  width: number;
  height: number;
  kind: ScenicPatchKind;
  shade: number;
}

export interface ScenicRoad {
  from: Point;
  to: Point;
}

export interface ScenicProp {
  x: number;
  y: number;
  type: ObstacleType;
}

export interface ScenicSurroundModel {
  theme: LandTheme;
  coast: CoastEdge | null;
  /** Ordered shoreline points, including deterministic continuation beyond
   * both estate corners. Empty when the theme has no qualifying ocean. */
  coastline: Point[];
  patches: ScenicPatch[];
  roads: ScenicRoad[];
  props: ScenicProp[];
}

export const SCENIC_GENERATION_BLEED_TILES = 256;
export const SCENIC_CAMERA_MARGIN_TILES = 48;
export const SCENIC_PLANE_TILES = 4096;

const SCENIC_PROFILES: Record<LandTheme, {
  patches: readonly ScenicPatchKind[];
  props: readonly ObstacleType[];
  propDensity: number;
  naturalTerrain: "rough" | "deep_rough" | "waste_area";
}> = {
  parkland: {
    patches: ["meadow", "field", "wood", "scrub"],
    props: ["tree", "tree", "bush", "tree", "rock"],
    propDensity: 0.23,
    naturalTerrain: "rough",
  },
  links: {
    patches: ["meadow", "field", "scrub", "dune"],
    props: ["bush", "bush", "rock", "bush", "tree"],
    propDensity: 0.16,
    naturalTerrain: "deep_rough",
  },
  desert: {
    patches: ["scrub", "wash", "dune"],
    props: ["rock", "bush", "rock", "tree"],
    propDensity: 0.16,
    naturalTerrain: "waste_area",
  },
};

export function scenicNaturalTerrain(theme: LandTheme): "rough" | "deep_rough" | "waste_area" {
  const owner = getBiomeDefinition(theme).content.materials.terrain;
  return SCENIC_PROFILES[owner].naturalTerrain;
}

function hash(seed: number, x: number, y: number, salt = 0): number {
  let value = Math.imul((seed | 0) ^ Math.imul(x + 101, 73856093), 19349663);
  value ^= Math.imul(y + 211, 83492791) ^ salt;
  value = Math.imul(value ^ (value >>> 16), 2246822519);
  return (value ^ (value >>> 13)) >>> 0;
}

function random01(seed: number, x: number, y: number, salt = 0): number {
  return hash(seed, x, y, salt) / 0x100000000;
}

function edgeWaterStats(course: Course, edge: CoastEdge): { count: number; longestRun: number } {
  let count = 0;
  let run = 0;
  let longestRun = 0;
  const visit = (water: boolean) => {
    if (water) {
      count++;
      run++;
      longestRun = Math.max(longestRun, run);
    } else {
      run = 0;
    }
  };
  if (edge === "north" || edge === "south") {
    const y = edge === "north" ? 0 : course.height - 1;
    for (let x = 0; x < course.width; x++) visit(course.tiles[y * course.width + x] === "water");
  } else {
    const x = edge === "west" ? 0 : course.width - 1;
    for (let y = 0; y < course.height; y++) visit(course.tiles[y * course.width + x] === "water");
  }
  return { count, longestRun };
}

/**
 * Identify the generated Links sea without mistaking a pond or a short
 * player-painted boundary stroke for an ocean. The Links generator fills
 * most of exactly one edge, so a 25% threshold remains tolerant of edits.
 */
export function detectLinksCoast(course: Course): CoastEdge | null {
  if (!getBiomeDefinition(course.theme).generation.water.coastalEdge) return null;
  const edges: CoastEdge[] = ["north", "east", "south", "west"];
  const ranked = edges
    .map((edge) => {
      const length = edge === "north" || edge === "south" ? course.width : course.height;
      const { count, longestRun } = edgeWaterStats(course, edge);
      return { edge, count, longestRun, length, ratio: count / Math.max(1, length) };
    })
    .sort((a, b) => b.ratio - a.ratio || b.count - a.count);
  const best = ranked[0];
  return best && best.count >= 8 && best.ratio >= 0.25 && best.longestRun >= Math.max(8, best.length * 0.2)
    ? best.edge
    : null;
}

export function isScenicOceanPoint(
  coast: CoastEdge | null,
  point: Point,
  width: number,
  height: number,
  coastline: readonly Point[] = [],
): boolean {
  let boundary: number | null = null;
  if (coastline.length > 0 && coast) {
    const along = coast === "north" || coast === "south" ? point.x : point.y;
    const axis = (candidate: Point) => coast === "north" || coast === "south" ? candidate.x : candidate.y;
    const cross = (candidate: Point) => coast === "north" || coast === "south" ? candidate.y : candidate.x;
    if (along <= axis(coastline[0])) boundary = cross(coastline[0]);
    else if (along >= axis(coastline[coastline.length - 1])) boundary = cross(coastline[coastline.length - 1]);
    else for (let i = 1; i < coastline.length; i++) {
      const a = coastline[i - 1];
      const b = coastline[i];
      if (along > axis(b)) continue;
      const t = (along - axis(a)) / Math.max(1e-6, axis(b) - axis(a));
      boundary = cross(a) + (cross(b) - cross(a)) * t;
      break;
    }
  }
  if (coast === "north") return point.y < (boundary ?? 0);
  if (coast === "south") return point.y > (boundary ?? height);
  if (coast === "west") return point.x < (boundary ?? 0);
  if (coast === "east") return point.x > (boundary ?? width);
  return false;
}

function coastlineDepth(course: Course, coast: CoastEdge, along: number): number {
  const horizontal = coast === "north" || coast === "south";
  const axisLength = horizontal ? course.width : course.height;
  const acrossLength = horizontal ? course.height : course.width;
  const index = Math.max(0, Math.min(axisLength - 1, Math.round(along)));
  let depth = 0;
  while (depth < acrossLength) {
    const x = coast === "west" ? depth : coast === "east" ? course.width - 1 - depth : index;
    const y = coast === "north" ? depth : coast === "south" ? course.height - 1 - depth : index;
    if (course.tiles[y * course.width + x] !== "water") break;
    depth++;
  }
  return depth;
}

function buildCoastline(course: Course, coast: CoastEdge | null, seed: number): Point[] {
  if (!coast) return [];
  const horizontal = coast === "north" || coast === "south";
  const alongLength = horizontal ? course.width : course.height;
  const acrossLength = horizontal ? course.height : course.width;
  const step = 4;
  const maxDepth = Math.max(8, Math.floor(acrossLength * 0.3));
  const toPoint = (along: number, depth: number): Point => {
    if (coast === "north") return { x: along, y: depth };
    if (coast === "south") return { x: along, y: course.height - depth };
    if (coast === "west") return { x: depth, y: along };
    return { x: course.width - depth, y: along };
  };
  const inside: Point[] = [];
  for (let along = 0; along <= alongLength; along += step) {
    inside.push(toPoint(along, Math.max(2, coastlineDepth(course, coast, Math.min(along, alongLength - 1)))));
  }
  if ((horizontal ? inside[inside.length - 1].x : inside[inside.length - 1].y) < alongLength) {
    inside.push(toPoint(alongLength, Math.max(2, coastlineDepth(course, coast, alongLength - 1))));
  }
  const extend = (fromDepth: number, direction: -1 | 1): Point[] => {
    const points: Point[] = [];
    let depth = fromDepth;
    for (let distance = step; distance <= SCENIC_GENERATION_BLEED_TILES; distance += step) {
      const roll = random01(seed, direction * distance, alongLength, 0xc0457);
      if (roll < 0.28) depth--;
      else if (roll > 0.72) depth++;
      depth = Math.max(3, Math.min(maxDepth, depth));
      points.push(toPoint(direction < 0 ? -distance : alongLength + distance, depth));
    }
    return points;
  };
  const firstDepth = coastlineDepth(course, coast, 0);
  const lastDepth = coastlineDepth(course, coast, alongLength - 1);
  return [...extend(firstDepth, -1).reverse(), ...inside, ...extend(lastDepth, 1)];
}

function outsideEstate(x: number, y: number, width: number, height: number, padding = 0): boolean {
  return x < -padding || y < -padding || x > width + padding || y > height + padding;
}

/** Deterministic, render-only regional scenery. It is never saved or simulated. */
export function generateScenicSurround(course: Course, seed: number): ScenicSurroundModel {
  const theme = getBiomeDefinition(course.theme).key;
  const profile = SCENIC_PROFILES[getBiomeDefinition(theme).content.materials.terrain];
  const coast = detectLinksCoast(course);
  const coastline = buildCoastline(course, coast, seed);
  const bleed = SCENIC_GENERATION_BLEED_TILES;
  const cell = 32;
  const patches: ScenicPatch[] = [];
  const kinds = profile.patches;

  for (let gy = -Math.ceil(bleed / cell); gy <= Math.ceil((course.height + bleed) / cell); gy++) {
    for (let gx = -Math.ceil(bleed / cell); gx <= Math.ceil((course.width + bleed) / cell); gx++) {
      if (random01(seed, gx, gy, 0x711d) < 0.34) continue;
      const centerX = gx * cell + cell * (0.3 + random01(seed, gx, gy, 1) * 0.4);
      const centerY = gy * cell + cell * (0.3 + random01(seed, gx, gy, 2) * 0.4);
      const width = 16 + random01(seed, gx, gy, 3) * 24;
      const height = 14 + random01(seed, gx, gy, 4) * 22;
      const corners = [
        { x: centerX - width / 2, y: centerY - height / 2 },
        { x: centerX + width / 2, y: centerY - height / 2 },
        { x: centerX + width / 2, y: centerY + height / 2 },
        { x: centerX - width / 2, y: centerY + height / 2 },
      ];
      const fullyOutsideEstate =
        centerX + width / 2 < 0 || centerY + height / 2 < 0 ||
        centerX - width / 2 > course.width || centerY - height / 2 > course.height;
      if (!fullyOutsideEstate) continue;
      if (corners.some((point) => isScenicOceanPoint(coast, point, course.width, course.height, coastline))) continue;
      patches.push({
        x: centerX - width / 2,
        y: centerY - height / 2,
        width,
        height,
        kind: kinds[hash(seed, gx, gy, 5) % kinds.length],
        shade: random01(seed, gx, gy, 6),
      });
    }
  }

  const landEdges = (["north", "east", "south", "west"] as const).filter((edge) => edge !== coast);
  const roadEdges = landEdges
    .filter((_, index) => random01(seed, index, course.width + course.height, 0x20ad) > 0.38)
    .slice(0, 2);
  const roads: ScenicRoad[] = roadEdges.map((edge, index) => {
    const offset = 9 + Math.round(random01(seed, index, 0, 0x31) * 13);
    const minX = coast === "west" ? 0 : -bleed;
    const maxX = coast === "east" ? course.width : course.width + bleed;
    const minY = coast === "north" ? 0 : -bleed;
    const maxY = coast === "south" ? course.height : course.height + bleed;
    if (edge === "north") return { from: { x: minX, y: -offset }, to: { x: maxX, y: -offset } };
    if (edge === "south") return { from: { x: minX, y: course.height + offset }, to: { x: maxX, y: course.height + offset } };
    if (edge === "west") return { from: { x: -offset, y: minY }, to: { x: -offset, y: maxY } };
    return { from: { x: course.width + offset, y: minY }, to: { x: course.width + offset, y: maxY } };
  });

  const props: ScenicProp[] = [];
  const propOptions = profile.props;
  const propCell = 13;
  for (let gy = -Math.ceil(bleed / propCell); gy <= Math.ceil((course.height + bleed) / propCell); gy++) {
    for (let gx = -Math.ceil(bleed / propCell); gx <= Math.ceil((course.width + bleed) / propCell); gx++) {
      if (random01(seed, gx, gy, 0x90b5) > profile.propDensity) continue;
      const x = gx * propCell + random01(seed, gx, gy, 7) * propCell;
      const y = gy * propCell + random01(seed, gx, gy, 8) * propCell;
      if (!outsideEstate(x, y, course.width, course.height, 3)) continue;
      if (isScenicOceanPoint(coast, { x, y }, course.width, course.height, coastline)) continue;
      props.push({ x, y, type: propOptions[hash(seed, gx, gy, 9) % propOptions.length] });
    }
  }

  return { theme, coast, coastline, patches, roads, props };
}

export function clampScenicCameraCenter(
  point: Point,
  width: number,
  height: number,
  marginX: number,
  marginY: number,
): Point {
  const mx = Math.max(0, Math.min(SCENIC_CAMERA_MARGIN_TILES, marginX));
  const my = Math.max(0, Math.min(SCENIC_CAMERA_MARGIN_TILES, marginY));
  return {
    x: Math.max(-mx, Math.min(width + mx, point.x)),
    y: Math.max(-my, Math.min(height + my, point.y)),
  };
}
