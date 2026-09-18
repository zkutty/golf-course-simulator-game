import type { ColorVisionMode } from "../onboarding/profile";
import type { LandTheme, SurfacePoint, Terrain } from "../models/types";
import {
  contourProfileFor,
  detailsAlongContour,
  type ContourBand,
  type ContourDetail,
  type DetailProfile,
} from "./materialFields";

export interface SignedContourRibbon {
  readonly owner: Terrain;
  readonly other: Terrain;
  readonly band: ContourBand;
  /** The world-space boundary of the band closest to the outside terrain. */
  readonly outer: readonly SurfacePoint[];
  /** The world-space boundary of the band closest to the owning material. */
  readonly inner: readonly SurfacePoint[];
  readonly details: readonly ContourDetail[];
}

function isClosed(points: readonly SurfacePoint[]): boolean {
  if (points.length < 3) return false;
  const first = points[0];
  const last = points[points.length - 1];
  return Math.abs(first.x - last.x) <= 1e-7 && Math.abs(first.y - last.y) <= 1e-7;
}

function normalizedContour(points: readonly SurfacePoint[]): SurfacePoint[] {
  const closed = isClosed(points);
  const source = closed ? points.slice(0, -1) : points;
  return source.map((point) => ({ x: point.x, y: point.y }));
}

function normalAt(points: readonly SurfacePoint[], index: number, closed: boolean): SurfacePoint {
  const previous = points[closed ? (index - 1 + points.length) % points.length : Math.max(0, index - 1)];
  const next = points[closed ? (index + 1) % points.length : Math.min(points.length - 1, index + 1)];
  const dx = next.x - previous.x;
  const dy = next.y - previous.y;
  const length = Math.max(1e-7, Math.hypot(dx, dy));
  // Component contours are clockwise in y-down world space. This is the
  // inward normal, matching ContourBand's negative-outside convention.
  return { x: -dy / length, y: dx / length };
}

function offsetContour(points: readonly SurfacePoint[], offset: number): SurfacePoint[] {
  const closed = isClosed(points);
  const source = normalizedContour(points);
  if (source.length < 2) return [];
  const offsetPoints = source.map((point, index) => {
    const normal = normalAt(source, index, closed);
    return { x: point.x + normal.x * offset, y: point.y + normal.y * offset };
  });
  if (closed) offsetPoints.push({ ...offsetPoints[0] });
  return offsetPoints;
}

/**
 * Returns the complete pair-owned transition stack for one already-split
 * component boundary run. The owner guard is intentional: callers may feed
 * every component its own runs, but only the material declared by the shared
 * terrain contract can receive a ribbon. Geometry is world-space and has no
 * persistence or picking side effects.
 */
export function buildSignedContourRibbons(
  owner: Terrain,
  other: Terrain | null,
  points: readonly SurfacePoint[],
  options: {
    theme: LandTheme;
    colorVision: ColorVisionMode;
    profile: DetailProfile;
  },
): SignedContourRibbon[] {
  if (other == null || points.length < 2) return [];
  const profile = contourProfileFor(owner, other, options);
  if (!profile || profile.owner !== owner) return [];
  return profile.bands.map((band) => ({
    owner: profile.owner,
    other: profile.other,
    band,
    outer: offsetContour(points, band.offset),
    inner: offsetContour(points, band.offset + band.width),
    details: detailsAlongContour(points, {
      motif: band.detail,
      profile: options.profile,
    }),
  })).filter((ribbon) => ribbon.outer.length >= 2 && ribbon.inner.length === ribbon.outer.length);
}
