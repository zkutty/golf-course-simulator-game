import { CURRENT_SAVE_SCHEMA_VERSION } from "../../utils/save";
import { STORY_DEFINITION_BY_ID } from "../livingClub/content";
import { normalizeCourseLayouts } from "../models/courseLayouts";
import type { Course, CourseLayout, Hole } from "../models/types";
import type {
  ChallengePayloadV1,
  CoursePackageManifestV1,
  CoursePackageV1,
  PackageValidationResult,
} from "./types";

const MAX_TEXT_BYTES = 16 * 1024 * 1024;
const MAX_PREVIEW_BYTES = 2 * 1024 * 1024;
const MAX_GRID_CELLS = 256 * 256;
const MAX_HOLES = 36;
const MAX_OBSTACLES = 20_000;
const MAX_DECORATIONS = 20_000;
const MAX_BUILDINGS = 2_000;
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{1,95}$/;

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([, child]) => child !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, child]) => [key, stableValue(child)]));
}

export function canonicalPackageJson(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

async function sha256(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function packageCore(input: Omit<CoursePackageV1, "manifest"> & { manifest: Omit<CoursePackageManifestV1, "checksum"> | CoursePackageManifestV1 }) {
  const { checksum: _checksum, ...manifest } = input.manifest as CoursePackageManifestV1;
  return { manifest, payload: input.payload };
}

function scanUnsafe(value: unknown, path = "package", depth = 0): string[] {
  if (depth > 30) return [`${path}: nesting exceeds 30 levels`];
  if (typeof value === "string") {
    if (value.length > 20_000) return [`${path}: string is too long`];
    if (/https?:\/\//i.test(value)) return [`${path}: external URLs are not allowed`];
    if (/(^|[\\/])\.\.([\\/]|$)/.test(value) || value.includes("\0")) return [`${path}: unsafe path content`];
    return [];
  }
  if (Array.isArray(value)) return value.flatMap((item, index) => scanUnsafe(item, `${path}[${index}]`, depth + 1));
  if (!value || typeof value !== "object") return [];
  const errors: string[] = [];
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (key === "__proto__" || key === "prototype" || key === "constructor") errors.push(`${path}: forbidden key ${key}`);
    errors.push(...scanUnsafe(child, `${path}.${key}`, depth + 1));
  }
  return errors;
}

function validatePreview(preview: CoursePackageManifestV1["preview"], errors: string[]) {
  if (!preview) return;
  if (preview.mime !== "image/png" && preview.mime !== "image/jpeg") errors.push("preview: unsupported MIME type");
  const prefix = preview.mime === "image/png" ? "data:image/png;base64," : "data:image/jpeg;base64,";
  if (!preview.dataUrl.startsWith(prefix)) errors.push("preview: MIME/data mismatch");
  const estimatedBytes = Math.ceil((preview.dataUrl.length - prefix.length) * 0.75);
  if (estimatedBytes > MAX_PREVIEW_BYTES) errors.push("preview: exceeds 2 MiB");
}

function validateCourse(course: Course, errors: string[]) {
  if (!Number.isInteger(course.width) || !Number.isInteger(course.height) || course.width < 1 || course.height < 1) {
    errors.push("course: invalid dimensions");
    return;
  }
  const cells = course.width * course.height;
  if (cells > MAX_GRID_CELLS || course.tiles?.length !== cells) errors.push("course: invalid or oversized tile grid");
  if (course.elevations && course.elevations.length !== cells) errors.push("course: elevation grid mismatch");
  if (!Array.isArray(course.holes) || course.holes.length > MAX_HOLES) errors.push("course: too many holes");
  if (!Array.isArray(course.obstacles) || course.obstacles.length > MAX_OBSTACLES) errors.push("course: too many obstacles");
  if (!Array.isArray(course.decorations) || course.decorations.length > MAX_DECORATIONS) errors.push("course: too many decorations");
  if (!Array.isArray(course.buildings) || course.buildings.length > MAX_BUILDINGS) errors.push("course: too many buildings");
  const holeIds = new Set<string>();
  for (const hole of course.holes ?? []) {
    if (!hole.id || holeIds.has(hole.id)) errors.push("course: stable hole IDs are missing or duplicated");
    if (hole.id) holeIds.add(hole.id);
  }
  for (const layout of course.layouts ?? []) {
    for (const holeId of [...layout.draftHoleIds, ...layout.publishedHoleIds]) {
      if (!holeIds.has(holeId)) errors.push(`course: layout ${layout.id} references missing hole ${holeId}`);
    }
  }
}

function validateChallenge(challenge: ChallengePayloadV1 | undefined, errors: string[]) {
  if (!challenge) return;
  if (!["easy", "normal", "hard"].includes(challenge.difficulty)) errors.push("challenge: invalid difficulty");
  if (!Array.isArray(challenge.goals) || challenge.goals.length > 20) errors.push("challenge: invalid goal count");
  for (const goal of challenge.goals ?? []) {
    if (!goal.id || !Array.isArray(goal.conditions) || goal.conditions.length > 8) errors.push(`challenge: invalid goal ${goal.id ?? "unknown"}`);
  }
  if (!Array.isArray(challenge.allowedEventIds) || challenge.allowedEventIds.some((id) => !STORY_DEFINITION_BY_ID.has(id))) {
    errors.push("challenge: unsupported event vocabulary");
  }
}

export async function validatePackageText(text: string): Promise<PackageValidationResult> {
  if (typeof text !== "string" || new TextEncoder().encode(text).length > MAX_TEXT_BYTES) {
    return { status: "corrupt", errors: ["Package exceeds the 16 MiB limit."] };
  }
  let value: CoursePackageV1;
  try {
    value = JSON.parse(text) as CoursePackageV1;
  } catch {
    return { status: "corrupt", errors: ["Package is not valid JSON."] };
  }
  const errors = scanUnsafe(value);
  if (!value?.manifest || !value.payload?.course) errors.push("Package manifest or course payload is missing.");
  if (errors.length) return { status: "corrupt", errors };
  const manifest = value.manifest;
  if (manifest.format !== "coursecraft-package" || manifest.version !== 1) {
    return { status: "unsupported", errors: ["Package format/version is unsupported."] };
  }
  if (!ID_PATTERN.test(manifest.contentId) || !ID_PATTERN.test(manifest.author?.id ?? "")) errors.push("Manifest identity is invalid.");
  if (!manifest.title || manifest.title.length > 100 || manifest.description.length > 1000 || manifest.author.displayName.length > 80) errors.push("Manifest text limits are invalid.");
  if (!VERSION_PATTERN.test(manifest.requiredGameVersion)) errors.push("Required game version is invalid.");
  if (!Number.isInteger(manifest.requiredSaveSchema) || manifest.requiredSaveSchema < 1) errors.push("Required save schema is invalid.");
  if (!["parkland", "links", "desert"].includes(manifest.theme)) errors.push("Theme is invalid.");
  validatePreview(manifest.preview, errors);
  validateCourse(value.payload.course, errors);
  validateChallenge(value.payload.challenge, errors);
  const expectedChecksum = await sha256(canonicalPackageJson(packageCore(value)));
  if (manifest.checksum !== expectedChecksum) errors.push("Package checksum does not match its contents.");
  if (errors.length) return { status: "corrupt", errors };
  if (manifest.requiredSaveSchema > CURRENT_SAVE_SCHEMA_VERSION) {
    return { status: "unsupported", errors: [`Package requires save schema ${manifest.requiredSaveSchema}.`] };
  }
  const status = manifest.requiredSaveSchema < CURRENT_SAVE_SCHEMA_VERSION ? "migratable" : "compatible";
  return { status, value, warnings: status === "migratable" ? ["Package uses an older compatible course schema and will be normalized on import."] : [] };
}

export async function createCoursePackage(input: {
  course: Course;
  kind?: "course" | "challenge";
  contentId?: string;
  revision?: number;
  title: string;
  description: string;
  author: { id: string; displayName: string };
  requiredGameVersion: string;
  challenge?: ChallengePayloadV1;
  preview?: CoursePackageManifestV1["preview"];
  now?: Date;
}): Promise<CoursePackageV1> {
  const now = (input.now ?? new Date()).toISOString();
  const normalizedCourse = normalizeCourseLayouts(structuredClone(input.course));
  const seedId = input.contentId ?? `cc-${await sha256(canonicalPackageJson({
    author: input.author.id,
    title: input.title,
    createdAt: now,
    course: normalizedCourse,
  })).then((value) => value.slice(0, 24))}`;
  const withoutChecksum = {
    manifest: {
      format: "coursecraft-package" as const,
      version: 1 as const,
      kind: input.kind ?? (input.challenge ? "challenge" : "course"),
      contentId: seedId,
      revision: Math.max(1, Math.floor(input.revision ?? 1)),
      title: input.title.trim(),
      description: input.description.trim(),
      author: { id: input.author.id.trim(), displayName: input.author.displayName.trim() },
      createdAt: now,
      updatedAt: now,
      requiredGameVersion: input.requiredGameVersion,
      requiredSaveSchema: CURRENT_SAVE_SCHEMA_VERSION,
      theme: normalizedCourse.theme ?? "parkland",
      ...(input.preview ? { preview: input.preview } : {}),
    },
    payload: {
      course: normalizedCourse,
      ...(input.challenge ? { challenge: input.challenge } : {}),
    },
  };
  const checksum = await sha256(canonicalPackageJson(withoutChecksum));
  return { ...withoutChecksum, manifest: { ...withoutChecksum.manifest, checksum } };
}

function remapHole(hole: Hole, id: string): Hole {
  return { ...hole, id };
}

function remapLayout(layout: CourseLayout, layoutId: string, holeIds: Map<string, string>): CourseLayout {
  return {
    ...layout,
    id: layoutId,
    draftHoleIds: layout.draftHoleIds.map((id) => holeIds.get(id) ?? id),
    publishedHoleIds: layout.publishedHoleIds.map((id) => holeIds.get(id) ?? id),
  };
}

export function remapImportedCourseIdentity(value: CoursePackageV1, instanceId: string): Course {
  if (!ID_PATTERN.test(instanceId)) throw new Error("Import instance identity is invalid.");
  const course = structuredClone(value.payload.course);
  const holeIds = new Map(course.holes.map((hole, index) => [hole.id ?? `hole-${index + 1}`, `${instanceId}-h${index + 1}`]));
  const layoutIds = new Map((course.layouts ?? []).map((layout, index) => [layout.id, `${instanceId}-c${index + 1}`]));
  const holes = course.holes.map((hole, index) => remapHole(hole, holeIds.get(hole.id ?? `hole-${index + 1}`)!));
  const layouts = (course.layouts ?? []).map((layout) => remapLayout(layout, layoutIds.get(layout.id)!, holeIds));
  return normalizeCourseLayouts({
    ...course,
    holes,
    layouts,
    activeCourseId: course.activeCourseId ? layoutIds.get(course.activeCourseId) : layouts[0]?.id,
    buildings: course.buildings.map((building, index) => ({ ...building, id: `${instanceId}-b${index + 1}` })),
    property: course.property ? {
      ...course.property,
      assets: course.property.assets.map((asset, index) => ({ ...asset, id: `${instanceId}-a${index + 1}` })),
    } : undefined,
  });
}

export function packageText(value: CoursePackageV1): string {
  return canonicalPackageJson(value);
}
