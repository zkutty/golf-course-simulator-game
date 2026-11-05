import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { browserPlatform } from "../../platform/browserPlatform";
import type { PlatformServices } from "../../platform/types";
import { canonicalJson } from "../../utils/canonical";
import { captureHoleTemplate, createHoleTemplatePackage } from "../contentPackages/holeTemplatePackage";
import { deleteContentPackage, exportContentPackage, importContentPackage, readHoleTemplatePackage, saveAuthoredHoleTemplatePackage } from "../contentPackages/library";
import { corridorFeature, rasterizeSurfaceFeatureDetailed } from "../models/surfaceIntent";
import { isWalkableTerrain } from "../models/terrainRules";
import { createEstate, isOwnedTile } from "../estate/estate";
import { sha256Hex } from "./serialization";
import type { Action } from "../../core/actions";
import { applyAction } from "../../core/reducer";
import { CURRENT_SAVE_SCHEMA_VERSION, normalizeLoadedSaveResult } from "../../utils/save";
import type { GameState } from "../gameState";
import { DEFAULT_COURSE, DEFAULT_WORLD } from "../models/defaults";
import type { Course, Point, World } from "../models/types";
import { canonicalHoleTemplatePlanIdentityJson, planHoleTemplatePlacement } from "./placement";
import type {
  HoleTemplatePlacement,
  HoleTemplatePlacementPlanV1,
  HoleTemplateV1,
} from "./types";

function sourceTemplate(): HoleTemplateV1 {
  return {
    format: "coursecraft-hole-template",
    version: 1,
    id: "portable-par-three",
    title: "Portable Par Three",
    description: "Reducer transaction fixture.",
    width: 3,
    height: 3,
    yardsPerTile: DEFAULT_COURSE.yardsPerTile,
    cells: [
      { x: 0, y: 1, terrain: "tee", elevationOffset: 0 },
      { x: 1, y: 1, terrain: "fairway", elevationOffset: 1 },
      { x: 2, y: 1, terrain: "green", elevationOffset: 0 },
    ],
    hole: {
      tee: { x: 0, y: 1 },
      green: { x: 2, y: 1 },
      teeBoxes: { member: { x: 0, y: 1 } },
      pinPositions: { A: { x: 2, y: 1 } },
      parMode: "MANUAL",
      parManual: 3,
    },
    obstacles: [{ x: 1, y: 2, type: "bush" }],
    decorations: [{ kind: "flower_bed", x: 0, y: 2, rotation: 0 }],
    provenance: {
      sourceKind: "licensed_provider",
      sourceLabel: "Example Design Archive",
      importedAt: "2026-08-05T12:00:00.000Z",
      rightsAttested: true,
      licenseName: "Example License",
      attribution: "Designed by Example Architect",
      redistribution: "attribution",
      sourceAssetRetained: false,
    },
    confidence: { scale: 1, terrain: 1, elevation: 1, notes: [] },
  };
}

function transactionState(origin = { x: 10, y: 10 }): GameState {
  const course: Course = structuredClone(DEFAULT_COURSE);
  course.holes = [];
  course.layouts = undefined;
  course.activeCourseId = undefined;
  course.tiles = new Array(course.width * course.height).fill("rough");
  course.elevations = new Array(course.width * course.height).fill(4);
  course.obstacles = [{ x: origin.x + 1, y: origin.y + 2, type: "tree", origin: "natural" }];
  course.decorations = [];
  course.buildings = [];
  course.estate = undefined;
  const world: World = { ...structuredClone(DEFAULT_WORLD), cash: 1_000_000, reputation: 100, isBankrupt: false };
  return {
    course,
    world,
    selectedTerrain: "fairway",
    terrainVersion: 3,
    obstaclesVersion: 4,
    markersVersion: 5,
    economyVersion: 6,
  };
}

function placement(origin = { x: 10, y: 10 }): HoleTemplatePlacement {
  return {
    origin,
    rotation: 0,
    elevationPolicy: "template-relief",
    baseElevation: 4,
    holeId: `installed-${origin.x}-${origin.y}`,
  };
}

