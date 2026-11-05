import { describe, expect, it } from "vitest";
import { sampleCorridor } from "../models/surfaceIntent";
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
  transformHoleTemplateSurfacePoint,
  transformedHoleTemplateSize,
} from "./placement";
import {
  canonicalHoleTemplateJson,
  sha256Hex,
  validateHoleTemplateV1,
  validateHoleTemplateSurfaceIntent,
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
  return { ...structuredClone(DEFAULT_WORLD), cash: 1_000_000, reputation: 100, economicPressure: "balanced", ...overrides };
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
  it("preserves reviewed fidelity and bounded provenance through canonicalization and placement, retaining required credit only", () => {
    const source = template({
      provenance: { ...template().provenance, sourceKind: "open_data", redistribution: "attribution", licenseName: "CC BY 4.0", attribution: "Dataset author" },
      fidelity: { tier: "calibrated", controlPointsReviewed: true, reviewedControlPointCount: 2, verifiedYardage: 180 },
    });
    const canonical = canonicalHoleTemplateJson(source);
    expect(canonicalHoleTemplateJson(JSON.parse(canonical))).toBe(canonical);
    expect(planned({ template: source }).mutations.addHole.templateAttribution).toEqual({ templateId: source.id, ...source.provenance, fidelity: source.fidelity });
    const privateSource = template({ provenance: { ...template().provenance, attribution: "Unrequired credit" } });
    expect(planned({ template: privateSource }).mutations.addHole.templateAttribution).toMatchObject({ fidelity: { tier: "sketch" }, rightsAttested: true, redistribution: "private_only", sourceAssetRetained: false });
    expect(planned({ template: privateSource }).mutations.addHole.templateAttribution).not.toHaveProperty("attribution");
  });
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
    const world = fundedWorld({ economicPressure: "tight" });
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


describe("TEMPLATE-C strict portable authored surfaces", () => {
  const surfaces = () => ({ version: 1 as const, features: [{ id: "surface-1", terrain: "path" as const, order: 7,
    geometry: { kind: "corridor" as const, knots: [{ x: 1.1, y: 1.2 }, { x: 1.3, y: 1.2 }], width: 1.75,
      tangents: [{ in: { x: 0, y: 0 }, out: { x: 4, y: 3 } }, { in: { x: 0, y: 3 }, out: { x: 4, y: 0 } }] }, coverage: [5] }] });
  const raw = () => JSON.parse(JSON.stringify(template({ surfaceIntent: surfaces() })));
  it("preserves optional field absence and canonicalizes feature order without moving authored nodes", () => {
    const source = raw(); source.surfaceIntent.features.push({ ...structuredClone(source.surfaceIntent.features[0]), id: "surface-2", order: 2 });
    const result = validateHoleTemplateV1(source); expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected valid metadata");
    expect(result.value.surfaceIntent!.features.map(f => f.id)).toEqual(["surface-2", "surface-1"]);
    expect(result.value.surfaceIntent!.features[1].geometry).toEqual(source.surfaceIntent.features[0].geometry);
    expect(canonicalHoleTemplateJson(result.value)).toBe(canonicalHoleTemplateJson(source));
    expect(validateHoleTemplateV1(template())).not.toHaveProperty("value.surfaceIntent");
  });
  const malformed: Array<[string, (value: ReturnType<typeof JSON.parse>) => void]> = [
    ["unknown extension field", v => { v.surfaceIntent.graph = {}; }],
    ["unsupported extension version", v => { v.surfaceIntent.version = 2; }],
    ["null extension", v => { v.surfaceIntent = null; }],
    ["empty extension", v => { v.surfaceIntent.features = []; }],
    ["excess features", v => { v.surfaceIntent.features = Array(513).fill(v.surfaceIntent.features[0]); }],
    ["duplicate identities", v => { v.surfaceIntent.features.push(structuredClone(v.surfaceIntent.features[0])); }],
    ["invalid identity", v => { v.surfaceIntent.features[0].id = "bad/id"; }],
    ["unsafe order", v => { v.surfaceIntent.features[0].order = Number.MAX_SAFE_INTEGER + 1; }],
    ["unknown terrain", v => { v.surfaceIntent.features[0].terrain = "lava"; }],
    ["graph on feature", v => { v.surfaceIntent.features[0].indices = [0, 1, 2]; }],
    ["unknown geometry", v => { v.surfaceIntent.features[0].geometry.kind = "mesh"; }],
    ["unknown geometry field", v => { v.surfaceIntent.features[0].geometry.secret = 1; }],
    ["nonfinite knot", v => { v.surfaceIntent.features[0].geometry.knots[0].x = NaN; }],
    ["outside knot", v => { v.surfaceIntent.features[0].geometry.knots[0].x = -.01; }],
    ["excess nodes", v => { v.surfaceIntent.features[0].geometry.knots = Array(257).fill({ x: 1, y: 1 }); }],
    ["missing node", v => { v.surfaceIntent.features[0].geometry.knots = []; }],
    ["width too small", v => { v.surfaceIntent.features[0].geometry.width = .249; }],
    ["width too large", v => { v.surfaceIntent.features[0].geometry.width = 24.001; }],
    ["infinite width", v => { v.surfaceIntent.features[0].geometry.width = Infinity; }],
    ["handle count", v => { v.surfaceIntent.features[0].geometry.tangents.pop(); }],
    ["nonfinite distant handle", v => { v.surfaceIntent.features[0].geometry.tangents[0].out.x = Infinity; }],
    ["outside distant handle", v => { v.surfaceIntent.features[0].geometry.tangents[0].out.x = 4.01; }],
    ["handle extra field", v => { v.surfaceIntent.features[0].geometry.tangents[0].key = "bad"; }],
    ["duplicate coverage", v => { v.surfaceIntent.features[0].coverage.push(5); }],
    ["noninteger coverage", v => { v.surfaceIntent.features[0].coverage = [5.5]; }],
    ["outside coverage", v => { v.surfaceIntent.features[0].coverage = [12]; }],
    ["missing explicit carrier cell", v => { v.surfaceIntent.features[0].coverage = [0]; }],
    ["empty mask", v => { v.surfaceIntent.features[0].renderRings = []; }],
    ["excess rings", v => { v.surfaceIntent.features[0].renderRings = Array(33).fill([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }]); }],
    ["short mask ring", v => { v.surfaceIntent.features[0].renderRings = [[{ x: 1, y: 1 }]]; }],
    ["outside mask", v => { v.surfaceIntent.features[0].renderRings = [[{ x: 5, y: 1 }, { x: 1, y: 0 }, { x: 1, y: 1 }]]; }],
    ["partial region", v => { v.surfaceIntent.features[0].geometry = { kind: "region", ring: [{ x: 1, y: 1 }, { x: 2, y: 2 }] }; }],
    ["cyclic point", v => { const knots = v.surfaceIntent.features[0].geometry.knots; knots[0] = knots; }],
  ];
  it.each(malformed)("rejects %s without permissive repair", (_name, mutate) => {
    const value = raw(); mutate(value); expect(validateHoleTemplateV1(value).ok).toBe(false);
  });
  it("matches the actual chord loop on short chords with distant handles and keeps custom width", () => {
    const value = raw(), feature = value.surfaceIntent.features[0], result = validateHoleTemplateV1(value);
    expect(result.ok).toBe(true); if (!result.ok) throw new Error("Expected bounded distant handles");
    const sampled = sampleCorridor(feature.geometry.knots, .2, feature.geometry.tangents);
    expect(sampled.length).toBe(Math.max(1, Math.ceil(Math.hypot(.2, 0) / .2)) + 1);
    expect(result.value.surfaceIntent!.features[0].geometry).toEqual(feature.geometry);
  });
  it("enforces aggregate budgets before expensive arrays or model sampling", () => {
    const feature = surfaces().features[0];
    const check = (features: unknown[], width = 256, height = 256, cells?: Set<number>) => validateHoleTemplateSurfaceIntent({ version: 1, features }, width, height, cells);
    const nodes = Array.from({ length: 256 }, () => ({ x: 1, y: 1 }));
    expect(check(Array.from({ length: 33 }, (_, i) => ({ ...feature, id: `surface-${i}`, geometry: { kind: "corridor", knots: nodes, width: 1 } })))).toMatchObject({ ok: false, issues: expect.arrayContaining([expect.objectContaining({ message: expect.stringContaining("nodes") })]) });
    const coverage = Array.from({ length: 65_536 }, (_, i) => i);
    expect(check(Array.from({ length: 5 }, (_, i) => ({ ...feature, id: `surface-${i}`, coverage })))).toMatchObject({ ok: false, issues: expect.arrayContaining([expect.objectContaining({ message: expect.stringContaining("coverage") })]) });
    const ring = Array.from({ length: 256 }, () => ({ x: 1, y: 1 }));
    expect(check(Array.from({ length: 5 }, (_, i) => ({ ...feature, id: `surface-${i}`, renderRings: Array(32).fill(ring) })))).toMatchObject({ ok: false, issues: expect.arrayContaining([expect.objectContaining({ message: expect.stringContaining("mask") })]) });
    expect(check(Array.from({ length: 26 }, (_, i) => ({ ...feature, id: `surface-${i}`, geometry: { kind: "corridor", knots: [{ x: 0, y: 0 }, { x: 256, y: 0 }], width: 1 } })))).toMatchObject({ ok: false, issues: expect.arrayContaining([expect.objectContaining({ message: expect.stringContaining("sampling") })]) });
    expect(check([feature], 257, 1, new Set([5])).ok).toBe(false);
  });
});


