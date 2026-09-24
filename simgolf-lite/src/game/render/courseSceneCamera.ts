import { resolveCourseSetup } from "../models/courseSetup";
import type { Course, PinRotation, Point, TeeSet } from "../models/types";
import type {
  CourseSceneCompositionPlanV1,
  CourseSceneHoleEnvelopeV1,
  SceneGridBoundsV1,
} from "./courseSceneComposition";
import { worldToIso, type IsoRotation } from "./iso";

export const COURSE_SCENE_CAMERA_MIN_ZOOM = 0.15;
export const COURSE_SCENE_CAMERA_MAX_ZOOM = 8;
export const COURSE_SCENE_CAMERA_NORMAL_MARGIN = 0.98;
export const COURSE_SCENE_CAMERA_OVERVIEW_MARGIN = 0.95;
/** Minimum screen clearance for semantic markers around a normal hole frame. */
export const COURSE_SCENE_CAMERA_SEMANTIC_CLEARANCE_PX = 18;

const PLAYABLE_MARGIN_TILES = 1;
const HABITAT_RELEVANCE_TILES = 5;

export interface CourseSceneCameraInput {
  readonly course: Course;
  readonly composition: CourseSceneCompositionPlanV1;
  readonly activeHoleIndex: number;
  readonly teeSet?: TeeSet;
  readonly pinRotation?: PinRotation;
  readonly viewport: { readonly width: number; readonly height: number };
  readonly rotation: IsoRotation;
  readonly mode: "normal" | "overview";
}

export interface CourseSceneCameraFrame {
  readonly mode: "normal" | "overview";
  readonly source: "active-hole" | "fallback-overview" | "overview";
  readonly center: Point;
  readonly zoom: number;
  readonly bounds: SceneGridBoundsV1;
  readonly holeId: string | null;
  readonly route: readonly Point[];
  readonly habitatZoneIds: readonly string[];
  readonly visiblePoints: readonly Point[];
}

function validBounds(bounds: SceneGridBoundsV1): boolean {
  return [bounds.minX, bounds.minY, bounds.maxX, bounds.maxY].every(Number.isFinite)
    && bounds.minX <= bounds.maxX && bounds.minY <= bounds.maxY;
}

function courseBounds(course: Course): SceneGridBoundsV1 {
  return {
    minX: 0,
    minY: 0,
    maxX: Math.max(0, course.width - 1),
    maxY: Math.max(0, course.height - 1),
  };
}

function overviewBounds(course: Course, composition: CourseSceneCompositionPlanV1): SceneGridBoundsV1 {
  return validBounds(composition.sceneBounds) ? { ...composition.sceneBounds } : courseBounds(course);
}

function projectedFitZoom(
  bounds: SceneGridBoundsV1,
  viewport: CourseSceneCameraInput["viewport"],
  rotation: IsoRotation,
  margin: number,
  clearancePx = 0,
): number {
  const corners = [
    worldToIso(bounds.minX, bounds.minY, 0, rotation),
    worldToIso(bounds.maxX + 1, bounds.minY, 0, rotation),
    worldToIso(bounds.maxX + 1, bounds.maxY + 1, 0, rotation),
    worldToIso(bounds.minX, bounds.maxY + 1, 0, rotation),
  ];
  const width = Math.max(...corners.map((point) => point.x)) - Math.min(...corners.map((point) => point.x));
  const height = Math.max(...corners.map((point) => point.y)) - Math.min(...corners.map((point) => point.y));
  if (width <= 0 || height <= 0 || viewport.width <= 0 || viewport.height <= 0) return 1;
  const fitted = Math.min(
    Math.max(0, viewport.width * margin - 2 * clearancePx) / width,
    Math.max(0, viewport.height * margin - 2 * clearancePx) / height,
  );
  return Math.max(COURSE_SCENE_CAMERA_MIN_ZOOM, Math.min(COURSE_SCENE_CAMERA_MAX_ZOOM, fitted));
}

function frameForBounds(
  mode: CourseSceneCameraFrame["mode"],
  source: CourseSceneCameraFrame["source"],
  bounds: SceneGridBoundsV1,
  input: CourseSceneCameraInput,
  details: Pick<CourseSceneCameraFrame, "holeId" | "route" | "habitatZoneIds" | "visiblePoints">,
): CourseSceneCameraFrame {
  return {
    mode,
    source,
    center: {
      x: (bounds.minX + bounds.maxX + 1) / 2,
      y: (bounds.minY + bounds.maxY + 1) / 2,
    },
    zoom: projectedFitZoom(
      bounds,
      input.viewport,
      input.rotation,
      mode === "overview" ? COURSE_SCENE_CAMERA_OVERVIEW_MARGIN : COURSE_SCENE_CAMERA_NORMAL_MARGIN,
      mode === "overview" ? 0 : COURSE_SCENE_CAMERA_SEMANTIC_CLEARANCE_PX,
    ),
    bounds: { ...bounds },
    holeId: details.holeId,
    route: details.route.map((point) => ({ ...point })),
    habitatZoneIds: [...details.habitatZoneIds],
    visiblePoints: details.visiblePoints.map((point) => ({ ...point })),
  };
}

