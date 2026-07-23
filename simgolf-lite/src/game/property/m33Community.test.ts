import { describe, expect, it } from "vitest";
import { DEFAULT_COURSE, DEFAULT_WORLD } from "../models/defaults";
import type { Course, World } from "../models/types";
import { isOwnedTile } from "../estate/estate";
import {
  analyzeResidentialSafety,
  applyPropertyCommand,
  emptyPropertyCourse,
  emptyPropertyEnterprise,
  normalizePropertyCourse,
  normalizePropertyEnterprise,
  residentialDevelopmentPreview,
  settlePropertyDay,
  type PropertyCommand,
} from "./property";
import type { PropertyAsset, PropertyShotTrace, ResidentHousehold, ResidentialStrategy } from "./types";

function fixture(): { course: Course; world: World } {
  return {
    course: { ...DEFAULT_COURSE, property: emptyPropertyCourse() },
    world: { ...DEFAULT_WORLD, cash: 5_000_000, reputation: 88, runSeed: 987, enterprise: emptyPropertyEnterprise() },
  };
}

function command(course: Course, world: World, action: PropertyCommand) {
  const result = applyPropertyCommand(course, world, action);
  expect(result.ok, result.message).toBe(true);
  return { course: result.course, world: result.world };
}

function withAccess(input = fixture()) {
  let { course, world } = input;
  ({ course, world } = command(course, world, { type: "BUILD", kind: "road" }));
  ({ course, world } = command(course, world, { type: "BUILD", kind: "parking" }));
  for (const kind of ["road", "parking"] as const) {
    const asset = course.property!.assets.find((candidate) => candidate.kind === kind)!;
    ({ course, world } = command(course, world, { type: "UPGRADE", assetId: asset.id }));
  }
  return { course, world };
}

function finishPhase(course: Course, world: World) {
  for (let day = 0; day < 5; day++) {
    const settled = settlePropertyDay(course, world, day, 0);
    course = settled.course;
    world = settled.world;
  }
  return { course, world };
}

