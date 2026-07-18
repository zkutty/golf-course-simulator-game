import type {
  Building,
  BuildingPricing,
  BuildingTier,
  BuildingType,
  ConcessionType,
  Course,
  Point,
} from "./types";
import { BALANCE } from "../balance/balanceConfig";
import { BUILDING_SPECS, buildingFootprintSet, buildingSpec } from "./buildings";

/**
 * Concession economics (M4, ZKU-117/118): pure helpers shared by the editor,
 * the live purchase model, and the weekly P&L rollup. All tunables live in
 * BALANCE.concessions.
 */

export const CONCESSION_TYPES = ["proshop", "snackbar", "cartrental"] as const;

export function isConcession(type: BuildingType): type is ConcessionType {
  return type !== "clubhouse";
}

export function concessionsOnCourse(course: Course): Building[] {
  return (course.buildings ?? []).filter((b) => isConcession(b.type));
}

export function buildingTier(b: Building): BuildingTier {
  return b.tier ?? 1;
}

export function buildingPricing(b: Building): BuildingPricing {
  return b.pricing ?? "standard";
}

export function concessionBuildCost(type: ConcessionType, costMult = 1): number {
  return BALANCE.concessions.buildings[type].buildCost * costMult;
}

export function concessionSalvageValue(b: Building, costMult = 1): number {
  if (!isConcession(b.type)) return 0;
  const cfg = BALANCE.concessions.buildings[b.type];
  // Tier upgrades salvage at the same fraction as the base building.
  const upgradeSpend =
    (buildingTier(b) - 1) * cfg.buildCost * BALANCE.concessions.tierUpgradeCostFrac;
  return (cfg.salvage + upgradeSpend * (cfg.salvage / cfg.buildCost)) * costMult;
}

export function tierUpgradeCost(b: Building, costMult = 1): number | null {
  if (!isConcession(b.type) || buildingTier(b) >= 3) return null;
  const cfg = BALANCE.concessions.buildings[b.type];
  return cfg.buildCost * BALANCE.concessions.tierUpgradeCostFrac * costMult;
}

/** Ticket price of one sale at this building (tier and pricing applied). */
export function concessionItemPrice(b: Building): number {
  if (!isConcession(b.type)) return 0;
  const cfg = BALANCE.concessions.buildings[b.type];
  const tierMult = BALANCE.concessions.tierPriceMult[buildingTier(b) - 1] ?? 1;
  const priceMult = BALANCE.concessions.pricing[buildingPricing(b)].priceMult;
  return Math.round(cfg.itemPrice * tierMult * priceMult);
}

/** Cost of goods behind one sale at this building. */
export function concessionGoodsCost(b: Building): number {
  if (!isConcession(b.type)) return 0;
  return concessionItemPrice(b) * BALANCE.concessions.buildings[b.type].goodsCostFrac;
}

/**
 * How attractive the counter looks before price is even read: nicer tiers
 * add appeal, premium pricing repels, budget pricing draws people in.
 * Signed, roughly -0.12..+0.26.
 */
export function concessionAppeal(b: Building): number {
  if (!isConcession(b.type)) return 0;
  return (
    (BALANCE.concessions.tierAppealBonus[buildingTier(b) - 1] ?? 0) +
    BALANCE.concessions.pricing[buildingPricing(b)].appeal
  );
}

/**
 * The walkable tile a golfer stands on to be served: preferably centered on
 * the south face of the footprint (buildings anchor their door there), else
 * the first open tile walking the perimeter. Null when fully bricked in.
 */
export function servicePoint(course: Course, b: Building): Point | null {
  const spec = buildingSpec(b);
  const occupied = buildingFootprintSet(course);
  const open = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= course.width || y >= course.height) return false;
    const idx = y * course.width + x;
    if (course.tiles[idx] === "water") return false;
    return !occupied.has(idx);
  };
  const southY = b.y + spec.d;
  const preferred: Point = { x: b.x + Math.floor((spec.w - 1) / 2), y: southY };
  if (open(preferred.x, preferred.y)) return preferred;
  const candidates: Point[] = [];
  for (let x = b.x - 1; x <= b.x + spec.w; x++) {
    candidates.push({ x, y: b.y - 1 }, { x, y: southY });
  }
  for (let y = b.y; y < southY; y++) {
    candidates.push({ x: b.x - 1, y }, { x: b.x + spec.w, y });
  }
  for (const p of candidates) if (open(p.x, p.y)) return p;
  return null;
}

/** Building whose footprint covers the tile, if any. */
export function buildingAt(course: Course, x: number, y: number): Building | null {
  for (const b of course.buildings ?? []) {
    const spec = BUILDING_SPECS[b.type];
    if (!spec) continue;
    if (x >= b.x && x < b.x + spec.w && y >= b.y && y < b.y + spec.d) return b;
  }
  return null;
}
