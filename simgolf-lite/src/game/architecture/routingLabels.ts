import { courseForLayout, layoutById } from "../models/courseLayouts";
import { resolveCourseSetup } from "../models/courseSetup";
import type { Course, Point } from "../models/types";
import type { ArchitectureReviewFilters } from "./review";
import type { ArchitectureRoutingHole } from "./reviewTypes";

const UNUSABLE = new Set(["water", "wetland", "sand", "waste_area"]);

/** Layout order and the shared setup resolver are the only identity authorities. */
export function buildArchitectureRouting(course: Course, filters: Pick<ArchitectureReviewFilters, "courseId" | "teeSet" | "pinRotation" | "routingOrder">): ArchitectureRoutingHole[] {
  const layout = layoutById(course, filters.courseId);
  const draft = filters.routingOrder === "draft" || (!filters.routingOrder && !layout?.publishedHoleIds.length);
  const view = courseForLayout(course, filters.courseId, draft);
  const requestedTee = filters.teeSet === "all" ? "member" : filters.teeSet;
  const requestedPin = filters.pinRotation === "all" ? course.activePinRotation ?? "A" : filters.pinRotation;
  const valid = (p: Point | null): p is Point => !!p && Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.y >= 0 && p.x < course.width && p.y < course.height;
  return view.holes.map((hole, index) => {
    const setup = resolveCourseSetup(hole, requestedTee, requestedPin);
    const tee = valid(setup.tee) ? { ...setup.tee } : null;
    const pin = valid(setup.pin) ? { ...setup.pin } : null;
    // Authored waypoints describe a corridor spine. Never use a reference or
    // solver target here, and never feed these points back to simulation.
    const spine = tee && pin ? [tee, ...(hole.waypoints ?? []).filter(valid).slice(0, 32).map(p => ({ ...p })), pin] : [];
    const midpoint = spine.length ? routeMidpoint(spine) : tee ?? pin ?? { x: course.width / 2, y: course.height / 2 };
    const anchor = nearestUsableAnchor(course, midpoint);
    return {
      holeId: hole.id!, number: index + 1, name: hole.name ?? hole.id!, tee, pin,
      teeSet: setup.teeSet, pinRotation: setup.pinRotation,
      usedTeeFallback: setup.usedTeeFallback, usedPinFallback: setup.usedPinFallback,
      spine, anchor,
      status: tee && pin ? "complete" : tee ? "missing-green" : pin ? "missing-tee" : "missing-both",
    };
  });
}

const draftReviewCache = new WeakMap<Course, Course>();

/** Existing analysis consumers resolve published IDs internally. Project the
 * chosen draft order into a cached, isolated review view; nothing is published
 * or written back to the authoritative estate. */
export function courseForRoutingReview(course: Course, filters: Pick<ArchitectureReviewFilters, "kind" | "courseId" | "routingOrder">): Course {
  const layout = layoutById(course, filters.courseId);
  const draft = filters.kind === "routing" && (filters.routingOrder === "draft" || (!filters.routingOrder && !layout?.publishedHoleIds.length));
  const view = courseForLayout(course, filters.courseId, draft);
  if (!draft) return view;
  const cached = draftReviewCache.get(view);
  if (cached) return cached;
  const selectedLayout = layoutById(view, view.activeCourseId)!;
  const result = { ...view, layouts: [{ ...selectedLayout, publishedHoleIds: selectedLayout.draftHoleIds }] };
  draftReviewCache.set(view, result);
  return result;
}

export function routeMidpoint(points: readonly Point[]): Point {
  const lengths = points.slice(1).map((p, i) => Math.hypot(p.x - points[i].x, p.y - points[i].y));
  let remaining = lengths.reduce((sum, length) => sum + length, 0) / 2;
  for (let i = 0; i < lengths.length; i++) {
    if (remaining <= lengths[i]) {
      const ratio = lengths[i] ? remaining / lengths[i] : 0;
      return { x: points[i].x + (points[i + 1].x - points[i].x) * ratio, y: points[i].y + (points[i + 1].y - points[i].y) * ratio };
    }
    remaining -= lengths[i];
  }
  return { ...points[0] };
}

