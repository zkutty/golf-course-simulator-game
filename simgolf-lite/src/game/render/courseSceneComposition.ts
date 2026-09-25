import highAtlasJson from "../../assets/terrain/parkland-habitat-4x/high/habitat-atlas.json";
import { hashCanonicalValue } from "../../utils/canonical";
import { buildingTiles } from "../models/buildings";
import { PIN_ROTATIONS, TEE_SETS } from "../models/types";
import type { Building, Course, Hole, Obstacle, Point, Terrain } from "../models/types";
import {
  resolveHabitatFieldTopology,
  type HabitatFieldDiagnostic,
  type HabitatFieldPlacement,
  type HabitatFieldTopologyRequest,
  type HabitatFieldTopologyResult,
  type HabitatGridBounds,
  type HabitatTileCoordinate,
  type ParklandHabitatAtlasCatalog,
  type ParklandHabitatFamily,
} from "./habitatFieldTopology";
import { m19AuthoredHabitatSource, type M19AuthoredHabitatPatchV1 } from "./m19AuthoredHabitatSource";

export const COURSE_SCENE_COMPOSITION_VERSION = 1 as const;
export const COURSE_SCENE_COMPOSITION_SEMANTICS = "course-scene-composition-v1" as const;
export const COURSE_SCENE_INTER_ZONE_GAP_CELLS = 1 as const;

const HIGH_ATLAS = highAtlasJson as unknown as ParklandHabitatAtlasCatalog;
const CARDINALS = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
] as const;
const MAINTAINED_TERRAINS: ReadonlySet<Terrain> = new Set([
  "fairway", "green", "tee", "path", "sand", "waste_area",
]);
const HABITAT_TERRAINS: ReadonlySet<Terrain> = new Set(["rough", "deep_rough"]);
const STRATEGIC_HAZARD_TERRAINS: ReadonlySet<Terrain> = new Set([
  "water", "wetland", "sand", "waste_area",
]);

