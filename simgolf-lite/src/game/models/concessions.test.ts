import { describe, expect, it } from "vitest";
import type { Course, Terrain } from "./types";
import { DEFAULT_COURSE } from "./defaults";
import { BUILDING_SPECS, buildingFootprintSet, canPlaceBuilding } from "./buildings";
import {
  buildingAt,
  buildingPricing,
  buildingTier,
  concessionAppeal,
  concessionItemPrice,
  concessionSalvageValue,
  concessionsOnCourse,
  isConcession,
  servicePoint,
  tierUpgradeCost,
} from "./concessions";
import { BALANCE } from "../balance/balanceConfig";
import { applyAction } from "../../core/reducer";
import { DEFAULT_STATE, type GameState } from "../gameState";

function flatCourse(width = 20, height = 20): Course {
  return {
    ...DEFAULT_COURSE,
    width,
    height,
    tiles: Array.from({ length: width * height }, () => "fairway" as Terrain),
    elevations: Array.from({ length: width * height }, () => 0),
    holes: [],
    obstacles: [],
    buildings: [],
  };
}

function stateWith(course: Course, cash = 50_000): GameState {
  return {
    ...DEFAULT_STATE,
    course,
    world: { ...DEFAULT_STATE.world, cash },
  };
}

describe("concession specs and placement", () => {
  it("registers all three concession types with valid footprints", () => {
    for (const t of ["proshop", "snackbar", "cartrental"] as const) {
      const spec = BUILDING_SPECS[t];
      expect(spec.w).toBeGreaterThan(0);
      expect(spec.d).toBeGreaterThan(0);
      expect(isConcession(t)).toBe(true);
    }
    expect(isConcession("clubhouse")).toBe(false);
  });

  it("canPlaceBuilding validates concessions like any building", () => {
    const c = flatCourse();
    expect(canPlaceBuilding(c, "snackbar", 5, 5).ok).toBe(true);
    expect(canPlaceBuilding(c, "proshop", 19, 5).ok).toBe(false); // 2 wide, oob
    c.buildings = [{ type: "snackbar", x: 5, y: 5 }];
    expect(canPlaceBuilding(c, "proshop", 4, 4).ok).toBe(false); // overlap
  });
});

describe("concession economics", () => {
  it("prices scale with tier and pricing level", () => {
    const base = concessionItemPrice({ type: "snackbar", x: 0, y: 0 });
    const t3 = concessionItemPrice({ type: "snackbar", x: 0, y: 0, tier: 3 });
    const premium = concessionItemPrice({ type: "snackbar", x: 0, y: 0, pricing: "premium" });
    const budget = concessionItemPrice({ type: "snackbar", x: 0, y: 0, pricing: "budget" });
    expect(base).toBe(BALANCE.concessions.buildings.snackbar.itemPrice);
    expect(t3).toBeGreaterThan(base);
    expect(premium).toBeGreaterThan(base);
    expect(budget).toBeLessThan(base);
  });

  it("appeal favors budget pricing and higher tiers", () => {
    const std = concessionAppeal({ type: "proshop", x: 0, y: 0 });
    expect(concessionAppeal({ type: "proshop", x: 0, y: 0, pricing: "budget" })).toBeGreaterThan(std);
    expect(concessionAppeal({ type: "proshop", x: 0, y: 0, pricing: "premium" })).toBeLessThan(std);
    expect(concessionAppeal({ type: "proshop", x: 0, y: 0, tier: 3 })).toBeGreaterThan(std);
  });

  it("tier upgrades cost money and cap at tier 3", () => {
    const b = { type: "cartrental" as const, x: 0, y: 0 };
    expect(tierUpgradeCost(b)).toBeGreaterThan(0);
    expect(tierUpgradeCost({ ...b, tier: 3 })).toBeNull();
    // Upgraded buildings salvage for more than fresh ones.
    expect(concessionSalvageValue({ ...b, tier: 3 })).toBeGreaterThan(concessionSalvageValue(b));
  });

  it("servicePoint returns a walkable tile adjacent to the footprint", () => {
    const c = flatCourse();
    const b = { type: "proshop" as const, x: 8, y: 8 };
    c.buildings = [b];
    const p = servicePoint(c, b)!;
    expect(p).not.toBeNull();
    const blocked = buildingFootprintSet(c);
    expect(blocked.has(p.y * c.width + p.x)).toBe(false);
    // adjacent: within 1 tile of the footprint rect
    expect(p.x).toBeGreaterThanOrEqual(b.x - 1);
    expect(p.x).toBeLessThanOrEqual(b.x + 2);
    expect(p.y).toBeGreaterThanOrEqual(b.y - 1);
    expect(p.y).toBeLessThanOrEqual(b.y + 2);
  });
});

