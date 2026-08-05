import { describe, expect, it } from "vitest";
import { terrainCostMult } from "../balance/difficulty";
import { createEstate } from "../estate/estate";
import { DEFAULT_COURSE, DEFAULT_WORLD } from "../models/defaults";
import { decorationCost } from "../models/decorations";
import {
  naturalFeatureInstallationQuote,
  naturalFeatureRemovalQuote,
} from "../models/plantRegistry";
import {
  computeElevationChangeCost,
  computeTerrainChangeBreakdown,
} from "../models/terrainEconomics";
import type { Course, World } from "../models/types";
import {
  canonicalHoleTemplatePlanIdentityJson,
  planHoleTemplatePlacement,
  transformHoleTemplatePoint,
  transformedHoleTemplateSize,
} from "./placement";
import {
  canonicalHoleTemplateJson,
  sha256Hex,
  validateHoleTemplateV1,
} from "./serialization";
import type {
  HoleTemplatePlacement,
  HoleTemplateTargetVersions,
  HoleTemplateV1,
} from "./types";

const VERSIONS: HoleTemplateTargetVersions = {
  terrainVersion: 11,
  obstaclesVersion: 7,
  markersVersion: 5,
  economyVersion: 13,
};

function template(overrides: Partial<HoleTemplateV1> = {}): HoleTemplateV1 {
  return {
    format: "coursecraft-hole-template",
    version: 1,
    id: "local-famous-par-3",
    title: "Lakeside Par 3",
    description: "A compact imported hole.",
    width: 4,
    height: 3,
    yardsPerTile: 10,
    cells: [
      { x: 0, y: 1, terrain: "tee", elevationOffset: 0 },
      { x: 1, y: 1, terrain: "fairway", elevationOffset: 0 },
      { x: 2, y: 1, terrain: "water", elevationOffset: -1 },
      { x: 3, y: 1, terrain: "green", elevationOffset: 0 },
      { x: 3, y: 2, terrain: "rough", elevationOffset: 1 },
    ],
    hole: {
      tee: { x: 0, y: 1 },
      green: { x: 3, y: 1 },
      teeBoxes: { member: { x: 0, y: 1 } },
      pinPositions: { A: { x: 3, y: 1 } },
      waypoints: [{ x: 1, y: 1 }],
      parMode: "MANUAL",
      parManual: 3,
    },
    obstacles: [{ x: 3, y: 2, type: "bush" }],
    decorations: [{ kind: "flower_bed", x: 0, y: 2, rotation: 0 }],
    provenance: {
      sourceKind: "player_photo",
      sourceLabel: "My own aerial photo",
      importedAt: "2026-07-30T12:00:00.000Z",
      rightsAttested: true,
      redistribution: "private_only",
      sourceAssetRetained: false,
    },
    confidence: { scale: 0.92, terrain: 0.86, elevation: 0.7, notes: [] },
    ...overrides,
  };
}

function buildableCourse(): Course {
  const course = structuredClone(DEFAULT_COURSE);
  course.holes = [];
  course.tiles = new Array(course.width * course.height).fill("rough");
  course.elevations = new Array(course.width * course.height).fill(5);
  course.obstacles = [];
  course.decorations = [];
  course.buildings = [];
  course.estate = undefined;
  course.theme = "parkland";
  return course;
}

function fundedWorld(overrides: Partial<World> = {}): World {
  return { ...structuredClone(DEFAULT_WORLD), cash: 1_000_000, reputation: 100, difficulty: "normal", ...overrides };
}

function placement(overrides: Partial<HoleTemplatePlacement> = {}): HoleTemplatePlacement {
  return {
    origin: { x: 10, y: 10 },
    rotation: 1,
    mirrorX: true,
    elevationPolicy: "template-relief",
    baseElevation: 5,
    holeId: "hole-import-1",
    ...overrides,
  };
}

