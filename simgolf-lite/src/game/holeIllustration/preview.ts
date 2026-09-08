import { BIOME_KEYS, type LandTheme } from "../models/biomes";
import type { Course, PinRotation, TeeSet } from "../models/types";
import { normalizeCourseLayouts } from "../models/courseLayouts";
import { buildArchitectureReferencePlan, type ArchitectureReferencePlan } from "../architecture/referencePlan";
import { SEASONS, type SeasonName } from "../seasons/types";
import { createHoleIllustrationRenderPlan, type HoleIllustrationFrameMode, type HoleIllustrationRenderSettings } from "./renderPlan";
import { renderHoleIllustrationSvg } from "./renderer";
import { createHoleIllustrationSnapshot } from "./snapshot";
import { HOLE_ILLUSTRATION_CONTRASTS, type HoleIllustrationContrast } from "./style";
import type { HoleIllustrationRouteSource } from "./types";
import type { HoleIllustrationSnapshot } from "./types";

export type HoleIllustrationEvidenceStatus = "ready" | "stale-only" | "sparse" | "empty";
export interface HoleIllustrationEvidenceScope { readonly status: HoleIllustrationEvidenceStatus; readonly layoutId: string; readonly holeId: string; readonly teeSet: string; readonly pinRotation: string; }

export interface HoleIllustrationPreviewSettings {
  readonly layoutId: string;
  readonly routeSource: HoleIllustrationRouteSource;
  readonly holeId: string;
  readonly teeSet: TeeSet;
  readonly pinRotation: PinRotation;
  readonly frame: HoleIllustrationFrameMode;
  readonly biome: LandTheme;
  readonly season: SeasonName;
  readonly contrast: HoleIllustrationContrast;
  readonly showContours: boolean;
  readonly showVegetation: boolean;
  readonly showHazards: boolean;
  readonly showShotLine: boolean;
  readonly showLabels: boolean;
  readonly showLandingDistances: boolean;
}

export interface HoleIllustrationPreview {
  readonly complete: boolean;
  readonly message?: string;
  readonly svg?: string;
  readonly metadata?: {
    readonly holeNumber: number;
    readonly holeName: string;
    readonly tee: TeeSet;
    readonly pin: PinRotation;
    readonly par: 3 | 4 | 5;
    readonly yardage: number;
    readonly routeSource: HoleIllustrationRouteSource;
    readonly snapshotHash: string;
    readonly planHash: string;
  };
  /** Values come only from the exact selected M69 reference-plan segments. */
  readonly landings: readonly { readonly name: string; readonly yards: number }[];
  readonly annotationsAvailable: boolean;
  readonly warning?: string;
}

export const HOLE_ILLUSTRATION_PREVIEW_DEFAULTS = Object.freeze({
  frame: "north-up" as const,
  biome: BIOME_KEYS[0],
  season: SEASONS[1],
  contrast: HOLE_ILLUSTRATION_CONTRASTS[0],
  showContours: true,
  showVegetation: true,
  showHazards: true,
  showShotLine: true,
  showLabels: true,
  showLandingDistances: false,
});

export function defaultHoleIllustrationPreviewSettings(course: Course): HoleIllustrationPreviewSettings | null {
  const normalized = normalizeCourseLayouts(course);
  const normalizedLayouts = normalized.layouts ?? [];
  const layout = normalizedLayouts.find((item) => item.id === normalized.activeCourseId) ?? normalizedLayouts[0];
  const holeId = layout?.publishedHoleIds[0] ?? layout?.draftHoleIds[0];
  if (!layout || !holeId) return null;
  return { layoutId: layout.id, routeSource: layout.publishedHoleIds.includes(holeId) ? "published" : "draft", holeId, teeSet: "member", pinRotation: "A", ...HOLE_ILLUSTRATION_PREVIEW_DEFAULTS };
}

