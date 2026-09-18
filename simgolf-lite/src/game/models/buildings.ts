import type {
  Building,
  BuildingSiteGradeRecordV1,
  BuildingTier,
  BuildingType,
  ConcessionType,
  Course,
  Point,
  LandTheme,
} from "./types";
import { isOwnedTile } from "../estate/estate";
import { getBiomeDefinition } from "./biomes";
import { planBuildingSiteGrade, type BuildingSiteGradePlan } from "./buildingSiteGrade";

/**
 * Building registry + placement rules (ZKU-152).
 *
 * This is the renderer-facing API that M4's concessions (ZKU-117) extend:
 * adding a new building type is one spec entry + one atlas frame — no
 * renderer changes.
 */

export interface BuildingSpec {
  type: BuildingType;
  name: string;
  /** Footprint in tiles (width along world x, depth along world y). */
  w: number;
  d: number;
  /** Atlas frame name (see src/render/atlas.ts). */
  frame: string;
  buildCost: number;
  defaultPrice?: number;
  item?: string;
  serviceMinutes?: number;
  capacity?: number;
}

export type BuildingVisualFrame = `${LandTheme}_${BuildingType}_t${BuildingTier}`;

/** Theme/tier visual selection follows the registry's structure owner. */
export function buildingVisualFrame(building: Building, theme: LandTheme = "parkland"): BuildingVisualFrame {
  const tier: BuildingTier = building.type === "clubhouse" ? 1 : (building.tier ?? 1);
  const owner = getBiomeDefinition(theme).content.structures.buildings;
  return `${owner}_${building.type}_t${tier}`;
}

export const BUILDING_SPECS: Record<BuildingType, BuildingSpec> = {
  clubhouse: {
    type: "clubhouse", name: "Clubhouse", w: 3, d: 3, frame: "clubhouse", buildCost: 0,
  },
  pro_shop: {
    type: "pro_shop", name: "Pro Shop", w: 2, d: 2, frame: "pro_shop",
    buildCost: 8_000, defaultPrice: 28, item: "Golf merchandise", serviceMinutes: 6, capacity: 3,
  },
  snack_bar: {
    type: "snack_bar", name: "Snack Bar", w: 2, d: 2, frame: "snack_bar",
    buildCost: 4_500, defaultPrice: 9, item: "Food & drink", serviceMinutes: 4, capacity: 4,
  },
  cart_rental: {
    type: "cart_rental", name: "Cart Rental", w: 2, d: 2, frame: "cart_rental",
    buildCost: 6_500, defaultPrice: 18, item: "Cart rental", serviceMinutes: 5, capacity: 5,
  },
};

export const CONCESSION_TYPES: readonly ConcessionType[] = [
  "pro_shop", "snack_bar", "cart_rental",
] as const;

export const MAX_BUILDING_SUPPORT_DELTA = 3 as const;
export const MAX_BUILDING_GRADE_DELTA = 4 as const;

export type BuildingPlacementBlocker =
  | "out_of_bounds"
  | "ownership_boundary"
  | "water_or_wetland"
  | "excessive_slope"
  | "unusable_entrance"
  | "building_overlap"
  | "marker_conflict"
  | "obstacle_conflict";

export interface BuildingPlacementQuote {
  readonly ok: boolean;
  readonly reasonCode?: BuildingPlacementBlocker;
  readonly reason?: string;
  readonly buildingCost: number;
  readonly earthworkCost: number;
  readonly foundationCost: number;
  readonly totalCost: number;
  readonly grade?: BuildingSiteGradePlan;
  readonly entrance?: Point;
}

export function isConcessionType(type: BuildingType): type is ConcessionType {
  return type !== "clubhouse";
}

export function isConcession(building: Building): building is Building & { type: ConcessionType } {
  return isConcessionType(building.type);
}

