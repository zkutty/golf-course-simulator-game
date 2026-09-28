import { buildingEntrance, buildingFootprintSet } from "../models/buildings";
import type { Building, Course, Point, Terrain } from "../models/types";
import { isOwnedTile } from "../estate/estate";
import type { PropertyAsset, PropertyCourseState } from "./types";

const ROAD_WIDTH = 8;
const ROAD_HEIGHT = 2;
const PARKING_WIDTH = 6;
const PARKING_HEIGHT = 5;
const MAX_GRADE_STEP = 2;

export interface StarterArrivalPlan {
  gateway: Point;
  roadFootprint: { x: number; y: number; width: number; height: number };
  driveway: Point[];
  parking: { x: number; y: number; width: number; height: number };
  pedestrianRoute: Point[];
  clubhouseEntrance: Point;
}

export interface StarterArrivalValidation {
  ok: boolean;
  reason?: string;
  plan?: StarterArrivalPlan;
}

interface ParkingCandidate {
  x: number;
  y: number;
  pedestrianRoute: Point[];
}

interface GatewayCandidate {
  footprint: { x: number; y: number };
  publicPoint: Point;
}

function pointKey(point: Point): string {
  return `${point.x},${point.y}`;
}

function samePoint(a: Point, b: Point): boolean {
  return a.x === b.x && a.y === b.y;
}

function manhattan(a: Point, b: Point): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function routeIsAdjacent(points: readonly Point[]): boolean {
  return points.length > 0 && points.every((point, index) => index === 0 || manhattan(points[index - 1], point) === 1);
}

function isHazard(terrain: Terrain): boolean {
  return terrain === "water" || terrain === "wetland";
}

function pointInRect(point: Point, rect: { x: number; y: number; width: number; height: number }): boolean {
  return point.x >= rect.x && point.x < rect.x + rect.width && point.y >= rect.y && point.y < rect.y + rect.height;
}

function clearPoint(course: Course, point: Point, blocked: ReadonlySet<number>): boolean {
  if (point.x < 0 || point.y < 0 || point.x >= course.width || point.y >= course.height) return false;
  if (!isOwnedTile(course, point.x, point.y)) return false;
  if (isHazard(course.tiles[point.y * course.width + point.x])) return false;
  if (blocked.has(point.y * course.width + point.x)) return false;
  return !(course.obstacles ?? []).some((obstacle) => samePoint(obstacle, point));
}

function clearRect(course: Course, rect: { x: number; y: number; width: number; height: number }, blocked: ReadonlySet<number>): boolean {
  let minElevation = Infinity;
  let maxElevation = -Infinity;
  for (let y = rect.y; y < rect.y + rect.height; y++) for (let x = rect.x; x < rect.x + rect.width; x++) {
    if (!clearPoint(course, { x, y }, blocked)) return false;
    const elevation = course.elevations[y * course.width + x] ?? 0;
    minElevation = Math.min(minElevation, elevation);
    maxElevation = Math.max(maxElevation, elevation);
  }
  return maxElevation - minElevation <= 3;
}

function straightRoute(from: Point, to: Point): Point[] {
  const route: Point[] = [{ ...from }];
  let cursor = { ...from };
  while (cursor.x !== to.x) {
    cursor = { x: cursor.x + Math.sign(to.x - cursor.x), y: cursor.y };
    route.push(cursor);
  }
  while (cursor.y !== to.y) {
    cursor = { x: cursor.x, y: cursor.y + Math.sign(to.y - cursor.y) };
    route.push(cursor);
  }
  return route;
}

function reversedStraightRoute(from: Point, to: Point): Point[] {
  return straightRoute(to, from).reverse();
}

function routeHasSafeGrade(course: Course, points: readonly Point[]): boolean {
  return points.every((point, index) => {
    if (index === 0) return true;
    const previous = points[index - 1];
    const previousElevation = course.elevations[previous.y * course.width + previous.x] ?? 0;
    const elevation = course.elevations[point.y * course.width + point.x] ?? 0;
    return Math.abs(elevation - previousElevation) <= MAX_GRADE_STEP;
  });
}

