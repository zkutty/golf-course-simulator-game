import { platformServices } from "../../platform";
import type { PlatformServices, PlatformWorkshopItem } from "../../platform/types";
import { packageText, validatePackageText, PACKAGE_LIMITS } from "./packageFormat";
import type { ContentLibraryEntry, CoursePackageV1, PackageValidationResult, WorkshopPublishResult } from "./types";
import { isLandTheme } from "../models/biomes";

const MANIFEST_KEY = "coursecraft_content_library_v1";
const PACKAGE_PREFIX = "coursecraft_content_";
const QUARANTINE_PREFIX = "coursecraft_content_quarantine_";
const WORKSHOP_PLACEHOLDER_PREFIX = "coursecraft_workshop_";
const MAX_LIBRARY_ENTRIES = 250;
let quarantineSequence = 0;

const SOURCES = new Set<ContentLibraryEntry["source"]>(["local", "manual", "workshop", "cached"]);
const STATES = new Set<ContentLibraryEntry["state"]>([
  "ready", "subscribed", "downloading", "installed", "cached", "update-available", "incompatible", "corrupt", "quarantined",
]);

function safeEntry(value: unknown): value is ContentLibraryEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<ContentLibraryEntry>;
  return typeof candidate.contentId === "string" && candidate.contentId.length > 0 && candidate.contentId.length <= 96 &&
    typeof candidate.revision === "number" && Number.isInteger(candidate.revision) && candidate.revision >= 1 &&
    (candidate.kind === "course" || candidate.kind === "challenge") &&
    typeof candidate.title === "string" && candidate.title.length <= 100 &&
    typeof candidate.author === "string" && candidate.author.length <= 80 &&
    isLandTheme(candidate.theme) &&
    typeof candidate.updatedAt === "string" && !Number.isNaN(Date.parse(candidate.updatedAt)) &&
    SOURCES.has(candidate.source as ContentLibraryEntry["source"]) &&
    STATES.has(candidate.state as ContentLibraryEntry["state"]) &&
    typeof candidate.packageKey === "string" && candidate.packageKey.length <= 180 &&
    (candidate.quarantineReason === undefined || candidate.quarantineReason === "corrupt" || candidate.quarantineReason === "incompatible");
}

async function readManifest(platform: PlatformServices): Promise<ContentLibraryEntry[]> {
  const raw = await platform.files.readText(MANIFEST_KEY);
  if (!raw || raw.length > 2 * 1024 * 1024) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(safeEntry).slice(0, MAX_LIBRARY_ENTRIES);
  } catch {
    return [];
  }
}

async function writeManifest(platform: PlatformServices, entries: ContentLibraryEntry[]) {
  const safe = entries.filter(safeEntry).slice(0, MAX_LIBRARY_ENTRIES);
  await platform.files.writeTextAtomic(MANIFEST_KEY, JSON.stringify(safe));
}

function quarantineKey() {
  quarantineSequence = (quarantineSequence + 1) % 10_000;
  return `${QUARANTINE_PREFIX}${Date.now().toString(36)}-${quarantineSequence.toString(36)}`;
}

async function quarantine(platform: PlatformServices, text: string) {
  await platform.files.writeTextAtomic(quarantineKey(), text.slice(0, PACKAGE_LIMITS.maxTextBytes));
}

function placeholder(item: PlatformWorkshopItem, state: ContentLibraryEntry["state"]): ContentLibraryEntry {
  const id = item.id.replace(/[^A-Za-z0-9_.-]/g, "-").slice(0, 80) || "unknown";
  const version = Number.parseInt(item.version ?? "1", 10);
  return {
    contentId: `${WORKSHOP_PLACEHOLDER_PREFIX}${id}`,
    revision: Number.isFinite(version) && version > 0 ? version : 1,
    kind: "course",
    title: typeof item.title === "string" && item.title.trim() ? item.title.slice(0, 100) : "Workshop item",
    author: "Workshop",
    theme: "parkland",
    updatedAt: "1970-01-01T00:00:00.000Z",
    source: state === "cached" ? "cached" : "workshop",
    state,
    packageKey: `${WORKSHOP_PLACEHOLDER_PREFIX}${id}`,
    publishedId: item.id,
  };
}

function workshopState(item: PlatformWorkshopItem): ContentLibraryEntry["state"] {
  if (item.state === "subscribed" || item.state === "downloading" || item.state === "installed" || item.state === "cached") return item.state;
  return item.state === "incompatible" ? "incompatible" : "corrupt";
}

function numericWorkshopVersion(item: PlatformWorkshopItem): number | null {
  const match = typeof item.version === "string" ? /\d+/.exec(item.version) : null;
  if (!match) return null;
  const version = Number.parseInt(match[0], 10);
  return Number.isSafeInteger(version) ? version : null;
}

