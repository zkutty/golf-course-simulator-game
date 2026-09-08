import { getPinPosition, getTeeBox } from "../models/courseSetup";
import { normalizeCourseLayouts } from "../models/courseLayouts";
import type { Course, Hole } from "../models/types";
import {
  buildHoleIllustrationPreview,
  type HoleIllustrationEvidenceScope,
  type HoleIllustrationPreview,
  type HoleIllustrationPreviewSettings,
} from "./preview";

export const HOLE_ILLUSTRATION_EXPORT_VERSION = 1 as const;
export const HOLE_ILLUSTRATION_EXPORT_LIMITS = Object.freeze({
  maxSvgBytes: 32 * 1024 * 1024,
  maxRasterPixels: 16_777_216,
  maxPngBytes: 24 * 1024 * 1024,
  maxDataUrlCharacters: 32 * 1024 * 1024,
});

export type HoleIllustrationExportKind = "single" | "atlas";

export interface HoleIllustrationExportMetadata {
  readonly schema: "coursecraft-hole-illustration";
  readonly version: typeof HOLE_ILLUSTRATION_EXPORT_VERSION;
  readonly kind: HoleIllustrationExportKind;
  readonly width: number;
  readonly height: number;
  readonly courseName: string;
  readonly layoutId: string;
  readonly layoutName: string;
  readonly holeId?: string;
  readonly holeName?: string;
  readonly tee: HoleIllustrationPreviewSettings["teeSet"];
  readonly pin: HoleIllustrationPreviewSettings["pinRotation"];
  readonly frame: HoleIllustrationPreviewSettings["frame"];
  readonly biome: HoleIllustrationPreviewSettings["biome"];
  readonly season: HoleIllustrationPreviewSettings["season"];
  readonly contrast: HoleIllustrationPreviewSettings["contrast"];
  readonly snapshotHashes: readonly string[];
  readonly planHashes: readonly string[];
  readonly publishedHoleCount: number;
}

export interface HoleIllustrationExportArtifact {
  readonly complete: true;
  readonly kind: HoleIllustrationExportKind;
  readonly width: number;
  readonly height: number;
  readonly viewBox: string;
  readonly fileStem: string;
  readonly svg: string;
  readonly metadata: HoleIllustrationExportMetadata;
}

export interface HoleIllustrationExportFailureItem {
  readonly index?: number;
  readonly holeId?: string;
  readonly message: string;
}

export interface HoleIllustrationExportFailure {
  readonly complete: false;
  readonly code: "INVALID_LAYOUT" | "INVALID_ROUTE" | "INCOMPLETE_HOLE" | "OUTPUT_LIMIT";
  readonly message: string;
  readonly failures: readonly HoleIllustrationExportFailureItem[];
}

export type HoleIllustrationExportResult = HoleIllustrationExportArtifact | HoleIllustrationExportFailure;

const encoder = new TextEncoder();

function failure(code: HoleIllustrationExportFailure["code"], message: string, failures: readonly HoleIllustrationExportFailureItem[] = []): HoleIllustrationExportFailure {
  return { complete: false, code, message, failures };
}

export function safeIllustrationText(value: unknown, maximum = 96): string {
  if (typeof value !== "string") return "";
  const printable = [...value].map((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127 ? " " : character;
  }).join("");
  const clean = [...printable.replace(/\s+/g, " ").trim()];
  return clean.length <= maximum ? clean.join("") : `${clean.slice(0, Math.max(1, maximum - 1)).join("")}…`;
}

function xml(value: unknown): string {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function safeFileStem(value: string): string {
  return value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 72) || "coursecraft-illustration";
}

function metadataSvg(metadata: HoleIllustrationExportMetadata): string {
  return `<metadata id="coursecraft-export">${xml(JSON.stringify(metadata))}</metadata>`;
}

