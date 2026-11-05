import type { Course, Hole, LandTheme, Point, SurfaceFeature, Terrain } from "../models/types";
import { canonicalJson } from "../../utils/canonical";
import { HOLE_TEMPLATE_SURFACE_LIMITS, validateHoleTemplateSurfaceIntent, validateHoleTemplateV1 } from "../holeTemplates/serialization";
import { decorationTiles } from "../models/decorations";
import { BIOME_KEYS } from "../models/biomes";
import type { HoleTemplateCellV1, HoleTemplateSurfaceIntentV1, HoleTemplateV1 } from "../holeTemplates/types";
import { provenancePolicyIssues } from "../holeTemplates/provenancePolicy";
import type { HoleTemplatePackageV1, PackageValidationResult } from "./types";

export const HOLE_TEMPLATE_PACKAGE_FORMAT = "coursecraft-hole-template-package" as const;
export const HOLE_TEMPLATE_PACKAGE_VERSION = 1 as const;
export const HOLE_TEMPLATE_PACKAGE_MAX_BYTES = 16 * 1024 * 1024;

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{1,95}$/;
const THEMES = new Set<LandTheme>(BIOME_KEYS);

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([, child]) => child !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, child]) => [key, stableValue(child)]));
}

function canonicalPackageJson(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function packageCore(value: HoleTemplatePackageV1): Omit<HoleTemplatePackageV1, "manifest"> & { manifest: Omit<HoleTemplatePackageV1["manifest"], "checksum"> } {
  const { checksum: _checksum, ...manifest } = value.manifest;
  return { manifest, payload: value.payload };
}

function packageError(message: string): PackageValidationResult {
  return { status: "corrupt", errors: [message] };
}

/** Validates the package envelope plus the released V1 hole-template contract. */
export async function validateHoleTemplatePackageText(text: string): Promise<PackageValidationResult> {
  if (typeof text !== "string" || new TextEncoder().encode(text).length > HOLE_TEMPLATE_PACKAGE_MAX_BYTES) {
    return packageError("Hole template package exceeds the 16 MiB limit.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return packageError("Hole template package is not valid JSON.");
  }
  if (!isRecord(parsed) || Object.keys(parsed).some((key) => key !== "manifest" && key !== "payload") || !isRecord(parsed.manifest) || !isRecord(parsed.payload)) {
    return packageError("Hole template package must contain only manifest and payload objects.");
  }
  const manifest = parsed.manifest;
  const payload = parsed.payload;
  const allowedManifest = ["format", "version", "kind", "contentId", "revision", "title", "description", "author", "createdAt", "updatedAt", "requiredGameVersion", "theme", "checksum"];
  if (Object.keys(manifest).some((key) => !allowedManifest.includes(key)) || Object.keys(payload).some((key) => key !== "template")) return packageError("Hole template package has unsupported fields.");
  if (manifest.format !== HOLE_TEMPLATE_PACKAGE_FORMAT || manifest.version !== HOLE_TEMPLATE_PACKAGE_VERSION || manifest.kind !== "hole-template") {
    return { status: "unsupported", errors: ["This hole template package version is not supported."] };
  }
  if (!ID_PATTERN.test(manifest.contentId as string) || !Number.isInteger(manifest.revision) || (manifest.revision as number) < 1) return packageError("Hole template package identity is invalid.");
  if (typeof manifest.title !== "string" || !manifest.title.trim() || manifest.title.length > 160 || typeof manifest.description !== "string" || manifest.description.length > 4096) return packageError("Hole template package title or description is invalid.");
  if (!isRecord(manifest.author) || Object.keys(manifest.author).some((key) => key !== "id" && key !== "displayName") || !ID_PATTERN.test(manifest.author.id as string) || typeof manifest.author.displayName !== "string" || !manifest.author.displayName.trim() || manifest.author.displayName.length > 80) return packageError("Hole template package author is invalid.");
  if (typeof manifest.createdAt !== "string" || typeof manifest.updatedAt !== "string" || Number.isNaN(Date.parse(manifest.createdAt)) || Number.isNaN(Date.parse(manifest.updatedAt)) || typeof manifest.requiredGameVersion !== "string" || !manifest.requiredGameVersion.trim() || !THEMES.has(manifest.theme as LandTheme) || typeof manifest.checksum !== "string" || !/^[a-f0-9]{64}$/.test(manifest.checksum)) return packageError("Hole template package manifest is invalid.");

  const template = validateHoleTemplateV1(payload.template);
  if (!template.ok) return { status: "corrupt", errors: template.issues.map((issue) => `${issue.path}: ${issue.message}`) };
  const value: HoleTemplatePackageV1 = {
    manifest: manifest as unknown as HoleTemplatePackageV1["manifest"],
    payload: { template: template.value },
  };
  const expectedChecksum = await sha256(canonicalPackageJson(packageCore(value)));
  if (value.manifest.checksum !== expectedChecksum) return packageError("Hole template package checksum does not match its contents.");
  return { status: "compatible", value, warnings: [] };
}

export async function createHoleTemplatePackage(input: {
  template: HoleTemplateV1;
  title: string;
  description: string;
  author: { id: string; displayName: string };
  requiredGameVersion: string;
  theme: LandTheme;
  contentId?: string;
  revision?: number;
  createdAt?: Date;
  now?: Date;
}): Promise<HoleTemplatePackageV1> {
  const validated = validateHoleTemplateV1(input.template);
  if (!validated.ok) throw new TypeError(validated.issues.map((issue) => `${issue.path}: ${issue.message}`).join("\n"));
  if (!THEMES.has(input.theme)) throw new Error("Hole template package capture theme is unsupported.");
  const now = input.now ?? new Date();
  const createdAt = input.createdAt ?? now;
  const contentId = input.contentId ?? `hole-${(await sha256(canonicalJson({ author: input.author.id, title: input.title, template: validated.value }))).slice(0, 24)}`;
  const withoutChecksum = {
    manifest: {
      format: HOLE_TEMPLATE_PACKAGE_FORMAT,
      version: HOLE_TEMPLATE_PACKAGE_VERSION,
      kind: "hole-template" as const,
      contentId,
      revision: Math.max(1, Math.floor(input.revision ?? 1)),
      title: input.title.trim(),
      description: input.description.trim(),
      author: { id: input.author.id.trim(), displayName: input.author.displayName.trim() },
      createdAt: createdAt.toISOString(),
      updatedAt: now.toISOString(),
      requiredGameVersion: input.requiredGameVersion.trim(),
      theme: input.theme,
    },
    payload: { template: validated.value },
  };
  return { ...withoutChecksum, manifest: { ...withoutChecksum.manifest, checksum: await sha256(canonicalPackageJson(withoutChecksum)) } };
}

export function holeTemplatePackageText(value: HoleTemplatePackageV1): string {
  return canonicalPackageJson(value);
}

function local(point: Point, bounds: { minX: number; minY: number }): Point {
  return { x: point.x - bounds.minX, y: point.y - bounds.minY };
}

/** Existing source-compatible API; the Library consumes warnings explicitly. */
export function captureHoleTemplate(...args: Parameters<typeof captureHoleTemplateWithWarnings>): HoleTemplateV1 {
  return captureHoleTemplateWithWarnings(...args).template;
}

/** Captures once; warnings are transient player feedback, never package state. */
export function captureHoleTemplateWithWarnings(course: Course, hole: Hole, input: {
  id: string;
  title: string;
  description: string;
  yardsPerTile: number;
  provenance: HoleTemplateV1["provenance"];
  confidence: HoleTemplateV1["confidence"];
}): { template: HoleTemplateV1; warnings: HoleTemplateCaptureWarning[] } {
  if (!hole.tee || !hole.green) throw new Error("A captured hole needs tee and green markers.");
  let provenance = input.provenance;
  if (hole.templateAttribution) {
    const { templateId: _templateId, fidelity: _fidelity, ...inherited } = hole.templateAttribution;
    if (provenancePolicyIssues(inherited).length) throw new Error("Review the original source rights before recapturing a historical imported hole.");
    provenance = inherited as HoleTemplateV1["provenance"];
  }
  const points = [hole.tee, hole.green, ...(hole.waypoints ?? []), ...Object.values(hole.teeBoxes ?? {}).filter((point): point is Point => point != null), ...Object.values(hole.pinPositions ?? {}).filter((point): point is Point => point != null)];
  const routeMinX = Math.min(...points.map((point) => point.x));
  const routeMaxX = Math.max(...points.map((point) => point.x));
  const routeMinY = Math.min(...points.map((point) => point.y));
  const routeMaxY = Math.max(...points.map((point) => point.y));
  // Features do not carry a hole ID. Include only the immediate route
  // envelope (plus a one-tile shoulder) so a nearby authored feature is not
  // silently discarded, while adjacent-hole content remains out of scope.
  const nearRoute = (point: Point) => point.x >= routeMinX - 1 && point.x <= routeMaxX + 1 && point.y >= routeMinY - 1 && point.y <= routeMaxY + 1;
  const obstacles = course.obstacles.filter(nearRoute);
  const decorations = (course.decorations ?? []).filter(nearRoute);
  const featurePoints = [
    ...obstacles,
    ...decorations.flatMap((decoration) => decorationTiles(decoration)),
  ];
  const minX = Math.min(routeMinX, ...featurePoints.map((point) => point.x));
  const maxX = Math.max(routeMaxX, ...featurePoints.map((point) => point.x));
  const minY = Math.min(routeMinY, ...featurePoints.map((point) => point.y));
  const maxY = Math.max(routeMaxY, ...featurePoints.map((point) => point.y));
  const bounds = { minX, minY };
  const surfaces = captureSurfaceIntent(course, { minX, minY, maxX, maxY });
  const inBounds = (point: Point) => point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY;
  const terrainAt = (point: Point): Terrain => course.tiles[point.y * course.width + point.x];
  const heightAt = (point: Point) => course.elevations?.[point.y * course.width + point.x] ?? 0;
  const datum = heightAt(hole.tee);
  const required = new Set(points.map((point) => `${point.x},${point.y}`));
  for (const index of surfaces.requiredCells) required.add(`${index % course.width},${Math.floor(index / course.width)}`);
  const cells: HoleTemplateCellV1[] = [];
  for (let y = minY; y <= maxY; y += 1) for (let x = minX; x <= maxX; x += 1) {
    const point = { x, y };
    const terrain = terrainAt(point);
    // Rough is the implicit placement background. Keep authored terrain,
    // relief, and markers only, so library storage remains sparse.
    const elevationOffset = heightAt(point) - datum;
    if (terrain !== "rough" || elevationOffset !== 0 || required.has(`${x},${y}`)) cells.push({ ...local(point, bounds), terrain, elevationOffset });
  }
  const translatedMarkers = <T extends Record<string, Point | null> | undefined>(markers: T) => markers && Object.fromEntries(Object.entries(markers).map(([key, point]) => [key, point ? local(point, bounds) : null])) as T;
  return { template: {
    format: "coursecraft-hole-template",
    version: 1,
    id: input.id,
    title: input.title,
    description: input.description,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
    yardsPerTile: input.yardsPerTile,
    cells,
    hole: {
      tee: local(hole.tee, bounds), green: local(hole.green, bounds),
      ...(hole.teeBoxes ? { teeBoxes: translatedMarkers(hole.teeBoxes) } : {}),
      ...(hole.pinPositions ? { pinPositions: translatedMarkers(hole.pinPositions) } : {}),
      ...(hole.waypoints ? { waypoints: hole.waypoints.map((point) => local(point, bounds)) } : {}),
      ...(hole.parByTee ? { parByTee: structuredClone(hole.parByTee) } : {}),
      parMode: hole.parMode,
      ...(hole.parManual !== undefined ? { parManual: hole.parManual } : {}),
    },
    obstacles: obstacles.filter(inBounds).map(({ origin: _origin, ...obstacle }) => ({ ...obstacle, ...local(obstacle, bounds) })),
    decorations: decorations.filter(inBounds).map(({ origin: _origin, ...decoration }) => ({ ...decoration, ...local(decoration, bounds) })),
    provenance: structuredClone(provenance),
    confidence: structuredClone(input.confidence),
    fidelity: { tier: "sketch" },
    ...(surfaces.surfaceIntent ? { surfaceIntent: surfaces.surfaceIntent } : {}),
  }, warnings: surfaces.warnings };
}

export type HoleTemplateCaptureWarning = { code: "partial_non_path"; count: number };
export class HoleTemplateCaptureError extends Error {
  readonly code: "partial_path" | "invalid_surface";
  constructor(code: "partial_path" | "invalid_surface", message: string) { super(message); this.code = code; this.name = "HoleTemplateCaptureError"; }
}

function captureSurfaceIntent(course: Course, bounds: { minX: number; minY: number; maxX: number; maxY: number }): {
  surfaceIntent?: HoleTemplateSurfaceIntentV1; requiredCells: Set<number>; warnings: HoleTemplateCaptureWarning[];
} {
  const requiredCells = new Set<number>(), candidates: SurfaceFeature[] = [];
  const raw = course.surfaceIntent;
  if (!raw) return { requiredCells, warnings: [] };
  const limits = HOLE_TEMPLATE_SURFACE_LIMITS;
  function invalid(message: string): never { throw new HoleTemplateCaptureError("invalid_surface", message); }
  if (raw.version !== 1 || !Array.isArray(raw.features) || raw.features.length > limits.features) invalid("This hole's editable surfaces exceed the supported capture limits.");
  let visitedCoverage = 0;
  const insideCell = (index: number) => { const x = index % course.width, y = Math.floor(index / course.width); return x >= bounds.minX && x <= bounds.maxX && y >= bounds.minY && y <= bounds.maxY; };
  for (const feature of raw.features) {
    if (!feature || !Array.isArray(feature.coverage) || feature.coverage.length > course.width * course.height || (visitedCoverage += feature.coverage.length) > limits.coverage) invalid("This hole's editable surfaces exceed the supported capture limits.");
    if (!feature.coverage.every(index => Number.isSafeInteger(index) && index >= 0 && index < course.width * course.height)) invalid("An editable surface has invalid accepted terrain cells.");
    if (feature.coverage.some(insideCell)) candidates.push(feature);
  }
  if (!candidates.length) return { requiredCells, warnings: [] };
  const checked = validateHoleTemplateSurfaceIntent({ version: 1, features: candidates }, course.width, course.height);
  if (!checked.ok) invalid(checked.issues.slice(0, 3).map(item => item.message).join(" "));
  const features: SurfaceFeature[] = []; let partialNonPath = 0;
  const width = bounds.maxX - bounds.minX + 1, height = bounds.maxY - bounds.minY + 1;
  const insidePoint = (p: Point) => p.x >= bounds.minX && p.x <= bounds.maxX + 1 && p.y >= bounds.minY && p.y <= bounds.maxY + 1;
  for (const feature of checked.value.features) {
    const geometry = feature.geometry;
    const points = geometry.kind === "corridor" ? geometry.knots : geometry.ring;
    const allPoints = [...points, ...(geometry.tangents?.flatMap(pair => [pair.in, pair.out]) ?? []), ...(feature.renderRings?.flat() ?? [])];
    if (!feature.coverage.every(insideCell) || !allPoints.every(insidePoint)) {
      if (feature.terrain === "path") throw new HoleTemplateCaptureError("partial_path", "A path extends beyond this hole's captured area. Adjust the path before saving the template.");
      partialNonPath++; continue;
    }
    feature.coverage.forEach(index => requiredCells.add(index));
    const translate = (p: Point) => local(p, bounds);
    features.push({ ...feature,
      coverage: feature.coverage.map(index => (Math.floor(index / course.width) - bounds.minY) * width + index % course.width - bounds.minX).sort((a, b) => a - b),
      geometry: geometry.kind === "corridor"
        ? { ...geometry, knots: geometry.knots.map(translate), ...(geometry.tangents ? { tangents: geometry.tangents.map(pair => ({ in: translate(pair.in), out: translate(pair.out) })) } : {}) }
        : { ...geometry, ring: geometry.ring.map(translate), ...(geometry.tangents ? { tangents: geometry.tangents.map(pair => ({ in: translate(pair.in), out: translate(pair.out) })) } : {}) },
      ...(feature.renderRings ? { renderRings: feature.renderRings.map(ring => ring.map(translate)) } : {}),
    });
  }
  if (features.length && (width > limits.dimension || height > limits.dimension)) invalid("This hole's editable surfaces exceed the supported capture dimensions.");
  return { ...(features.length ? { surfaceIntent: { version: 1 as const, features } } : {}), requiredCells,
    warnings: partialNonPath ? [{ code: "partial_non_path", count: partialNonPath }] : [] };
}
