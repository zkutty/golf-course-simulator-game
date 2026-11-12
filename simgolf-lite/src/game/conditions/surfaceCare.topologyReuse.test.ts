import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_WORLD } from "../models/defaults";
import type { Course, SurfaceFeature, Terrain } from "../models/types";
import type { SurfaceCareTopology } from "./surfaceCare";
import { normalizeCourseLayouts } from "../models/courseLayouts";
import { createM27ReleaseReferenceCourse, createRenderPerfCourse } from "../testing/referenceCourse";
import { createM53SurfaceCareRoutineFixture } from "../testing/m53SurfaceCareFixtures";
import { encodeTerrainBaseline } from "../estate/estate";
import { redoEditorEdit, undoEditorEdit } from "../editor/editorHistory";

afterEach(async () => {
  vi.doUnmock("./surfaceCareTopologyReuse");
  await vi.dynamicImportSettled();
});

async function isolated(ready = true) {
  await vi.dynamicImportSettled();
  vi.resetModules();
  const api = await import("./surfaceCare");
  if (ready) {
    // Trigger the genuine optional import through its production miss path.
    api.surfaceCareTopology(course());
    await vi.dynamicImportSettled();
  }
  return api;
}

function feature(id = "authored", coverage = [0, 1], order = 1, terrain: Terrain = "fairway"): SurfaceFeature {
  return { id, terrain, order, coverage, geometry: { kind: "region", ring: [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 1 }] } };
}

function course(): Course {
  return {
    width: 16, height: 8,
    tiles: Array.from({ length: 128 }, (_, index): Terrain => index < 20 ? "fairway" : "rough"),
    elevations: new Array(128).fill(0), holes: [], obstacles: [], buildings: [],
    yardsPerTile: 4, name: "Topology reuse", baseGreenFee: 65, condition: 1, theme: "parkland",
    surfaceIntent: { version: 1, nextId: 2, features: [feature()] },
  };
}

function value(topology: SurfaceCareTopology) {
  return { zones: topology.zones, zoneByTile: topology.zoneByTile, zonesByKey: [...topology.zonesByKey] };
}

async function expectColdParity(input: Course, actual: SurfaceCareTopology) {
  const cold = await isolated(false);
  expect(value(actual)).toEqual(value(cold.surfaceCareTopology(structuredClone(input))));
}

function estate(input: Course, natural: Terrain = "rough") {
  // Only this production builder's estate dependency; no estate logic is mocked.
  return { naturalBaseline: { terrainRle: encodeTerrainBaseline(new Array<Terrain>(input.tiles.length).fill(natural)) } } as Course["estate"];
}

