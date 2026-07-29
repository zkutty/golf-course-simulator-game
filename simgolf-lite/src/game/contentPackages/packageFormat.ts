import { CURRENT_SAVE_SCHEMA_VERSION } from "../../utils/save";
import { normalizeCourseLayouts } from "../models/courseLayouts";
import { validateCoursePlayability, validateScenarioAuthoring } from "../scenarioAuthoring/authoring";
import type { Course, CourseLayout, Hole, Terrain } from "../models/types";
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
const MAX_GOALS = 20;
const MAX_EVENTS = 40;
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{1,95}$/;
const TERRAIN_VALUES = new Set<Terrain>(["fairway", "rough", "deep_rough", "sand", "waste_area", "water", "wetland", "green", "tee", "path"]);

/** Documented package budgets used by both manual and Workshop imports. */
export const PACKAGE_LIMITS = Object.freeze({
  maxTextBytes: MAX_TEXT_BYTES,
  maxPreviewBytes: MAX_PREVIEW_BYTES,
  maxGridCells: MAX_GRID_CELLS,
  maxHoles: MAX_HOLES,
  maxGoals: MAX_GOALS,
  maxEvents: MAX_EVENTS,
});

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function scanUnsafe(value: unknown, path = "package", depth = 0): string[] {
  if (depth > 30) return [`${path}: nesting exceeds 30 levels`];
  if (typeof value === "string") {
    if (value.length > 20_000) return [`${path}: string is too long`];
    if (!path.endsWith(".preview.dataUrl") && (/\b[a-z][a-z0-9+.-]*:\/\//i.test(value) || /\b(?:javascript|vbscript|file|data):/i.test(value))) return [`${path}: external URLs and executable schemes are not allowed`];
    if (/(^|[\\/])\.\.([\\/]|$)/.test(value) || value.includes("\0")) return [`${path}: unsafe path content`];
    return [];
  }
  if (Array.isArray(value)) return value.flatMap((item, index) => scanUnsafe(item, `${path}[${index}]`, depth + 1));
  if (!isRecord(value)) return [];
  const errors: string[] = [];
  for (const [key, child] of Object.entries(value)) {
    if (key === "__proto__" || key === "prototype" || key === "constructor") errors.push(`${path}: forbidden key ${key}`);
    errors.push(...scanUnsafe(child, `${path}.${key}`, depth + 1));
  }
  return errors;
}

function unknownKeys(value: Record<string, unknown>, allowed: readonly string[], path: string, errors: string[]) {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) if (!allowedSet.has(key)) errors.push(`${path}: unsupported field ${key}`);
}

function decodeBase64(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 === 1) return null;
  try {
    if (typeof atob === "function") {
      const binary = atob(value);
      return Uint8Array.from(binary, (character) => character.charCodeAt(0));
    }
  } catch {
    return null;
  }
  return null;
}

function validatePreview(preview: unknown, errors: string[]): preview is CoursePackageManifestV1["preview"] {
  if (!preview) return true;
  if (!isRecord(preview)) {
    errors.push("preview: must be an object");
    return false;
  }
  unknownKeys(preview, ["mime", "dataUrl"], "preview", errors);
  if (preview.mime !== "image/png" && preview.mime !== "image/jpeg") errors.push("preview: unsupported MIME type");
  if (typeof preview.dataUrl !== "string") {
    errors.push("preview: data URL is required");
    return false;
  }
  const prefix = preview.mime === "image/png" ? "data:image/png;base64," : "data:image/jpeg;base64,";
  if (!preview.dataUrl.startsWith(prefix)) {
    errors.push("preview: MIME/data mismatch");
    return false;
  }
  const encoded = preview.dataUrl.slice(prefix.length);
  const estimatedBytes = Math.ceil(encoded.length * 0.75);
  if (estimatedBytes > MAX_PREVIEW_BYTES) errors.push("preview: exceeds 2 MiB");
  const bytes = decodeBase64(encoded);
  if (!bytes || bytes.length === 0) errors.push("preview: invalid base64 image data");
  if (bytes && preview.mime === "image/png" && !(bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47)) errors.push("preview: PNG signature is missing");
  if (bytes && preview.mime === "image/jpeg" && !(bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)) errors.push("preview: JPEG signature is missing");
  return true;
}

