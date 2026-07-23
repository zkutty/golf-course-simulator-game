import { describe, expect, it } from "vitest";
import { DEFAULT_COURSE, DEFAULT_WORLD } from "../models/defaults";
import type { Course, World } from "../models/types";
import {
  FACILITY_MODULE_SPECS,
  applyPropertyCommand,
  analyzeResidentialSafety,
  emptyPropertyCourse,
  emptyPropertyEnterprise,
  propertyAccessCapacity,
  propertyOutingPreview,
  propertySummary,
  propertyUpgradePreview,
  settlePropertyDay,
  type PropertyCommand,
} from "./property";
import { isOwnedTile } from "../estate/estate";

function fixture(): { course: Course; world: World } {
  return {
    course: { ...DEFAULT_COURSE, property: emptyPropertyCourse() },
    world: { ...DEFAULT_WORLD, cash: 500_000, reputation: 82, enterprise: emptyPropertyEnterprise() },
  };
}

function run(course: Course, world: World, command: PropertyCommand): { course: Course; world: World } {
  const result = applyPropertyCommand(course, world, command);
  expect(result.ok, result.message).toBe(true);
  return { course: result.course, world: result.world };
}

describe("property enterprise", () => {
  it("requires access, then improves shared arrival capacity through surface tiers", () => {
    let { course, world } = fixture();
    const blocked = applyPropertyCommand(course, world, { type: "BUILD", kind: "driving_range" });
    expect(blocked.ok).toBe(false);
    expect(blocked.message).toMatch(/road.*parking/i);
    expect(propertyAccessCapacity(course)).toBe(18);

    ({ course, world } = run(course, world, { type: "BUILD", kind: "road" }));
    ({ course, world } = run(course, world, { type: "BUILD", kind: "parking" }));
    expect(propertyAccessCapacity(course)).toBeGreaterThan(18);
    const road = course.property!.assets.find((asset) => asset.kind === "road")!;
    const parking = course.property!.assets.find((asset) => asset.kind === "parking")!;
    ({ course, world } = run(course, world, { type: "UPGRADE", assetId: road.id }));
    ({ course, world } = run(course, world, { type: "UPGRADE", assetId: parking.id }));
    expect(course.property!.assets.find((asset) => asset.id === road.id)?.surface).toBe("dirt");
    expect(propertyAccessCapacity(course)).toBeGreaterThanOrEqual(40);
  });

  it("settles buckets, lessons, upkeep, customer skill, and an idempotent ledger", () => {
    let { course, world } = fixture();
    for (const command of [
      { type: "BUILD", kind: "road" },
      { type: "BUILD", kind: "parking" },
      { type: "BUILD", kind: "driving_range" },
      { type: "BUILD", kind: "putting_green" },
      { type: "BUILD", kind: "clubhouse" },
      { type: "HIRE_PRO" },
      { type: "LAUNCH_MEMBERSHIP" },
    ] as PropertyCommand[]) ({ course, world } = run(course, world, command));

    const skillBefore = propertySummary(course, world).averageCustomerSkill;
    const settled = settlePropertyDay(course, world, 0, 8);
    expect(settled.report.revenue).toBeGreaterThan(0);
    expect(settled.report.costs).toBeGreaterThan(0);
    expect(settled.report.entries.some((entry) => entry.category === "practice")).toBe(true);
    expect(settled.report.entries.some((entry) => entry.category === "lessons")).toBe(true);
    expect(settled.report.entries.some((entry) => entry.category === "membership")).toBe(true);
    expect(propertySummary(settled.course, settled.world).averageCustomerSkill).toBeGreaterThan(skillBefore);
    expect(settled.course.property!.assets.find((asset) => asset.kind === "driving_range")!.condition).toBeLessThan(1);

    const duplicate = settlePropertyDay(settled.course, settled.world, 0, 8);
    expect(duplicate.report).toMatchObject({ revenue: 0, costs: 0, visitors: 0 });
  });

  it("links lodging, dining, retail, events, and residential closings to one customer economy", () => {
    let { course, world } = fixture();
    for (const command of [
      { type: "BUILD", kind: "road" },
      { type: "BUILD", kind: "parking" },
    ] as PropertyCommand[]) ({ course, world } = run(course, world, command));
    for (const asset of [...course.property!.assets]) ({ course, world } = run(course, world, { type: "UPGRADE", assetId: asset.id }));
    for (const command of [
      { type: "BUILD", kind: "clubhouse" },
      { type: "BUILD", kind: "restaurant" },
      { type: "BUILD", kind: "pro_shop" },
      { type: "BUILD", kind: "event_space" },
      { type: "BUILD", kind: "driving_range" },
      { type: "BUILD", kind: "lodge" },
      { type: "BUILD", kind: "hotel" },
      { type: "BUILD", kind: "houses" },
      { type: "BUILD", kind: "safety_buffer" },
      { type: "HIRE_SERVICE", role: "frontDesk" },
      { type: "HIRE_SERVICE", role: "housekeeping" },
      { type: "HIRE_SERVICE", role: "foodService" },
    ] as PropertyCommand[]) ({ course, world } = run(course, world, command));

    const summary = propertySummary(course, world);
    expect(summary.occupiedHomes).toBeGreaterThan(0);
    expect(summary.enterprise.ledger.some((entry) => entry.category === "real_estate")).toBe(true);
    const settled = settlePropertyDay(course, world, 5, 12);
    const categories = new Set(settled.report.entries.map((entry) => entry.category));
    expect(categories).toContain("lodging");
    expect(categories).toContain("food_beverage");
    expect(categories).toContain("retail");
    expect(categories).toContain("events");
    expect(settled.world.enterprise!.reservations.length).toBeGreaterThan(0);
  });

  it("derives residential eligibility from real hole corridors and enforces sold-land tenure", () => {
    const { course: base, world: baseWorld } = fixture();
    const homes = { id: "homes-risk", kind: "houses" as const, name: "Fairway homes", category: "community" as const, tier: 1 as const, x: 20, y: 6, width: 12, height: 8, capacity: 20, condition: 1, price: 0, units: 300, enabled: true, tenure: "sold" as const };
    const course: Course = {
      ...base,
      holes: base.holes.map((hole, index) => index === 0 ? { ...hole, tee: { x: 0, y: 5 }, green: { x: 100, y: 5 } } : hole),
      property: { ...emptyPropertyCourse(), assets: [homes] },
    };
    const exposed = analyzeResidentialSafety(course, homes.id);
    expect(exposed.eligibility).toBe("blocked");
    expect(exposed.contributions[0].holeId).toBe(course.holes[0].id);
    expect(isOwnedTile(course, 21, 7)).toBe(false);

    const protectedCourse: Course = { ...course, property: { ...emptyPropertyCourse(), assets: [...course.property!.assets, { id: "net", kind: "netting", name: "Protective netting", category: "safety", tier: 4, x: 19, y: 6, width: 10, height: 1, capacity: 0, condition: 1, price: 0, enabled: true }] } };
    expect(analyzeResidentialSafety(protectedCourse, homes.id).score).toBeLessThan(exposed.score);

    const world: World = { ...baseWorld, enterprise: { ...emptyPropertyEnterprise(), residents: [{ id: "residents-homes-risk", assetId: homes.id, units: 300, occupied: 100, satisfaction: 70, complaints: 2 }] } };
    const bought = applyPropertyCommand(protectedCourse, world, { type: "BUYBACK", assetId: homes.id });
    expect(bought.ok, bought.message).toBe(true);
    expect(isOwnedTile(bought.course, 21, 7)).toBe(false);
    const remediatedOnce = settlePropertyDay(bought.course, bought.world, 0, 0);
    const remediated = settlePropertyDay(remediatedOnce.course, remediatedOnce.world, 1, 0);
    expect(isOwnedTile(remediated.course, 21, 7)).toBe(true);
    expect(bought.world.enterprise?.residents).toHaveLength(0);
  });

  it("configures practice geometry, operating policy, shell modules, and construction previews atomically", () => {
    let { course, world } = fixture();
    for (const command of [
      { type: "BUILD", kind: "road" },
      { type: "BUILD", kind: "parking" },
      { type: "BUILD", kind: "driving_range" },
      { type: "BUILD", kind: "clubhouse" },
    ] as PropertyCommand[]) ({ course, world } = run(course, world, command));

    const range = course.property!.assets.find((asset) => asset.kind === "driving_range")!;
    const originalRoute = range.route!.points;
    ({ course, world } = run(course, world, { type: "RENAME", assetId: range.id, name: "North Academy Range" }));
    ({ course, world } = run(course, world, { type: "ROTATE_PRACTICE", assetId: range.id }));
    ({ course, world } = run(course, world, { type: "SET_HOURS", assetId: range.id, openHour: 7, closeHour: 16 }));
    ({ course, world } = run(course, world, { type: "SET_UPKEEP", assetId: range.id, policy: "premium" }));
    const configured = course.property!.assets.find((asset) => asset.id === range.id)!;
    expect(configured.route!.points).not.toEqual(originalRoute);
    expect(configured).toMatchObject({ name: "North Academy Range", openHour: 7, closeHour: 16, upkeepPolicy: "premium" });

    ({ course, world } = run(course, world, { type: "INSTALL_MODULE", module: "check_in" }));
    ({ course, world } = run(course, world, { type: "INSTALL_MODULE", module: "pro_shop" }));
    expect(course.property!.assets.find((asset) => asset.kind === "clubhouse")!.modules).toHaveLength(2);
    expect(applyPropertyCommand(course, world, { type: "INSTALL_MODULE", module: "restaurant" }).message).toMatch(/tier 2/i);
    const clubhouse = course.property!.assets.find((asset) => asset.kind === "clubhouse")!;
    const preview = propertyUpgradePreview(course, clubhouse.id)!;
    expect(preview).toMatchObject({ nextTier: 2, capacityDelta: expect.any(Number), parkingDemandDelta: expect.any(Number), downtimeDays: 1 });
    expect(preview.cost).toBeGreaterThan(FACILITY_MODULE_SPECS.check_in.buildCost);
    ({ course, world } = run(course, world, { type: "UPGRADE", assetId: clubhouse.id }));
    ({ course, world } = run(course, world, { type: "INSTALL_MODULE", module: "restaurant" }));
    expect(course.property!.assets.find((asset) => asset.kind === "clubhouse")).toMatchObject({ tier: 2, constructionDaysRemaining: 1 });

    const settled = settlePropertyDay(course, world, 1, 4);
    const settledRange = settled.course.property!.assets.find((asset) => asset.id === range.id)!;
    expect(settledRange.lastDay).toMatchObject({ demand: expect.any(Number), served: expect.any(Number), denied: expect.any(Number), revenue: expect.any(Number) });
    expect(settled.course.property!.assets.find((asset) => asset.kind === "clubhouse")!.constructionDaysRemaining).toBe(0);
  });

  it("previews, books, persists, and refunds capacity-backed outing packages", () => {
    let { course, world } = fixture();
    course = {
      ...course,
      holes: course.holes.map((hole, index) => index === 0 ? { ...hole, tee: { x: 40, y: 40 }, green: { x: 52, y: 48 } } : hole),
    };
    for (const command of [
      { type: "BUILD", kind: "road" },
      { type: "BUILD", kind: "parking" },
    ] as PropertyCommand[]) ({ course, world } = run(course, world, command));
    for (let step = 0; step < 2; step++) {
      for (const kind of ["road", "parking"] as const) {
        const asset = course.property!.assets.find((candidate) => candidate.kind === kind)!;
        ({ course, world } = run(course, world, { type: "UPGRADE", assetId: asset.id }));
      }
    }
    for (const command of [
      { type: "BUILD", kind: "clubhouse" },
      { type: "BUILD", kind: "event_space" },
    ] as PropertyCommand[]) ({ course, world } = run(course, world, command));

    const preview = propertyOutingPreview(course, world, "golf_only");
    expect(preview.blockers).toEqual([]);
    expect(preview.gross).toBeGreaterThan(preview.variableCost);
    const cashBefore = world.cash;
    ({ course, world } = run(course, world, { type: "BOOK_OUTING", package: "golf_only" }));
    const outing = world.enterprise!.outings.at(-1)!;
    expect(outing).toMatchObject({ package: "golf_only", status: "scheduled", guests: preview.guests });
    expect(world.cash).toBe(cashBefore + preview.deposit);
    ({ course, world } = run(course, world, { type: "CANCEL_OUTING", outingId: outing.id }));
    expect(world.enterprise!.outings.at(-1)?.status).toBe("cancelled");
    expect(world.enterprise!.ledger.at(-1)).toMatchObject({ category: "events", grossRevenue: 0, netContribution: -Math.round(preview.deposit * 0.8) });
  });
});