describe("TEMPLATE-P rigid authored surface placement", () => {
  const matrices = [
    [0, false, 1, 0, 0, 0, 1, 0], [1, false, 0, -1, 3, 1, 0, 0],
    [2, false, -1, 0, 4, 0, -1, 3], [3, false, 0, 1, 0, -1, 0, 4],
    [0, true, -1, 0, 4, 0, 1, 0], [1, true, 0, -1, 3, -1, 0, 4],
    [2, true, 1, 0, 0, 0, -1, 3], [3, true, 0, 1, 0, 1, 0, 0],
  ] as const;
  function authoredTemplate() {
    return template({ obstacles: [], decorations: [], surfaceIntent: { version: 1, features: [
      { id: "portable-path", terrain: "path", order: 20, coverage: [5], geometry: { kind: "corridor", knots: [{ x: 1.25, y: 1.5 }, { x: 1.75, y: 1.5 }], width: 1.75,
        tangents: [{ in: { x: 1, y: 1 }, out: { x: 1.5, y: 2 } }, { in: { x: 1.5, y: 1 }, out: { x: 2, y: 2 } }] }, renderRings: [[{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 2, y: 2 }, { x: 1, y: 2 }]] },
      { id: "portable-region", terrain: "water", order: 10, coverage: [6], geometry: { kind: "region", ring: [{ x: 2, y: 1 }, { x: 3, y: 1 }, { x: 3, y: 2 }] } },
    ] } });
  }
  it.each(matrices)("maps cell edges, centers and authored handles at rotation %s mirror %s", (rotation, mirrorX, a, b, c, d, e, f) => {
    const origin = { x: 10, y: 20 }, where = placement({ origin, rotation, mirrorX });
    const oracle = (p: { x: number; y: number }) => ({ x: 10 + a * p.x + b * p.y + c, y: 20 + d * p.x + e * p.y + f });
    for (const point of [{ x: 1.5, y: 1.5 }, { x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }, { x: 0, y: 3 }]) expect(transformHoleTemplateSurfacePoint(point, { width: 4, height: 3 }, where)).toEqual(oracle(point));
    for (let y = 0; y < 3; y++) for (let x = 0; x < 4; x++) {
      const center = oracle({ x: x + .5, y: y + .5 });
      expect(transformHoleTemplatePoint({ x, y }, { width: 4, height: 3 }, where)).toEqual({ x: center.x - .5, y: center.y - .5 });
    }
    const source = authoredTemplate(), before = structuredClone(source), course = buildableCourse();
    const plan = planned({ course, template: source, placement: where }); expect(plan.canApply).toBe(true);
    const [region, corridor] = plan.mutations.surfaceIntent!.addFeatures;
    expect(region.geometry).toEqual({ kind: "region", ring: source.surfaceIntent!.features[1].geometry.kind === "region" ? source.surfaceIntent!.features[1].geometry.ring.map(oracle) : [] });
    const geometry = source.surfaceIntent!.features[0].geometry;
    if (geometry.kind !== "corridor") throw new Error("Expected authored corridor");
    expect(corridor.geometry).toEqual({ kind: "corridor", knots: geometry.knots.map(oracle), width: 1.75, tangents: geometry.tangents!.map(pair => ({ in: oracle(pair.in), out: oracle(pair.out) })) });
    const expectedMask = source.surfaceIntent!.features[0].renderRings![0].map(oracle); if (mirrorX) expectedMask.reverse();
    expect(corridor.renderRings).toEqual([expectedMask]);
    expect(corridor.coverage).toEqual([(() => { const center = oracle({ x: 1.5, y: 1.5 }); return (center.y - .5) * course.width + center.x - .5; })()]);
    expect(source).toEqual(before);
  });
  it("allocates collision-free target IDs and dense relative order without changing portable IDs", () => {
    const course = buildableCourse(), source = authoredTemplate();
    course.surfaceIntent = { version: 1, nextId: 1, features: [1, 2].map(id => ({ id: `surface-${id}`, terrain: "rough", order: id * 10, coverage: [id], geometry: { kind: "corridor", knots: [{ x: id + .5, y: .5 }], width: 1 } })) };
    const before = JSON.stringify(course.surfaceIntent), plan = planned({ course, template: source });
    expect(plan.canApply).toBe(true); expect(plan.mutations.surfaceIntent).toMatchObject({ nextId: 5, addFeatures: [{ id: "surface-3", order: 21 }, { id: "surface-4", order: 22 }] });
    expect(JSON.stringify(course.surfaceIntent)).toBe(before);
    expect(plan.template.surfaceIntent!.features.map(feature => feature.id)).toEqual(["portable-region", "portable-path"]);
    expect(plan.mutations.surfaceIntent).not.toHaveProperty("features");
  });
  it("blocks existing intent on any authored payload cell, including an unchanged marker outside new feature coverage", () => {
    const source = authoredTemplate(), course = buildableCourse();
    course.surfaceIntent = { version: 1, nextId: 2, features: [{ id: "existing-curve", terrain: "rough", order: 1, coverage: [13 * course.width + 11], geometry: { kind: "corridor", knots: [{ x: 11.5, y: 13.5 }], width: 1 } }] };
    const plan = planned({ course, template: source });
    expect(plan.canApply).toBe(false); expect(plan.blockers).toContainEqual(expect.objectContaining({ code: "surface_conflict", points: [{ x: 11, y: 13 }] }));
    const old = structuredClone(source); delete old.surfaceIntent;
    expect(planned({ course, template: old }).canApply).toBe(true);
  });
  it.each(["capacity", "counter-zero", "counter-unsafe", "counter-exhausted", "order-exhausted", "order-negative"])("blocks target %s without evicting or repairing features", reason => {
    const course = buildableCourse(), count = reason === "capacity" ? 512 : 1;
    course.surfaceIntent = { version: 1, nextId: 1, features: Array.from({ length: count }, (_, i) => ({ id: `existing-${i}`, terrain: "rough", order: reason === "order-exhausted" ? Number.MAX_SAFE_INTEGER : reason === "order-negative" ? -1 : i, coverage: [], geometry: { kind: "corridor", knots: [{ x: .5, y: .5 }], width: 1 } })) };
    if (reason === "counter-zero") course.surfaceIntent.nextId = 0;
    if (reason === "counter-unsafe") course.surfaceIntent.nextId = Number.MAX_SAFE_INTEGER + 1;
    if (reason === "counter-exhausted") course.surfaceIntent.nextId = Number.MAX_SAFE_INTEGER - 1;
    const before = structuredClone(course), plan = planned({ course, template: authoredTemplate() });
    expect(plan.canApply).toBe(false); expect(plan.blockers).toContainEqual(expect.objectContaining({ code: "surface_capacity" })); expect(course).toEqual(before);
  });
  it("preserves exact quote and old mutation bytes except declared intent and its terrain invalidation", () => {
    const source = authoredTemplate(), old = structuredClone(source); delete old.surfaceIntent;
    const course = buildableCourse();
    for (const cell of source.cells) { const point = transformHoleTemplatePoint(cell, source, placement()); const index = point.y * course.width + point.x; course.tiles[index] = cell.terrain; course.elevations[index] = 5 + cell.elevationOffset; }
    const legacy = planned({ course, template: old }), authored = planned({ course, template: source });
    expect(authored.quote).toEqual(legacy.quote); expect(authored.quote.total).toBe(0);
    const { surfaceIntent, versions, ...rest } = authored.mutations;
    expect(surfaceIntent!.addFeatures).toHaveLength(2);
    expect(rest).toEqual((({ versions: _versions, ...mutation }) => mutation)(legacy.mutations));
    expect(versions.after).toEqual({ ...legacy.mutations.versions.after, terrainVersion: VERSIONS.terrainVersion + 1 });
    expect(legacy.mutations.versions.after.terrainVersion).toBe(VERSIONS.terrainVersion); expect(legacy.mutations).not.toHaveProperty("surfaceIntent");
  });
});