function candidateParkingRects(clubhouse: Building): Array<{ x: number; y: number }> {
  const candidates: Array<{ x: number; y: number }> = [];
  const seen = new Set<string>();
  const lateralOffsets = [-1, 0, -2, 1, -3, 2, -4, 3, -5, 4, -6, 5, -7, 6];
  const add = (x: number, y: number) => {
    const key = `${x},${y}`;
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push({ x, y });
  };
  for (let gap = 2; gap <= 12; gap++) {
    for (const offset of lateralOffsets) {
      add(clubhouse.x + offset, clubhouse.y + 3 + gap);
      add(clubhouse.x + offset, clubhouse.y - PARKING_HEIGHT - gap);
      add(clubhouse.x + 3 + gap, clubhouse.y + offset);
      add(clubhouse.x - PARKING_WIDTH - gap, clubhouse.y + offset);
    }
  }
  return candidates;
}

function parkingCandidates(course: Course, clubhouse: Building, entrance: Point, blocked: ReadonlySet<number>): ParkingCandidate[] {
  const raw = candidateParkingRects(clubhouse);
  const candidates: ParkingCandidate[] = [];
  for (const rect of raw) {
    const parking = { ...rect, width: PARKING_WIDTH, height: PARKING_HEIGHT };
    if (!clearRect(course, parking, blocked)) continue;
    const boundary: Point[] = [];
    for (let x = parking.x; x < parking.x + parking.width; x++) {
      boundary.push({ x, y: parking.y }, { x, y: parking.y + parking.height - 1 });
    }
    for (let y = parking.y + 1; y < parking.y + parking.height - 1; y++) {
      boundary.push({ x: parking.x, y }, { x: parking.x + parking.width - 1, y });
    }
    boundary.sort((a, b) => manhattan(a, entrance) - manhattan(b, entrance) || a.y - b.y || a.x - b.x);
    let pedestrianRoute: Point[] | null = null;
    for (const target of boundary) {
      const simpleRoutes = [straightRoute(target, entrance), reversedStraightRoute(target, entrance)];
      pedestrianRoute = simpleRoutes.find((route) => route.every((step) => clearPoint(course, step, blocked)) && routeHasSafeGrade(course, route)) ?? null;
      if (pedestrianRoute) break;
    }
    if (!pedestrianRoute) {
      pedestrianRoute = routeToParking(course, [entrance], parking, blocked)?.reverse() ?? null;
    }
    if (pedestrianRoute && routeIsAdjacent(pedestrianRoute)) candidates.push({ x: rect.x, y: rect.y, pedestrianRoute });
    if (candidates.length >= 12) break;
  }
  return candidates;
}

function gatewayCandidates(course: Course, blocked: ReadonlySet<number>): GatewayCandidate[] {
  const parcel = course.estate?.parcels.find((candidate) => candidate.id === course.estate?.starterParcelId);
  if (!parcel) return [];
  const { minX, minY, maxX, maxY } = parcel.bounds;
  const raw: GatewayCandidate[] = [];
  for (let y = minY; y <= maxY - ROAD_HEIGHT + 1; y += 4) {
    raw.push({ footprint: { x: minX, y }, publicPoint: { x: minX, y: y + 1 } });
    raw.push({ footprint: { x: maxX - ROAD_WIDTH + 1, y }, publicPoint: { x: maxX, y: y + 1 } });
  }
  for (let x = minX; x <= maxX - ROAD_WIDTH + 1; x += 4) {
    raw.push({ footprint: { x, y: minY }, publicPoint: { x: x + Math.floor(ROAD_WIDTH / 2), y: minY } });
    raw.push({ footprint: { x, y: maxY - ROAD_HEIGHT + 1 }, publicPoint: { x: x + Math.floor(ROAD_WIDTH / 2), y: maxY } });
  }
  return raw.filter(({ footprint }) => clearRect(course, { ...footprint, width: ROAD_WIDTH, height: ROAD_HEIGHT }, blocked));
}