function preview(state: GameState, origin = { x: 10, y: 10 }): HoleTemplatePlacementPlanV1 {
  const result = planHoleTemplatePlacement({
    course: state.course,
    world: state.world,
    template: sourceTemplate(),
    placement: placement(origin),
    targetVersions: {
      terrainVersion: state.terrainVersion,
      obstaclesVersion: state.obstaclesVersion,
      markersVersion: state.markersVersion,
      economyVersion: state.economyVersion,
    },
  });
  if (result.status !== "planned" || !result.plan.canApply) throw new Error("Expected an applicable placement preview.");
  return result.plan;
}

function action(plan: HoleTemplatePlacementPlanV1): Action {
  return { type: "PLACE_HOLE_TEMPLATE", plan };
}

describe("PLACE_HOLE_TEMPLATE authoritative transaction", () => {
  it("applies the verified plan atomically at the exact preview price", () => {
    const before = transactionState();
    const plan = preview(before);
    const untouched = structuredClone(before);
    const after = applyAction(before, action(plan));

    expect(before).toEqual(untouched);
    expect(after).not.toBe(before);
    expect(after.world.cash).toBe(before.world.cash - plan.quote.total);
    expect(after.course.tiles[11 * after.course.width + 10]).toBe("tee");
    expect(after.course.tiles[11 * after.course.width + 11]).toBe("fairway");
    expect(after.course.elevations[11 * after.course.width + 11]).toBe(5);
    expect(after.course.obstacles).toContainEqual(expect.objectContaining({ x: 11, y: 12, type: "bush", origin: "player" }));
    expect(after.course.obstacles).not.toContainEqual(expect.objectContaining({ x: 11, y: 12, type: "tree" }));
    expect(after.course.decorations).toContainEqual(expect.objectContaining({ x: 10, y: 12, kind: "flower_bed", origin: "player" }));
    expect(after.course.holes).toHaveLength(1);
    expect(after.course.holes[0]).toMatchObject({
      id: "installed-10-10",
      templateAttribution: {
        templateId: "portable-par-three",
        sourceLabel: "Example Design Archive",
        licenseName: "Example License",
        attribution: "Designed by Example Architect",
      },
    });
    expect(after.course.layouts?.[0].draftHoleIds).toEqual(["installed-10-10"]);
    expect(after.course.layouts?.[0].publishedHoleIds).toEqual([]);
    expect({
      terrainVersion: after.terrainVersion,
      obstaclesVersion: after.obstaclesVersion,
      markersVersion: after.markersVersion,
      economyVersion: after.economyVersion,
    }).toEqual(plan.mutations.versions.after);
    expect(JSON.stringify(after.course.holes[0])).not.toContain("confidence");
    expect(JSON.stringify(after.course.holes[0])).not.toContain("Reducer transaction fixture");
  });

  it("uses one reducer boundary and is repeat-safe", () => {
    const before = transactionState();
    const command = action(preview(before));
    const after = applyAction(before, command);
    const repeated = applyAction(after, command);

    expect(repeated).toBe(after);
    expect(after.course.holes).toHaveLength(before.course.holes.length + 1);
    // Existing undo/redo owners need retain only these two complete snapshots;
    // no intermediate terrain, obstacle, cash, or layout state is observable.
    expect(structuredClone(before)).toEqual(before);
    expect(structuredClone(after)).toEqual(after);
  });

  it("survives current-schema save/reload with stable identity and compact attribution", () => {
    const before = transactionState();
    const after = applyAction(before, action(preview(before)));
    const loaded = normalizeLoadedSaveResult({
      schemaVersion: CURRENT_SAVE_SCHEMA_VERSION,
      savedAt: 1,
      course: after.course,
      world: after.world,
    });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.payload.course.holes[0]).toMatchObject({
      id: "installed-10-10",
      templateAttribution: { templateId: "portable-par-three", attribution: "Designed by Example Architect" },
    });
    expect(loaded.payload.course.layouts?.[0].draftHoleIds).toContain("installed-10-10");
  });

  it("blocks a live Player Pro round without changing any state", () => {
    const before = transactionState();
    const plan = preview(before);
    const active = {
      ...before,
      world: {
        ...before.world,
        playerPro: { activeRound: { phase: "shot" } },
      } as unknown as World,
    };
    expect(applyAction(active, action(plan))).toBe(active);
  });
});

