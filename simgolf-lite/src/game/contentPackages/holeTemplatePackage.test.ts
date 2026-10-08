import { describe, expect, it, vi } from "vitest";
import { browserPlatform } from "../../platform/browserPlatform";
import type { PlatformServices } from "../../platform/types";
import { DEFAULT_COURSE } from "../models/defaults";
import type { Course, Hole } from "../models/types";
import { captureHoleTemplate, createHoleTemplatePackage, holeTemplatePackageText, validateHoleTemplatePackageText } from "./holeTemplatePackage";
import { exportContentPackage, importContentPackage, listContentLibrary, publishContentPackage, readHoleTemplatePackage, saveAuthoredHoleTemplatePackage } from "./library";
import { canonicalPackageJson, createCoursePackage, packageText } from "./packageFormat";
import { sha256Hex } from "../holeTemplates/serialization";
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