function routeToParking(
  course: Course,
  starts: readonly Point[],
  parking: { x: number; y: number; width: number; height: number },
  blocked: ReadonlySet<number>,
): Point[] | null {
  const targets = new Set<string>();
  const targetPoints: Point[] = [];
  const addTarget = (point: Point) => {
    if (targets.has(pointKey(point))) return;
    targets.add(pointKey(point));
    targetPoints.push(point);
  };
  for (let x = parking.x; x < parking.x + parking.width; x++) {
    addTarget({ x, y: parking.y });
    addTarget({ x, y: parking.y + parking.height - 1 });
  }
  for (let y = parking.y; y < parking.y + parking.height; y++) {
    addTarget({ x: parking.x, y });
    addTarget({ x: parking.x + parking.width - 1, y });
  }
  const open: Point[] = starts.map((point) => ({ ...point }));
  const openKeys = new Set(starts.map(pointKey));
  const cameFrom = new Map<string, Point>();
  const distance = new Map<string, number>(starts.map((point) => [pointKey(point), 0]));
  const estimate = new Map<string, number>(starts.map((point) => [pointKey(point), Math.min(...targetPoints.map((target) => manhattan(point, target))) ]));
  while (open.length > 0) {
    let bestIndex = 0;
    for (let index = 1; index < open.length; index++) {
      const currentScore = estimate.get(pointKey(open[index])) ?? Infinity;
      const bestScore = estimate.get(pointKey(open[bestIndex])) ?? Infinity;
      if (currentScore < bestScore || currentScore === bestScore && pointKey(open[index]) < pointKey(open[bestIndex])) bestIndex = index;
    }
    const current = open.splice(bestIndex, 1)[0];
    openKeys.delete(pointKey(current));
    if (targets.has(pointKey(current))) {
      const result = [current];
      let cursor = current;
      while (cameFrom.has(pointKey(cursor))) {
        const previous = cameFrom.get(pointKey(cursor))!;
        result.push(previous);
        cursor = previous;
      }
      return result.reverse();
    }
    const currentElevation = course.elevations[current.y * course.width + current.x] ?? 0;
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
      const next = { x: current.x + dx, y: current.y + dy };
      if (!pointInRect(next, parking) && !clearPoint(course, next, blocked)) continue;
      const nextElevation = course.elevations[next.y * course.width + next.x] ?? 0;
      const grade = Math.abs(nextElevation - currentElevation);
      if (grade > MAX_GRADE_STEP) continue;
      const terrain = course.tiles[next.y * course.width + next.x];
      const terrainCost = terrain === "sand" || terrain === "waste_area" ? 4 : terrain === "deep_rough" ? 2 : 0;
      const nextDistance = (distance.get(pointKey(current)) ?? Infinity) + 1 + grade * 3 + terrainCost;
      if (nextDistance >= (distance.get(pointKey(next)) ?? Infinity)) continue;
      cameFrom.set(pointKey(next), current);
      distance.set(pointKey(next), nextDistance);
      const heuristic = Math.min(...targetPoints.map((target) => manhattan(next, target)));
      estimate.set(pointKey(next), nextDistance + heuristic);
      if (!openKeys.has(pointKey(next))) {
        open.push(next);
        openKeys.add(pointKey(next));
      }
    }
  }
  return null;
}

export function planStarterArrival(course: Course): StarterArrivalPlan | null {
  const clubhouse = course.buildings.find((building) => building.type === "clubhouse");
  if (!clubhouse || !course.estate) return null;
  const entrance = buildingEntrance(course, clubhouse);
  const blocked = buildingFootprintSet(course);
  const parking = parkingCandidates(course, clubhouse, entrance, blocked);
  const gateways = gatewayCandidates(course, blocked);
  let best: { plan: StarterArrivalPlan; score: number } | null = null;
  for (const lot of parking) {
    const driveway = routeToParking(course, gateways.map((gateway) => gateway.publicPoint), { ...lot, width: PARKING_WIDTH, height: PARKING_HEIGHT }, blocked);
    if (!driveway) continue;
    const gateway = gateways.find((candidate) => samePoint(candidate.publicPoint, driveway[0]));
    if (!gateway) continue;
    const elevationWork = driveway.slice(1).reduce((sum, point, index) => {
      const previous = driveway[index];
      return sum + Math.abs((course.elevations[point.y * course.width + point.x] ?? 0) - (course.elevations[previous.y * course.width + previous.x] ?? 0));
    }, 0);
    const score = driveway.length + elevationWork * 4 + lot.pedestrianRoute.length * 2;
    const plan: StarterArrivalPlan = {
      gateway: gateway.publicPoint,
      roadFootprint: { ...gateway.footprint, width: ROAD_WIDTH, height: ROAD_HEIGHT },
      driveway,
      parking: { x: lot.x, y: lot.y, width: PARKING_WIDTH, height: PARKING_HEIGHT },
      pedestrianRoute: lot.pedestrianRoute,
      clubhouseEntrance: entrance,
    };
    if (!best || score < best.score || score === best.score && pointKey(plan.gateway) < pointKey(best.plan.gateway)) best = { plan, score };
  }
  return best?.plan ?? null;
}