describe("TEMPLATE-P frozen historical plan bytes", () => {
  it("keeps the pre-C absent-extension identity and plan text byte-exact", () => {
    const source = JSON.parse("{\"cells\":[{\"elevationOffset\":0,\"terrain\":\"tee\",\"x\":0,\"y\":1},{\"elevationOffset\":0,\"terrain\":\"fairway\",\"x\":1,\"y\":1},{\"elevationOffset\":-1,\"terrain\":\"water\",\"x\":2,\"y\":1},{\"elevationOffset\":1,\"terrain\":\"green\",\"x\":3,\"y\":1}],\"confidence\":{\"elevation\":1,\"notes\":[],\"scale\":1,\"terrain\":1},\"decorations\":[{\"kind\":\"flower_bed\",\"rotation\":0,\"x\":0,\"y\":0}],\"description\":\"Player-built sparse capture.\",\"format\":\"coursecraft-hole-template\",\"height\":2,\"hole\":{\"green\":{\"x\":3,\"y\":1},\"parManual\":3,\"parMode\":\"MANUAL\",\"pinPositions\":{\"A\":{\"x\":3,\"y\":1}},\"tee\":{\"x\":0,\"y\":1},\"teeBoxes\":{\"member\":{\"x\":0,\"y\":1}},\"waypoints\":[{\"x\":1,\"y\":1}]},\"id\":\"built-hole\",\"obstacles\":[{\"type\":\"bush\",\"x\":2,\"y\":0}],\"provenance\":{\"importedAt\":\"2026-08-05T12:00:00.000Z\",\"redistribution\":\"private_only\",\"rightsAttested\":true,\"sourceAssetRetained\":false,\"sourceKind\":\"manual\",\"sourceLabel\":\"Player-built hole\"},\"title\":\"Built par three\",\"version\":1,\"width\":4,\"yardsPerTile\":5}") as HoleTemplateV1;
    const course = structuredClone(DEFAULT_COURSE); course.holes = []; course.tiles = course.tiles.map(() => "rough"); course.elevations = course.elevations.map(() => 5); course.obstacles = []; course.decorations = []; course.buildings = []; course.estate = undefined; course.yardsPerTile = 5;
    const plan = planned({ course, world: { ...structuredClone(DEFAULT_WORLD), cash: 1_000_000, reputation: 100, isBankrupt: false }, template: source, placement: placement({ holeId: "historical-hole" }) });
    expect(sha256Hex(canonicalHoleTemplatePlanIdentityJson(plan))).toBe("462aeb00d219f0d3d3e560ad35252a442622bf0920053d69bdbf85e7f4c15714");
    expect(sha256Hex(plan.identity.value)).toBe("3ce89622d8a9eb4ad2840fd5cfe68fdaab7c17243139d93af9f4b75022f326c5");
    expect(sha256Hex(JSON.stringify(plan))).toBe("c5c6f5ac84a9d42b104bfa29a9934191795df72ea67de3bc11082287df43dcec");
    expect(plan.mutations).not.toHaveProperty("surfaceIntent");
  });
});