function validPoint(value: unknown, width: number, height: number, allowNull = true): value is { x: number; y: number } | null {
  if (value == null && allowNull) return true;
  return isRecord(value) && typeof value.x === "number" && typeof value.y === "number" && Number.isInteger(value.x) && Number.isInteger(value.y) && value.x >= 0 && value.y >= 0 && value.x < width && value.y < height;
}

function validateCourse(course: unknown, errors: string[]): course is Course {
  if (!isRecord(course)) {
    errors.push("course: payload must be an object");
    return false;
  }
  const width = typeof course.width === "number" ? course.width : NaN;
  const height = typeof course.height === "number" ? course.height : NaN;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 256 || height > 256) {
    errors.push("course: invalid dimensions");
    return false;
  }
  const cells = width * height;
  if (cells > MAX_GRID_CELLS || !Array.isArray(course.tiles) || course.tiles.length !== cells || course.tiles.some((tile) => typeof tile !== "string" || !TERRAIN_VALUES.has(tile as Terrain))) errors.push("course: invalid or oversized tile grid");
  if (course.elevations !== undefined && (!Array.isArray(course.elevations) || course.elevations.length !== cells || course.elevations.some((value) => typeof value !== "number" || !Number.isFinite(value)))) errors.push("course: invalid elevation grid");
  if (!Array.isArray(course.holes) || course.holes.length < 1 || course.holes.length > MAX_HOLES) errors.push("course: hole count must be between 1 and 36");
  if (!Array.isArray(course.obstacles) || course.obstacles.length > MAX_OBSTACLES) errors.push("course: too many obstacles");
  if (!Array.isArray(course.decorations) || course.decorations.length > MAX_DECORATIONS) errors.push("course: too many decorations");
  if (!Array.isArray(course.buildings) || course.buildings.length > MAX_BUILDINGS) errors.push("course: too many buildings");
  if (course.layouts !== undefined && !Array.isArray(course.layouts)) errors.push("course: layouts must be an array");
  for (const [index, hole] of (Array.isArray(course.holes) ? course.holes : []).entries()) {
    if (!isRecord(hole)) {
      errors.push(`course.holes[${index}]: hole must be an object`);
      continue;
    }
    if (typeof hole.id !== "string" || !ID_PATTERN.test(hole.id)) errors.push(`course.holes[${index}]: stable hole ID is invalid`);
    if (!validPoint(hole.tee, width, height) || !validPoint(hole.green, width, height)) errors.push(`course.holes[${index}]: tee/green must be in bounds or null`);
    for (const key of ["teeBoxes", "pinPositions"] as const) {
      if (hole[key] !== undefined) {
        if (!isRecord(hole[key])) errors.push(`course.holes[${index}].${key}: must be an object`);
        else for (const point of Object.values(hole[key])) if (!validPoint(point, width, height)) errors.push(`course.holes[${index}].${key}: marker is out of bounds`);
      }
    }
    if (hole.parMode !== "AUTO" && hole.parMode !== "MANUAL") errors.push(`course.holes[${index}]: par mode is invalid`);
    if (hole.parManual !== undefined && (typeof hole.parManual !== "number" || !Number.isInteger(hole.parManual) || hole.parManual < 3 || hole.parManual > 5)) errors.push(`course.holes[${index}]: manual par is invalid`);
  }
  for (const key of ["obstacles", "decorations", "buildings"] as const) {
    for (const [index, item] of (Array.isArray(course[key]) ? course[key] : []).entries()) {
      if (!isRecord(item) || !validPoint(item, width, height, false)) errors.push(`course.${key}[${index}]: position is out of bounds`);
    }
  }
  const holeIds = new Set<string>();
  for (const hole of Array.isArray(course.holes) ? course.holes : []) {
    if (isRecord(hole) && typeof hole.id === "string") {
      if (holeIds.has(hole.id)) errors.push("course: stable hole IDs are missing or duplicated");
      holeIds.add(hole.id);
    }
  }
  for (const [index, layout] of (Array.isArray(course.layouts) ? course.layouts : []).entries()) {
    if (!isRecord(layout) || typeof layout.id !== "string" || !ID_PATTERN.test(layout.id) || !Array.isArray(layout.draftHoleIds) || !Array.isArray(layout.publishedHoleIds)) {
      errors.push(`course.layouts[${index}]: routing shape is invalid`);
      continue;
    }
    for (const holeId of [...layout.draftHoleIds, ...layout.publishedHoleIds]) {
      if (!holeIds.has(holeId)) errors.push(`course: layout ${layout.id} references missing hole ${holeId}`);
    }
  }
  return errors.length === 0;
}