function planned(args: {
  course?: Course;
  world?: World;
  template?: unknown;
  placement?: HoleTemplatePlacement;
  versions?: HoleTemplateTargetVersions;
} = {}) {
  const result = planHoleTemplatePlacement({
    course: args.course ?? buildableCourse(),
    world: args.world ?? fundedWorld(),
    template: args.template ?? template(),
    placement: args.placement ?? placement(),
    targetVersions: args.versions ?? VERSIONS,
  });
  expect(result.status).toBe("planned");
  if (result.status !== "planned") throw new Error("Expected a placement plan.");
  return result.plan;
}

describe("HoleTemplate V1 serialization", () => {
  it("uses a verified browser-safe SHA-256 implementation", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("canonicalizes unordered sparse features without changing ordered waypoints", () => {
    const source = template({
      hole: { ...template().hole, waypoints: [{ x: 1, y: 1 }, { x: 2, y: 1 }] },
    });
    const reordered = {
      ...source,
      cells: [...source.cells].reverse(),
      obstacles: [...source.obstacles].reverse(),
      decorations: [...source.decorations].reverse(),
    };
    expect(canonicalHoleTemplateJson(reordered)).toBe(canonicalHoleTemplateJson(source));
    const withReversedRoute = template({ hole: { ...source.hole, waypoints: [...(source.hole.waypoints ?? [])].reverse() } });
    expect(canonicalHoleTemplateJson(withReversedRoute)).not.toBe(canonicalHoleTemplateJson(source));
  });

  it("rejects unsupported versions, unknown fields, duplicate cells, and markers off their authored surface", () => {
    const invalid = {
      ...template(),
      version: 2,
      remoteUrl: "https://example.invalid/source",
      cells: [...template().cells, template().cells[0]],
      hole: { ...template().hole, tee: { x: 1, y: 1 } },
    };
    const result = validateHoleTemplateV1(invalid);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "unsupported_version", path: "template.version" }),
      expect.objectContaining({ code: "unknown_field", path: "template.remoteUrl" }),
      expect.objectContaining({ code: "duplicate_value", path: expect.stringContaining("cells") }),
      expect.objectContaining({ code: "invalid_value", path: "template.hole.tee" }),
    ]));
  });
});