export function normalizedBuilding(building: Building): Building {
  const rawGrade = building.siteGrade;
  const siteGrade = rawGrade
    && rawGrade.version === 1
    && Number.isInteger(rawGrade.supportElevation)
    && Number.isInteger(rawGrade.cutSteps) && rawGrade.cutSteps >= 0
    && Number.isInteger(rawGrade.fillSteps) && rawGrade.fillSteps >= 0
    && Number.isFinite(rawGrade.earthworkCost) && rawGrade.earthworkCost >= 0
    && Number.isFinite(rawGrade.foundationCost) && rawGrade.foundationCost >= 0
    && Number.isFinite(rawGrade.totalSiteCost) && rawGrade.totalSiteCost >= 0
      ? { ...rawGrade } satisfies BuildingSiteGradeRecordV1
      : undefined;
  const { siteGrade: _ignoredGrade, ...safeBuilding } = building;
  const identified = {
    ...safeBuilding,
    id: building.id || `building-${building.type}-${building.x}-${building.y}`,
    ...(siteGrade ? { siteGrade } : {}),
  };
  if (!isConcession(identified)) return identified;
  const spec = BUILDING_SPECS[identified.type];
  const tier = ([1, 2, 3] as BuildingTier[]).includes(identified.tier as BuildingTier)
    ? identified.tier as BuildingTier
    : 1;
  const price = Number.isFinite(identified.price)
    ? Math.max(1, Math.round(identified.price as number))
    : spec.defaultPrice!;
  return { ...identified, tier, price };
}

export function buildingSpec(b: Building): BuildingSpec {
  return BUILDING_SPECS[b.type];
}

/** Tiles covered by a building (for pathfinding and overlap checks). */
export function buildingTiles(b: Building): Array<{ x: number; y: number }> {
  const spec = buildingSpec(b);
  const out: Array<{ x: number; y: number }> = [];
  for (let y = b.y; y < b.y + spec.d; y++) {
    for (let x = b.x; x < b.x + spec.w; x++) out.push({ x, y });
  }
  return out;
}

export function buildingAtTile(course: Course, x: number, y: number): Building | undefined {
  return (course.buildings ?? []).find((building) => {
    const spec = buildingSpec(building);
    return x >= building.x && x < building.x + spec.w && y >= building.y && y < building.y + spec.d;
  });
}

/** Door/queue tile: nearest passable tile immediately in front of a structure. */
export function buildingEntrance(course: Course, building: Building): Point {
  return buildingEntranceCandidates(course, building)[0] ?? { x: building.x, y: building.y };
}

/** Ordered deterministic door approaches (front, right, left, rear). */
export function buildingEntranceCandidates(course: Course, building: Building): Point[] {
  const spec = buildingSpec(building);
  const candidates: Point[] = [
    { x: building.x + Math.floor(spec.w / 2), y: building.y + spec.d },
    { x: building.x + spec.w, y: building.y + Math.floor(spec.d / 2) },
    { x: building.x - 1, y: building.y + Math.floor(spec.d / 2) },
    { x: building.x + Math.floor(spec.w / 2), y: building.y - 1 },
  ];
  return candidates.filter((p) => {
    if (p.x < 0 || p.y < 0 || p.x >= course.width || p.y >= course.height) return false;
    const terrain = course.tiles[p.y * course.width + p.x];
    if (terrain === "water" || terrain === "wetland" || !isOwnedTile(course, p.x, p.y)) return false;
    if (buildingAtTile(course, p.x, p.y)) return false;
    return !(course.obstacles ?? []).some((obstacle) => obstacle.x === p.x && obstacle.y === p.y);
  });
}

/** Fast lookup set of all building-covered tile indices for a course. */
export function buildingFootprintSet(course: Course): Set<number> {
  const set = new Set<number>();
  for (const b of course.buildings ?? []) {
    for (const t of buildingTiles(b)) {
      if (t.x >= 0 && t.y >= 0 && t.x < course.width && t.y < course.height) {
        set.add(t.y * course.width + t.x);
      }
    }
  }
  return set;
}

/**
 * Placement validation: in bounds, near-flat footprint (max 1 elevation
 * step, matching tee/green sites — the Level sculpt brush prepares pads),
 * no water, no tee/green markers, no obstacles, no building overlap.
 */
function blocked(
  reasonCode: BuildingPlacementBlocker,
  reason: string,
  buildingCost: number,
): BuildingPlacementQuote {
  return { ok: false, reasonCode, reason, buildingCost, earthworkCost: 0, foundationCost: 0, totalCost: buildingCost };
}