describe("M33 golf community, real estate, and safety", () => {
  it.each(["sell", "retain", "partner"] satisfies ResidentialStrategy[])("plans, constructs, releases, and reconciles the %s strategy once", (strategy) => {
    let { course, world } = withAccess();
    const preview = residentialDevelopmentPreview(course, world, "houses", strategy);
    expect(preview.blockers).toEqual([]);
    expect(preview.playerCapital).toBe(strategy === "partner" ? Math.round(preview.developmentCost * 0.46) : preview.developmentCost);

    ({ course, world } = command(course, world, { type: "PLAN_DEVELOPMENT", kind: "houses", strategy, confirmed: true }));
    expect(course.property!.developments[0]).toMatchObject({ strategy, status: "construction" });
    expect(course.property!.units).toHaveLength(preview.units);
    expect(course.property!.easements).toHaveLength(3);
    const developmentAsset = course.property!.assets.find((asset) => asset.developmentId)!;
    expect(isOwnedTile(course, developmentAsset.x + 1, developmentAsset.y + 1)).toBe(false);
    expect(applyPropertyCommand(course, world, { type: "MOVE", assetId: developmentAsset.id, dx: 1, dy: 0 }).ok).toBe(false);

    ({ course, world } = finishPhase(course, world));
    const development = course.property!.developments[0];
    expect(development.status).toBe(strategy === "sell" ? "sold_out" : "complete");
    expect(course.property!.units.some((unit) => !!unit.householdId)).toBe(true);
    expect(world.enterprise!.residents.length).toBeGreaterThan(0);
    expect(world.enterprise!.customers.some((customer) => customer.segment === "resident")).toBe(true);
    expect(course.property!.assets.find((asset) => asset.id === developmentAsset.id)?.tenure).toBe(strategy === "sell" ? "sold" : strategy === "retain" ? "retained" : "partnered");
    expect(world.enterprise!.ledger.filter((entry) => entry.description.includes(development.name))).toHaveLength(2);
    expect(applyPropertyCommand(course, world, { type: "PLAN_DEVELOPMENT", kind: "houses", strategy, confirmed: true }).ok).toBe(false);

    if (strategy === "retain") {
      const next = settlePropertyDay(course, world, 6, 0);
      const rent = next.report.entries.find((entry) => entry.description.includes("retained rent"));
      expect(rent?.revenue).toBeGreaterThan(0);
      expect(rent?.cost).toBeGreaterThan(0);
      expect(course.property!.units.some((unit) => unit.status === "vacant")).toBe(true);
    }
  });

  it("requires explicit irreversible confirmation and preserves atomic stable identities through JSON migration", () => {
    let { course, world } = withAccess();
    const rejected = applyPropertyCommand(course, world, { type: "PLAN_DEVELOPMENT", kind: "condos", strategy: "partner" });
    expect(rejected.ok).toBe(false);
    expect(rejected.message).toMatch(/confirm/i);
    ({ course, world } = command(course, world, { type: "PLAN_DEVELOPMENT", kind: "condos", strategy: "partner", confirmed: true }));

    const normalizedCourse = normalizePropertyCourse(JSON.parse(JSON.stringify(course.property)));
    const normalizedEnterprise = normalizePropertyEnterprise(JSON.parse(JSON.stringify(world.enterprise)));
    expect(normalizedCourse.version).toBe(2);
    expect(normalizedEnterprise.version).toBe(3);
    expect(new Set(normalizedCourse.units.map((unit) => unit.id)).size).toBe(normalizedCourse.units.length);
    expect(normalizedCourse.developments[0].unitIds).toEqual(normalizedCourse.units.map((unit) => unit.id));
    expect(normalizedCourse.easements.every((easement) => easement.protected)).toBe(true);
  });

  it("derives heat cells and separately responds to tee restrictions, height, geometry, and condition", () => {
    const homes: PropertyAsset = { id: "homes", kind: "houses", name: "Corridor homes", category: "community", tier: 1, x: 20, y: 1, width: 12, height: 8, capacity: 20, condition: 1, price: 0, units: 40, enabled: true, tenure: "sold" };
    const exposed: Course = {
      ...DEFAULT_COURSE,
      holes: DEFAULT_COURSE.holes.map((hole, index) => index === 0 ? { ...hole, tee: { x: 0, y: 5 }, green: { x: 80, y: 5 }, teeBoxes: { championship: { x: 0, y: 5 }, member: { x: 4, y: 5 }, forward: { x: 8, y: 5 } } } : hole),
      property: { ...emptyPropertyCourse(), assets: [homes] },
    };
    const before = analyzeResidentialSafety(exposed, homes.id);
    expect(before.heatmap.length).toBeGreaterThan(0);
    expect(before.measuredSetback).toBeLessThan(4);
    expect(before.blockingReasons.length).toBeGreaterThan(0);

    const restricted = applyPropertyCommand(exposed, { ...DEFAULT_WORLD, enterprise: emptyPropertyEnterprise() }, { type: "SET_SAFETY_POLICY", restrictedTeeSets: ["championship", "member"] });
    expect(restricted.ok).toBe(true);
    expect(analyzeResidentialSafety(restricted.course, homes.id).expectedExposure).toBeLessThan(before.expectedExposure);

    const netting: PropertyAsset = { id: "net", kind: "netting", name: "Tall net", category: "safety", tier: 4, x: 18, y: 4, width: 10, height: 1, capacity: 0, condition: 1, price: 0, enabled: true, mitigationKind: "netting", coverageHeight: 18 };
    const protectedCourse = { ...exposed, property: { ...emptyPropertyCourse(), assets: [homes, netting] } };
    const maintained = analyzeResidentialSafety(protectedCourse, homes.id);
    const failed = analyzeResidentialSafety({ ...protectedCourse, property: { ...protectedCourse.property!, assets: [homes, { ...netting, condition: 0.25, coverageHeight: 3 }] } }, homes.id);
    expect(maintained.score).toBeLessThan(failed.score);
    expect(failed.score).toBeLessThanOrEqual(before.score);
  });

  it("creates only plausible trajectory-attributed incidents, recurring complaints, and exactly-once claims", () => {
    const homes: PropertyAsset = { id: "homes", kind: "houses", name: "Corridor homes", category: "community", tier: 1, x: 20, y: 1, width: 12, height: 8, capacity: 20, condition: 1, price: 0, units: 1, enabled: true, tenure: "sold" };
    const household: ResidentHousehold = { id: "household-home", assetId: homes.id, units: 1, occupied: 1, satisfaction: 75, complaints: 0, unitIds: ["home-1"], customerIds: ["resident-home-1"], archetype: "golf_family", golfInterest: 80, riskTolerance: 30, serviceExpectation: 70, advocacy: 0, opposition: 0, localSpend: 0, membershipPropensity: 60 };
    const course: Course = { ...DEFAULT_COURSE, property: { ...emptyPropertyCourse(), assets: [homes] } };
    const world: World = { ...DEFAULT_WORLD, cash: 1_000_000, runSeed: 987, enterprise: { ...emptyPropertyEnterprise(), residents: [household] } };
    const trace: PropertyShotTrace = { golferId: 0, holeId: "hole-risk", holeName: "Risky 1st", teeSet: "member", shotType: "drive", from: { x: 0, y: 5 }, to: { x: 80, y: 5 } };
    const result = settlePropertyDay(course, world, 0, 1, [trace]);
    expect(result.report.incidents).toHaveLength(1);
    expect(result.report.incidents[0]).toMatchObject({ assetId: homes.id, sourceHoleId: "hole-risk", teeSet: "member", shotType: "drive", impact: { x: 26, y: 5 } });
    expect(result.world.enterprise!.complaints[0]).toMatchObject({ source: "errant_ball", recurrence: 1, status: "open" });
    const claim = result.world.enterprise!.claims[0];
    expect(claim).toMatchObject({ status: "open", incidentId: result.report.incidents[0].id });

    const filed = applyPropertyCommand(result.course, result.world, { type: "FILE_CLAIM", claimId: claim.id });
    expect(filed.ok).toBe(true);
    const cashBefore = filed.world.cash;
    const settled = applyPropertyCommand(filed.course, filed.world, { type: "SETTLE_CLAIM", claimId: claim.id });
    expect(settled.ok).toBe(true);
    expect(settled.world.cash).toBeLessThan(cashBefore);
    expect(settled.world.enterprise!.claims[0].status).toBe("settled");
    expect(settled.world.enterprise!.insurance.claimsSettled).toBe(1);
    expect(applyPropertyCommand(settled.course, settled.world, { type: "SETTLE_CLAIM", claimId: claim.id }).ok).toBe(false);
  });

  it("lets real geometry mitigation prevent the same seeded live-shot incident", () => {
    const homes: PropertyAsset = { id: "homes", kind: "houses", name: "Corridor homes", category: "community", tier: 1, x: 20, y: 1, width: 12, height: 8, capacity: 20, condition: 1, price: 0, units: 1, enabled: true, tenure: "sold" };
    const net: PropertyAsset = { id: "net", kind: "netting", name: "Trajectory net", category: "safety", tier: 4, x: 12, y: 4, width: 10, height: 1, capacity: 0, condition: 1, price: 0, enabled: true, mitigationKind: "netting", coverageHeight: 18 };
    const household: ResidentHousehold = { id: "household-home", assetId: homes.id, units: 1, occupied: 1, satisfaction: 75, complaints: 0 };
    const course: Course = { ...DEFAULT_COURSE, property: { ...emptyPropertyCourse(), assets: [homes, net] } };
    const world: World = { ...DEFAULT_WORLD, cash: 1_000_000, runSeed: 987, enterprise: { ...emptyPropertyEnterprise(), residents: [household] } };
    const trace: PropertyShotTrace = { golferId: 0, holeId: "hole-risk", holeName: "Risky 1st", teeSet: "member", shotType: "drive", from: { x: 0, y: 5 }, to: { x: 80, y: 5 } };
    expect(settlePropertyDay(course, world, 0, 1, [trace]).report.incidents).toHaveLength(0);
  });
});
