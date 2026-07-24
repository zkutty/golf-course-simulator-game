import { platformServices } from "../../platform";
import type { PlatformServices } from "../../platform/types";
import { packageText, validatePackageText } from "./packageFormat";
import type { ContentLibraryEntry, CoursePackageV1, PackageValidationResult } from "./types";

const MANIFEST_KEY = "coursecraft_content_library_v1";
const PACKAGE_PREFIX = "coursecraft_content_";
const QUARANTINE_PREFIX = "coursecraft_content_quarantine_";
const MAX_LIBRARY_ENTRIES = 250;

async function readManifest(platform: PlatformServices): Promise<ContentLibraryEntry[]> {
  const raw = await platform.files.readText(MANIFEST_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as ContentLibraryEntry[];
    return Array.isArray(parsed) ? parsed.slice(0, MAX_LIBRARY_ENTRIES) : [];
  } catch {
    return [];
  }
}

async function writeManifest(platform: PlatformServices, entries: ContentLibraryEntry[]) {
  await platform.files.writeTextAtomic(MANIFEST_KEY, JSON.stringify(entries.slice(0, MAX_LIBRARY_ENTRIES)));
}

export async function listContentLibrary(platform = platformServices): Promise<ContentLibraryEntry[]> {
  return (await readManifest(platform)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function importContentPackage(
  text: string,
  source: ContentLibraryEntry["source"] = "manual",
  platform = platformServices,
): Promise<{ validation: PackageValidationResult; entry?: ContentLibraryEntry; replaced?: ContentLibraryEntry }> {
  const validation = await validatePackageText(text);
  if (validation.status === "corrupt" || validation.status === "unsupported") {
    const quarantineKey = `${QUARANTINE_PREFIX}${Date.now().toString(36)}`;
    await platform.files.writeTextAtomic(quarantineKey, text.slice(0, 16 * 1024 * 1024));
    return { validation };
  }
  const value = validation.value;
  const entries = await readManifest(platform);
  const existing = entries.find((entry) => entry.contentId === value.manifest.contentId);
  if (existing && existing.revision > value.manifest.revision) {
    return {
      validation: { status: "unsupported", errors: ["A newer local revision already exists."] },
      replaced: existing,
    };
  }
  const packageKey = `${PACKAGE_PREFIX}${value.manifest.contentId}`;
  const entry: ContentLibraryEntry = {
    contentId: value.manifest.contentId,
    revision: value.manifest.revision,
    kind: value.manifest.kind,
    title: value.manifest.title,
    author: value.manifest.author.displayName,
    theme: value.manifest.theme,
    updatedAt: value.manifest.updatedAt,
    source,
    state: "ready",
    packageKey,
    preview: value.manifest.preview,
    publishedId: existing?.publishedId,
  };
  await platform.files.writeTextAtomic(packageKey, packageText(value));
  const next = existing ? entries.map((item) => item.contentId === entry.contentId ? entry : item) : [entry, ...entries];
  await writeManifest(platform, next);
  return { validation, entry, ...(existing ? { replaced: existing } : {}) };
}

export async function saveAuthoredPackage(value: CoursePackageV1, platform = platformServices) {
  return importContentPackage(packageText(value), "local", platform);
}

export async function readContentPackage(contentId: string, platform = platformServices): Promise<CoursePackageV1 | null> {
  const entry = (await readManifest(platform)).find((item) => item.contentId === contentId);
  if (!entry) return null;
  const text = await platform.files.readText(entry.packageKey);
  if (!text) return null;
  const validation = await validatePackageText(text);
  return validation.status === "compatible" || validation.status === "migratable" ? validation.value : null;
}

export async function deleteContentPackage(contentId: string, platform = platformServices): Promise<boolean> {
  const entries = await readManifest(platform);
  const entry = entries.find((item) => item.contentId === contentId);
  if (!entry) return false;
  await platform.files.delete(entry.packageKey);
  await writeManifest(platform, entries.filter((item) => item.contentId !== contentId));
  return true;
}

export async function exportContentPackage(contentId: string, platform = platformServices): Promise<boolean> {
  const entry = (await readManifest(platform)).find((item) => item.contentId === contentId);
  if (!entry) return false;
  const text = await platform.files.readText(entry.packageKey);
  if (!text) return false;
  return platform.files.chooseExport(`${entry.title.replace(/[^A-Za-z0-9_-]+/g, "-")}.coursecraft-course`, text);
}

export async function refreshWorkshopLibrary(platform = platformServices): Promise<ContentLibraryEntry[]> {
  if (!platform.capabilities.workshop) return listContentLibrary(platform);
  const items = await platform.workshop.list();
  const entries = await readManifest(platform);
  const next = entries.map((entry) => {
    if (!entry.publishedId) return entry;
    const item = items.find((candidate) => candidate.id === entry.publishedId);
    if (!item) return { ...entry, source: "cached" as const };
    if (item.state === "corrupt" || item.state === "incompatible") return { ...entry, state: "quarantined" as const };
    return { ...entry, source: item.state === "cached" ? "cached" as const : "workshop" as const };
  });
  await writeManifest(platform, next);
  return next;
}

export async function publishContentPackage(
  contentId: string,
  visibility: "public" | "friends" | "private" = "private",
  platform = platformServices,
): Promise<{ publishedId: string; needsLegalAgreement: boolean } | null> {
  if (!platform.capabilities.workshop) return null;
  const entries = await readManifest(platform);
  const entry = entries.find((item) => item.contentId === contentId);
  if (!entry) return null;
  const text = await platform.files.readText(entry.packageKey);
  if (!text) return null;
  const validation = await validatePackageText(text);
  if (validation.status !== "compatible" && validation.status !== "migratable") return null;
  const value = validation.value;
  const result = await platform.workshop.publish({
    contentId,
    title: value.manifest.title,
    description: value.manifest.description,
    tags: [value.manifest.kind, value.manifest.theme],
    visibility,
    packageText: text,
    previewDataUrl: value.manifest.preview?.dataUrl,
    existingPublishedId: entry.publishedId,
  });
  await writeManifest(platform, entries.map((item) => item.contentId === contentId
    ? { ...item, source: "workshop", publishedId: result.publishedId }
    : item));
  return result;
}