function starterAssets(plan: StarterArrivalPlan): PropertyAsset[] {
  return [
    {
      id: "property-road-starter",
      kind: "road",
      name: "Starter driveway",
      category: "access",
      tier: 3,
      ...plan.roadFootprint,
      capacity: 64,
      condition: 1,
      price: 0,
      surface: "gravel",
      route: { id: "starter-arrival-driveway", points: plan.driveway },
      upkeepPolicy: "standard",
      openHour: 7,
      closeHour: 20,
      constructionDaysRemaining: 0,
      enabled: true,
    },
    {
      id: "property-parking-starter",
      kind: "parking",
      name: "Clubhouse parking",
      category: "access",
      tier: 3,
      ...plan.parking,
      capacity: 72,
      condition: 1,
      price: 0,
      surface: "gravel",
      pedestrianRoute: { id: "starter-arrival-pedestrian", points: plan.pedestrianRoute },
      upkeepPolicy: "standard",
      openHour: 7,
      closeHour: 20,
      constructionDaysRemaining: 0,
      enabled: true,
    },
  ];
}

export function installStarterArrival(course: Course): Course {
  const plan = planStarterArrival(course);
  if (!plan) return course;
  const property: PropertyCourseState = course.property ?? {
    version: 2,
    assets: [],
    developments: [],
    units: [],
    easements: [],
    safetyPolicy: { restrictedTeeSets: [], closedHoleIds: [], exposureLimit: 70 },
  };
  const retained = property.assets.filter((asset) => asset.id !== "property-road-starter" && asset.id !== "property-parking-starter");
  return { ...course, property: { ...property, version: 2, arrivalVersion: 1, assets: [...starterAssets(plan), ...retained] } };
}

function safeRoute(course: Course, points: readonly Point[], allow: (point: Point) => boolean): boolean {
  if (!routeIsAdjacent(points)) return false;
  for (let index = 0; index < points.length; index++) {
    const point = points[index];
    if (!allow(point)) return false;
    if (index > 0) {
      const previous = points[index - 1];
      const grade = Math.abs((course.elevations[point.y * course.width + point.x] ?? 0) - (course.elevations[previous.y * course.width + previous.x] ?? 0));
      if (grade > MAX_GRADE_STEP) return false;
    }
  }
  return true;
}

export function validateStarterArrival(course: Course): StarterArrivalValidation {
  const road = course.property?.assets.find((asset) => asset.id === "property-road-starter");
  const parking = course.property?.assets.find((asset) => asset.id === "property-parking-starter");
  const clubhouse = course.buildings.find((building) => building.type === "clubhouse");
  if (!road?.enabled || !parking?.enabled || !clubhouse) return { ok: false, reason: "starter road, parking, or clubhouse is unavailable" };
  const driveway = road.route?.points ?? [];
  const pedestrianRoute = parking.pedestrianRoute?.points ?? [];
  const parcel = course.estate?.parcels.find((candidate) => candidate.id === course.estate?.starterParcelId);
  if (!parcel || driveway.length === 0 || pedestrianRoute.length === 0) return { ok: false, reason: "starter arrival routes are missing" };
  const gateway = driveway[0];
  const onBoundary = gateway.x === parcel.bounds.minX || gateway.x === parcel.bounds.maxX || gateway.y === parcel.bounds.minY || gateway.y === parcel.bounds.maxY;
  if (!onBoundary) return { ok: false, reason: "driveway does not reach the public-road gateway" };
  const blocked = buildingFootprintSet(course);
  if (!safeRoute(course, driveway, (point) => pointInRect(point, parking) || clearPoint(course, point, blocked))) return { ok: false, reason: "driveway crosses blocked, hazardous, unowned, or excessive-grade land" };
  if (!pointInRect(driveway[driveway.length - 1], parking)) return { ok: false, reason: "driveway does not join clubhouse parking" };
  const entrance = buildingEntrance(course, clubhouse);
  if (!pointInRect(pedestrianRoute[0], parking) || !samePoint(pedestrianRoute[pedestrianRoute.length - 1], entrance)) return { ok: false, reason: "pedestrian path does not join parking to the clubhouse entrance" };
  if (!safeRoute(course, pedestrianRoute, (point) => pointInRect(point, parking) || clearPoint(course, point, blocked))) return { ok: false, reason: "pedestrian path crosses blocked, hazardous, or unowned land" };
  return {
    ok: true,
    plan: { gateway, roadFootprint: { x: road.x, y: road.y, width: road.width, height: road.height }, driveway: [...driveway], parking: { x: parking.x, y: parking.y, width: parking.width, height: parking.height }, pedestrianRoute: [...pedestrianRoute], clubhouseEntrance: entrance },
  };
}
