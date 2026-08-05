import { describe, expect, it } from "vitest";
import { browserPlatform } from "../../platform/browserPlatform";
import type { PlatformServices } from "../../platform/types";
import { DEFAULT_COURSE } from "../models/defaults";
import type { Course, Hole } from "../models/types";
import { captureHoleTemplate, createHoleTemplatePackage, holeTemplatePackageText, validateHoleTemplatePackageText } from "./holeTemplatePackage";
import { exportContentPackage, importContentPackage, listContentLibrary, readHoleTemplatePackage, saveAuthoredHoleTemplatePackage } from "./library";

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