function accessibleSvgMarkup(metadata: HoleIllustrationExportMetadata): { attributes: string; children: string } {
  const fallback = "CourseCraft hole illustration";
  const subject = metadata.kind === "single"
    ? safeIllustrationText(metadata.holeName, 64) || "Hole illustration"
    : `${metadata.publishedHoleCount}-hole published atlas`;
  const context = safeIllustrationText(metadata.layoutName, 64) || safeIllustrationText(metadata.courseName, 64) || fallback;
  const identity = safeFileStem(`${metadata.kind}-${metadata.snapshotHashes[0]?.slice(0, 12) ?? "export"}-${metadata.layoutId}-${metadata.holeId ?? metadata.publishedHoleCount}`);
  const titleId = `coursecraft-${identity}-title`;
  const descriptionId = `coursecraft-${identity}-description`;
  const title = `${subject} — ${context}`;
  const description = `${metadata.tee} tee, Pin ${metadata.pin}, ${metadata.frame}, ${metadata.biome}, ${metadata.season}, ${metadata.contrast}.`;
  return {
    attributes: `role="img" aria-labelledby="${titleId} ${descriptionId}"`,
    children: `<title id="${titleId}">${xml(title)}</title><desc id="${descriptionId}">${xml(description)}</desc>`,
  };
}

function namespaceNestedSvgIds(svg: string, panelIndex: number): string {
  const replacements = new Map<string, string>();
  let ordinal = 0;
  let result = svg.replace(/\bid="([^"]+)"/g, (_match, id: string) => {
    const replacement = `coursecraft-atlas-panel-${panelIndex}-${++ordinal}-${id.replace(/[^A-Za-z0-9_.:-]/g, "-")}`;
    if (!replacements.has(id)) replacements.set(id, replacement);
    return `id="${replacement}"`;
  });
  const replacementFor = (id: string) => replacements.get(id) ?? id;
  result = result.replace(/url\(#([^)]+)\)/g, (_match, id: string) => `url(#${replacementFor(id)})`);
  result = result.replace(/\b(href|xlink:href)="#([^"]+)"/g, (_match, attribute: string, id: string) => `${attribute}="#${replacementFor(id)}"`);
  result = result.replace(/\b(aria-labelledby|aria-describedby)="([^"]+)"/g, (_match, attribute: string, ids: string) => `${attribute}="${ids.split(/\s+/).map(replacementFor).join(" ")}"`);
  return result;
}

function svgInner(svg: string): string | null {
  const open = svg.indexOf(">");
  const close = svg.lastIndexOf("</svg>");
  return svg.startsWith("<svg ") && open > 0 && close > open ? svg.slice(open + 1, close) : null;
}

function singleSvg(preview: HoleIllustrationPreview, metadata: HoleIllustrationExportMetadata): string | null {
  if (!preview.svg) return null;
  const root = /^<svg\s+([^>]+)>/.exec(preview.svg);
  if (!root) return null;
  const attributes = root[1]
    .replace(/\swidth="[^"]*"/, "")
    .replace(/\sheight="[^"]*"/, "")
    .replace(/\sviewBox="[^"]*"/, "")
    .replace(/\srole="[^"]*"/, "")
    .replace(/\saria-labelledby="[^"]*"/, "");
  const accessible = accessibleSvgMarkup(metadata);
  const replacement = `<svg ${attributes} width="3840" height="2560" viewBox="0 0 960 640" data-coursecraft-export-version="1" data-export-kind="single" ${accessible.attributes}>${accessible.children}${metadataSvg(metadata)}`;
  return preview.svg.replace(root[0], replacement);
}