function nearestUsableAnchor(course: Course, midpoint: Point): Point {
  const x = Math.max(0, Math.min(course.width - 1, Math.round(midpoint.x)));
  const y = Math.max(0, Math.min(course.height - 1, Math.round(midpoint.y)));
  let best: Point = { x, y };
  let bestScore = Infinity;
  for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
    const p = { x: x + dx, y: y + dy };
    if (p.x < 0 || p.y < 0 || p.x >= course.width || p.y >= course.height) continue;
    const terrain = course.tiles[p.y * course.width + p.x];
    if (UNUSABLE.has(terrain)) continue;
    const score = Math.hypot(p.x - midpoint.x, p.y - midpoint.y) + (terrain === "fairway" || terrain === "tee" || terrain === "green" ? 0 : 3);
    if (score < bestScore) { best = p; bestScore = score; }
  }
  return best;
}

export interface RoutingLabelRect { x: number; y: number; width: number; height: number }
export interface RoutingLabelRequest { id: string; center: Point; width: number; height: number }
export interface RoutingLabelPlacement extends RoutingLabelRequest { placed: Point; fits: boolean }

// Preserve the original ring/index order and floating-point operation order.
const ROUTING_LABEL_RING_OFFSETS: readonly Point[] = (() => {
  const offsets: Point[] = [];
  for (let ring = 0; ring <= 12; ring++) {
    const count = ring === 0 ? 1 : 12;
    for (let index = 0; index < count; index++) {
      const angle = index * Math.PI * 2 / count;
      offsets.push({ x: Math.cos(angle) * ring * 18, y: Math.sin(angle) * ring * 18 });
    }
  }
  return offsets;
})();

/** Bounded, deterministic screen-space packing, independent of camera rotation. */
export function placeRoutingLabels(requests: readonly RoutingLabelRequest[], viewport: RoutingLabelRect, reserved: readonly RoutingLabelRect[], legal: (p: Point) => boolean = () => true): RoutingLabelPlacement[] {
  const occupied = [...reserved];
  const overlaps = (a: RoutingLabelRect, b: RoutingLabelRect) => a.x < b.x + b.width + 3 && a.x + a.width + 3 > b.x && a.y < b.y + b.height + 3 && a.y + a.height + 3 > b.y;
  return requests.map(request => {
    let placed = request.center;
    let fits = false;
    const accept = (p: Point) => {
      const box = { x: p.x - request.width / 2, y: p.y - request.height / 2, width: request.width, height: request.height };
      if (box.x < viewport.x + 5 || box.y < viewport.y + 5 || box.x + box.width > viewport.x + viewport.width - 5 || box.y + box.height > viewport.y + viewport.height - 5 || !legal(p) || occupied.some(other => overlaps(box, other))) return false;
      placed = p; fits = true; occupied.push(box); return true;
    };
    for (const offset of ROUTING_LABEL_RING_OFFSETS) {
      const p = { x: request.center.x + offset.x, y: request.center.y + offset.y };
      if (accept(p)) break;
    }
    // A large overlay panel can cover an endpoint farther than the local
    // midpoint search radius. Try its nearest edges without hiding a marker
    // underneath UI; leader lines still identify the true endpoint.
    for (const panel of reserved) {
      if (fits) break;
      const seeds = [
        { x: panel.x - request.width / 2 - 6, y: request.center.y },
        { x: panel.x + panel.width + request.width / 2 + 6, y: request.center.y },
        { x: request.center.x, y: panel.y - request.height / 2 - 6 },
        { x: request.center.x, y: panel.y + panel.height + request.height / 2 + 6 },
      ].sort((a, b) => Math.hypot(a.x - request.center.x, a.y - request.center.y) - Math.hypot(b.x - request.center.x, b.y - request.center.y));
      for (const seed of seeds) {
        if (fits) break;
        for (let offset = 0; offset <= 12 && !fits; offset++) for (const direction of offset === 0 ? [0] : [-1, 1]) {
          const vertical = seed.x !== request.center.x;
          if (accept({ x: seed.x + (vertical ? 0 : offset * 18 * direction), y: seed.y + (vertical ? offset * 18 * direction : 0) })) break;
        }
      }
    }
    return { ...request, placed, fits };
  });
}