describe("pure hole template placement planner", () => {
  it("transforms every quarter-turn and mirror deterministically", () => {
    const source = template();
    expect(transformedHoleTemplateSize(source, 0)).toEqual({ width: 4, height: 3 });
    expect(transformedHoleTemplateSize(source, 1)).toEqual({ width: 3, height: 4 });
    const origin = { x: 10, y: 20 };
    expect([0, 1, 2, 3].map((rotation) => transformHoleTemplatePoint(
      { x: 0, y: 1 }, source, { origin, rotation: rotation as 0 | 1 | 2 | 3, mirrorX: false },
    ))).toEqual([
      { x: 10, y: 21 }, { x: 11, y: 20 }, { x: 13, y: 21 }, { x: 11, y: 23 },
    ]);
    expect(transformHoleTemplatePoint({ x: 0, y: 1 }, source, { origin, rotation: 1, mirrorX: true })).toEqual({ x: 11, y: 23 });
  });

  it("returns exact registry-backed quotes and fully transformed proposed mutations", () => {
    const course = buildableCourse();
    course.theme = "desert";
    const world = fundedWorld({ difficulty: "hard" });
    const plan = planned({ course, world });
    expect(plan.canApply).toBe(true);
    expect(plan.blockers).toEqual([]);
    expect(plan.identity).toMatchObject({ algorithm: "SHA-256", value: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(plan.identity.value).toBe(sha256Hex(canonicalHoleTemplatePlanIdentityJson(plan)));
    expect(plan.transformedSize).toEqual({ width: 3, height: 4 });
    expect(plan.mutations.addHole).toMatchObject({ id: "hole-import-1", name: "Lakeside Par 3", tee: { x: 11, y: 13 }, green: { x: 11, y: 10 } });
    expect(plan.mutations.terrain).toContainEqual(expect.objectContaining({ x: 11, y: 11, before: "rough", after: "water" }));
    expect(plan.mutations.elevations).toContainEqual(expect.objectContaining({ x: 11, y: 11, before: 5, after: 4 }));
    expect(plan.mutations.addObstacles).toEqual([{ x: 10, y: 10, type: "bush", origin: "player", plantId: expect.any(String) }]);
    expect(plan.mutations.addDecorations).toEqual([{ kind: "flower_bed", x: 10, y: 13, rotation: 3, origin: "player" }]);

    const costMult = terrainCostMult("hard");
    const terrainQuotes = template().cells.map((cell) => computeTerrainChangeBreakdown("rough", cell.terrain, costMult, "desert"));
    const expectedTerrain = terrainQuotes.reduce((sum, quote) => sum + quote.gross, 0);
    const expectedEarthwork = template().cells.reduce((sum, cell) => sum + computeElevationChangeCost(cell.elevationOffset, costMult, "desert").net, 0);
    const quoteMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
    const expectedNatural = quoteMoney(naturalFeatureInstallationQuote({ theme: "desert", obstacleType: "bush", costMult }).gross);
    const expectedDecoration = quoteMoney(decorationCost({ kind: "flower_bed", x: 10, y: 13, rotation: 3, origin: "player" }, "desert", costMult));
    const expectedSubtotal = quoteMoney(expectedTerrain + expectedEarthwork + expectedNatural + expectedDecoration);
    expect(plan.quote).toMatchObject({
      terrainConstruction: expectedTerrain,
      terrainSalvageCredit: 0,
      earthwork: expectedEarthwork,
      siteClearing: 0,
      naturalFeatureSalvageCredit: 0,
      naturalFeatures: expectedNatural,
      decorations: expectedDecoration,
      subtotal: expectedSubtotal,
      total: expectedSubtotal,
    });
    expect(plan.mutations.cashDelta).toBe(-plan.quote.total);
    expect(plan.mutations.versions).toEqual({
      before: VERSIONS,
      after: { terrainVersion: 12, obstaclesVersion: 8, markersVersion: 6, economyVersion: 14 },
    });
  });

  it("supports template relief, automatic median fitting, and estate-relief preservation", () => {
    const course = buildableCourse();
    const source = template();
    for (const [index, cell] of source.cells.entries()) {
      const target = transformHoleTemplatePoint(cell, source, placement({ rotation: 0, mirrorX: false }));
      course.elevations[target.y * course.width + target.x] = [7, 8, 8, 9, 11][index];
    }
    const automatic = planned({ course, placement: placement({ rotation: 0, mirrorX: false, baseElevation: undefined }) });
    expect(automatic.placement.baseElevation).toBe(9);
    expect(automatic.quote.earthwork).toBeGreaterThan(0);

    const preserved = planned({
      course,
      placement: placement({ rotation: 0, mirrorX: false, elevationPolicy: "preserve-estate-relief", baseElevation: undefined }),
    });
    expect(preserved.placement.baseElevation).toBeNull();
    expect(preserved.mutations.elevations).toEqual([]);
    expect(preserved.quote.earthwork).toBe(0);
  });

  it("binds identity to canonical blueprint content, transform, target versions, quote, and mutations", () => {
    const baseline = planned();
    const reordered = planned({ template: { ...template(), cells: [...template().cells].reverse() } });
    expect(reordered.identity.value).toBe(baseline.identity.value);
    expect(planned({ template: template({ title: "Changed blueprint" }) }).identity.value).not.toBe(baseline.identity.value);
    expect(planned({ placement: placement({ origin: { x: 11, y: 10 } }) }).identity.value).not.toBe(baseline.identity.value);
    expect(planned({ versions: { ...VERSIONS, terrainVersion: VERSIONS.terrainVersion + 1 } }).identity.value).not.toBe(baseline.identity.value);

    const changedTarget = buildableCourse();
    const sourceCell = transformHoleTemplatePoint(template().cells[0], template(), placement());
    changedTarget.tiles[sourceCell.y * changedTarget.width + sourceCell.x] = "fairway";
    const changedPlan = planned({ course: changedTarget });
    expect(changedPlan.quote).not.toEqual(baseline.quote);
    expect(changedPlan.mutations).not.toEqual(baseline.mutations);
    expect(changedPlan.identity.value).not.toBe(baseline.identity.value);
  });

  it("does not mutate any input snapshot", () => {
    const course = buildableCourse();
    const world = fundedWorld();
    const source = template();
    const requestPlacement = placement();
    const before = structuredClone({ course, world, source, requestPlacement, versions: VERSIONS });
    planned({ course, world, template: source, placement: requestPlacement });
    expect({ course, world, source, requestPlacement, versions: VERSIONS }).toEqual(before);
  });

  it("returns structured fail-closed blockers for malformed and stale-prone requests", () => {
    const unsupported = planHoleTemplatePlacement({
      course: buildableCourse(), world: fundedWorld(), template: { ...template(), version: 2 }, placement: placement(), targetVersions: VERSIONS,
    });
    expect(unsupported).toMatchObject({
      status: "rejected",
      blockers: expect.arrayContaining([expect.objectContaining({ code: "unsupported_version", path: "template.version", action: expect.any(String) })]),
    });
    const invalidVersions = planHoleTemplatePlacement({
      course: buildableCourse(), world: fundedWorld(), template: template(), placement: placement(), targetVersions: { ...VERSIONS, terrainVersion: -1 },
    });
    expect(invalidVersions).toMatchObject({ status: "rejected", blockers: [expect.objectContaining({ code: "invalid_target_versions", action: expect.any(String) })] });
  });

  it("reports actionable operational blockers without withholding the quote and mutation preview", () => {
    const course = buildableCourse();
    course.estate = createEstate(course, 42);
    course.buildings = [{ id: "existing", type: "clubhouse", x: 10, y: 10 }];
    course.obstacles = [{ x: 11, y: 11, type: "tree" }];
    const world = fundedWorld({ cash: 0, reputation: 0, constraints: { protectedTrees: true } });
    const source = template({
      yardsPerTile: 5,
      provenance: { ...template().provenance, rightsAttested: false, redistribution: "unknown" },
    });
    const plan = planned({ course, world, template: source, placement: placement({ rotation: 0, mirrorX: false }) });
    expect(plan.canApply).toBe(false);
    expect(plan.quote.total).toBeGreaterThan(0);
    expect(plan.mutations.removeObstacles).toEqual([{ x: 11, y: 11, type: "tree" }]);
    expect(plan.quote.siteClearing).toBe(naturalFeatureRemovalQuote({ theme: "parkland", obstacle: course.obstacles[0] }).gross);
    expect(plan.blockers.map((blocker) => blocker.code)).toEqual(expect.arrayContaining([
      "rights_attestation_required", "scale_mismatch", "unowned_land", "building_conflict", "protected_tree", "insufficient_funds",
    ]));
    expect(plan.blockers.every((blocker) => blocker.action.length > 0)).toBe(true);
  });

  it("fails closed when template relief clips or preserve-relief is combined with a base", () => {
    const clipped = planned({ placement: placement({ baseElevation: 15 }) });
    expect(clipped.blockers).toContainEqual(expect.objectContaining({ code: "relief_out_of_range", points: expect.any(Array) }));
    const invalid = planHoleTemplatePlacement({
      course: buildableCourse(),
      world: fundedWorld(),
      template: template(),
      placement: placement({ elevationPolicy: "preserve-estate-relief", baseElevation: 5 }),
      targetVersions: VERSIONS,
    });
    expect(invalid).toMatchObject({ status: "rejected", blockers: [expect.objectContaining({ code: "invalid_placement", path: "placement.baseElevation" })] });
  });
});