function metadataFor(
  kind: HoleIllustrationExportKind,
  dimensions: { width: number; height: number },
  course: Course,
  layout: { id: string; name: string; publishedHoleIds: readonly string[] },
  settings: HoleIllustrationPreviewSettings,
  previews: readonly HoleIllustrationPreview[],
): HoleIllustrationExportMetadata {
  const selected = kind === "single" ? previews[0]?.metadata : undefined;
  return {
    schema: "coursecraft-hole-illustration",
    version: HOLE_ILLUSTRATION_EXPORT_VERSION,
    kind,
    width: dimensions.width,
    height: dimensions.height,
    courseName: safeIllustrationText(course.name),
    layoutId: safeIllustrationText(layout.id),
    layoutName: safeIllustrationText(layout.name),
    ...(kind === "single" ? { holeId: safeIllustrationText(settings.holeId), holeName: safeIllustrationText(selected?.holeName) } : {}),
    tee: settings.teeSet,
    pin: settings.pinRotation,
    frame: settings.frame,
    biome: settings.biome,
    season: settings.season,
    contrast: settings.contrast,
    snapshotHashes: previews.flatMap((preview) => preview.metadata?.snapshotHash ? [preview.metadata.snapshotHash] : []),
    planHashes: previews.flatMap((preview) => preview.metadata?.planHash ? [preview.metadata.planHash] : []),
    publishedHoleCount: layout.publishedHoleIds.length,
  };
}

function routeMap(course: Course, holes: readonly Hole[], settings: HoleIllustrationPreviewSettings, x: number, y: number, width: number, height: number): string {
  const scale = Math.min(width / Math.max(1, course.width), height / Math.max(1, course.height));
  const offsetX = x + (width - course.width * scale) / 2;
  const offsetY = y + (height - course.height * scale) / 2;
  const point = (value: { x: number; y: number }) => `${(offsetX + value.x * scale).toFixed(2)},${(offsetY + value.y * scale).toFixed(2)}`;
  const routes = holes.map((hole, index) => {
    const tee = getTeeBox(hole, settings.teeSet);
    const pin = getPinPosition(hole, settings.pinRotation);
    if (!tee || !pin) return "";
    return `<polyline points="${[tee, ...(hole.waypoints ?? []), pin].map(point).join(" ")}" fill="none" stroke="#355f49" stroke-width="4"/><circle cx="${point(tee).split(",")[0]}" cy="${point(tee).split(",")[1]}" r="6" fill="#fff" stroke="#234633"/><text x="${(offsetX + tee.x * scale + 8).toFixed(2)}" y="${(offsetY + tee.y * scale - 8).toFixed(2)}" font-size="18" font-family="Arial,sans-serif" fill="#17231d">${index + 1}</text>`;
  }).join("");
  return `<g data-course-map="true"><rect x="${x}" y="${y}" width="${width}" height="${height}" rx="12" fill="#dce9d8" stroke="#71917c"/>${routes}</g>`;
}