describe("building reducer actions", () => {
  it("PLACE_BUILDING charges the build cost and appends the building", () => {
    const s0 = stateWith(flatCourse());
    const s1 = applyAction(s0, { type: "PLACE_BUILDING", buildingType: "snackbar", x: 5, y: 5 });
    expect(s1.course.buildings).toHaveLength(1);
    expect(s1.world.cash).toBe(s0.world.cash - BALANCE.concessions.buildings.snackbar.buildCost);
    expect(s1.obstaclesVersion).toBe(s0.obstaclesVersion + 1);
    expect(s1.economyVersion).toBe(s0.economyVersion + 1);
  });

  it("PLACE_BUILDING refuses invalid sites", () => {
    const c = flatCourse();
    c.tiles[5 * 20 + 5] = "water";
    const s0 = stateWith(c);
    const s1 = applyAction(s0, { type: "PLACE_BUILDING", buildingType: "snackbar", x: 5, y: 5 });
    expect(s1.course.buildings).toHaveLength(0);
    expect(s1.world.cash).toBe(s0.world.cash);
  });

  it("REMOVE_BUILDING refunds salvage; the clubhouse is protected", () => {
    const c = flatCourse();
    c.buildings = [
      { type: "clubhouse", x: 1, y: 1 },
      { type: "snackbar", x: 10, y: 10 },
    ];
    const s0 = stateWith(c);
    const s1 = applyAction(s0, { type: "REMOVE_BUILDING", x: 10, y: 10 });
    expect(s1.course.buildings).toHaveLength(1);
    expect(s1.world.cash).toBe(s0.world.cash + BALANCE.concessions.buildings.snackbar.salvage);
    const s2 = applyAction(s1, { type: "REMOVE_BUILDING", x: 2, y: 2 });
    expect(s2.course.buildings).toHaveLength(1); // clubhouse untouched
  });

  it("CONFIGURE_BUILDING upgrades tier (charged) and re-prices (free)", () => {
    const c = flatCourse();
    c.buildings = [{ type: "proshop", x: 8, y: 8 }];
    const s0 = stateWith(c);
    const s1 = applyAction(s0, { type: "CONFIGURE_BUILDING", x: 8, y: 8, upgradeTier: true });
    expect(buildingTier(s1.course.buildings[0])).toBe(2);
    expect(s1.world.cash).toBeLessThan(s0.world.cash);
    const s2 = applyAction(s1, { type: "CONFIGURE_BUILDING", x: 8, y: 8, pricing: "premium" });
    expect(buildingPricing(s2.course.buildings[0])).toBe("premium");
    expect(s2.world.cash).toBe(s1.world.cash);
    // Tier caps at 3.
    const s3 = applyAction(s2, { type: "CONFIGURE_BUILDING", x: 8, y: 8, upgradeTier: true });
    const s4 = applyAction(s3, { type: "CONFIGURE_BUILDING", x: 8, y: 8, upgradeTier: true });
    expect(buildingTier(s4.course.buildings[0])).toBe(3);
    expect(s4.world.cash).toBe(s3.world.cash);
  });

  it("buildingAt finds buildings by any covered tile", () => {
    const c = flatCourse();
    c.buildings = [{ type: "proshop", x: 8, y: 8 }];
    expect(buildingAt(c, 9, 9)?.type).toBe("proshop");
    expect(buildingAt(c, 10, 8)).toBeNull();
    expect(concessionsOnCourse(c)).toHaveLength(1);
  });
});
