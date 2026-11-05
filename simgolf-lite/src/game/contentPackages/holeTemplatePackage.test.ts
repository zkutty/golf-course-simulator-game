import { describe, expect, it, vi } from "vitest";
import { browserPlatform } from "../../platform/browserPlatform";
import type { PlatformServices } from "../../platform/types";
import { DEFAULT_COURSE, DEFAULT_WORLD } from "../models/defaults";
import type { Course, Hole, SurfaceFeature } from "../models/types";
import { captureHoleTemplate, captureHoleTemplateWithWarnings, HoleTemplateCaptureError, createHoleTemplatePackage, holeTemplatePackageText, validateHoleTemplatePackageText } from "./holeTemplatePackage";
import { exportContentPackage, importContentPackage, listContentLibrary, publishContentPackage, readHoleTemplatePackage, saveAuthoredHoleTemplatePackage } from "./library";
import { canonicalPackageJson, createCoursePackage, packageText } from "./packageFormat";
import { canonicalHoleTemplateJson, sha256Hex, validateHoleTemplateV1 } from "../holeTemplates/serialization";
import { corridorFeature, rasterizeSurfaceFeatureDetailed } from "../models/surfaceIntent";
import { canonicalHoleTemplatePlanIdentityJson, planHoleTemplatePlacement } from "../holeTemplates/placement";
import { createM26MultiCourseReferenceCourse } from "../testing/referenceCourse";

function platform(): PlatformServices & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    ...browserPlatform, values,
    files: {
      readText: async (key) => values.get(key) ?? null,
      writeTextAtomic: async (key, text) => void values.set(key, text),
      delete: async (key) => void values.delete(key),
      list: async (prefix) => [...values.keys()].filter((key) => key.startsWith(prefix)),
      chooseImport: async () => null, chooseExport: async (name, text) => (values.set(`export:${name}`, text), true), exportSupportBundle: async () => true,
    },
  };
}

function builtHole(): { course: Course; hole: Hole } {
  const course = structuredClone(DEFAULT_COURSE);
  course.width = 8; course.height = 5;
  course.tiles = new Array(40).fill("rough");
  course.elevations = new Array(40).fill(4);
  const tile = (x: number, y: number, terrain: Course["tiles"][number], elevation = 4) => { course.tiles[y * 8 + x] = terrain; course.elevations![y * 8 + x] = elevation; };
  tile(1, 2, "tee"); tile(2, 2, "fairway"); tile(3, 2, "water", 3); tile(4, 2, "green", 5);
  course.obstacles = [{ x: 3, y: 1, type: "bush" }];
  course.decorations = [{ kind: "flower_bed", x: 1, y: 1, rotation: 0 }];
  const hole: Hole = { id: "built-hole", tee: { x: 1, y: 2 }, green: { x: 4, y: 2 }, teeBoxes: { member: { x: 1, y: 2 } }, pinPositions: { A: { x: 4, y: 2 } }, waypoints: [{ x: 2, y: 2 }], parMode: "MANUAL", parManual: 3 };
  course.holes = [hole];
  return { course, hole };
}

async function fixture() {
  const { course, hole } = builtHole();
  const template = captureHoleTemplate(course, hole, {
    id: "built-hole", title: "Built par three", description: "Player-built sparse capture.", yardsPerTile: 5,
    provenance: { sourceKind: "manual", sourceLabel: "Player-built hole", importedAt: "2026-08-05T12:00:00.000Z", rightsAttested: true, redistribution: "private_only", sourceAssetRetained: false },
    confidence: { scale: 1, terrain: 1, elevation: 1, notes: [] },
  });
  return createHoleTemplatePackage({ template, title: template.title, description: template.description, author: { id: "author-01", displayName: "Author" }, requiredGameVersion: "1.0.0", theme: "parkland", now: new Date("2026-08-05T12:00:00.000Z") });
}