function atlasSvg(
  course: Course,
  layout: { id: string; name: string; publishedHoleIds: readonly string[] },
  holes: readonly Hole[],
  settings: HoleIllustrationPreviewSettings,
  previews: readonly HoleIllustrationPreview[],
  includeMap: boolean,
  metadata: HoleIllustrationExportMetadata,
): string | null {
  const count = previews.length;
  const width = count === 18 ? 2400 : 3000;
  const height = count === 18 ? 3900 : 2500;
  const margin = 48;
  const gap = 24;
  const header = 360;
  const columns = 3;
  const rows = count / columns;
  const cardWidth = (width - margin * 2 - gap * (columns - 1)) / columns;
  const rowHeight = (height - header - margin - gap * (rows - 1)) / rows;
  const titleHeight = 44;
  const imageHeight = Math.min(rowHeight - titleHeight, cardWidth * 2 / 3);
  const title = safeIllustrationText(layout.name || course.name, 28);
  const map = includeMap ? routeMap(course, holes, settings, width - margin - 520, 56, 520, 240) : "";
  const panels: string[] = [];
  for (let index = 0; index < previews.length; index++) {
    const previewInner = previews[index].svg ? svgInner(previews[index].svg!) : null;
    const inner = previewInner ? namespaceNestedSvgIds(previewInner, index + 1) : null;
    if (!inner) return null;
    const column = index % columns;
    const row = Math.floor(index / columns);
    const left = margin + column * (cardWidth + gap);
    const top = header + row * (rowHeight + gap);
    const holeName = safeIllustrationText(previews[index].metadata?.holeName ?? holes[index]?.name ?? holes[index]?.id, 26);
    panels.push(`<g data-atlas-index="${index + 1}" data-hole-id="${xml(holes[index]?.id ?? "")}"><rect x="${left}" y="${top}" width="${cardWidth}" height="${titleHeight + imageHeight}" rx="10" fill="#fffdf6" stroke="#71917c"/><text x="${left + 12}" y="${top + 30}" font-size="24" font-weight="700" font-family="Arial,sans-serif" fill="#17231d">${index + 1}. ${xml(holeName)}</text><svg x="${left}" y="${top + titleHeight}" width="${cardWidth}" height="${imageHeight}" viewBox="0 0 960 640" preserveAspectRatio="xMidYMid meet">${inner}</svg></g>`);
  }
  const accessible = accessibleSvgMarkup(metadata);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" data-coursecraft-export-version="1" data-export-kind="atlas" ${accessible.attributes}>${accessible.children}${metadataSvg(metadata)}<rect width="${width}" height="${height}" fill="#f4ead3"/><g data-cover-title-band="true"><rect width="${width}" height="336" fill="#e6d8b8"/><text x="${margin}" y="96" font-size="58" font-weight="700" font-family="Arial,sans-serif" fill="#17231d">${xml(title)}</text><text x="${margin}" y="152" font-size="28" font-family="Arial,sans-serif" fill="#26362d">${count}-hole published atlas · ${settings.teeSet} tee · Pin ${settings.pinRotation} · ${settings.frame}</text><g data-legend="true" font-family="Arial,sans-serif" font-size="23" fill="#26362d"><circle cx="${margin + 10}" cy="220" r="10" fill="#ffffff" stroke="#234633"/><text x="${margin + 30}" y="228">Tee</text><circle cx="${margin + 130}" cy="220" r="10" fill="#d00000"/><text x="${margin + 150}" y="228">Pin</text><rect x="${margin}" y="254" width="28" height="18" fill="#71a85b"/><text x="${margin + 38}" y="271">Playing surface, hazards, contours and details follow the selected preview style.</text></g>${map}</g>${panels.join("")}</svg>`;
}

export function holeIllustrationSvgWithinLimit(svg: string, maximum = HOLE_ILLUSTRATION_EXPORT_LIMITS.maxSvgBytes): boolean {
  return Number.isSafeInteger(maximum) && maximum >= 0 && encoder.encode(svg).byteLength <= maximum;
}