async function workshopPackageText(item: PlatformWorkshopItem, platform: PlatformServices): Promise<string | null> {
  const candidates: string[] = [];
  if (typeof item.localPath === "string" && item.localPath.length <= 500) candidates.push(item.localPath);
  try {
    const copied = await platform.workshop.copyLocal(item.id);
    if (typeof copied === "string" && copied.length <= PACKAGE_LIMITS.maxTextBytes) {
      if (copied.trimStart().startsWith("{")) return copied;
      candidates.push(copied);
    }
  } catch {
    // Offline or provider errors leave the existing cached package intact.
  }
  for (const key of candidates) {
    try {
      const text = await platform.files.readText(key);
      if (text) return text;
    } catch {
      // The provider may return a path that is not readable in this build.
    }
  }
  return null;
}

export async function listContentLibrary(platform = platformServices): Promise<ContentLibraryEntry[]> {
  return (await readManifest(platform)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function readAuthoredPackage(authorId: string, title: string, platform = platformServices): Promise<CoursePackageV1 | null> {
  const entry = (await readManifest(platform)).find((candidate) => candidate.source === "local" && candidate.authorId === authorId && candidate.title === title);
  return entry ? readContentPackage(entry.contentId, platform) : null;
}

export async function importContentPackage(
  text: string,
  source: ContentLibraryEntry["source"] = "manual",
  platform = platformServices,
): Promise<{ validation: PackageValidationResult; entry?: ContentLibraryEntry; replaced?: ContentLibraryEntry }> {
  const validation = await validatePackageText(text);
  if (validation.status === "corrupt" || validation.status === "unsupported") {
    await quarantine(platform, typeof text === "string" ? text : "");
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
  const packageKey = `${PACKAGE_PREFIX}${value.manifest.contentId}@r${value.manifest.revision}-${value.manifest.checksum.slice(0, 12)}`;
  const entry: ContentLibraryEntry = {
    contentId: value.manifest.contentId,
    revision: value.manifest.revision,
    kind: value.manifest.kind,
    title: value.manifest.title,
    author: value.manifest.author.displayName,
    theme: value.manifest.theme,
    updatedAt: value.manifest.updatedAt,
    createdAt: value.manifest.createdAt,
    authorId: value.manifest.author.id,
    source,
    state: "ready",
    packageKey,
    preview: value.manifest.preview,
    publishedId: existing?.publishedId,
  };
  const createdRevision = packageKey !== existing?.packageKey;
  await platform.files.writeTextAtomic(packageKey, packageText(value));
  const next = existing ? entries.map((item) => item.contentId === entry.contentId ? entry : item) : [entry, ...entries];
  try {
    await writeManifest(platform, next);
  } catch (error) {
    if (createdRevision) await platform.files.delete(packageKey).catch(() => undefined);
    throw error;
  }
  if (existing && existing.packageKey !== packageKey) {
    await platform.files.delete(existing.packageKey).catch(() => undefined);
  }
  return { validation, entry, ...(existing ? { replaced: existing } : {}) };
}

export async function saveAuthoredPackage(value: CoursePackageV1, platform = platformServices) {
  return importContentPackage(packageText(value), "local", platform);
}

export async function readContentPackage(contentId: string, platform = platformServices): Promise<CoursePackageV1 | null> {
  const entry = (await readManifest(platform)).find((item) => item.contentId === contentId);
  if (!entry) return null;
  const text = await platform.files.readText(entry.packageKey);
  if (!text) {
    const entries = await readManifest(platform);
    await writeManifest(platform, entries.map((item) => item.contentId === contentId ? { ...item, state: "corrupt" as const, quarantined: true, quarantineReason: "corrupt" as const } : item));
    return null;
  }
  const validation = await validatePackageText(text);
  if (validation.status === "compatible" || validation.status === "migratable") return validation.value;
  await quarantine(platform, text);
  const quarantineReason = validation.status === "unsupported" ? "incompatible" as const : "corrupt" as const;
  const entries = await readManifest(platform);
  await writeManifest(platform, entries.map((item) => item.contentId === contentId ? { ...item, state: quarantineReason, quarantined: true, quarantineReason } : item));
  return null;
}

export async function deleteContentPackage(contentId: string, platform = platformServices): Promise<boolean> {
  const entries = await readManifest(platform);
  const entry = entries.find((item) => item.contentId === contentId);
  if (!entry) return false;
  await writeManifest(platform, entries.filter((item) => item.contentId !== contentId));
  await platform.files.delete(entry.packageKey).catch(() => undefined);
  return true;
}

export async function exportContentPackage(contentId: string, platform = platformServices): Promise<boolean> {
  const entry = (await readManifest(platform)).find((item) => item.contentId === contentId);
  if (!entry) return false;
  const text = await platform.files.readText(entry.packageKey);
  if (!text) return false;
  const safeName = entry.title.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "coursecraft-package";
  return platform.files.chooseExport(`${safeName}.coursecraft-course`, text);
}

export async function refreshWorkshopLibrary(platform = platformServices): Promise<ContentLibraryEntry[]> {
  const entries = await readManifest(platform);
  if (!platform.capabilities.workshop) return listContentLibrary(platform);
  let items: PlatformWorkshopItem[];
  try {
    const received = await platform.workshop.list();
    items = Array.isArray(received) ? received.filter((item): item is PlatformWorkshopItem => !!item && typeof item.id === "string" && typeof item.state === "string") : [];
  } catch {
    return entries.map((entry) => entry.source === "workshop" ? { ...entry, source: "cached" as const, state: "cached" as const } : entry);
  }
  const next = [...entries];
  for (const item of items) {
    const existingIndex = next.findIndex((entry) => entry.publishedId === item.id);
    const state = workshopState(item);
    if (state === "subscribed" || state === "downloading" || state === "incompatible" || state === "corrupt") {
      if (existingIndex >= 0) next[existingIndex] = { ...next[existingIndex], state, source: "workshop", quarantined: state === "incompatible" || state === "corrupt", quarantineReason: state === "incompatible" || state === "corrupt" ? state : undefined };
      else next.push({ ...placeholder(item, state), quarantined: state === "incompatible" || state === "corrupt", quarantineReason: state === "incompatible" || state === "corrupt" ? state : undefined });
      continue;
    }
    const text = await workshopPackageText(item, platform);
    if (text) {
      const imported = await importContentPackage(text, "workshop", platform);
      if (imported.entry) {
        const importedEntry = { ...imported.entry, publishedId: item.id, source: item.state === "cached" ? "cached" as const : "workshop" as const, state: state === "cached" ? "cached" as const : "installed" as const };
        const index = next.findIndex((entry) => entry.contentId === importedEntry.contentId || entry.publishedId === item.id);
        if (index >= 0) next[index] = { ...next[index], ...importedEntry };
        else next.push(importedEntry);
      } else if (existingIndex >= 0) {
        const quarantineReason = imported.validation.status === "unsupported" ? "incompatible" as const : "corrupt" as const;
        next[existingIndex] = { ...next[existingIndex], state: quarantineReason, quarantined: true, quarantineReason };
      } else {
        const quarantineReason = imported.validation.status === "unsupported" ? "incompatible" as const : "corrupt" as const;
        next.push({ ...placeholder(item, quarantineReason), quarantined: true, quarantineReason });
      }
      continue;
    }
    if (existingIndex >= 0) {
      const existing = next[existingIndex];
      const providerVersion = numericWorkshopVersion(item);
      next[existingIndex] = {
        ...existing,
        source: item.state === "cached" ? "cached" : "workshop",
        state: providerVersion != null && providerVersion > existing.revision ? "update-available" : state,
      };
    } else next.push(placeholder(item, state));
  }
  const seen = new Set(items.map((item) => item.id));
  for (let index = 0; index < next.length; index += 1) {
    const entry = next[index];
    if (!entry.publishedId || seen.has(entry.publishedId) || entry.source === "local" || entry.source === "manual") continue;
    next[index] = { ...entry, source: "cached", state: "cached" };
  }
  await writeManifest(platform, next);
  return listContentLibrary(platform);
}

export async function copyWorkshopItemLocally(itemId: string, platform = platformServices): Promise<ContentLibraryEntry | null> {
  if (!platform.capabilities.workshop) return null;
  const item = (await platform.workshop.list()).find((candidate) => candidate.id === itemId);
  if (!item) return null;
  const text = await workshopPackageText(item, platform);
  if (!text) return null;
  const result = await importContentPackage(text, "local", platform);
  return result.entry ? { ...result.entry, publishedId: item.id, source: "local" } : null;
}

export async function publishContentPackage(
  contentId: string,
  visibility: "public" | "friends" | "private" = "private",
  platform = platformServices,
): Promise<WorkshopPublishResult | null> {
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
  }) as WorkshopPublishResult;
  if (!result || typeof result.publishedId !== "string" || !result.publishedId.trim()) throw new Error("Workshop did not return a published identity.");
  if (result.ownershipVerified === false || result.ownership === "not-owner") throw new Error("Workshop ownership could not be verified; the local package was not changed.");
  const needsLegalAgreement = result.needsLegalAgreement === true;
  const normalized: WorkshopPublishResult = {
    ...result,
    needsLegalAgreement,
    legalAgreementUrl: result.legalAgreementUrl ?? platform.workshop.legalAgreementUrl,
  };
  if (needsLegalAgreement) return normalized;
  await writeManifest(platform, entries.map((item) => item.contentId === contentId
    ? { ...item, source: "workshop", state: "ready" as const, publishedId: result.publishedId }
    : item));
  return normalized;
}

export async function retryWorkshopPublish(contentId: string, visibility: "public" | "friends" | "private" = "private", platform = platformServices) {
  return publishContentPackage(contentId, visibility, platform);
}

export async function cancelWorkshopOperation(operationId: string, platform = platformServices): Promise<boolean> {
  if (!platform.capabilities.workshop || !/^[A-Za-z0-9_.:-]{1,180}$/.test(operationId)) return false;
  await platform.workshop.cancel(operationId);
  return true;
}

export function workshopLegalAgreementUrl(platform = platformServices): string | null {
  return platform.capabilities.workshop ? platform.workshop.legalAgreementUrl : null;
}