describe("ZK-650 hole template packages", () => {
  it("preserves source rights when recapturing a placed hole and resets fidelity after editable capture", () => {
    const { course, hole } = builtHole();
    hole.templateAttribution = { templateId: "original-photo", sourceKind: "player_photo", sourceLabel: "Original photo", importedAt: "2026-08-05T12:00:00.000Z", rightsAttested: true, redistribution: "private_only", sourceAssetRetained: false, fidelity: { tier: "calibrated", controlPointsReviewed: true, reviewedControlPointCount: 2, verifiedYardage: 150 } };
    const input = { id: "recaptured-hole", title: "Recapture", description: "", yardsPerTile: 5, provenance: { sourceKind: "manual" as const, sourceLabel: "New manual claim", importedAt: "2026-08-06T12:00:00.000Z", rightsAttested: true, redistribution: "allowed" as const, sourceAssetRetained: false }, confidence: { scale: 1, terrain: 1, elevation: 1, notes: [] } };
    const captured = captureHoleTemplate(course, hole, input);
    expect(captured.provenance).toMatchObject({ sourceKind: "player_photo", sourceLabel: "Original photo", importedAt: "2026-08-05T12:00:00.000Z", redistribution: "private_only" });
    expect(captured.fidelity).toEqual({ tier: "sketch" });
    hole.templateAttribution = { templateId: "historical-photo", sourceLabel: "Historical source" };
    expect(() => captureHoleTemplate(course, hole, input)).toThrow("Review the original source rights");
  });
  it("verifies historical V1 checksums without inserting fidelity or changing canonical bytes", async () => {
    const old = await fixture();
    delete old.payload.template.fidelity;
    const { checksum: _checksum, ...manifest } = old.manifest;
    old.manifest.checksum = sha256Hex(canonicalPackageJson({ manifest, payload: old.payload }));
    const text = holeTemplatePackageText(old);
    const result = await validateHoleTemplatePackageText(text);
    expect(result.status).toBe("compatible");
    if (result.status !== "compatible") throw new Error("Expected historical compatibility");
    expect(holeTemplatePackageText(result.value as typeof old)).toBe(text);
    expect(result.value).not.toHaveProperty("payload.template.fidelity");
    const testPlatform = platform();
    await importContentPackage(text, "manual", testPlatform);
    expect(await readHoleTemplatePackage(old.manifest.contentId, testPlatform)).toEqual(old);
    expect(await exportContentPackage(old.manifest.contentId, testPlatform)).toBe(true);
    expect([...testPlatform.values.entries()].find(([key]) => key.startsWith("export:"))?.[1]).toBe(text);
  });

  it("exports private copies, blocks private redistribution, and never invokes Workshop for any template", async () => {
    const testPlatform = platform();
    testPlatform.capabilities = { ...testPlatform.capabilities, workshop: true };
    const publish = vi.fn();
    testPlatform.workshop = { ...testPlatform.workshop, publish };
    const value = await fixture();
    await saveAuthoredHoleTemplatePackage(value, testPlatform);
    expect(await exportContentPackage(value.manifest.contentId, testPlatform, "redistribution")).toBe(false);
    expect([...testPlatform.values.keys()].some((key) => key.startsWith("export:"))).toBe(false);
    expect(await exportContentPackage(value.manifest.contentId, testPlatform, "private_copy")).toBe(true);
    expect(await publishContentPackage(value.manifest.contentId, "public", testPlatform)).toBeNull();
    const shareable = structuredClone(value.payload.template);
    shareable.provenance.redistribution = "allowed";
    const shared = await createHoleTemplatePackage({ template: shareable, title: "Shareable", description: "", author: value.manifest.author, requiredGameVersion: "1.0.0", theme: "parkland" });
    await saveAuthoredHoleTemplatePackage(shared, testPlatform);
    expect(await exportContentPackage(shared.manifest.contentId, testPlatform, "redistribution")).toBe(true);
    expect(await publishContentPackage(shared.manifest.contentId, "private", testPlatform)).toBeNull();
    expect(publish).not.toHaveBeenCalled();
  });

  it("follows placed-template privacy into course exports and Workshop without blocking manually built courses", async () => {
    const testPlatform = platform();
    testPlatform.capabilities = { ...testPlatform.capabilities, workshop: true };
    const publish = vi.fn(async () => ({ publishedId: "published-course", needsLegalAgreement: false }));
    testPlatform.workshop = { ...testPlatform.workshop, publish };
    const course = createM26MultiCourseReferenceCourse();
    course.holes[0].templateAttribution = { templateId: "private-template", sourceKind: "player_photo", sourceLabel: "My photo", importedAt: "2026-08-05T12:00:00.000Z", rightsAttested: true, redistribution: "private_only", sourceAssetRetained: false, fidelity: { tier: "sketch" } };
    const value = await createCoursePackage({ course, title: "Imported course", description: "", author: { id: "author-01", displayName: "Author" }, requiredGameVersion: "1.0.0" });
    expect((await importContentPackage(packageText(value), "local", testPlatform)).entry).toBeDefined();
    expect(await exportContentPackage(value.manifest.contentId, testPlatform, "private_copy")).toBe(true);
    expect(await exportContentPackage(value.manifest.contentId, testPlatform, "redistribution")).toBe(false);
    expect(await publishContentPackage(value.manifest.contentId, "public", testPlatform)).toBeNull();
    expect(publish).not.toHaveBeenCalled();
    delete course.holes[0].templateAttribution;
    const manual = await createCoursePackage({ course, title: "Manual course", description: "", author: value.manifest.author, requiredGameVersion: "1.0.0" });
    await importContentPackage(packageText(manual), "local", testPlatform);
    expect(await publishContentPackage(manual.manifest.contentId, "public", testPlatform)).toMatchObject({ publishedId: "published-course" });
    expect(publish).toHaveBeenCalledOnce();
  });

  it("quarantines a rejected image-bearing blueprint as a diagnostic without retaining source pixels", async () => {
    const value = await fixture();
    const raw = JSON.parse(holeTemplatePackageText(value));
    raw.payload.template.provenance.sourcePixels = "sensitive-source-pixels";
    raw.payload.template.provenance.sourceAssetRetained = true;
    const testPlatform = platform();
    expect((await importContentPackage(JSON.stringify(raw), "manual", testPlatform)).entry).toBeUndefined();
    expect([...testPlatform.values.values()].join(" ")).not.toContain("sensitive-source-pixels");
    expect([...testPlatform.values.values()].join(" ")).toContain("sourceDiscarded");
  });
  it("captures a sparse, self-contained player-built hole with markers, relief, features, and variants", () => {
    const { course, hole } = builtHole();
    const template = captureHoleTemplate(course, hole, { id: "built-hole", title: "Built par three", description: "Player-built sparse capture.", yardsPerTile: 5, provenance: { sourceKind: "manual", sourceLabel: "Player-built hole", importedAt: "2026-08-05T12:00:00.000Z", rightsAttested: true, redistribution: "private_only", sourceAssetRetained: false }, confidence: { scale: 1, terrain: 1, elevation: 1, notes: [] } });
    expect(template.cells).toHaveLength(4);
    expect(template.hole).toMatchObject({ tee: { x: 0, y: 1 }, green: { x: 3, y: 1 }, teeBoxes: { member: { x: 0, y: 1 } }, pinPositions: { A: { x: 3, y: 1 } }, waypoints: [{ x: 1, y: 1 }] });
    expect(template.cells.find((cell) => cell.terrain === "water")?.elevationOffset).toBe(-1);
    expect(template.obstacles).toEqual([{ x: 2, y: 0, type: "bush" }]);
    expect(template.decorations).toEqual([{ kind: "flower_bed", x: 0, y: 0, rotation: 0 }]);
    expect(JSON.stringify(template)).not.toContain("estate");
  });

  it("produces canonical checksummed revisioned JSON and rejects tampering", async () => {
    const value = await fixture();
    const text = holeTemplatePackageText(value);
    expect(await validateHoleTemplatePackageText(text)).toMatchObject({ status: "compatible", value: { manifest: { kind: "hole-template", revision: 1 } } });
    const tampered = JSON.parse(text); tampered.payload.template.title = "Tampered";
    await expect(validateHoleTemplatePackageText(JSON.stringify(tampered))).resolves.toMatchObject({ status: "corrupt" });
  });

  it("stores templates in the isolated library, preserves course packages, and quarantines malformed imports", async () => {
    const testPlatform = platform();
    const value = await fixture();
    const saved = await saveAuthoredHoleTemplatePackage(value, testPlatform);
    expect(saved.entry).toMatchObject({ kind: "hole-template", state: "ready" });
    await expect(readHoleTemplatePackage(value.manifest.contentId, testPlatform)).resolves.toMatchObject({ payload: { template: { id: "built-hole" } } });
    expect(await listContentLibrary(testPlatform)).toMatchObject([{ kind: "hole-template" }]);
    expect(await exportContentPackage(value.manifest.contentId, testPlatform)).toBe(true);
    expect([...testPlatform.values.keys()].some((key) => key.endsWith(".coursecraft-hole-template"))).toBe(true);
    const malformed = await importContentPackage("{\"manifest\":{\"format\":\"coursecraft-hole-template-package\"}}", "manual", testPlatform);
    expect(malformed.validation.status).toBe("corrupt");
    expect([...testPlatform.values.keys()].some((key) => key.startsWith("coursecraft_content_quarantine_"))).toBe(true);
  });
});