function fallbackOverview(input: CourseSceneCameraInput): CourseSceneCameraFrame {
  return frameForBounds(input.mode, input.mode === "overview" ? "overview" : "fallback-overview",
    overviewBounds(input.course, input.composition), input, {
      holeId: null,
      route: [],
      habitatZoneIds: [],
      visiblePoints: [],
    });
}

function stableHoleIds(course: Course): readonly string[] {
  const counts = new Map<string, number>();
  const used = new Set<string>();
  return course.holes.map((hole, index) => {
    const sourceId = hole.id?.trim() || `hole-${index + 1}`;
    let occurrence = (counts.get(sourceId) ?? 0) + 1;
    let candidate = occurrence === 1 ? sourceId : `${sourceId}@${occurrence}`;
    while (used.has(candidate)) {
      occurrence += 1;
      candidate = `${sourceId}@${occurrence}`;
    }
    counts.set(sourceId, occurrence);
    used.add(candidate);
    return candidate;
  });
}

function intersectsEnvelope(point: Point, envelope: CourseSceneHoleEnvelopeV1): boolean {
  return point.x >= envelope.bounds.minX && point.x <= envelope.bounds.maxX
    && point.y >= envelope.bounds.minY && point.y <= envelope.bounds.maxY;
}

function boundedPoints(
  course: Course,
  points: readonly Point[],
  padding: number,
): SceneGridBoundsV1 | null {
  if (points.length === 0 || course.width <= 0 || course.height <= 0) return null;
  return {
    minX: Math.max(0, Math.floor(Math.min(...points.map((point) => point.x)) - padding)),
    minY: Math.max(0, Math.floor(Math.min(...points.map((point) => point.y)) - padding)),
    maxX: Math.min(course.width - 1, Math.ceil(Math.max(...points.map((point) => point.x)) + padding)),
    maxY: Math.min(course.height - 1, Math.ceil(Math.max(...points.map((point) => point.y)) + padding)),
  };
}

function unionBounds(left: SceneGridBoundsV1, right: SceneGridBoundsV1): SceneGridBoundsV1 {
  return {
    minX: Math.min(left.minX, right.minX),
    minY: Math.min(left.minY, right.minY),
    maxX: Math.max(left.maxX, right.maxX),
    maxY: Math.max(left.maxY, right.maxY),
  };
}

/**
 * Pure scene-aware camera policy. Normal mode frames one authoritative setup
 * plus only habitat owned by its accepted scene envelope; overview mode keeps
 * the complete estate fit used by Architect and the explicit Fit command.
 */
export function deriveCourseSceneCamera(input: CourseSceneCameraInput): CourseSceneCameraFrame {
  if (input.mode === "overview") return fallbackOverview(input);
  if (!Number.isInteger(input.activeHoleIndex)
    || input.activeHoleIndex < 0
    || input.activeHoleIndex >= input.course.holes.length) return fallbackOverview(input);

  const hole = input.course.holes[input.activeHoleIndex];
  const setup = resolveCourseSetup(hole, input.teeSet ?? "member", input.pinRotation ?? input.course.activePinRotation ?? "A");
  if (!setup.tee || !setup.pin) return fallbackOverview(input);

  const holeId = stableHoleIds(input.course)[input.activeHoleIndex];
  const envelope = input.composition.holeEnvelopes.find((candidate) => candidate.holeId === holeId);
  if (!envelope) return fallbackOverview(input);

  const route = [setup.tee, ...(hole.waypoints ?? []), setup.pin].map((point) => ({ ...point }));
  let bounds = boundedPoints(input.course, route, PLAYABLE_MARGIN_TILES);
  if (!bounds) return fallbackOverview(input);
  const habitatWindow = boundedPoints(input.course, route, HABITAT_RELEVANCE_TILES);

  const landmarks = input.composition.landmarks
    .filter((landmark) => landmark.holeId === holeId && landmark.kind === "strategic_hazard")
    .map((landmark) => ({ ...landmark.point }));
  const relevantZones = input.composition.habitatZones.map((zone) => ({
    zone,
    occupancy: zone.occupancy.filter((point) => intersectsEnvelope(point, envelope)
      && habitatWindow != null
      && point.x >= habitatWindow.minX && point.x <= habitatWindow.maxX
      && point.y >= habitatWindow.minY && point.y <= habitatWindow.maxY),
  })).filter((entry) => entry.occupancy.length > 0);
  const habitatPoints = relevantZones.flatMap((entry) => entry.occupancy.map((point) => ({ ...point })));
  const landmarkBounds = boundedPoints(input.course, landmarks, 0);
  const habitatBounds = boundedPoints(input.course, habitatPoints, 0);
  if (landmarkBounds) bounds = unionBounds(bounds, landmarkBounds);
  if (habitatBounds) bounds = unionBounds(bounds, habitatBounds);

  const visiblePoints = [...route, ...landmarks, ...habitatPoints];
  return frameForBounds("normal", "active-hole", bounds, input, {
    holeId,
    route,
    habitatZoneIds: relevantZones.map(({ zone }) => zone.id),
    visiblePoints,
  });
}