function presentationSvg(svg: string, plan: Pick<ArchitectureReferencePlan, "segments" | "landingZones">, snapshot: HoleIllustrationSnapshot, settings: HoleIllustrationPreviewSettings, annotationsAvailable: boolean): string {
  const width = 960, height = 640, padding = .06;
  const frame = settings.frame === "north-up" ? snapshot.framing.northUp : snapshot.framing.teeToGreen;
  const scale = Math.min(width * (1 - padding * 2) / frame.crop.width, height * (1 - padding * 2) / frame.crop.height);
  const offsetX = (width - frame.crop.width * scale) / 2, offsetY = (height - frame.crop.height * scale) / 2;
  const point = (source: { x: number; y: number }) => {
    const dx = source.x - frame.originCourse.x, dy = source.y - frame.originCourse.y;
    const x = frame.mode === "north-up" ? source.x + frame.translation.x : frame.matrix.a * dx + frame.matrix.c * dy + frame.translation.x;
    const y = frame.mode === "north-up" ? source.y + frame.translation.y : frame.matrix.b * dx + frame.matrix.d * dy + frame.translation.y;
    return { x: Math.max(0, Math.min(width, offsetX + x * scale)), y: Math.max(0, Math.min(height, offsetY + y * scale)) };
  };
  const hidden = [!settings.showContours && '[data-layer="elevation-contours"]', !settings.showVegetation && '[data-layer="vegetation-obstacles"]', !settings.showVegetation && '[data-layer="surroundings"]', !settings.showHazards && '[data-semantic="terrain:sand"]', !settings.showHazards && '[data-semantic="terrain:waste_area"]', !settings.showHazards && '[data-semantic="terrain:water"]', !settings.showHazards && '[data-semantic="terrain:wetland"]', '[data-layer="route"]'].filter(Boolean).join(",");
  const segmentSvg = annotationsAvailable && settings.showShotLine ? plan.segments.map((segment) => { const a = point(segment.from), b = point(segment.to); return `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="#9b273b" stroke-width="4" data-m69-segment="true"/>`; }).join("") : "";
  const landingSvg = annotationsAvailable ? plan.landingZones.map((landing, index) => { const p = point(landing.center); const yards = Math.round(plan.segments[index]?.playsLikeYards ?? 0); return `<circle cx="${p.x}" cy="${p.y}" r="${Math.max(8, landing.radiusTiles * scale)}" fill="#f5c842" fill-opacity=".35" stroke="#775d00" data-m69-landing="${index + 1}"/>${settings.showLandingDistances ? `<text x="${p.x + 10}" y="${p.y - 10}" font-size="22" font-weight="700" fill="#17231d" stroke="#fff" stroke-width="4" paint-order="stroke">${yards} yd shot</text>` : ""}`; }).join("") : "";
  const labels = settings.showLabels ? `<rect x="6" y="6" width="330" height="58" rx="5" fill="#ffffff" fill-opacity=".85"/><text x="14" y="29" font-size="22" font-weight="700" fill="#17231d">Hole ${snapshot.route.order + 1} · Par ${snapshot.par} · ${snapshot.yardage} yd</text><text x="14" y="54" font-size="19" fill="#17231d">${snapshot.selection.teeSet} tee · Pin ${snapshot.selection.pinRotation}</text>` : "";
  return svg.replace("</svg>", `<style>${hidden ? `${hidden}{display:none}` : ""}</style><g data-layer="m69-reference">${segmentSvg}${landingSvg}${labels}</g></svg>`);
}

/** Composes released snapshot, render-plan, and renderer contracts without mutating course or save state. */
export function buildHoleIllustrationPreview(course: Course, settings: HoleIllustrationPreviewSettings, evidence: HoleIllustrationEvidenceScope): HoleIllustrationPreview {
  const normalized = normalizeCourseLayouts(course);
  const snapshotResult = createHoleIllustrationSnapshot(normalized, {
    layoutId: settings.layoutId,
    routeSource: settings.routeSource,
    holeId: settings.holeId,
    teeSet: settings.teeSet,
    pinRotation: settings.pinRotation,
  });
  if (!snapshotResult.complete) return { complete: false, message: snapshotResult.message, landings: [], annotationsAvailable: false };
  const planResult = createHoleIllustrationRenderPlan(snapshotResult.snapshot, {
    frame: settings.frame, biome: settings.biome, season: settings.season, contrast: settings.contrast,
    viewport: { width: 960, height: 640, padding: 0.06 },
  } satisfies HoleIllustrationRenderSettings);
  if (!planResult.complete) return { complete: false, message: planResult.message, landings: [], annotationsAvailable: false };
  const svgResult = renderHoleIllustrationSvg(planResult.plan);
  if (!svgResult.complete) return { complete: false, message: svgResult.message, landings: [], annotationsAvailable: false };
  const selectedHole = normalized.holes.find((hole) => hole.id === settings.holeId);
  const referencePlan = selectedHole ? buildArchitectureReferencePlan(normalized, selectedHole, settings.teeSet, settings.pinRotation) : null;
  const annotationsAvailable = evidence.status === "ready" && evidence.layoutId === settings.layoutId && evidence.holeId === settings.holeId && evidence.teeSet === settings.teeSet && evidence.pinRotation === settings.pinRotation && referencePlan?.status === "complete";
  const warning = annotationsAvailable ? undefined : "Architecture Review evidence or the selected M69 reference plan is incomplete; route and landing annotations are disabled.";
  const snapshot = snapshotResult.snapshot;
  return {
    complete: true,
    svg: presentationSvg(svgResult.svg, referencePlan ?? { segments: [], landingZones: [] }, snapshot, settings, annotationsAvailable),
    metadata: {
      holeNumber: snapshot.route.order + 1,
      holeName: selectedHole?.name ?? snapshot.route.holeId,
      tee: snapshot.selection.teeSet,
      pin: snapshot.selection.pinRotation,
      par: snapshot.par,
      yardage: snapshot.yardage,
      routeSource: snapshot.route.source,
      snapshotHash: snapshot.hash,
      planHash: planResult.plan.hash,
    },
    landings: annotationsAvailable && settings.showLandingDistances ? referencePlan!.landingZones.map((_, index) => ({ name: `Landing ${index + 1}`, yards: Math.round(referencePlan!.segments[index]?.playsLikeYards ?? 0) })) : [],
    annotationsAvailable,
    warning,
  };
}