const captureInput = {
  id: "built-hole", title: "Built par three", description: "Player-built sparse capture.", yardsPerTile: 5,
  provenance: { sourceKind: "manual" as const, sourceLabel: "Player-built hole", importedAt: "2026-08-05T12:00:00.000Z", rightsAttested: true, redistribution: "private_only" as const, sourceAssetRetained: false },
  confidence: { scale: 1, terrain: 1, elevation: 1, notes: [] },
};
function savedSurfaceHole() {
  const course = structuredClone(DEFAULT_COURSE);
  course.width = 16; course.height = 16; course.tiles = Array(256).fill("rough"); course.elevations = Array(256).fill(0);
  course.obstacles = []; course.decorations = []; course.buildings = []; course.surfaceIntent = { version: 1, nextId: 1, features: [] };
  const feature = corridorFeature(course, "path", [{ x: 2.5, y: 3.5 }, { x: 6.5, y: 2.5 }, { x: 9.5, y: 6.5 }, { x: 13.5, y: 5.5 }], 1.5);
  if (feature.geometry.kind !== "corridor") throw new Error("Expected corridor");
  feature.geometry.tangents = feature.geometry.knots.map(p => ({ in: { x: p.x - .6, y: p.y }, out: { x: p.x + .6, y: p.y } }));
  const raster = rasterizeSurfaceFeatureDetailed(feature, 16, 16);
  feature.coverage = raster.tiles.map(p => p.y * 16 + p.x); feature.renderRings = raster.rings;
  feature.coverage.forEach(index => { course.tiles[index] = "path"; }); course.surfaceIntent.features = [feature];
  const hole: Hole = { id: "saved-S", tee: { x: 0, y: 0 }, green: { x: 15, y: 15 }, parMode: "AUTO" };
  course.holes = [hole]; course.tiles[0] = "tee"; course.tiles[255] = "green";
  return { course, hole, feature };
}
function surfaceTemplate() {
  const { course, hole } = savedSurfaceHole(); return captureHoleTemplate(course, hole, captureInput);
}

