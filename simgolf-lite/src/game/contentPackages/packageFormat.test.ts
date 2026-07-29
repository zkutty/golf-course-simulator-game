import { describe, expect, it } from "vitest";
import { createM26MultiCourseReferenceCourse } from "../testing/referenceCourse";
import { browserPlatform } from "../../platform/browserPlatform";
import type { PlatformServices, PlatformWorkshopItem } from "../../platform/types";
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
  publishContentPackage,
  refreshWorkshopLibrary,
  retryWorkshopPublish,
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

function workshopPlatform() {
  const platform = testPlatform();
  let items: PlatformWorkshopItem[] = [];
  let copied = new Map<string, string>();
  let publishResult: { publishedId: string; needsLegalAgreement: boolean; ownershipVerified?: boolean } = { publishedId: "workshop-1", needsLegalAgreement: false };
  platform.capabilities = { ...platform.capabilities, kind: "steam", steam: true, workshop: true };
  platform.workshop = {
    legalAgreementUrl: "https://steamcommunity.com/sharedfiles/workshoplegalagreement",
    list: async () => items,
    publish: async () => publishResult,
    cancel: async () => undefined,
    copyLocal: async (itemId) => copied.get(itemId) ?? null,
  };
  return {
    platform,
    setItems: (next: typeof items) => { items = next; },
    setCopied: (next: Map<string, string>) => { copied = next; },
    setPublishResult: (next: typeof publishResult) => { publishResult = next; },
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

  it("rejects malformed JSON shapes without throwing and reports playability blockers", async () => {
    for (const text of ["null", "[]", "{}", '{"manifest":null,"payload":null}', '{"manifest":{"version":1},"payload":{"course":null}}']) {
      await expect(validatePackageText(text)).resolves.toMatchObject({ status: "corrupt" });
    }
    const value = await fixture();
    const broken = structuredClone(value);
    broken.payload.course.holes[0].tee = null;
    const result = await validatePackageText(packageText(broken));
    expect(result.status).toBe("corrupt");
    expect(result.status === "corrupt" && result.errors.some((error) => error.includes("incomplete"))).toBe(true);
  });

  it("accepts only signed PNG/JPEG preview bytes and carries a stable revision identity", async () => {
    const value = await createCoursePackage({
      course: createM26MultiCourseReferenceCourse(),
      title: "Preview Estate",
      description: "Preview fixture",
      author: { id: "author-01", displayName: "Course Author" },
      requiredGameVersion: "1.0.0-rc.2",
      preview: { mime: "image/png", dataUrl: "data:image/png;base64,iVBORw0KGgo=" },
      now: new Date("2026-07-24T12:00:00.000Z"),
    });
    expect((await validatePackageText(packageText(value))).status).toBe("compatible");
    const badPreview = structuredClone(value);
    badPreview.manifest.preview = { mime: "image/png", dataUrl: "data:image/png;base64,ZmFrZQ==" };
    expect((await validatePackageText(packageText(badPreview))).status).toBe("corrupt");
    const later = await createCoursePackage({
      course: createM26MultiCourseReferenceCourse(),
      title: "Preview Estate",
      description: "Preview fixture",
      author: { id: "author-01", displayName: "Course Author" },
      requiredGameVersion: "1.0.0-rc.2",
      now: new Date("2026-07-25T12:00:00.000Z"),
    });
    expect(later.manifest.contentId).toBe(value.manifest.contentId);
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

  it("reconciles Workshop subscriptions, installed packages, updates, cached removal, and corrupt items", async () => {
    const harness = workshopPlatform();
    const value = await fixture();
    harness.setItems([
      { id: "subscribed-1", state: "subscribed", title: "New subscription", version: "1" },
      { id: "installed-1", state: "installed", title: "Installed package", version: "1" },
      { id: "corrupt-1", state: "corrupt", title: "Bad package", version: "1" },
    ]);
    harness.setCopied(new Map([["installed-1", packageText(value)]]));
    const first = await refreshWorkshopLibrary(harness.platform);
    expect(first.find((entry) => entry.publishedId === "subscribed-1")?.state).toBe("subscribed");
    expect(first.find((entry) => entry.publishedId === "installed-1")?.state).toBe("installed");
    expect(first.find((entry) => entry.publishedId === "corrupt-1")?.state).toBe("corrupt");

    harness.setItems([{ id: "installed-1", state: "installed", title: "Installed package", version: "2" }]);
    harness.setCopied(new Map());
    const updated = await refreshWorkshopLibrary(harness.platform);
    expect(updated.find((entry) => entry.publishedId === "installed-1")?.state).toBe("update-available");
    expect(updated.find((entry) => entry.publishedId === "subscribed-1")?.state).toBe("cached");
  });

  it("does not mark a package published until legal and ownership checks pass, while retrying locally", async () => {
    const harness = workshopPlatform();
    const value = await fixture();
    await importContentPackage(packageText(value), "local", harness.platform);
    harness.setPublishResult({ publishedId: "workshop-legal", needsLegalAgreement: true });
    const pending = await publishContentPackage(value.manifest.contentId, "private", harness.platform);
    expect(pending).toMatchObject({ publishedId: "workshop-legal", needsLegalAgreement: true, legalAgreementUrl: "https://steamcommunity.com/sharedfiles/workshoplegalagreement" });
    expect((await listContentLibrary(harness.platform)).find((entry) => entry.contentId === value.manifest.contentId)?.publishedId).toBeUndefined();

    harness.setPublishResult({ publishedId: "workshop-denied", needsLegalAgreement: false, ownershipVerified: false });
    await expect(retryWorkshopPublish(value.manifest.contentId, "private", harness.platform)).rejects.toThrow("ownership");
    harness.setPublishResult({ publishedId: "workshop-ok", needsLegalAgreement: false, ownershipVerified: true });
    await publishContentPackage(value.manifest.contentId, "private", harness.platform);
    expect((await listContentLibrary(harness.platform)).find((entry) => entry.contentId === value.manifest.contentId)).toMatchObject({ source: "workshop", publishedId: "workshop-ok" });
  });
});