describe("PLACE_HOLE_TEMPLATE reducer fuzz", () => {
  it("changes nothing for stale current versions or same-version course drift", () => {
    fc.assert(fc.property(
      fc.constantFrom("terrainVersion", "obstaclesVersion", "markersVersion", "economyVersion"),
      fc.integer({ min: 1, max: 100 }),
      (key, delta) => {
        const before = transactionState();
        const plan = preview(before);
        const stale = { ...before, [key]: before[key] + delta };
        expect(applyAction(stale, action(plan))).toBe(stale);

        const drifted = structuredClone(before);
        drifted.course.tiles[11 * drifted.course.width + 10] = "fairway";
        expect(applyAction(drifted, action(plan))).toBe(drifted);
      },
    ), { numRuns: 100 });
  });

  it("changes nothing for malicious hashes, prices, mutations, or malformed carriers", () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 1_000_000 }), fc.constantFrom("cash", "terrain", "hole"), (delta, field) => {
      const before = transactionState();
      const malicious = structuredClone(preview(before));
      if (field === "cash") malicious.mutations.cashDelta -= delta;
      if (field === "terrain") malicious.mutations.terrain[0].after = "water";
      if (field === "hole") malicious.mutations.addHole.id = `attacker-${delta}`;
      expect(applyAction(before, action(malicious))).toBe(before);

      malicious.identity.value = "0".repeat(64);
      expect(applyAction(before, action(malicious))).toBe(before);
    }), { numRuns: 100 });
    const before = transactionState();
    expect(() => applyAction(before, { type: "PLACE_HOLE_TEMPLATE", plan: null } as unknown as Action)).not.toThrow();
    expect(applyAction(before, { type: "PLACE_HOLE_TEMPLATE", plan: null } as unknown as Action)).toBe(before);
  });

  it("rolls back every category when the authoritative replan becomes blocked", () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 100 }), (cash) => {
      const before = transactionState();
      const plan = preview(before);
      const blocked = { ...before, world: { ...before.world, cash } };
      const snapshot = structuredClone(blocked);
      const after = applyAction(blocked, action(plan));
      expect(after).toBe(blocked);
      expect(after).toEqual(snapshot);
    }), { numRuns: 50 });
  });
});