describe("bounded exact-content surface-care topology reuse", () => {
  it("qualifies the actual18-hole canonical production save path and matches a cold module", async () => {
    const api = await isolated();
    const save = await import("../../utils/save");
    const input = normalizeCourseLayouts(createRenderPerfCourse("parkland"));
    expect(input.holes).toHaveLength(18);
    const encode = (payload: Parameters<typeof save.payloadForPersistence>[0]) => JSON.stringify({
      schemaVersion: save.CURRENT_SAVE_SCHEMA_VERSION, savedAt: 123,
      ...save.payloadForPersistence(payload),
    });
    const warm = save.parseSaveText(encode({ course: input, world: DEFAULT_WORLD, history: [] }));
    if (!warm.ok) throw new Error(JSON.stringify(warm.error));
    const text = encode(warm.payload);
    const first = save.parseSaveText(text), second = save.parseSaveText(text);
    if (!first.ok || !second.ok) throw new Error("canonical save did not parse");
    expect(first.payload.course.tiles).not.toBe(second.payload.course.tiles);
    const a = api.surfaceCareTopology(first.payload.course), b = api.surfaceCareTopology(second.payload.course);
    expect(a).toBe(b);
    expect(a.zoneByTile).toHaveLength(7_700);
    await expectColdParity(second.payload.course, b);
  });

  it("describes36-hole M27 eligibility without timers or relaxed caps", async () => {
    const api = await isolated();
    const input = normalizeCourseLayouts(createM27ReleaseReferenceCourse("parkland"));
    expect(input.holes).toHaveLength(36);
    expect(input.tiles).toHaveLength(30_800);
    const a = api.surfaceCareTopology(input), b = api.surfaceCareTopology(structuredClone(input));
    console.info(JSON.stringify({ fixture: "M27-36", tiles: input.tiles.length, zones: a.zones.length, contentReuseEligible: a === b }));
    await expectColdParity(input, b);
  });

  it("retains the identity fast path, but only one content entry across A/B/A", async () => {
    const api = await isolated(), a = course(), b = course();
    b.tiles[3] = "green";
    const first = api.surfaceCareTopology(a);
    expect(api.surfaceCareTopology({ ...a, condition: 0.2 })).toBe(first);
    const other = api.surfaceCareTopology(b);
    expect(other).not.toBe(first);
    expect(api.surfaceCareTopology(structuredClone(b))).toBe(other);
    const returned = api.surfaceCareTopology(structuredClone(a));
    expect(returned).not.toBe(first);
    expect(value(returned)).toEqual(value(first));
    // Existing weak ownership remains valid after replacement of the strong entry.
    expect(api.surfaceCareTopology(a)).toBe(first);
  });

  it.each([
    ["cultivated terrain", (c: Course) => { c.tiles[3] = "green"; }],
    ["noncultivated terrain", (c: Course) => { c.tiles[100] = "water"; }],
    ["dimensions", (c: Course) => { c.width = 8; c.height = 16; }],
    ["feature id", (c: Course) => { c.surfaceIntent!.features[0].id = "changed"; }],
    ["feature terrain", (c: Course) => { c.surfaceIntent!.features[0].terrain = "green"; }],
    ["feature order", (c: Course) => { c.surfaceIntent!.features[0].order = 2; }],
    ["coverage", (c: Course) => { c.surfaceIntent!.features[0].coverage = [1, 2]; }],
    ["coverage sequence", (c: Course) => { c.surfaceIntent!.features[0].coverage.reverse(); }],
    ["estate presence", (c: Course) => { c.estate = estate(c); }],
  ] as const)("invalidates %s using the unchanged cold builder", async (_name, change) => {
    const api = await isolated(), initial = course();
    const first = api.surfaceCareTopology(initial), edited = structuredClone(initial);
    change(edited);
    const result = api.surfaceCareTopology(edited);
    expect(result).not.toBe(first);
    await expectColdParity(edited, result);
  });

  it("preserves sort participation, original sequence and equal-id/order overlap ties", async () => {
    const api = await isolated(), a = course();
    a.surfaceIntent!.features = [feature("same", [0, 1], 1), feature("same", [1, 2], 1), feature("water", [], 0, "water")];
    const first = api.surfaceCareTopology(a), reversed = structuredClone(a);
    reversed.surfaceIntent!.features.reverse();
    const second = api.surfaceCareTopology(reversed);
    expect(second).not.toBe(first);
    await expectColdParity(reversed, second);
    const changed = structuredClone(reversed);
    changed.surfaceIntent!.features[0].order = 99;
    expect(api.surfaceCareTopology(changed)).not.toBe(second);
    await expectColdParity(changed, api.surfaceCareTopology(changed));
  });

  it("does not collapse different raw RLE fallbacks and ignores unrelated metadata", async () => {
    const api = await isolated(), a = course();
    a.estate = estate(a);
    const first = api.surfaceCareTopology(a), metadata = structuredClone(a);
    metadata.name = "Other"; metadata.condition = 0.3;
    metadata.elevations.fill(4);
    metadata.surfaceIntent!.nextId = 99;
    metadata.surfaceIntent!.features[0].geometry = { kind: "region", ring: [] };
    metadata.surfaceIntent!.features[0].renderRings = [];
    metadata.estate!.seed = 123;
    expect(api.surfaceCareTopology(metadata)).toBe(first);
    const changed = structuredClone(metadata);
    changed.estate!.naturalBaseline.terrainRle = encodeTerrainBaseline(new Array<Terrain>(128).fill("water"));
    expect(api.surfaceCareTopology(changed)).not.toBe(first);
    const invalid1 = structuredClone(a), invalid2 = structuredClone(a);
    invalid1.estate!.naturalBaseline.terrainRle = "invalid-one";
    invalid2.estate!.naturalBaseline.terrainRle = "invalid-two";
    const one = api.surfaceCareTopology(invalid1), two = api.surfaceCareTopology(invalid2);
    expect(two).not.toBe(one);
    await expectColdParity(invalid2, two);
  });

  it("keeps fresh condition normalization while sharing only topology", async () => {
    const api = await isolated();
    const a = createM53SurfaceCareRoutineFixture(course(), "healthy"), b = structuredClone(a);
    const key = api.surfaceCareTopology(a).zones[0].key;
    b.surfaceCare!.records[key].mowingQuality = 0.2;
    const first = api.normalizeSurfaceCareState(a.surfaceCare, a);
    const second = api.normalizeSurfaceCareState(b.surfaceCare, b);
    expect(api.surfaceCareTopology(a)).toBe(api.surfaceCareTopology(b));
    expect(first).not.toBe(second);
    expect(first!.records[key].mowingQuality).not.toBe(second!.records[key].mowingQuality);
    expect(second!.records[key].mowingQuality).toBe(0.2);
  });

  it("preserves reconciliation, actual undo/redo and edit/revert records", async () => {
    const api = await isolated();
    const a = createM53SurfaceCareRoutineFixture(course(), "healthy"), b = structuredClone(a);
    b.tiles[2] = "green";
    const edited = api.reconcileSurfaceCareAfterEdit(a, b);
    const capital = { spent: 0, refunded: 0, byTerrainSpent: {}, byTerrainTiles: {} };
    const undo = undoEditorEdit({ undo: [{ course: a, world: DEFAULT_WORLD, capital }], redo: [] }, { course: edited, world: DEFAULT_WORLD }, capital)!;
    const redo = redoEditorEdit(undo.history, { course: undo.snapshot.course, world: DEFAULT_WORLD }, capital)!;
    expect(undo.snapshot.course).toBe(a);
    expect(redo.snapshot.course).toBe(edited);
    const reverted = api.reconcileSurfaceCareAfterEdit(edited, structuredClone(undo.snapshot.course));
    const cold = await isolated();
    expect(edited).toEqual(cold.reconcileSurfaceCareAfterEdit(structuredClone(a), structuredClone(b)));
    expect(reverted).toEqual(cold.reconcileSurfaceCareAfterEdit(structuredClone(edited), structuredClone(a)));
  });

  it.each([
    ["tile count", () => ({ ...course(), width: 32_769, height: 1, tiles: new Array<Terrain>(32_769).fill("rough") })],
    ["dimension/length mismatch", () => { const c = course(); c.tiles.pop(); return c; }],
    ["feature count", () => { const c = course(); c.surfaceIntent!.features = Array.from({ length: 513 }, (_, i) => feature(String(i), [], i, "water")); return c; }],
    ["coverage count", () => { const c = course(); c.surfaceIntent!.features[0].coverage = new Array(65_537).fill(0); return c; }],
    ["feature id", () => { const c = course(); c.surfaceIntent!.features[0].id = "x".repeat(257); return c; }],
    ["escaped key bound", () => { const c = course(); c.estate = estate(c); c.estate!.naturalBaseline.terrainRle = "x".repeat(30_000); return c; }],
    ["published text bound", () => { const c = course(); c.width = 32_768; c.height = 1; c.tiles = new Array<Terrain>(32_768).fill("rough"); const coverage = Array.from({ length: 4096 }, (_, i) => i * 8); for (const index of coverage) c.tiles[index] = "fairway"; c.surfaceIntent!.features = [feature("x".repeat(240), coverage)]; return c; }],
    ["nonfinite sort participant", () => { const c = course(); c.surfaceIntent!.features.push(feature("water", [], NaN, "water")); return c; }],
  ] as const)("bypasses %s and clears the single retained content entry", async (_name, make) => {
    const api = await isolated(), a = course();
    const first = api.surfaceCareTopology(a), input = make();
    const built = api.surfaceCareTopology(input);
    expect(api.surfaceCareTopology(structuredClone(input))).not.toBe(built);
    const returned = api.surfaceCareTopology(structuredClone(a));
    expect(returned).not.toBe(first);
    await expectColdParity(input, built);
  });

  it("keeps an immutable primitive key when the original input objects change", async () => {
    const api = await isolated(), input = course(), saved = structuredClone(input);
    const first = api.surfaceCareTopology(input);
    input.tiles[0] = "water";
    input.surfaceIntent!.features[0].id = "mutated owner";
    expect(api.surfaceCareTopology(saved)).toBe(first);
    expect(value(first)).toEqual(value((await isolated()).surfaceCareTopology(structuredClone(saved))));
  });

  it("admits512 sort participants and a large supported coverage sequence", async () => {
    const api = await isolated(), input = course();
    input.surfaceIntent!.features = Array.from({ length: 512 }, (_, index) => feature(String(index), [], index, "water"));
    const first = api.surfaceCareTopology(input);
    expect(api.surfaceCareTopology(structuredClone(input))).toBe(first);
    const covered = course();
    covered.surfaceIntent!.features[0].coverage = new Array(60_000).fill(0);
    const second = api.surfaceCareTopology(covered);
    expect(api.surfaceCareTopology(structuredClone(covered))).toBe(second);
  });

  it("admits the tile and id boundaries without exceeding the structural caps", async () => {
    const api = await isolated(), input = course();
    input.width = 32_768; input.height = 1; input.tiles = new Array<Terrain>(32_768).fill("green");
    input.surfaceIntent!.features = [feature("x".repeat(256), [], 0, "water")];
    const first = api.surfaceCareTopology(input);
    expect(first.zones).toHaveLength(4096);
    expect(api.surfaceCareTopology(structuredClone(input))).toBe(first);
  });

  it("does not retain accessors, sparse arrays, array overrides or unsupported prototypes", async () => {
    const api = await isolated();
    let reads = 0;
    const accessor = () => { const c = course(); Object.defineProperty(c.surfaceIntent!.features[0], "coverage", { enumerable: true, get: () => { reads++; return [0, 1]; } }); return c; };
    const first = api.surfaceCareTopology(accessor());
    expect(api.surfaceCareTopology(accessor())).not.toBe(first);
    expect(reads).toBe(2); // Only the original builder executes this getter.
    const overridden = () => { const c = course(); Object.defineProperty(c.tiles, "toJSON", { value: () => ["fairway"] }); return c; };
    const built = api.surfaceCareTopology(overridden());
    expect(api.surfaceCareTopology(overridden())).not.toBe(built);
    const unusual = () => { const c = course(); Object.setPrototypeOf(c, { marker: true }); return c; };
    const other = api.surfaceCareTopology(unusual());
    expect(api.surfaceCareTopology(unusual())).not.toBe(other);
    const sparse = course(); delete sparse.surfaceIntent!.features[0];
    expect(() => api.surfaceCareTopology(sparse)).toThrow(); // Preserve the cold error.
    const fresh = await isolated();
    expect(() => fresh.surfaceCareTopology(structuredClone(sparse))).toThrow();
  });
});