export interface SceneGridBoundsV1 {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export interface SceneExclusionOwnerV1 {
  readonly id: string;
  readonly source: "maintained-terrain" | "routed-corridor" | "authored-marker" | "obstacle" | "building";
  readonly radius: number;
  readonly sourcePoints: readonly Point[];
  readonly sourcePolylines?: readonly (readonly Point[])[];
  readonly cells: readonly number[];
}

export interface SceneExclusionGeometryV1 {
  readonly radius: number;
  readonly metric: "chebyshev";
  readonly cells: readonly number[];
  readonly owners: readonly SceneExclusionOwnerV1[];
}

export interface CourseSceneMarkerV1 {
  readonly id: string;
  readonly kind: "tee" | "pin" | "flag";
  readonly point: Point;
}

export interface CourseSceneHoleEnvelopeV1 {
  readonly id: string;
  readonly holeId: string;
  readonly bounds: SceneGridBoundsV1;
  readonly route: readonly Point[];
  readonly markers: readonly CourseSceneMarkerV1[];
}

export interface CourseSceneLandmarkV1 {
  readonly id: string;
  readonly holeId: string;
  readonly kind: "active_tee" | "active_green" | "strategic_hazard";
  readonly point: Point;
  readonly evidence?: "terrain" | "obstacle";
}

export interface HabitatZoneEvidenceV1 {
  readonly kind: "tree_grove" | "rock" | "deep_rough_margin" | "wet_shore" | "authored_habitat_source";
  readonly ownerId: string;
  readonly sourcePoints: readonly Point[];
  readonly rule: string;
}

export interface CourseSceneHabitatZoneV1 {
  readonly id: string;
  readonly ownerId: string;
  readonly family: ParklandHabitatFamily;
  readonly evidence: HabitatZoneEvidenceV1;
  readonly bounds: HabitatGridBounds;
  readonly area: number;
  readonly occupancy: readonly HabitatTileCoordinate[];
  /** Exact transactional T1 result: one entry for every occupied cell. */
  readonly placements: readonly HabitatFieldPlacement[];
}

export interface HabitatCandidateRejectionV1 {
  readonly candidateId: string;
  readonly family: ParklandHabitatFamily;
  readonly evidenceOwnerId: string;
  readonly diagnostics: readonly HabitatFieldDiagnostic[];
}

export interface CourseSceneCompositionPlanV1 {
  readonly version: typeof COURSE_SCENE_COMPOSITION_VERSION;
  readonly semantics: typeof COURSE_SCENE_COMPOSITION_SEMANTICS;
  readonly semanticSeed: number;
  readonly sceneBounds: SceneGridBoundsV1;
  readonly courseHash: string;
  readonly obstacleHash: string;
  readonly holeEnvelopes: readonly CourseSceneHoleEnvelopeV1[];
  readonly landmarks: readonly CourseSceneLandmarkV1[];
  readonly exclusions: {
    readonly maintainedTerrain: SceneExclusionGeometryV1;
    readonly routedCorridor: SceneExclusionGeometryV1;
    readonly authoredMarkers: SceneExclusionGeometryV1;
    readonly obstacles: SceneExclusionGeometryV1;
    readonly buildings: SceneExclusionGeometryV1;
    readonly dynamicSuppression: {
      readonly golfers: { readonly radius: 2; readonly metric: "chebyshev"; readonly policy: "suppress-at-render" };
      readonly activeEditorPreview: { readonly radius: 2; readonly metric: "chebyshev"; readonly policy: "suppress-at-render" };
    };
    readonly interZoneGapCells: typeof COURSE_SCENE_INTER_ZONE_GAP_CELLS;
    readonly interZoneGapMetric: "chebyshev";
    readonly adjacentTreeGrovePolicy: "merge-same-family-before-topology";
    readonly vegetationGroundPolicy: "visual-underlay-beneath-source-trees-and-bushes";
    readonly treeAuthority: "existing-obstacles-only";
  };
  readonly habitatZones: readonly CourseSceneHabitatZoneV1[];
  readonly rejectedCandidates: readonly HabitatCandidateRejectionV1[];
}

export interface CourseSceneCompositionInput {
  readonly course: Course;
  readonly seed: number;
  /** Test/integration seam. Production uses the checked-in high atlas. */
  readonly atlas?: ParklandHabitatAtlasCatalog;
  /** Test/integration seam. Production calls the accepted T1 resolver directly. */
  readonly topologyResolver?: (request: HabitatFieldTopologyRequest) => HabitatFieldTopologyResult;
}

interface EvidenceLabel {
  readonly family: ParklandHabitatFamily;
  readonly evidence: HabitatZoneEvidenceV1;
}

interface HabitatCandidate {
  readonly id: string;
  readonly family: ParklandHabitatFamily;
  readonly evidence: HabitatZoneEvidenceV1;
  readonly bounds: HabitatGridBounds;
  readonly occupied: readonly HabitatTileCoordinate[];
}

interface StableHole {
  readonly hole: Hole;
  readonly index: number;
  readonly id: string;
}

function pointKey(point: Point): string {
  return `${point.x},${point.y}`;
}

function cell(course: Course, x: number, y: number): number {
  return y * course.width + x;
}

function pointFor(course: Course, value: number): Point {
  return { x: value % course.width, y: Math.floor(value / course.width) };
}

function inside(course: Course, point: Point): boolean {
  return Number.isInteger(point.x) && Number.isInteger(point.y)
    && point.x >= 0 && point.y >= 0 && point.x < course.width && point.y < course.height;
}

function comparePoints(left: Point, right: Point): number {
  return left.y - right.y || left.x - right.x;
}

function uniquePoints(points: readonly (Point | null | undefined)[]): Point[] {
  return [...new Map(points.filter((point): point is Point => point != null && Number.isFinite(point.x) && Number.isFinite(point.y))
    .map((point) => [pointKey(point), { x: point.x, y: point.y }])).values()].sort(comparePoints);
}

function stableHoles(holes: readonly Hole[]): readonly StableHole[] {
  const counts = new Map<string, number>();
  const used = new Set<string>();
  return holes.map((hole, index) => {
    const sourceId = hole.id?.trim() || `hole-${index + 1}`;
    let occurrence = (counts.get(sourceId) ?? 0) + 1;
    let candidate = occurrence === 1 ? sourceId : `${sourceId}@${occurrence}`;
    while (used.has(candidate)) {
      occurrence += 1;
      candidate = `${sourceId}@${occurrence}`;
    }
    counts.set(sourceId, occurrence);
    used.add(candidate);
    return { hole, index, id: candidate };
  });
}

function authoredMarkers(stable: StableHole): readonly CourseSceneMarkerV1[] {
  const teeEntries = TEE_SETS.map((set) => ({
    id: `tee:${set}`,
    kind: "tee" as const,
    point: stable.hole.teeBoxes?.[set],
  }));
  const pinEntries = PIN_ROTATIONS.map((rotation) => ({
    id: `pin:${rotation}`,
    kind: "pin" as const,
    point: stable.hole.pinPositions?.[rotation],
  }));
  const entries: { id: string; kind: CourseSceneMarkerV1["kind"]; point: Point | null | undefined }[] = [
    ...teeEntries,
    ...pinEntries,
  ];
  const authoredTeeKeys = new Set(teeEntries.filter((entry) => entry.point).map((entry) => pointKey(entry.point as Point)));
  const authoredPinKeys = new Set(pinEntries.filter((entry) => entry.point).map((entry) => pointKey(entry.point as Point)));
  if (stable.hole.tee && !authoredTeeKeys.has(pointKey(stable.hole.tee))) {
    entries.push({ id: "tee:legacy", kind: "tee", point: stable.hole.tee });
  }
  if (stable.hole.green && !authoredPinKeys.has(pointKey(stable.hole.green))) {
    entries.push({ id: "flag:legacy", kind: "flag", point: stable.hole.green });
  }
  return entries.filter((entry): entry is typeof entry & { point: Point } => Boolean(entry.point))
    .map((entry) => ({ id: `${stable.id}:${entry.id}`, kind: entry.kind, point: { ...entry.point } }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function routeVariants(stable: StableHole): readonly (readonly Point[])[] {
  const tees = uniquePoints([
    ...TEE_SETS.map((set) => stable.hole.teeBoxes?.[set]),
    stable.hole.tee,
  ]);
  const pins = uniquePoints([
    ...PIN_ROTATIONS.map((rotation) => stable.hole.pinPositions?.[rotation]),
    stable.hole.green,
  ]);
  const routes: Point[][] = [];
  for (const tee of tees) for (const pin of pins) {
    routes.push([{ ...tee }, ...(stable.hole.waypoints ?? []).map((point) => ({ ...point })), { ...pin }]);
  }
  return routes.sort((left, right) => left.map(pointKey).join(";").localeCompare(right.map(pointKey).join(";")));
}

function boundsFor(course: Course, points: readonly Point[], padding = 0): SceneGridBoundsV1 {
  if (points.length === 0) return { minX: 0, minY: 0, maxX: Math.max(0, course.width - 1), maxY: Math.max(0, course.height - 1) };
  return {
    minX: Math.max(0, Math.min(...points.map((point) => point.x)) - padding),
    minY: Math.max(0, Math.min(...points.map((point) => point.y)) - padding),
    maxX: Math.min(course.width - 1, Math.max(...points.map((point) => point.x)) + padding),
    maxY: Math.min(course.height - 1, Math.max(...points.map((point) => point.y)) + padding),
  };
}

function diskCells(course: Course, points: readonly Point[], radius: number): readonly number[] {
  const output = new Set<number>();
  for (const point of points) for (let dy = -radius; dy <= radius; dy += 1) for (let dx = -radius; dx <= radius; dx += 1) {
    const candidate = { x: point.x + dx, y: point.y + dy };
    if (inside(course, candidate)) output.add(cell(course, candidate.x, candidate.y));
  }
  return [...output].sort((left, right) => left - right);
}

function rasterizeSegment(left: Point, right: Point): readonly Point[] {
  const steps = Math.max(Math.abs(right.x - left.x), Math.abs(right.y - left.y), 1);
  return Array.from({ length: steps + 1 }, (_, index) => ({
    x: Math.round(left.x + (right.x - left.x) * index / steps),
    y: Math.round(left.y + (right.y - left.y) * index / steps),
  }));
}

function rasterizePolyline(route: readonly Point[]): readonly Point[] {
  return uniquePoints(route.slice(1).flatMap((right, index) => rasterizeSegment(route[index], right)));
}

function exclusionGeometry(owners: readonly SceneExclusionOwnerV1[], radius: number): SceneExclusionGeometryV1 {
  const cells = new Set<number>();
  for (const owner of owners) for (const value of owner.cells) cells.add(value);
  return { radius, metric: "chebyshev", cells: [...cells].sort((left, right) => left - right), owners };
}

function connectedTerrainOwners(course: Course): readonly SceneExclusionOwnerV1[] {
  const remaining = new Set<number>();
  for (let value = 0; value < course.tiles.length; value += 1) {
    if (MAINTAINED_TERRAINS.has(course.tiles[value])) remaining.add(value);
  }
  const owners: SceneExclusionOwnerV1[] = [];
  while (remaining.size > 0) {
    const first = Math.min(...remaining);
    remaining.delete(first);
    const queue = [first];
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const point = pointFor(course, queue[cursor]);
      for (const offset of CARDINALS) {
        const neighbor = { x: point.x + offset.x, y: point.y + offset.y };
        if (!inside(course, neighbor)) continue;
        const neighborCell = cell(course, neighbor.x, neighbor.y);
        if (!remaining.has(neighborCell)) continue;
        remaining.delete(neighborCell);
        queue.push(neighborCell);
      }
    }
    const sourcePoints = queue.map((value) => pointFor(course, value)).sort(comparePoints);
    owners.push({
      id: `maintained:${first}`,
      source: "maintained-terrain",
      radius: 2,
      sourcePoints,
      cells: diskCells(course, sourcePoints, 2),
    });
  }
  return owners;
}

function canonicalObstacleEntries(obstacles: readonly Obstacle[]): readonly Obstacle[] {
  return obstacles.map((obstacle) => ({ ...obstacle })).sort((left, right) => left.y - right.y
    || left.x - right.x || left.type.localeCompare(right.type)
    || String(left.plantId ?? "").localeCompare(String(right.plantId ?? ""))
    || String(left.origin ?? "").localeCompare(String(right.origin ?? "")));
}

function obstacleOwners(course: Course): readonly SceneExclusionOwnerV1[] {
  const occurrences = new Map<string, number>();
  return canonicalObstacleEntries(course.obstacles).map((obstacle) => {
    const base = `obstacle:${obstacle.type}:${obstacle.x},${obstacle.y}:${obstacle.plantId ?? "-"}:${obstacle.origin ?? "-"}`;
    const count = (occurrences.get(base) ?? 0) + 1;
    occurrences.set(base, count);
    const point = { x: obstacle.x, y: obstacle.y };
    return {
      id: count === 1 ? base : `${base}@${count}`,
      source: "obstacle" as const,
      radius: 2,
      sourcePoints: [point],
      cells: diskCells(course, [point], 2),
    };
  });
}

function canonicalBuildings(buildings: readonly Building[]): readonly Building[] {
  return buildings.map((building) => ({ ...building })).sort((left, right) => left.y - right.y
    || left.x - right.x || left.type.localeCompare(right.type) || String(left.id ?? "").localeCompare(String(right.id ?? "")));
}

function buildingOwners(course: Course): readonly SceneExclusionOwnerV1[] {
  const occurrences = new Map<string, number>();
  return canonicalBuildings(course.buildings ?? []).map((building) => {
    const base = `building:${building.id ?? building.type}:${building.x},${building.y}`;
    const count = (occurrences.get(base) ?? 0) + 1;
    occurrences.set(base, count);
    const points = buildingTiles(building).map((point) => ({ ...point })).sort(comparePoints);
    return {
      id: count === 1 ? base : `${base}@${count}`,
      source: "building" as const,
      radius: 2,
      sourcePoints: points,
      cells: diskCells(course, points, 2),
    };
  });
}

function markerOwners(course: Course, holes: readonly StableHole[]): readonly SceneExclusionOwnerV1[] {
  return holes.map((stable) => {
    const points = uniquePoints(authoredMarkers(stable).map((marker) => marker.point));
    return {
      id: `markers:${stable.id}`,
      source: "authored-marker" as const,
      radius: 3,
      sourcePoints: points,
      cells: diskCells(course, points, 3),
    };
  }).filter((owner) => owner.sourcePoints.length > 0);
}

function routeOwners(course: Course, holes: readonly StableHole[]): readonly SceneExclusionOwnerV1[] {
  return holes.map((stable) => {
    const polylines = routeVariants(stable);
    const points = uniquePoints(polylines.flatMap(rasterizePolyline));
    return {
      id: `route:${stable.id}`,
      source: "routed-corridor" as const,
      radius: 2,
      sourcePoints: points,
      sourcePolylines: polylines,
      cells: diskCells(course, points, 2),
    };
  }).filter((owner) => owner.sourcePoints.length > 0);
}

function squaredDistanceToSegment(point: Point, left: Point, right: Point): number {
  const dx = right.x - left.x;
  const dy = right.y - left.y;
  const denominator = dx * dx + dy * dy;
  const t = denominator === 0 ? 0 : Math.max(0, Math.min(1,
    ((point.x - left.x) * dx + (point.y - left.y) * dy) / denominator));
  const offsetX = point.x - (left.x + t * dx);
  const offsetY = point.y - (left.y + t * dy);
  return offsetX * offsetX + offsetY * offsetY;
}

function distanceToRoute(point: Point, route: readonly Point[]): number {
  if (route.length < 2) return Number.POSITIVE_INFINITY;
  return Math.min(...route.slice(1).map((right, index) => squaredDistanceToSegment(point, route[index], right)));
}

function strategicHazard(course: Course, envelope: SceneGridBoundsV1, route: readonly Point[]): { point: Point; evidence: "terrain" | "obstacle" } | null {
  const candidates: { point: Point; evidence: "terrain" | "obstacle" }[] = [];
  for (let y = envelope.minY; y <= envelope.maxY; y += 1) for (let x = envelope.minX; x <= envelope.maxX; x += 1) {
    if (STRATEGIC_HAZARD_TERRAINS.has(course.tiles[cell(course, x, y)])) candidates.push({ point: { x, y }, evidence: "terrain" });
  }
  for (const obstacle of course.obstacles) {
    if (obstacle.x < envelope.minX || obstacle.x > envelope.maxX || obstacle.y < envelope.minY || obstacle.y > envelope.maxY) continue;
    candidates.push({ point: { x: obstacle.x, y: obstacle.y }, evidence: "obstacle" });
  }
  return candidates.sort((left, right) => distanceToRoute(left.point, route) - distanceToRoute(right.point, route)
    || (left.evidence === right.evidence ? 0 : left.evidence === "terrain" ? -1 : 1)
    || comparePoints(left.point, right.point))[0] ?? null;
}

function holeComposition(course: Course, holes: readonly StableHole[]): {
  readonly envelopes: readonly CourseSceneHoleEnvelopeV1[];
  readonly landmarks: readonly CourseSceneLandmarkV1[];
} {
  const envelopes: CourseSceneHoleEnvelopeV1[] = [];
  const landmarks: CourseSceneLandmarkV1[] = [];
  for (const stable of holes) {
    const { hole } = stable;
    if (!hole.tee || !hole.green) continue;
    const route = [{ ...hole.tee }, ...(hole.waypoints ?? []).map((point) => ({ ...point })), { ...hole.green }];
    const markers = authoredMarkers(stable);
    const bounds = boundsFor(course, [...route, ...markers.map((marker) => marker.point)], 4);
    envelopes.push({ id: `hole-envelope:${stable.id}`, holeId: stable.id, bounds, route, markers });
    landmarks.push(
      { id: `landmark:${stable.id}:active-tee`, holeId: stable.id, kind: "active_tee", point: { ...hole.tee } },
      { id: `landmark:${stable.id}:active-green`, holeId: stable.id, kind: "active_green", point: { ...hole.green } },
    );
    const hazard = strategicHazard(course, bounds, route);
    if (hazard) landmarks.push({
      id: `landmark:${stable.id}:strategic-hazard`,
      holeId: stable.id,
      kind: "strategic_hazard",
      point: hazard.point,
      evidence: hazard.evidence,
    });
  }
  return {
    envelopes: envelopes.sort((left, right) => left.id.localeCompare(right.id)),
    landmarks: landmarks.sort((left, right) => left.id.localeCompare(right.id)),
  };
}

function cardinalComponents(course: Course, source: ReadonlySet<number>): readonly (readonly number[])[] {
  const remaining = new Set(source);
  const components: number[][] = [];
  while (remaining.size > 0) {
    const first = Math.min(...remaining);
    remaining.delete(first);
    const queue = [first];
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const point = pointFor(course, queue[cursor]);
      for (const offset of CARDINALS) {
        const next = { x: point.x + offset.x, y: point.y + offset.y };
        if (!inside(course, next)) continue;
        const value = cell(course, next.x, next.y);
        if (!remaining.delete(value)) continue;
        queue.push(value);
      }
    }
    components.push(queue.sort((left, right) => left - right));
  }
  return components.sort((left, right) => left[0] - right[0]);
}

function treeGroveEvidence(course: Course): readonly { points: readonly Point[]; label: EvidenceLabel }[] {
  const trees = canonicalObstacleEntries(course.obstacles)
    .filter((obstacle) => obstacle.type === "tree" && inside(course, obstacle));
  const remaining = new Set(trees.map((_, index) => index));
  const groups: Point[][] = [];
  while (remaining.size > 0) {
    const first = Math.min(...remaining);
    remaining.delete(first);
    const members = [first];
    for (let cursor = 0; cursor < members.length; cursor += 1) {
      const source = trees[members[cursor]];
      for (const candidate of [...remaining]) {
        const target = trees[candidate];
        if (Math.max(Math.abs(source.x - target.x), Math.abs(source.y - target.y)) > 4) continue;
        remaining.delete(candidate);
        members.push(candidate);
      }
    }
    if (members.length >= 2) groups.push(members.map((index) => ({ x: trees[index].x, y: trees[index].y })).sort(comparePoints));
  }
  return groups.map((points) => {
    // Five-source groves and 2x2-or-denser cores own woodland floor. Smaller
    // source clusters own understory edge. This is world geometry, never view
    // angle, obstacle input order, or a hand-authored course coordinate.
    const pointSet = new Set(points.map(pointKey));
    const denseCore = points.some((point) => pointSet.has(`${point.x + 1},${point.y}`)
      && pointSet.has(`${point.x},${point.y + 1}`) && pointSet.has(`${point.x + 1},${point.y + 1}`));
    const family: ParklandHabitatFamily = points.length >= 5 || denseCore ? "woodland_floor" : "understory_edge";
    const ownerId = `tree-grove:${cell(course, points[0].x, points[0].y)}`;
    return {
      points,
      label: {
        family,
        evidence: {
          kind: "tree_grove",
          ownerId,
          sourcePoints: points,
          rule: family === "woodland_floor"
            ? "Chebyshev-4 tree-source cluster with at least five sources or a complete 2x2 core -> woodland_floor"
            : "Chebyshev-4 tree-source cluster with two to four sources and no complete 2x2 core -> understory_edge",
        },
      },
    };
  });
}

function evidenceLabels(course: Course, staticallyExcluded: ReadonlySet<number>): ReadonlyMap<number, EvidenceLabel> {
  const labels = new Map<number, EvidenceLabel>();
  const habitatCell = (point: Point) => inside(course, point)
    && HABITAT_TERRAINS.has(course.tiles[cell(course, point.x, point.y)])
    && !staticallyExcluded.has(cell(course, point.x, point.y));

  const assign = (point: Point, label: EvidenceLabel) => {
    if (habitatCell(point) && !labels.has(cell(course, point.x, point.y))) labels.set(cell(course, point.x, point.y), label);
  };

  for (const rock of canonicalObstacleEntries(course.obstacles).filter((obstacle) => obstacle.type === "rock")) {
    const ownerId = `rock:${rock.x},${rock.y}`;
    const label: EvidenceLabel = {
      family: "rock_leaf_transition",
      evidence: { kind: "rock", ownerId, sourcePoints: [{ x: rock.x, y: rock.y }], rule: "land cell within Chebyshev radius 3 of a real rock" },
    };
    for (let dy = -3; dy <= 3; dy += 1) for (let dx = -3; dx <= 3; dx += 1) assign({ x: rock.x + dx, y: rock.y + dy }, label);
  }

  const wetCells = new Set<number>();
  const deepCells = new Set<number>();
  for (let value = 0; value < course.tiles.length; value += 1) {
    if (course.tiles[value] === "water" || course.tiles[value] === "wetland") wetCells.add(value);
    if (course.tiles[value] === "deep_rough") deepCells.add(value);
  }
  for (const component of cardinalComponents(course, wetCells)) {
    const points = component.map((value) => pointFor(course, value));
    const label: EvidenceLabel = {
      family: "wet_shore",
      evidence: { kind: "wet_shore", ownerId: `wet-shore:${component[0]}`, sourcePoints: points, rule: "habitat land cell cardinally adjacent to a connected water/wetland shore" },
    };
    for (const wet of points) for (const offset of CARDINALS) assign({ x: wet.x + offset.x, y: wet.y + offset.y }, label);
  }
  for (const component of cardinalComponents(course, deepCells)) {
    const points = component.map((value) => pointFor(course, value));
    const componentSet = new Set(component);
    const label: EvidenceLabel = {
      family: "meadow_deep_rough_margin",
      evidence: { kind: "deep_rough_margin", ownerId: `deep-rough:${component[0]}`, sourcePoints: points, rule: "rough/deep-rough cell on a cardinal boundary of a connected deep-rough component" },
    };
    for (const deep of points) {
      const boundary = CARDINALS.some((offset) => {
        const neighbor = { x: deep.x + offset.x, y: deep.y + offset.y };
        return inside(course, neighbor) && !componentSet.has(cell(course, neighbor.x, neighbor.y));
      });
      if (boundary) assign(deep, label);
      for (const offset of CARDINALS) {
        const neighbor = { x: deep.x + offset.x, y: deep.y + offset.y };
        if (habitatCell(neighbor) && !componentSet.has(cell(course, neighbor.x, neighbor.y))) assign(neighbor, label);
      }
    }
  }
  return labels;
}

function treeGroveCandidates(
  course: Course,
  hardExcluded: ReadonlySet<number>,
): readonly HabitatCandidate[] {
  const obstaclesByCell = new Map<number, Obstacle[]>();
  for (const obstacle of canonicalObstacleEntries(course.obstacles)) {
    const value = cell(course, obstacle.x, obstacle.y);
    obstaclesByCell.set(value, [...(obstaclesByCell.get(value) ?? []), obstacle]);
  }
  return treeGroveEvidence(course).flatMap((grove) => {
    const sourceCells = new Set(grove.points.map((point) => cell(course, point.x, point.y)));
    const occupied = new Map<number, HabitatTileCoordinate>();
    for (const source of grove.points) for (let dy = -2; dy <= 2; dy += 1) for (let dx = -2; dx <= 2; dx += 1) {
      const point = { x: source.x + dx, y: source.y + dy };
      if (!inside(course, point)) continue;
      const value = cell(course, point.x, point.y);
      if (!HABITAT_TERRAINS.has(course.tiles[value]) || hardExcluded.has(value)) continue;
      // The presentation layer renders below real vegetation props, so source
      // trees and bushes may retain ecological ground. Rocks and any unrelated
      // obstacle authority remain hard holes in the visual occupancy.
      const obstacles = obstaclesByCell.get(value) ?? [];
      if (obstacles.some((obstacle) => obstacle.type !== "bush"
        && !(obstacle.type === "tree" && sourceCells.has(value)))) continue;
      occupied.set(value, point);
    }
    const largest = cardinalComponents(course, new Set(occupied.keys()))
      .slice().sort((left, right) => right.length - left.length || left[0] - right[0])[0] ?? [];
    const sorted = largest.map((value) => pointFor(course, value)).sort(comparePoints);
    if (sorted.length < 2) return [];
    const signature = sorted.map(pointKey).join(";");
    return [{
      id: `candidate:${grove.label.family}:${grove.label.evidence.ownerId}:${signature}`,
      family: grove.label.family,
      evidence: grove.label.evidence,
      bounds: candidateBounds(sorted),
      occupied: sorted,
    }];
  });
}

function candidateCellsTouchCardinally(left: HabitatCandidate, right: HabitatCandidate): boolean {
  const rightCells = new Set(right.occupied.map(pointKey));
  return left.occupied.some((point) => rightCells.has(pointKey(point)) || CARDINALS.some((offset) => (
    rightCells.has(`${point.x + offset.x},${point.y + offset.y}`)
  )));
}

function mergeAdjacentTreeGroveCandidates(candidates: readonly HabitatCandidate[]): readonly HabitatCandidate[] {
  const merged = candidates.map((candidate) => ({ ...candidate, occupied: [...candidate.occupied] }));
  let changed = true;
  while (changed) {
    changed = false;
    mergePass: for (let left = 0; left < merged.length; left += 1) {
      for (let right = left + 1; right < merged.length; right += 1) {
        const a = merged[left]; const b = merged[right];
        if (a.family !== b.family || !candidateCellsTouchCardinally(a, b)) continue;
        const occupied = [...new Map([...a.occupied, ...b.occupied].map((point) => [pointKey(point), point])).values()]
          .sort(comparePoints);
        const sourcePoints = [...new Map([...a.evidence.sourcePoints, ...b.evidence.sourcePoints]
          .map((point) => [pointKey(point), point])).values()].sort(comparePoints);
        const ownerIds = [a.evidence.ownerId, b.evidence.ownerId].flatMap((value) => value.split("+")).sort();
        const ownerId = ownerIds.join("+");
        merged[left] = {
          id: `candidate:${a.family}:${ownerId}:${occupied.map(pointKey).join(";")}`,
          family: a.family,
          evidence: {
            kind: "tree_grove",
            ownerId,
            sourcePoints,
            rule: `${a.evidence.rule}; cardinally adjacent same-family source fields merged before topology resolution`,
          },
          bounds: candidateBounds(occupied),
          occupied,
        };
        merged.splice(right, 1);
        changed = true;
        break mergePass;
      }
    }
  }
  return merged;
}

function candidateBounds(occupied: readonly HabitatTileCoordinate[]): HabitatGridBounds {
  const minX = Math.min(...occupied.map((point) => point.x));
  const minY = Math.min(...occupied.map((point) => point.y));
  const maxX = Math.max(...occupied.map((point) => point.x));
  const maxY = Math.max(...occupied.map((point) => point.y));
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

function shapeCandidates(course: Course, labels: ReadonlyMap<number, EvidenceLabel>): readonly HabitatCandidate[] {
  const groups = new Map<string, { label: EvidenceLabel; cells: Set<number> }>();
  for (const [value, label] of labels) {
    const key = `${label.family}|${label.evidence.ownerId}`;
    const group = groups.get(key) ?? { label, cells: new Set<number>() };
    group.cells.add(value);
    groups.set(key, group);
  }
  const candidates = new Map<string, HabitatCandidate>();
  const add = (label: EvidenceLabel, occupied: readonly HabitatTileCoordinate[]) => {
    const sorted = occupied.slice().sort(comparePoints);
    const signature = sorted.map(pointKey).join(";");
    const id = `candidate:${label.family}:${label.evidence.ownerId}:${signature}`;
    candidates.set(id, { id, family: label.family, evidence: label.evidence, bounds: candidateBounds(sorted), occupied: sorted });
  };
  for (const { label, cells } of [...groups.values()].sort((left, right) => left.label.evidence.ownerId.localeCompare(right.label.evidence.ownerId))) {
    const has = (x: number, y: number) => inside(course, { x, y }) && cells.has(cell(course, x, y));
    for (let y = 0; y < course.height; y += 1) for (let x = 0; x < course.width; x += 1) {
      const square3 = Array.from({ length: 9 }, (_, index) => ({ x: x + index % 3, y: y + Math.floor(index / 3) }));
      if (square3.every((point) => has(point.x, point.y))) {
        add(label, square3);
        for (const corner of [square3[0], square3[2], square3[6], square3[8]]) add(label, square3.filter((point) => point !== corner));
      }
      const square2 = [{ x, y }, { x: x + 1, y }, { x, y: y + 1 }, { x: x + 1, y: y + 1 }];
      if (square2.every((point) => has(point.x, point.y))) add(label, square2);
      if (has(x, y) && has(x + 1, y)) add(label, [{ x, y }, { x: x + 1, y }]);
      if (has(x, y) && has(x, y + 1)) add(label, [{ x, y }, { x, y: y + 1 }]);
    }
  }
  return [...candidates.values()];
}

function authoredSourcePoints(course: Course, patch: M19AuthoredHabitatPatchV1): readonly Point[] {
  if (patch.family === "meadow_deep_rough_margin") {
    const { bounds } = patch;
    const points: Point[] = [];
    for (let y = bounds.y - 2; y < bounds.y + bounds.height + 2; y += 1) for (let x = bounds.x - 2; x < bounds.x + bounds.width + 2; x += 1) {
      if (inside(course, { x, y }) && course.tiles[cell(course, x, y)] === "deep_rough") points.push({ x, y });
    }
    return uniquePoints(points);
  }
  const bounds = patch.bounds;
  return uniquePoints(course.obstacles.filter((obstacle) => obstacle.type === "tree"
    && obstacle.x >= bounds.x - 5 && obstacle.x < bounds.x + bounds.width + 5
    && obstacle.y >= bounds.y - 5 && obstacle.y < bounds.y + bounds.height + 5));
}

/**
 * A deliberately narrow presentation exception. It may cross only the blanket
 * maintained-terrain/obstacle *halos* on habitat terrain; routed corridors,
 * markers, buildings, and every obstacle source tile stay absolutely clear.
 */
function authoredHabitatCandidates(course: Course, absoluteExclusions: ReadonlySet<number>): readonly HabitatCandidate[] {
  const candidates: HabitatCandidate[] = [];
  for (const patch of m19AuthoredHabitatSource(course)) {
    const { bounds } = patch;
    let valid = patch.rowRuns.length === bounds.height && bounds.width >= 2 && bounds.height >= 2;
    const occupied: HabitatTileCoordinate[] = [];
    for (let y = bounds.y; y < bounds.y + bounds.height; y += 1) {
      const run = patch.rowRuns[y - bounds.y];
      if (!run || run[0] < bounds.x || run[1] >= bounds.x + bounds.width || run[0] > run[1]) {
        valid = false;
        continue;
      }
      for (let x = run[0]; x <= run[1]; x += 1) {
        const point = { x, y };
        if (!inside(course, point)) { valid = false; continue; }
        const value = cell(course, x, y);
        if (!HABITAT_TERRAINS.has(course.tiles[value]) || absoluteExclusions.has(value)) valid = false;
        occupied.push(point);
      }
    }
    const sourcePoints = valid ? authoredSourcePoints(course, patch) : [];
    if (patch.family === "meadow_deep_rough_margin") {
      valid = valid && sourcePoints.length > 0 && occupied.every((point) => sourcePoints.some((source) =>
        Math.max(Math.abs(point.x - source.x), Math.abs(point.y - source.y)) <= 2));
    } else {
      valid = valid && sourcePoints.length > 0 && occupied.every((point) => sourcePoints.some((tree) =>
        Math.max(Math.abs(point.x - tree.x), Math.abs(point.y - tree.y)) <= 5));
    }
    if (!valid || occupied.length < 4) continue;
    const evidence: HabitatZoneEvidenceV1 = {
      kind: "authored_habitat_source",
      ownerId: `m19-m23:${patch.id}`,
      sourcePoints,
      rule: "exact-fixture tile-snapped render-only source; absolute route, marker, building, and obstacle-source clearances",
    };
    candidates.push({
      id: `candidate:${patch.family}:${evidence.ownerId}`,
      family: patch.family,
      evidence,
      bounds: { ...bounds },
      occupied,
    });
  }
  return candidates;
}

function mix32(value: number): number {
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
  return (value ^ (value >>> 16)) >>> 0;
}

function textSalt(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) hash = Math.imul(hash ^ value.charCodeAt(index), 0x01000193);
  return hash >>> 0;
}

function canonicalCourseHash(course: Course): string {
  const cloned = structuredClone(course);
  const { activePinRotation: _setupSelector, ...semanticCourse } = cloned;
  const semantic = {
    ...semanticCourse,
    obstacles: [...canonicalObstacleEntries(cloned.obstacles)],
    buildings: [...canonicalBuildings(cloned.buildings ?? [])],
    holes: cloned.holes.map((hole) => {
    const authoredTees = uniquePoints(TEE_SETS.map((set) => hole.teeBoxes?.[set]));
    const authoredPins = uniquePoints(PIN_ROTATIONS.map((rotation) => hole.pinPositions?.[rotation]));
    const omitTee = hole.tee && authoredTees.some((point) => pointKey(point) === pointKey(hole.tee as Point));
    const omitGreen = hole.green && authoredPins.some((point) => pointKey(point) === pointKey(hole.green as Point));
    const { tee: _activeTee, green: _activeGreen, ...stableHole } = hole;
    return { ...stableHole, ...(!omitTee ? { tee: hole.tee } : {}), ...(!omitGreen ? { green: hole.green } : {}) };
    }),
  };
  return hashCanonicalValue(semantic);
}

function candidateConflicts(course: Course, candidate: HabitatCandidate, reserved: ReadonlySet<number>): boolean {
  return candidate.occupied.some((point) => reserved.has(cell(course, point.x, point.y)));
}

function reserveZoneGap(course: Course, occupied: readonly HabitatTileCoordinate[], reserved: Set<number>): void {
  for (const point of occupied) for (let dy = -COURSE_SCENE_INTER_ZONE_GAP_CELLS; dy <= COURSE_SCENE_INTER_ZONE_GAP_CELLS; dy += 1) {
    for (let dx = -COURSE_SCENE_INTER_ZONE_GAP_CELLS; dx <= COURSE_SCENE_INTER_ZONE_GAP_CELLS; dx += 1) {
      const neighbor = { x: point.x + dx, y: point.y + dy };
      if (inside(course, neighbor)) reserved.add(cell(course, neighbor.x, neighbor.y));
    }
  }
}

/**
 * Pure renderer-neutral derivation. Habitat candidates are accepted only when
 * the T1 resolver transactionally supplies exactly one truthful placement for
 * every occupied cell.
 */
export function deriveCourseSceneComposition(input: CourseSceneCompositionInput): CourseSceneCompositionPlanV1 {
  const course = input.course;
  const semanticSeed = Number.isSafeInteger(input.seed) ? input.seed : 0;
  const atlas = input.atlas ?? HIGH_ATLAS;
  const resolver = input.topologyResolver ?? resolveHabitatFieldTopology;
  const holes = stableHoles(course.holes);
  const composition = holeComposition(course, holes);

  const maintainedTerrain = exclusionGeometry(connectedTerrainOwners(course), 2);
  const routedCorridor = exclusionGeometry(routeOwners(course, holes), 2);
  const authoredMarkerGeometry = exclusionGeometry(markerOwners(course, holes), 3);
  const obstacleGeometry = exclusionGeometry(obstacleOwners(course), 2);
  const buildingGeometry = exclusionGeometry(buildingOwners(course), 2);
  const hardExcluded = new Set([
    ...maintainedTerrain.cells,
    ...routedCorridor.cells,
    ...authoredMarkerGeometry.cells,
    ...buildingGeometry.cells,
  ]);
  const treeSourceExcluded = new Set([
    ...routedCorridor.owners.flatMap((owner) => owner.sourcePoints.map((point) => cell(course, point.x, point.y))),
    ...authoredMarkerGeometry.owners.flatMap((owner) => owner.sourcePoints.map((point) => cell(course, point.x, point.y))),
    ...buildingGeometry.owners.flatMap((owner) => owner.sourcePoints.map((point) => cell(course, point.x, point.y))),
  ]);
  const staticallyExcluded = new Set([
    ...hardExcluded,
    ...obstacleGeometry.cells,
  ]);

  const authoredAbsoluteExclusions = new Set([
    ...routedCorridor.cells,
    ...authoredMarkerGeometry.cells,
    ...buildingGeometry.cells,
    ...course.obstacles.filter((obstacle) => inside(course, obstacle)).map((obstacle) => cell(course, obstacle.x, obstacle.y)),
  ]);

  const labels = evidenceLabels(course, staticallyExcluded);
  const treeCandidates = mergeAdjacentTreeGroveCandidates(treeGroveCandidates(course, treeSourceExcluded));
  const authoredCandidates = authoredHabitatCandidates(course, authoredAbsoluteExclusions);
  const ecologicalCandidates = [...treeCandidates, ...shapeCandidates(course, labels)]
    .sort((left, right) => right.occupied.length - left.occupied.length
    || mix32((semanticSeed | 0) ^ textSalt(left.id)) - mix32((semanticSeed | 0) ^ textSalt(right.id))
    || left.id.localeCompare(right.id));
  // Fixture-gated authored sources are evaluated first, not tuned per frame:
  // the normal zone-gap reservation then applies unchanged to all later data.
  const candidates = [...authoredCandidates, ...ecologicalCandidates];
  const reserved = new Set<number>();
  const zones: CourseSceneHabitatZoneV1[] = [];
  const rejected: HabitatCandidateRejectionV1[] = [];

  for (const candidate of candidates) {
    if (zones.length >= 24) break;
    if (candidateConflicts(course, candidate, reserved)) continue;
    const result = resolver({
      occupancy: { bounds: candidate.bounds, occupied: candidate.occupied },
      family: candidate.family,
      seed: semanticSeed,
      atlas,
    });
    if (!result.ok) {
      rejected.push({
        candidateId: candidate.id,
        family: candidate.family,
        evidenceOwnerId: candidate.evidence.ownerId,
        diagnostics: result.diagnostics.map((diagnostic) => ({ ...diagnostic })),
      });
      if (result.diagnostics.some((diagnostic) => diagnostic.code === "invalid_atlas")) break;
      continue;
    }
    if (result.placements.length !== candidate.occupied.length) {
      rejected.push({
        candidateId: candidate.id,
        family: candidate.family,
        evidenceOwnerId: candidate.evidence.ownerId,
        diagnostics: [{ code: "unsupported_topology", message: "T1 returned incomplete occupancy coverage" }],
      });
      continue;
    }
    const occupiedKeys = new Set(candidate.occupied.map(pointKey));
    const placementKeys = new Set(result.placements.map((placement) => pointKey(placement.tile)));
    const exactTileBijection = placementKeys.size === result.placements.length
      && placementKeys.size === occupiedKeys.size
      && [...occupiedKeys].every((key) => placementKeys.has(key));
    if (!exactTileBijection
      || result.placements.some((placement) => placement.family !== candidate.family || !occupiedKeys.has(pointKey(placement.tile)))) {
      rejected.push({
        candidateId: candidate.id,
        family: candidate.family,
        evidenceOwnerId: candidate.evidence.ownerId,
        diagnostics: [{ code: "unsupported_topology", message: "T1 returned placements without an exact family-correct occupancy bijection" }],
      });
      continue;
    }
    const occupancy = candidate.occupied.map((point) => ({ ...point }));
    const signature = occupancy.map(pointKey).join(";");
    const zoneId = `habitat-zone:${candidate.family}:${candidate.evidence.ownerId}:${hashCanonicalValue(signature)}`;
    zones.push({
      id: zoneId,
      ownerId: zoneId,
      family: candidate.family,
      evidence: {
        ...candidate.evidence,
        sourcePoints: candidate.evidence.sourcePoints.map((point) => ({ ...point })),
      },
      bounds: { ...candidate.bounds },
      area: occupancy.length,
      occupancy,
      placements: result.placements.map((placement) => ({
        ...placement,
        tile: { ...placement.tile },
        atlasAnchor: { ...placement.atlasAnchor },
        worldAnchor: { ...placement.worldAnchor },
        edgeAnchors: [...placement.edgeAnchors],
      })),
    });
    reserveZoneGap(course, occupancy, reserved);
  }

  return {
    version: COURSE_SCENE_COMPOSITION_VERSION,
    semantics: COURSE_SCENE_COMPOSITION_SEMANTICS,
    semanticSeed,
    sceneBounds: { minX: 0, minY: 0, maxX: Math.max(0, course.width - 1), maxY: Math.max(0, course.height - 1) },
    courseHash: canonicalCourseHash(course),
    obstacleHash: hashCanonicalValue(canonicalObstacleEntries(course.obstacles)),
    holeEnvelopes: composition.envelopes,
    landmarks: composition.landmarks,
    exclusions: {
      maintainedTerrain,
      routedCorridor,
      authoredMarkers: authoredMarkerGeometry,
      obstacles: obstacleGeometry,
      buildings: buildingGeometry,
      dynamicSuppression: {
        golfers: { radius: 2, metric: "chebyshev", policy: "suppress-at-render" },
        activeEditorPreview: { radius: 2, metric: "chebyshev", policy: "suppress-at-render" },
      },
      interZoneGapCells: COURSE_SCENE_INTER_ZONE_GAP_CELLS,
      interZoneGapMetric: "chebyshev",
      adjacentTreeGrovePolicy: "merge-same-family-before-topology",
      vegetationGroundPolicy: "visual-underlay-beneath-source-trees-and-bushes",
      treeAuthority: "existing-obstacles-only",
    },
    habitatZones: zones.sort((left, right) => left.id.localeCompare(right.id)),
    rejectedCandidates: rejected.slice(0, 64),
  };
}