describe("TEMPLATE-C authored surface portability", () => {
  it("retains fully bounded width1.5 saved-S geometry in the existing capture API", () => {
    const { course, hole, feature } = savedSurfaceHole(), before = structuredClone(course);
    const captured = captureHoleTemplate(course, hole, captureInput);
    expect(captured).toHaveProperty("surfaceIntent.features.0.geometry", feature.geometry);
    expect(captured.surfaceIntent?.features[0]).toEqual(feature);
    expect(captured.surfaceIntent?.features[0]).not.toBe(feature);
    expect(course).toEqual(before);
    captured.surfaceIntent!.features[0].coverage.pop(); expect(course).toEqual(before);
  });

  it("freezes actual pre-edit historical canonical/checksum/text/plan bytes with absent fields", async () => {
    const { course, hole } = builtHole(), template = captureHoleTemplate(course, hole, captureInput); delete template.fidelity;
    expect(template).not.toHaveProperty("surfaceIntent");
    const value = await createHoleTemplatePackage({ template, title: template.title, description: template.description, author: { id: "author-01", displayName: "Author" }, requiredGameVersion: "1.0.0", theme: "parkland", now: new Date("2026-08-05T12:00:00.000Z") });
    const { checksum: _checksum, ...manifest } = value.manifest;
    const target = structuredClone(DEFAULT_COURSE); target.holes = []; target.tiles = target.tiles.map(() => "rough"); target.elevations = target.elevations.map(() => 5); target.obstacles = []; target.decorations = []; target.buildings = []; target.estate = undefined; target.yardsPerTile = 5;
    const planned = planHoleTemplatePlacement({ course: target, world: { ...structuredClone(DEFAULT_WORLD), cash: 1_000_000, reputation: 100, isBankrupt: false }, template, placement: { origin: { x: 10, y: 10 }, rotation: 1, mirrorX: true, elevationPolicy: "template-relief", baseElevation: 5, holeId: "historical-hole" }, targetVersions: { terrainVersion: 11, obstaclesVersion: 7, markersVersion: 5, economyVersion: 13 } });
    if (planned.status !== "planned") throw new Error("Expected historical plan");
    const bytes = { templateCanonical: canonicalHoleTemplateJson(template), packageCoreCanonical: canonicalPackageJson({ manifest, payload: value.payload }), packageChecksum: value.manifest.checksum, packageText: holeTemplatePackageText(value), planIdentityCanonical: canonicalHoleTemplatePlanIdentityJson(planned.plan), planIdentity: planned.plan.identity.value, planText: JSON.stringify(planned.plan) };
    expect(Object.fromEntries(Object.entries(bytes).map(([key, text]) => [key, sha256Hex(text)]))).toEqual({
      templateCanonical: "aa76a6922db654184898ec5758a05fbada9dac8abf3494c610bdf7f8d8e03f5f", packageCoreCanonical: "5e351fbd1fd7c634060da36120906d070f6cf7897ff72967c718bbb4b6460432", packageChecksum: "ecbf61c044151c64a61dea3921ee4d3a2e9b53188e2dc36c5a60afb0a535f74b", packageText: "13c5006f88f7a3c84947bc26e328c2631bc0ad58cd428fe84b00ab1b7203af7c", planIdentityCanonical: "462aeb00d219f0d3d3e560ad35252a442622bf0920053d69bdbf85e7f4c15714", planIdentity: "3ce89622d8a9eb4ad2840fd5cfe68fdaab7c17243139d93af9f4b75022f326c5", planText: "c5c6f5ac84a9d42b104bfa29a9934191795df72ea67de3bc11082287df43dcec",
    });
    const imported = await validateHoleTemplatePackageText(bytes.packageText);
    expect(imported.status).toBe("compatible");
    if (imported.status !== "compatible") throw new Error("Expected compatibility");
    expect(holeTemplatePackageText(imported.value as typeof value)).toBe(bytes.packageText);
    expect(imported.value).not.toHaveProperty("payload.template.fidelity"); expect(imported.value).not.toHaveProperty("payload.template.surfaceIntent");
  });

  it("roundtrips custom widths/handles/order/coverage through the real checksummed isolated library", async () => {
    const template = surfaceTemplate(), geometry = template.surfaceIntent!.features[0].geometry;
    if (geometry.kind !== "corridor") throw new Error("Expected corridor"); geometry.width = 1.75;
    const value = await createHoleTemplatePackage({ template, title: template.title, description: "", author: { id: "author-01", displayName: "Author" }, requiredGameVersion: "1.0.0", theme: "parkland", now: new Date("2026-08-05T12:00:00.000Z") });
    const text = holeTemplatePackageText(value), testPlatform = platform();
    expect((await importContentPackage(text, "manual", testPlatform)).entry).toBeDefined();
    expect((await readHoleTemplatePackage(value.manifest.contentId, testPlatform))?.payload.template).toEqual(template);
    await exportContentPackage(value.manifest.contentId, testPlatform);
    expect([...testPlatform.values.entries()].find(([key]) => key.startsWith("export:"))?.[1]).toBe(text);
    for (const key of ["width", "handles", "order", "coverage"]) {
      const raw = JSON.parse(text), feature = raw.payload.template.surfaceIntent.features[0];
      if (key === "width") feature.geometry.width = 2;
      if (key === "handles") feature.geometry.tangents[0].out.x += .1;
      if (key === "order") feature.order++;
      if (key === "coverage") feature.coverage.pop();
      expect((await importContentPackage(JSON.stringify(raw), "manual", testPlatform)).validation.status, key).toBe("corrupt");
    }
    expect(template.provenance).toEqual(value.payload.template.provenance);
  });

  it("translates complete all-terrain metadata and keeps explicit zero-relief/overwritten coverage cells", () => {
    const { course, hole } = savedSurfaceHole(); hole.tee = { x: 1, y: 1 }; hole.green = { x: 15, y: 15 }; course.tiles[17] = "tee";
    const region: SurfaceFeature = { id: "surface-rough", terrain: "rough", order: 2, geometry: { kind: "region", ring: [{ x: 3, y: 10 }, { x: 5, y: 10 }, { x: 5, y: 12 }] }, coverage: [10 * 16 + 3, 11 * 16 + 4] };
    course.tiles[region.coverage[1]] = "sand"; course.surfaceIntent!.features.push(region);
    const result = captureHoleTemplateWithWarnings(course, hole, captureInput), captured = result.template.surfaceIntent!.features;
    expect(result.warnings).toEqual([]); expect(captured[0].geometry).toMatchObject({ knots: [{ x: 1.5, y: 2.5 }, { x: 5.5, y: 1.5 }, { x: 8.5, y: 5.5 }, { x: 12.5, y: 4.5 }], width: 1.5 });
    expect(captured[1].coverage).toEqual([9 * 15 + 2, 10 * 15 + 3]);
    expect(result.template.cells).toContainEqual({ x: 2, y: 9, terrain: "rough", elevationOffset: 0 });
    expect(result.template.cells).toContainEqual({ x: 3, y: 10, terrain: "sand", elevationOffset: 0 });
    expect(validateHoleTemplateV1(result.template).ok).toBe(true);
  });

  it("rejects partial PATH instead of downgrading it, and warns for broad partial non-PATH Sketch capture", () => {
    const { course, hole } = savedSurfaceHole(); hole.tee = { x: 2, y: 2 }; hole.green = { x: 12, y: 10 };
    expect(() => captureHoleTemplateWithWarnings(course, hole, captureInput)).toThrow(HoleTemplateCaptureError);
    course.surfaceIntent!.features[0].terrain = "fairway";
    const result = captureHoleTemplateWithWarnings(course, hole, captureInput);
    expect(result.warnings).toEqual([{ code: "partial_non_path", count: 1 }]); expect(result.template).not.toHaveProperty("surfaceIntent");
    const noIntent = { ...course, surfaceIntent: undefined };
    expect(result.template).toEqual(captureHoleTemplate(noIntent, hole, captureInput));
    course.surfaceIntent!.features[0].geometry = { kind: "corridor", knots: [{ x: Number.NaN, y: 3 }], width: 1 };
    expect(() => captureHoleTemplateWithWarnings(course, hole, captureInput)).toThrow("Continuous coordinates");
  });

  it("ignores surfaces outside the captured hole while retaining immutable inputs", () => {
    const { course, hole } = builtHole(); course.surfaceIntent = { version: 1, nextId: 2, features: [{ id: "outside", terrain: "path", order: 1, geometry: { kind: "corridor", knots: [{ x: 7.5, y: 4.5 }], width: 1 }, coverage: [39] }] };
    const before = structuredClone(course), result = captureHoleTemplateWithWarnings(course, hole, captureInput);
    expect(result.warnings).toEqual([]); expect(result.template).not.toHaveProperty("surfaceIntent"); expect(course).toEqual(before);
  });
});