describe("optional topology helper delivery and inherited dependencies", () => {
  it("returns cold topology synchronously while import is pending, without retrospective seeding", async () => {
    const cold = await isolated(false), input = course();
    const expected = value(cold.surfaceCareTopology(input));
    await vi.dynamicImportSettled();
    vi.resetModules();
    const actualHelper = await vi.importActual<typeof import("./surfaceCareTopologyReuse")>("./surfaceCareTopologyReuse");
    let release!: (module: typeof actualHelper) => void;
    let started!: () => void;
    const importing = new Promise<void>((resolve) => { started = resolve; });
    const factory = vi.fn(() => {
      started();
      return new Promise<typeof actualHelper>((resolve) => { release = resolve; });
    });
    vi.doMock("./surfaceCareTopologyReuse", factory);
    const api = await import("./surfaceCare");
    const a = api.surfaceCareTopology(structuredClone(input));
    const b = api.surfaceCareTopology(structuredClone(input));
    await importing;
    try {
      expect(value(a)).toEqual(expected);
      expect(value(b)).toEqual(expected);
      expect(b).not.toBe(a);
      expect(factory).toHaveBeenCalledTimes(1);
    } finally {
      release(actualHelper);
      await vi.dynamicImportSettled();
    }
    const firstLoaded = api.surfaceCareTopology(structuredClone(input));
    expect(firstLoaded).not.toBe(a);
    expect(firstLoaded).not.toBe(b);
    expect(api.surfaceCareTopology(structuredClone(input))).toBe(firstLoaded);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("latches a failed helper import and keeps cold results without unhandled rejection", async () => {
    const cold = await isolated(false), input = course();
    const expected = value(cold.surfaceCareTopology(input));
    await vi.dynamicImportSettled();
    vi.resetModules();
    const factory = vi.fn(() => { throw new Error("optional chunk unavailable"); });
    vi.doMock("./surfaceCareTopologyReuse", factory);
    const failures: unknown[] = [];
    const unhandled = (reason: unknown) => { failures.push(reason); };
    process.on("unhandledRejection", unhandled);
    try {
      const api = await import("./surfaceCare");
      const first = api.surfaceCareTopology(structuredClone(input));
      expect(value(first)).toEqual(expected);
      await vi.dynamicImportSettled();
      const second = api.surfaceCareTopology(structuredClone(input));
      expect(second).not.toBe(first);
      expect(value(second)).toEqual(expected);
      await vi.dynamicImportSettled();
      expect(factory).toHaveBeenCalledTimes(1);
      expect(failures).toEqual([]);
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });

  it("bypasses inherited estate data instead of reusing an absent-estate entry", async () => {
    const input = course(), inherited = estate(input, "water");
    const cold = await isolated(false);
    const expected = value(cold.surfaceCareTopology({ ...structuredClone(input), estate: inherited }));
    const api = await isolated();
    const previous = api.surfaceCareTopology(structuredClone(input));
    const helper = await import("./surfaceCareTopologyReuse");
    const original = Object.getOwnPropertyDescriptor(Object.prototype, "estate");
    let first!: SurfaceCareTopology, second!: SurfaceCareTopology;
    let lookup: ReturnType<typeof helper.lookupTopology>;
    try {
      Object.defineProperty(Object.prototype, "estate", { configurable: true, value: inherited });
      lookup = helper.lookupTopology(input);
      first = api.surfaceCareTopology(structuredClone(input));
      second = api.surfaceCareTopology(structuredClone(input));
    } finally {
      if (original) Object.defineProperty(Object.prototype, "estate", original);
      else Reflect.deleteProperty(Object.prototype, "estate");
    }
    expect(lookup).toBeNull();
    expect(first).not.toBe(previous);
    expect(second).not.toBe(first);
    expect(value(first)).toEqual(expected);
    expect(value(second)).toEqual(expected);
  });

  it("does not invoke an inherited surfaceIntent getter during key admission", async () => {
    const api = await isolated();
    const absent = course(); delete absent.surfaceIntent;
    const previous = api.surfaceCareTopology(absent);
    const helper = await import("./surfaceCareTopologyReuse");
    const cold = await isolated(false);
    const firstInput = course(), secondInput = course(), oracleInput = course();
    delete firstInput.surfaceIntent; delete secondInput.surfaceIntent; delete oracleInput.surfaceIntent;
    const inherited = { version: 1, nextId: 3, features: [feature("inherited")] };
    const original = Object.getOwnPropertyDescriptor(Object.prototype, "surfaceIntent");
    let reads = 0, keyReads = -1, actualReads = -1, coldReads = -1;
    let first!: SurfaceCareTopology, second!: SurfaceCareTopology, oracle!: SurfaceCareTopology;
    let lookup: ReturnType<typeof helper.lookupTopology>;
    try {
      Object.defineProperty(Object.prototype, "surfaceIntent", { configurable: true, get: () => { reads++; return inherited; } });
      lookup = helper.lookupTopology(firstInput); keyReads = reads;
      first = api.surfaceCareTopology(firstInput); actualReads = reads - keyReads;
      const beforeCold = reads;
      oracle = cold.surfaceCareTopology(oracleInput); coldReads = reads - beforeCold;
      second = api.surfaceCareTopology(secondInput);
    } finally {
      if (original) Object.defineProperty(Object.prototype, "surfaceIntent", original);
      else Reflect.deleteProperty(Object.prototype, "surfaceIntent");
    }
    expect(lookup).toBeNull();
    expect(keyReads).toBe(0);
    expect(actualReads).toBe(coldReads);
    expect(first).not.toBe(previous);
    expect(second).not.toBe(first);
    expect(value(first)).toEqual(value(oracle));
    expect(value(second)).toEqual(value(oracle));
  });
});
