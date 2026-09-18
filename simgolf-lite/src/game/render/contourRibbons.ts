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

/**
 * A conventional offset can form large mitres/bulbs at concave tile corners.
 * These seams are presentation cues, not a second surface outline, so clamp
 * every vertex by its neighbouring edge lengths and a small global envelope.
 * When a tight corner cannot accommodate the complete band, the band tapers
 * there instead of folding across the water/sand interior.
 */
function safeOffsetAt(
  points: readonly SurfacePoint[],
  index: number,
  offset: number,
  envelope: number,
  closed: boolean,
): number {
  const previous = points[closed ? (index - 1 + points.length) % points.length : Math.max(0, index - 1)];
  const current = points[index];
  const next = points[closed ? (index + 1) % points.length : Math.min(points.length - 1, index + 1)];
  const nearby = Math.min(
    Math.hypot(current.x - previous.x, current.y - previous.y) || Infinity,
    Math.hypot(next.x - current.x, next.y - current.y) || Infinity,
  );
  // A quarter of the shortest neighbouring segment leaves room for a bevel on
  // either side; the absolute ceiling keeps long concave shore runs quiet.
  const limit = Math.min(0.24, nearby * 0.22);
  // Apply one local scale to both sides of the band. That lets narrow bands
  // taper at a tight corner while retaining a real outer→inner interval.
  return offset * Math.min(1, limit / Math.max(1e-7, envelope));
}

function offsetContour(points: readonly SurfacePoint[], offset: number, envelope = Math.abs(offset)): SurfacePoint[] {
  const closed = isClosed(points);
  const source = normalizedContour(points);
  if (source.length < 2) return [];
  const offsetPoints = source.map((point, index) => {
    const normal = normalAt(source, index, closed);
    const safeOffset = safeOffsetAt(source, index, offset, envelope, closed);
    return { x: point.x + normal.x * safeOffset, y: point.y + normal.y * safeOffset };
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
  return profile.bands.map((band) => {
    const outerOffset = band.offset;
    const innerOffset = band.offset + band.width;
    const envelope = Math.max(Math.abs(outerOffset), Math.abs(innerOffset));
    return {
      owner: profile.owner,
      other: profile.other,
      band,
      outer: offsetContour(points, outerOffset, envelope),
      inner: offsetContour(points, innerOffset, envelope),
      details: detailsAlongContour(points, {
        motif: band.detail,
        profile: options.profile,
        spacingScale: band.detailSpacing,
      }),
    };
  }).filter((ribbon) => ribbon.outer.length >= 2 && ribbon.inner.length === ribbon.outer.length);
}