describe("TEMPLATE-C present-extension dimension boundary", () => {
  function largeHole() {
    const course = structuredClone(DEFAULT_COURSE);
    course.width = 258; course.height = 2; course.tiles = Array(516).fill("rough"); course.elevations = Array(516).fill(0);
    course.obstacles = []; course.decorations = []; course.buildings = [];
    const hole: Hole = { id: "large-hole", tee: { x: 0, y: 0 }, green: { x: 256, y: 0 }, parMode: "AUTO" };
    course.holes = [hole]; course.tiles[0] = "tee"; course.tiles[256] = "green";
    return { course, hole };
  }
  it("keeps legacy257x1 Sketch capture plus warning when every non-path curve is partial", () => {
    const { course, hole } = largeHole();
    course.surfaceIntent = { version: 1, nextId: 2, features: [{ id: "surface-fairway", terrain: "fairway", order: 1,
      geometry: { kind: "region", ring: [{ x: 0, y: 0 }, { x: 258, y: 0 }, { x: 258, y: 2 }, { x: 0, y: 2 }] }, coverage: [1, 257] }] };
    const before = structuredClone(course), result = captureHoleTemplateWithWarnings(course, hole, captureInput);
    expect(result.warnings).toEqual([{ code: "partial_non_path", count: 1 }]);
    expect(result.template).toMatchObject({ width: 257, height: 1 });
    expect(result.template).not.toHaveProperty("surfaceIntent");
    expect(result.template).toEqual(captureHoleTemplate({ ...course, surfaceIntent: undefined }, hole, captureInput));
    expect(validateHoleTemplateV1(result.template).ok).toBe(true); expect(course).toEqual(before);
  });
  it("rejects a fully preserved extension on an oversized257x1 capture", () => {
    const { course, hole } = largeHole();
    course.surfaceIntent = { version: 1, nextId: 2, features: [{ id: "surface-path", terrain: "path", order: 1,
      geometry: { kind: "corridor", knots: [{ x: 1.5, y: .5 }, { x: 255.5, y: .5 }], width: 1.5 }, coverage: [1, 255] }] };
    const before = structuredClone(course);
    expect(() => captureHoleTemplateWithWarnings(course, hole, captureInput)).toThrow(expect.objectContaining({ code: "invalid_surface", message: expect.stringContaining("dimensions") }));
    expect(course).toEqual(before);
  });
});