const SURFACE_TRANSFORMS = [
  [0, false], [1, false], [2, false], [3, false], [0, true], [1, true], [2, true], [3, true],
] as const;
function rigidOracle(point: Point, width: number, height: number, where: HoleTemplatePlacement): Point {
  const [cos, sin] = [[1, 0], [0, 1], [-1, 0], [0, -1]][where.rotation];
  const x = (point.x - width / 2) * (where.mirrorX ? -1 : 1), y = point.y - height / 2;
  const outWidth = where.rotation % 2 ? height : width, outHeight = where.rotation % 2 ? width : height;
  return { x: where.origin.x + outWidth / 2 + cos * x - sin * y, y: where.origin.y + outHeight / 2 + sin * x + cos * y };
}
function surfaceState(): GameState {
  const state = transactionState();
  state.course.width = 64; state.course.height = 48; state.course.tiles = Array(64 * 48).fill("rough"); state.course.elevations = Array(64 * 48).fill(4);
  state.course.obstacles = []; state.course.decorations = []; state.course.surfaceIntent = { version: 1, nextId: 1, features: [1, 2].map(id => ({ id: `surface-${id}`, terrain: "rough", order: id * 3, coverage: [id], geometry: { kind: "corridor", knots: [{ x: id + .5, y: .5 }], width: 1 } })) };
  return state;
}
function surfacePlan(state: GameState, template: HoleTemplateV1, where = placement({ x: 18, y: 9 })): HoleTemplatePlacementPlanV1 {
  const result = planHoleTemplatePlacement({ course: state.course, world: state.world, template, placement: where, targetVersions: { terrainVersion: state.terrainVersion, obstaclesVersion: state.obstaclesVersion, markersVersion: state.markersVersion, economyVersion: state.economyVersion } });
  if (result.status !== "planned") throw new Error("Expected valid template planning");
  return result.plan;
}
function smallAuthoredTemplate(): HoleTemplateV1 {
  const source = sourceTemplate(); source.obstacles = []; source.decorations = [];
  source.surfaceIntent = { version: 1, features: [{ id: "portable-path", terrain: "path", order: 2, coverage: [4], geometry: { kind: "corridor", knots: [{ x: 1.2, y: 1.5 }, { x: 1.8, y: 1.5 }], width: 1.5, tangents: [{ in: { x: 1, y: 1.5 }, out: { x: 1.4, y: 1.5 } }, { in: { x: 1.6, y: 1.5 }, out: { x: 2, y: 1.5 } }] } }] };
  return source;
}
async function packagedSavedS() {
  const source = structuredClone(DEFAULT_COURSE); source.width = 16; source.height = 16; source.tiles = Array(256).fill("rough"); source.elevations = Array(256).fill(4);
  source.obstacles = []; source.decorations = []; source.buildings = []; source.surfaceIntent = { version: 1, nextId: 8, features: [] };
  const feature = corridorFeature(source, "path", [{ x: 2.5, y: 3.5 }, { x: 6.5, y: 2.5 }, { x: 9.5, y: 6.5 }, { x: 13.5, y: 5.5 }], 1.5); feature.order = 9;
  if (feature.geometry.kind !== "corridor") throw new Error("Expected saved S");
  feature.geometry.tangents = feature.geometry.knots.map(p => ({ in: { x: p.x - .6, y: p.y }, out: { x: p.x + .6, y: p.y } }));
  const raster = rasterizeSurfaceFeatureDetailed(feature, 16, 16); feature.coverage = raster.tiles.map(p => p.y * 16 + p.x); feature.renderRings = raster.rings;
  for (const cell of feature.coverage) source.tiles[cell] = "path"; source.surfaceIntent.features = [feature];
  const hole = { id: "saved-S", tee: { x: 0, y: 0 }, green: { x: 15, y: 15 }, parMode: "AUTO" as const }; source.holes = [hole]; source.tiles[0] = "tee"; source.tiles[255] = "green";
  const template = captureHoleTemplate(source, hole, { id: "saved-S-template", title: "Saved S", description: "Authored portable S", yardsPerTile: source.yardsPerTile,
    provenance: { sourceKind: "manual", sourceLabel: "Player-built hole", importedAt: "2026-08-05T12:00:00.000Z", rightsAttested: true, redistribution: "private_only", sourceAssetRetained: false }, confidence: { scale: 1, terrain: 1, elevation: 1, notes: [] } });
  const value = await createHoleTemplatePackage({ template, title: template.title, description: template.description, author: { id: "author-01", displayName: "Author" }, requiredGameVersion: "1.0.0", theme: "parkland", now: new Date("2026-08-05T12:00:00.000Z") });
  const values = new Map<string, string>();
  const platform: PlatformServices = { ...browserPlatform, files: { readText: async key => values.get(key) ?? null, writeTextAtomic: async (key, text) => void values.set(key, text), delete: async key => void values.delete(key), list: async prefix => [...values.keys()].filter(key => key.startsWith(prefix)), chooseImport: async () => null, chooseExport: async (name, text) => (values.set(`export:${name}`, text), true), exportSupportBundle: async () => true } };
  expect((await saveAuthoredHoleTemplatePackage(value, platform)).entry).toBeDefined(); expect(await exportContentPackage(value.manifest.contentId, platform)).toBe(true);
  const text = [...values.entries()].find(([key]) => key.startsWith("export:"))![1];
  expect(await deleteContentPackage(value.manifest.contentId, platform)).toBe(true); expect((await importContentPackage(text, "manual", platform)).entry).toBeDefined();
  const loaded = await readHoleTemplatePackage(value.manifest.contentId, platform); if (!loaded) throw new Error("Expected actual imported template");
  return { source, feature, template: loaded.payload.template, platform, contentId: value.manifest.contentId };
}
function expectPoints(actual: readonly Point[], expected: readonly Point[]) {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((point, index) => { expect(point.x).toBeCloseTo(expected[index].x, 12); expect(point.y).toBeCloseTo(expected[index].y, 12); });
}