function foundationCostFor(plan: BuildingSiteGradePlan, costMult: number): number {
  const retainedEdgeSteps = plan.exposedEdges.reduce((total, edge) => total + Math.max(0, edge.magnitude - 1), 0);
  const bearingSteps = plan.maximumSupportDelta * plan.footprint.length;
  return Math.round((bearingSteps * 45 + retainedEdgeSteps * 90) * costMult);
}

/**
 * Complete pre-commit quote for shell, grading, foundation, and usable access.
 * The footprint and its one-cell engineering ring are treated as one atomic site.
 */
export function quoteBuildingPlacement(
  course: Course,
  type: BuildingType,
  x: number,
  y: number,
  costMult = 1,
): BuildingPlacementQuote {
  const spec = BUILDING_SPECS[type];
  const buildingCost = spec.buildCost;
  if (x < 0 || y < 0 || x + spec.w > course.width || y + spec.d > course.height) {
    return blocked("out_of_bounds", "footprint is out of bounds", buildingCost);
  }
  const site: Array<Point & { role: "footprint" | "transition" }> = [];
  for (let ty = y - 1; ty <= y + spec.d; ty++) for (let tx = x - 1; tx <= x + spec.w; tx++) {
    const role = tx >= x && tx < x + spec.w && ty >= y && ty < y + spec.d ? "footprint" : "transition";
    if (tx < 0 || ty < 0 || tx >= course.width || ty >= course.height) {
      return blocked("ownership_boundary", "engineering ring crosses the estate boundary", buildingCost);
    }
    site.push({ x: tx, y: ty, role });
  }
  for (const cell of site) {
    if (!isOwnedTile(course, cell.x, cell.y)) {
      return blocked("ownership_boundary", "engineered site crosses an unowned property boundary", buildingCost);
    }
    const terrain = course.tiles[cell.y * course.width + cell.x];
    if (terrain === "water" || terrain === "wetland") {
      return blocked("water_or_wetland", `${cell.role} crosses ${terrain}`, buildingCost);
    }
  }
  const occupied = buildingFootprintSet(course);
  for (const cell of site) {
    const idx = cell.y * course.width + cell.x;
    if (occupied.has(idx)) {
      return blocked("building_overlap", `${cell.role} overlaps a building`, buildingCost);
    }
  }
  for (const hole of course.holes) {
    for (const marker of [hole.tee, hole.green]) {
      if (!marker) continue;
      if (site.some((cell) => cell.x === marker.x && cell.y === marker.y)) {
        return blocked("marker_conflict", "engineered site covers a tee or green", buildingCost);
      }
    }
  }
  const entrance = buildingEntranceCandidates(course, { type, x, y })[0];
  if (!entrance) return blocked("unusable_entrance", "building has no usable owned entrance", buildingCost);
  for (const obs of course.obstacles ?? []) {
    if (site.some((cell) => cell.x === obs.x && cell.y === obs.y)) {
      return blocked("obstacle_conflict", "engineered site is blocked by an obstacle", buildingCost);
    }
  }
  const grade = planBuildingSiteGrade(course, { type, x, y }, { costMult });
  if (
    grade.maximumSupportDelta > MAX_BUILDING_SUPPORT_DELTA
    || grade.maximumDelta > MAX_BUILDING_GRADE_DELTA
    || grade.maximumExposedEdgeDelta > MAX_BUILDING_GRADE_DELTA
  ) {
    return blocked(
      "excessive_slope",
      `site is too steep to engineer safely (support ${grade.maximumSupportDelta}, earthwork ${grade.maximumDelta}, edge ${grade.maximumExposedEdgeDelta})`,
      buildingCost,
    );
  }
  const earthworkCost = Math.round(grade.costBaseline.total);
  const foundationCost = foundationCostFor(grade, costMult);
  return {
    ok: true,
    buildingCost,
    earthworkCost,
    foundationCost,
    totalCost: buildingCost + earthworkCost + foundationCost,
    grade,
    entrance,
  };
}