function validateChallenge(challenge: unknown, errors: string[]): challenge is ChallengePayloadV1 {
  if (!challenge) return true;
  if (!isRecord(challenge)) {
    errors.push("challenge: payload must be an object");
    return false;
  }
  unknownKeys(challenge, ["difficulty", "startingCash", "goals", "goalTemplateIds", "constraints", "allowedEventIds", "medalTargets"], "challenge", errors);
  if (!["easy", "normal", "hard"].includes(challenge.difficulty as string)) errors.push("challenge: invalid difficulty");
  if (challenge.medalTargets !== undefined && (!isRecord(challenge.medalTargets) || Object.keys(challenge.medalTargets).some((key) => key !== "silver" && key !== "gold"))) errors.push("challenge.medalTargets: unsupported shape");
  if (isRecord(challenge.medalTargets)) for (const key of ["silver", "gold"]) if (challenge.medalTargets[key] !== undefined && (typeof challenge.medalTargets[key] !== "number" || !Number.isFinite(challenge.medalTargets[key]))) errors.push(`challenge.medalTargets.${key}: must be finite`);
  const authoring = validateScenarioAuthoring(challenge as unknown as ChallengePayloadV1);
  errors.push(...authoring.blockers);
  return true;
}

export async function validatePackageText(text: string): Promise<PackageValidationResult> {
  if (typeof text !== "string" || new TextEncoder().encode(text).length > MAX_TEXT_BYTES) {
    return { status: "corrupt", errors: ["Package exceeds the 16 MiB limit."] };
  }
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    return { status: "corrupt", errors: ["Package is not valid JSON."] };
  }
  const errors = scanUnsafe(value);
  if (!isRecord(value)) return { status: "corrupt", errors: ["Package root must be a JSON object."] };
  unknownKeys(value, ["manifest", "payload"], "package", errors);
  if (!isRecord(value.manifest)) errors.push("Package manifest is missing or invalid.");
  if (!isRecord(value.payload) || value.payload.course === undefined) errors.push("Package course payload is missing or invalid.");
  if (errors.length) return { status: "corrupt", errors };
  const manifestRecord = value.manifest as Record<string, unknown>;
  const payloadRecord = value.payload as Record<string, unknown>;
  const manifest = manifestRecord as Partial<CoursePackageManifestV1>;
  const revision = typeof manifest.revision === "number" ? manifest.revision : NaN;
  const requiredSaveSchema = typeof manifest.requiredSaveSchema === "number" ? manifest.requiredSaveSchema : NaN;
  if (manifest.format !== "coursecraft-package") {
    return { status: "corrupt", errors: ["Package format is missing or unsupported."] };
  }
  if (manifest.version !== 1) {
    return { status: "unsupported", errors: ["Package format/version is unsupported."] };
  }
  unknownKeys(manifestRecord, ["format", "version", "kind", "contentId", "revision", "title", "description", "author", "createdAt", "updatedAt", "requiredGameVersion", "requiredSaveSchema", "theme", "checksum", "preview"], "manifest", errors);
  if (manifest.kind !== "course" && manifest.kind !== "challenge") errors.push("Manifest kind is invalid.");
  if (typeof manifest.contentId !== "string" || !ID_PATTERN.test(manifest.contentId)) errors.push("Manifest identity is invalid.");
  if (!Number.isInteger(revision) || revision < 1 || revision > 1_000_000) errors.push("Manifest revision is invalid.");
  if (typeof manifest.title !== "string" || !manifest.title.trim() || manifest.title.length > 100 || typeof manifest.description !== "string" || manifest.description.length > 1000 || !isRecord(manifest.author) || typeof manifest.author.displayName !== "string" || manifest.author.displayName.length > 80) errors.push("Manifest text limits are invalid.");
  if (!isRecord(manifest.author) || typeof manifest.author.id !== "string" || !ID_PATTERN.test(manifest.author.id)) errors.push("Manifest author identity is invalid.");
  if (typeof manifest.createdAt !== "string" || Number.isNaN(Date.parse(manifest.createdAt)) || typeof manifest.updatedAt !== "string" || Number.isNaN(Date.parse(manifest.updatedAt))) errors.push("Manifest timestamps are invalid.");
  if (typeof manifest.requiredGameVersion !== "string" || !VERSION_PATTERN.test(manifest.requiredGameVersion)) errors.push("Required game version is invalid.");
  if (!Number.isInteger(requiredSaveSchema) || requiredSaveSchema < 1) errors.push("Required save schema is invalid.");
  if (!["parkland", "links", "desert"].includes(manifest.theme as string)) errors.push("Theme is invalid.");
  validatePreview(manifest.preview, errors);
  const rawCourse = payloadRecord.course;
  const courseValid = validateCourse(rawCourse, errors);
  const challengeValid = payloadRecord.challenge === undefined || validateChallenge(payloadRecord.challenge, errors);
  if (courseValid && challengeValid) {
    const playability = validateCoursePlayability(rawCourse as Course);
    errors.push(...playability.blockers.map((blocker) => `course: ${blocker}`));
  }
  if (typeof manifest.checksum !== "string" || !/^[a-f0-9]{64}$/.test(manifest.checksum)) errors.push("Package checksum is invalid.");
  let expectedChecksum = "";
  try {
    expectedChecksum = await sha256(canonicalPackageJson(packageCore(value as unknown as CoursePackageV1)));
  } catch {
    errors.push("Package checksum could not be calculated.");
  }
  if (expectedChecksum && manifest.checksum !== expectedChecksum) errors.push("Package checksum does not match its contents.");
  if (errors.length) return { status: "corrupt", errors };
  if (requiredSaveSchema > CURRENT_SAVE_SCHEMA_VERSION) {
    return { status: "unsupported", errors: [`Package requires save schema ${requiredSaveSchema}.`] };
  }
  const status = requiredSaveSchema < CURRENT_SAVE_SCHEMA_VERSION ? "migratable" : "compatible";
  return { status, value: value as unknown as CoursePackageV1, warnings: status === "migratable" ? ["Package uses an older compatible course schema and will be normalized on import."] : [] };
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
  /** Preserve this timestamp when creating a new revision of an existing package. */
  createdAt?: Date;
  now?: Date;
}): Promise<CoursePackageV1> {
  const timestamp = input.now ?? new Date();
  const now = timestamp.toISOString();
  const createdAt = (input.createdAt ?? timestamp).toISOString();
  const normalizedCourse = normalizeCourseLayouts(structuredClone(input.course));
  const seedId = input.contentId ?? `cc-${await sha256(canonicalPackageJson({
    author: input.author.id,
    title: input.title,
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
      createdAt,
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