describe("TEMPLATE-P authored transaction authority", () => {
  it.each(SURFACE_TRANSFORMS)("captures/packages/applies/reloads the actual S at rotation %s mirror %s", async (rotation, mirrorX) => {
    const saved = await packagedSavedS(), state = surfaceState(), untouched = structuredClone(state), portableBefore = structuredClone(saved.template);
    const where = { ...placement({ x: 18, y: 9 }), rotation, mirrorX }, plan = surfacePlan(state, saved.template, where); expect(plan.canApply).toBe(true);
    const originalIntent = JSON.stringify(state.course.surfaceIntent), after = applyAction(state, action(plan)), placed = after.course.surfaceIntent!.features.at(-1)!;
    expect(after).not.toBe(state); expect(state).toEqual(untouched); expect(after.world.cash).toBe(state.world.cash - plan.quote.total);
    expect(JSON.stringify(after.course.surfaceIntent!.features.slice(0, 2))).toBe(JSON.stringify(state.course.surfaceIntent!.features));
    expect(placed).toMatchObject({ id: "surface-3", order: 7 }); expect(after.course.surfaceIntent!.nextId).toBe(4);
    expect(saved.template).toEqual(portableBefore); expect(JSON.stringify(state.course.surfaceIntent)).toBe(originalIntent);
    if (placed.geometry.kind !== "corridor" || saved.feature.geometry.kind !== "corridor") throw new Error("Expected S corridor");
    const oracle = (point: Point) => rigidOracle(point, 16, 16, where);
    expect(placed.geometry.width).toBe(1.5); expectPoints(placed.geometry.knots, saved.feature.geometry.knots.map(oracle));
    placed.geometry.tangents!.forEach((pair, i) => expectPoints([pair.in, pair.out], [oracle(saved.feature.geometry.tangents![i].in), oracle(saved.feature.geometry.tangents![i].out)]));
    expect(placed.coverage).toEqual(saved.feature.coverage.map(index => { const center = oracle({ x: index % 16 + .5, y: Math.floor(index / 16) + .5 }); return (center.y - .5) * 64 + center.x - .5; }).sort((a, b) => a - b));
    placed.renderRings!.forEach((ring, i) => { const expected = saved.feature.renderRings![i].map(oracle); if (mirrorX) expected.reverse(); expectPoints(ring, expected); });
    const loaded = normalizeLoadedSaveResult({ schemaVersion: CURRENT_SAVE_SCHEMA_VERSION, savedAt: 1, course: after.course, world: after.world }); expect(loaded.ok).toBe(true);
    if (!loaded.ok) throw new Error("Expected actual reload");
    expect(loaded.payload.course.surfaceIntent).toEqual(after.course.surfaceIntent);
    expect(await deleteContentPackage(saved.contentId, saved.platform)).toBe(true); expect(await readHoleTemplatePackage(saved.contentId, saved.platform)).toBeNull();
    expect(loaded.payload.course.surfaceIntent!.features.at(-1)).toEqual(placed);
    plan.mutations.surfaceIntent!.addFeatures[0].coverage.pop();
    if (plan.mutations.surfaceIntent!.addFeatures[0].geometry.kind === "corridor") plan.mutations.surfaceIntent!.addFeatures[0].geometry.knots[0].x++;
    expect(loaded.payload.course.surfaceIntent!.features.at(-1)).toEqual(placed); expect(saved.template).toEqual(portableBefore);
    placed.coverage.pop(); expect(state).toEqual(untouched); expect(saved.template).toEqual(portableBefore);
  });
  it("keeps exact tile, relief, cash, ownership and passability authority with or without metadata", () => {
    const state = surfaceState(), source = smallAuthoredTemplate(), old = structuredClone(source); delete old.surfaceIntent;
    const actualPlan = surfacePlan(state, source), oldPlan = surfacePlan(state, old);
    expect(actualPlan.quote).toEqual(oldPlan.quote);
    const actual = applyAction(state, action(actualPlan)), legacy = applyAction(state, action(oldPlan));
    expect(actual.course.tiles).toEqual(legacy.course.tiles); expect(actual.course.elevations).toEqual(legacy.course.elevations); expect(actual.world.cash).toBe(legacy.world.cash); expect(actual.course.estate).toEqual(legacy.course.estate);
    expect(actual.course.tiles.map(isWalkableTerrain)).toEqual(legacy.course.tiles.map(isWalkableTerrain));
    expect(isOwnedTile(actual.course, 19, 10)).toBe(isOwnedTile(legacy.course, 19, 10));
    const { surfaceIntent: _intent, ...course } = actual.course, { surfaceIntent: _oldIntent, ...oldCourse } = legacy.course; expect(course).toEqual(oldCourse);
    expect(actual.terrainVersion).toBe(legacy.terrainVersion); expect(actual.obstaclesVersion).toBe(legacy.obstaclesVersion); expect(actual.markersVersion).toBe(legacy.markersVersion); expect(actual.economyVersion).toBe(legacy.economyVersion);
  });
  it.each(["width", "handle", "coverage", "baseHash", "nextId", "template-width", "template-handle"])("rejects a rehashed forged %s atomically", field => {
    const state = surfaceState(), plan = surfacePlan(state, smallAuthoredTemplate()), forged = structuredClone(plan), feature = forged.mutations.surfaceIntent!.addFeatures[0];
    if (field === "width" && feature.geometry.kind === "corridor") feature.geometry.width = 2;
    if (field === "handle" && feature.geometry.kind === "corridor") feature.geometry.tangents![0].out.y += .1;
    if (field === "coverage") feature.coverage = [0];
    if (field === "baseHash") forged.mutations.surfaceIntent!.baseHash = "0".repeat(64);
    if (field === "nextId") forged.mutations.surfaceIntent!.nextId++;
    const portable = forged.template.surfaceIntent!.features[0].geometry;
    if (field === "template-width" && portable.kind === "corridor") portable.width = 2;
    if (field === "template-handle" && portable.kind === "corridor") portable.tangents![0].out.y += .1;
    forged.identity.value = sha256Hex(canonicalHoleTemplatePlanIdentityJson(forged));
    expect(applyAction(state, action(forged))).toBe(state);
  });
  it.each(["width", "handle", "counter", "order", "new-overlap"])("rejects same-version target intent %s drift", field => {
    const state = surfaceState(), plan = surfacePlan(state, smallAuthoredTemplate()), changed = structuredClone(state);
    const feature = changed.course.surfaceIntent!.features[0];
    if (field === "width" && feature.geometry.kind === "corridor") feature.geometry.width++;
    if (field === "handle" && feature.geometry.kind === "corridor") feature.geometry.tangents = [{ in: { x: 1, y: 0 }, out: { x: 2, y: 1 } }];
    if (field === "counter") changed.course.surfaceIntent!.nextId = 5;
    if (field === "order") feature.order++;
    if (field === "new-overlap") feature.coverage.push(10 * 64 + 18);
    expect(applyAction(changed, action(plan))).toBe(changed);
    expect(plan.mutations.surfaceIntent!.baseHash).toBe(sha256Hex(canonicalJson(state.course.surfaceIntent)));
  });
  it.each(["funds", "ownership", "bounds", "building", "round", "capacity", "counter"])("keeps all state unchanged when %s blocks a previously accepted preview", reason => {
    const state = surfaceState(), plan = surfacePlan(state, smallAuthoredTemplate()), blocked = structuredClone(state);
    if (reason === "funds") blocked.world.cash = 0;
    if (reason === "ownership") { blocked.course.estate = createEstate(blocked.course, 714); blocked.course.estate.ownedParcelIds = []; }
    if (reason === "bounds") { blocked.course.width = 16; blocked.course.height = 16; blocked.course.tiles = Array(256).fill("rough"); blocked.course.elevations = Array(256).fill(4); }
    if (reason === "building") blocked.course.buildings = [{ id: "blocked-building", type: "clubhouse", x: 18, y: 10 }];
    if (reason === "round") blocked.world.playerPro = { activeRound: { phase: "shot" } } as unknown as World["playerPro"];
    if (reason === "capacity") blocked.course.surfaceIntent!.features = Array.from({ length: 512 }, (_, i) => ({ ...structuredClone(blocked.course.surfaceIntent!.features[0]), id: `capacity-${i}`, order: i }));
    if (reason === "counter") blocked.course.surfaceIntent!.nextId = Number.MAX_SAFE_INTEGER;
    const before = structuredClone(blocked); expect(applyAction(blocked, action(plan))).toBe(blocked); expect(blocked).toEqual(before);
  });
  it("increments terrainVersion for an intent-only apply at the unchanged zero quote", () => {
    const state = surfaceState(), source = smallAuthoredTemplate(), where = placement({ x: 18, y: 9 });
    source.cells.forEach(cell => { const center = rigidOracle({ x: cell.x + .5, y: cell.y + .5 }, 3, 3, where); const index = (center.y - .5) * 64 + center.x - .5; state.course.tiles[index] = cell.terrain; state.course.elevations[index] = 4 + cell.elevationOffset; });
    const plan = surfacePlan(state, source, where); expect(plan.quote.total).toBe(0); expect(plan.mutations.terrain).toEqual([]); expect(plan.mutations.elevations).toEqual([]);
    const after = applyAction(state, action(plan)); expect(after.terrainVersion).toBe(state.terrainVersion + 1); expect(after.world.cash).toBe(state.world.cash); expect(after.course.surfaceIntent!.features).toHaveLength(3);
  });
});