describe("TEMPLATE-P sparse boundary authority", () => {
  it("blocks outside continuous control points even when every sparse authored tile is inside", () => {
    const source = template({ obstacles: [], decorations: [], cells: [{ x: 1, y: 1, terrain: "tee", elevationOffset: 0 }, { x: 2, y: 1, terrain: "path", elevationOffset: 0 }, { x: 3, y: 1, terrain: "green", elevationOffset: 0 }], hole: { tee: { x: 1, y: 1 }, green: { x: 3, y: 1 }, parMode: "AUTO" },
      surfaceIntent: { version: 1, features: [{ id: "sparse-edge", terrain: "path", order: 1, coverage: [6], geometry: { kind: "corridor", knots: [{ x: 0, y: 1.5 }, { x: 2.5, y: 1.5 }], width: 1 } }] } });
    const where = placement({ origin: { x: -1, y: 10 }, rotation: 0, mirrorX: false }), plan = planned({ template: source, placement: where });
    expect(plan.canApply).toBe(false); expect(plan.blockers).toContainEqual(expect.objectContaining({ code: "out_of_bounds", path: "template.surfaceIntent", points: [{ x: -1, y: 11.5 }] }));
    const legacy = structuredClone(source); delete legacy.surfaceIntent; expect(planned({ template: legacy, placement: where }).canApply).toBe(true);
  });
});
