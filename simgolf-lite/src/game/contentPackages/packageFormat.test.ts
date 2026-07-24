import { describe, expect, it } from "vitest";
import { createM26MultiCourseReferenceCourse } from "../testing/referenceCourse";
import { browserPlatform } from "../../platform/browserPlatform";
import type { PlatformServices } from "../../platform/types";
import {
  canonicalPackageJson,
  createCoursePackage,
  packageText,
  remapImportedCourseIdentity,
  validatePackageText,
} from "./packageFormat";
import {
  deleteContentPackage,
  exportContentPackage,
  importContentPackage,
  listContentLibrary,
  readContentPackage,
} from "./library";

function testPlatform(): PlatformServices & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    ...browserPlatform,
    values,
    files: {
      readText: async (key) => values.get(key) ?? null,
      writeTextAtomic: async (key, value) => void values.set(key, value),
      delete: async (key) => void values.delete(key),
      list: async (prefix) => [...values.keys()].filter((key) => key.startsWith(prefix)),
      chooseImport: async () => null,
      chooseExport: async (name, text) => {
        values.set(`export:${name}`, text);
        return true;
      },
      exportSupportBundle: async () => true,
    },
  };
}

async function fixture() {
  return createCoursePackage({
    course: createM26MultiCourseReferenceCourse(),
    title: "Reference Estate",
    description: "A two-course portability fixture.",
    author: { id: "author-01", displayName: "Course Author" },
    requiredGameVersion: "1.0.0-rc.2",
    now: new Date("2026-07-24T12:00:00.000Z"),
  });
}

describe("M43 course and challenge packages", () => {
  it("creates deterministic non-save packages with a verified checksum", async () => {
    const value = await fixture();
    const text = packageText(value);
    const validation = await validatePackageText(text);
    expect(validation.status).toBe("compatible");
    expect(text).toBe(canonicalPackageJson(value));
    expect(text).not.toContain("livingClub");
    expect(text).not.toContain("playerPro");
    expect(text).not.toContain("enterprise");
  });

  it("rejects tampering, URLs, traversal strings, unsupported versions, and oversized previews", async () => {
    const value = await fixture();
    const tampered = structuredClone(value);
    tampered.payload.course.name = "Tampered";
    expect((await validatePackageText(JSON.stringify(tampered))).status).toBe("corrupt");

    const unsafe = structuredClone(value);
    unsafe.manifest.description = "See https://example.com/../../secret";
    expect((await validatePackageText(JSON.stringify(unsafe))).status).toBe("corrupt");

    const future = structuredClone(value);
    future.manifest.version = 99 as 1;
    expect((await validatePackageText(JSON.stringify(future))).status).toBe("unsupported");

    expect((await validatePackageText("x".repeat(16 * 1024 * 1024 + 1))).status).toBe("corrupt");
  });

  it("remaps imported hole, routing, building, and property identities without breaking references", async () => {
    const value = await fixture();
    const course = remapImportedCourseIdentity(value, "import-a");
    expect(course.holes.every((hole) => hole.id?.startsWith("import-a-h"))).toBe(true);
    expect(course.layouts?.every((layout) =>
      [...layout.draftHoleIds, ...layout.publishedHoleIds].every((id) => course.holes.some((hole) => hole.id === id))
    )).toBe(true);
    expect(course.buildings.every((building) => building.id?.startsWith("import-a-b"))).toBe(true);
    expect(course.property?.assets.every((asset) => asset.id.startsWith("import-a-a")) ?? true).toBe(true);
  });

  it("imports, updates, lists, exports, reads, and deletes a manual package offline", async () => {
    const platform = testPlatform();
    const value = await fixture();
    const imported = await importContentPackage(packageText(value), "manual", platform);
    expect(imported.entry?.state).toBe("ready");
    expect(await listContentLibrary(platform)).toHaveLength(1);
    expect((await readContentPackage(value.manifest.contentId, platform))?.manifest.checksum).toBe(value.manifest.checksum);
    expect(await exportContentPackage(value.manifest.contentId, platform)).toBe(true);
    expect([...platform.values.keys()].some((key) => key.startsWith("export:"))).toBe(true);
    expect(await deleteContentPackage(value.manifest.contentId, platform)).toBe(true);
    expect(await listContentLibrary(platform)).toEqual([]);
  });

  it("quarantines malformed content without partial library import", async () => {
    const platform = testPlatform();
    const result = await importContentPackage('{"manifest":{"format":"coursecraft-package"}}', "workshop", platform);
    expect(result.validation.status).toBe("corrupt");
    expect(await listContentLibrary(platform)).toEqual([]);
    expect([...platform.values.keys()].some((key) => key.startsWith("coursecraft_content_quarantine_"))).toBe(true);
  });
});