describe("TEMPLATE-P isolated G proof (coordinator scheduled)", () => {
  it("G rigid covariance preserves accepted saved-S centerlines and clipping in all8 transforms", async () => {
    const { buildContinuousPathPlan } = await import("../paths/continuousPathPlan");
    const saved = await packagedSavedS(), sourcePlan = buildContinuousPathPlan(saved.source);
    const sourceEdges = sourcePlan.edges.filter(edge => edge.source === "intent"); expect(sourceEdges.length).toBeGreaterThan(0);
    const distance = (point: Point, polylines: readonly (readonly Point[])[]) => {
      let best = Infinity;
      for (const points of polylines) for (let i = 1; i < points.length; i++) {
        const a = points[i - 1], b = points[i], dx = b.x - a.x, dy = b.y - a.y;
        const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
        best = Math.min(best, Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy));
      }
      return best;
    };
    for (const [rotation, mirrorX] of SURFACE_TRANSFORMS) {
      const state = surfaceState(), where = { ...placement({ x: 18, y: 9 }), rotation, mirrorX }, plan = surfacePlan(state, saved.template, where);
      expect(plan.canApply).toBe(true); const after = applyAction(state, action(plan));
      const targetPlan = buildContinuousPathPlan(after.course), targetEdges = targetPlan.edges.filter(edge => edge.source === "intent" && edge.featureIds.includes("surface-3"));
      expect(targetEdges.length).toBeGreaterThan(0); expect(targetEdges.every(edge => Math.abs(edge.width - .9) < 1e-12)).toBe(true);
      const expected = sourceEdges.map(edge => edge.points.map(point => rigidOracle(point, 16, 16, where))), actual = targetEdges.map(edge => edge.points);
      const distances = [...expected.flat().map(point => distance(point, actual)), ...actual.flat().map(point => distance(point, expected))];
      expect(Math.max(...distances)).toBeLessThan(1e-7);
      expect(targetPlan.coverage).toEqual(after.course.surfaceIntent!.features.at(-1)!.coverage);
      expect(targetEdges.every(edge => edge.coverage.every(cell => after.course.tiles[cell] === "path"))).toBe(true);
    }
  });
});