export function buildHoleIllustrationExport(
  course: Course,
  settings: HoleIllustrationPreviewSettings,
  evidence: HoleIllustrationEvidenceScope,
  request: { kind: HoleIllustrationExportKind; includeMap?: boolean },
): HoleIllustrationExportResult {
  const originalLayout = course.layouts?.find((layout) => layout.id === settings.layoutId);
  if (request.kind === "atlas" && originalLayout) {
    const firstIndex = new Map<string, number>();
    const duplicates = originalLayout.publishedHoleIds.flatMap((holeId, index) => {
      const previous = firstIndex.get(holeId);
      if (previous !== undefined) return [{ index: index + 1, holeId, message: `This hole duplicates published route position ${previous + 1}.` }];
      firstIndex.set(holeId, index);
      return [];
    });
    if (duplicates.length) {
      return failure("INVALID_ROUTE", "The published route contains duplicate hole IDs; no atlas was exported.", duplicates);
    }
    const identityCounts = new Map<string, number>();
    for (const hole of course.holes) if (hole.id) identityCounts.set(hole.id, (identityCounts.get(hole.id) ?? 0) + 1);
    const invalidIdentities = originalLayout.publishedHoleIds.flatMap((holeId, index) => {
      const count = identityCounts.get(holeId) ?? 0;
      return count === 1 ? [] : [{ index: index + 1, holeId, message: count === 0 ? "The routed hole ID does not exist in this estate." : "The routed hole ID is duplicated in this estate." }];
    });
    if (invalidIdentities.length) return failure("INVALID_ROUTE", "The published route has missing or ambiguous hole identities; no atlas was exported.", invalidIdentities);
  }
  const normalized = normalizeCourseLayouts(course);
  const layout = normalized.layouts?.find((candidate) => candidate.id === settings.layoutId);
  if (!layout) return failure("INVALID_LAYOUT", "The selected course layout no longer exists.");
  if (request.kind === "single") {
    const preview = buildHoleIllustrationPreview(normalized, settings, evidence);
    if (!preview.complete || !preview.svg || !preview.metadata) {
      return failure("INCOMPLETE_HOLE", "The selected hole could not be rendered; no file was exported.", [{ holeId: settings.holeId, message: preview.message ?? "The preview is incomplete." }]);
    }
    const dimensions = { width: 3840, height: 2560 };
    const metadata = metadataFor("single", dimensions, normalized, layout, settings, [preview]);
    const svg = singleSvg(preview, metadata);
    if (!svg || !holeIllustrationSvgWithinLimit(svg)) return failure("OUTPUT_LIMIT", "The single-hole SVG exceeds the supported output limit.");
    return { complete: true, kind: "single", ...dimensions, viewBox: "0 0 960 640", fileStem: `${safeFileStem(layout.name)}-${safeFileStem(preview.metadata.holeName)}-${settings.teeSet}-${settings.pinRotation}`, svg, metadata };
  }
  if (layout.publishedHoleIds.length !== 9 && layout.publishedHoleIds.length !== 18) {
    return failure("INVALID_ROUTE", `The selected published route has ${layout.publishedHoleIds.length} holes; an atlas requires exactly 9 or 18.`);
  }
  const holesById = new Map(normalized.holes.flatMap((hole) => hole.id ? [[hole.id, hole] as const] : []));
  const holes = layout.publishedHoleIds.map((holeId) => holesById.get(holeId));
  const missing = holes.flatMap((hole, index) => hole ? [] : [{ index: index + 1, holeId: layout.publishedHoleIds[index], message: "The routed hole does not exist." }]);
  if (missing.length) return failure("INVALID_ROUTE", "The published route is incomplete; no atlas was exported.", missing);
  const atlasSettings = { ...settings, routeSource: "published" as const, showShotLine: false, showLandingDistances: false };
  const previews = holes.map((hole) => buildHoleIllustrationPreview(normalized, { ...atlasSettings, holeId: hole!.id! }, { ...evidence, status: "empty" }));
  const incomplete = previews.flatMap((preview, index) => preview.complete && preview.svg && preview.metadata ? [] : [{ index: index + 1, holeId: holes[index]!.id, message: preview.message ?? "The hole preview is incomplete." }]);
  if (incomplete.length) return failure("INCOMPLETE_HOLE", "One or more published holes could not be rendered; no atlas was exported.", incomplete);
  const dimensions = previews.length === 18 ? { width: 2400, height: 3900 } : { width: 3000, height: 2500 };
  if (dimensions.width * dimensions.height > HOLE_ILLUSTRATION_EXPORT_LIMITS.maxRasterPixels) return failure("OUTPUT_LIMIT", "The atlas exceeds the supported pixel limit.");
  const metadata = metadataFor("atlas", dimensions, normalized, layout, atlasSettings, previews);
  const svg = atlasSvg(normalized, layout, holes as Hole[], atlasSettings, previews, request.includeMap === true, metadata);
  if (!svg || !holeIllustrationSvgWithinLimit(svg)) return failure("OUTPUT_LIMIT", "The atlas SVG exceeds the supported output limit.");
  return { complete: true, kind: "atlas", ...dimensions, viewBox: `0 0 ${dimensions.width} ${dimensions.height}`, fileStem: `${safeFileStem(layout.name)}-${previews.length}-hole-atlas-${settings.teeSet}-${settings.pinRotation}`, svg, metadata };
}