export function canPlaceBuilding(
  course: Course,
  type: BuildingType,
  x: number,
  y: number,
): { ok: boolean; reason?: string } {
  const quote = quoteBuildingPlacement(course, type, x, y);
  return quote.ok ? { ok: true } : { ok: false, reason: quote.reason };
}

export function buildingSiteGradeRecord(quote: BuildingPlacementQuote): BuildingSiteGradeRecordV1 | undefined {
  if (!quote.ok || !quote.grade) return undefined;
  return {
    version: 1,
    supportElevation: quote.grade.supportElevation,
    cutSteps: quote.grade.costBaseline.cutSteps,
    fillSteps: quote.grade.costBaseline.fillSteps,
    earthworkCost: quote.earthworkCost,
    foundationCost: quote.foundationCost,
    totalSiteCost: quote.earthworkCost + quote.foundationCost,
  };
}

export function applyBuildingSiteGrade(course: Course, plan: BuildingSiteGradePlan): Course {
  if (plan.mutations.length === 0) return course;
  const elevations = course.elevations?.length === course.width * course.height
    ? course.elevations.slice()
    : new Array(course.width * course.height).fill(0);
  for (const mutation of plan.mutations) elevations[mutation.index] = mutation.after;
  return { ...course, elevations };
}

export function buildingSupportElevation(course: Course, building: Building): number {
  if (building.siteGrade?.version === 1 && Number.isFinite(building.siteGrade.supportElevation)) {
    return building.siteGrade.supportElevation;
  }
  return planBuildingSiteGrade(course, building).supportElevation;
}

export function buildingSiteNeedsRepair(course: Course, building: Building): boolean {
  return planBuildingSiteGrade(course, building).mutations.length > 0;
}

export function quoteBuildingSiteRepair(
  course: Course,
  building: Building,
  costMult = 1,
): BuildingPlacementQuote {
  const withoutTarget = { ...course, buildings: (course.buildings ?? []).filter((candidate) => candidate !== building) };
  const quote = quoteBuildingPlacement(withoutTarget, building.type, building.x, building.y, costMult);
  if (!quote.ok) return quote;
  return { ...quote, buildingCost: 0, totalCost: quote.earthworkCost + quote.foundationCost };
}

/**
 * Find a starter clubhouse site deterministically. A naturally stable site
 * wins immediately in the center-out scan. If the generated course has no
 * such site, choose the valid engineered site with the lowest site-work cost,
 * then use row-major coordinates as a stable tie-break.
 */
export function findClubhouseSpot(course: Course): { x: number; y: number } | null {
  const spec = BUILDING_SPECS.clubhouse;
  const cx = Math.floor(course.width / 2 - spec.w / 2);
  const cy = Math.floor(course.height / 2 - spec.d / 2);
  const engineered: Array<{ x: number; y: number; siteCost: number }> = [];
  for (let r = 0; r < Math.max(course.width, course.height); r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue; // ring only
        const x = cx + dx;
        const y = cy + dy;
        const quote = quoteBuildingPlacement(course, "clubhouse", x, y);
        // Preserve the center-out preference for a naturally stable full site.
        if (quote.ok && quote.grade?.mutations.length === 0) return { x, y };
        if (quote.ok && quote.grade) {
          engineered.push({
            x,
            y,
            siteCost: quote.earthworkCost + quote.foundationCost,
          });
        }
      }
    }
  }
  engineered.sort((a, b) => a.siteCost - b.siteCost || a.y - b.y || a.x - b.x);
  const fallback = engineered[0];
  return fallback ? { x: fallback.x, y: fallback.y } : null;
}

/** Grade and install the included starter structure without touching run cash. */
export function installStarterClubhouse(course: Course): Course {
  const spot = findClubhouseSpot(course);
  if (!spot) return course;
  const quote = quoteBuildingPlacement(course, "clubhouse", spot.x, spot.y);
  if (!quote.ok || !quote.grade) return course;
  const graded = applyBuildingSiteGrade(course, quote.grade);
  return {
    ...graded,
    buildings: [{
      id: `building-clubhouse-${spot.x}-${spot.y}`,
      type: "clubhouse",
      ...spot,
      siteGrade: buildingSiteGradeRecord(quote),
    }],
  };
}
