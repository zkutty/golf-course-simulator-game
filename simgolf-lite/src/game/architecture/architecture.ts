import type { Course, Hole, PinRotation, Point, TeeSet, Terrain } from "../models/types";
import { BALANCE } from "../balance/balanceConfig";
import { decodeElevationBaseline, decodeTerrainBaseline } from "../estate/estate";
import { computeAutoPar, computePathDistanceTiles } from "../sim/holeMetrics";
import { findWalkPath } from "../live/walkPath";
import { lastItem } from "../../utils/array";
import { buildStrategicPortfolio } from "./portfolio";
import type { M48StrategicPortfolio } from "./m48Types";
import { courseWithEffectiveSurfaces } from "../conditions/surfaceCare";
import { getPinPosition, getTeeBox } from "../models/courseSetup";

export type ArchitectureComponentId = "routing" | "naturalFit" | "variety" | "safety" | "walkability";
export type ArchitectureWarningKind = "transfer" | "clubhouse" | "repetition" | "crossing" | "parallel" | "earthwork" | "terrain";

export interface ArchitectureWarning {
  id: string;
  kind: ArchitectureWarningKind;
  severity: "info" | "warning";
  message: string;
  holeIds: string[];
  location?: Point;
  geometry?: Point[];
  measurement: string;
}

export interface ArchitectureComponent {
  id: ArchitectureComponentId;
  label: string;
  score: number;
  weight: number;
  explanation: string;
  raw: Record<string, number>;
}

export interface ArchitectureReport {
  total: number;
  components: Record<ArchitectureComponentId, ArchitectureComponent>;
  warnings: ArchitectureWarning[];
  generatedFor: { courseId?: string; holeIds: string[] };
  /** M48 strategy facts are additive so M27 consumers and old saves keep their shape. */
  strategic?: M48StrategicPortfolio;
}

const WEIGHTS: Record<ArchitectureComponentId, number> = {
  routing: .25,
  naturalFit: .25,
  variety: .20,
  safety: .15,
  walkability: .15,
};

const cache = new WeakMap<Course, Map<string, ArchitectureReport>>();
const clamp = (value: number, min = 0, max = 100) => Math.max(min, Math.min(max, value));
const round = (value: number, digits = 1) => Number(value.toFixed(digits));
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const midpoint = (a: Point, b: Point): Point => ({ x: round((a.x + b.x) / 2), y: round((a.y + b.y) / 2) });

export interface ArchitectureAnalysisSetup {
  teeSet?: TeeSet;
  pinRotation?: PinRotation;
}

function analysisPath(hole: Hole, teeSet: TeeSet, pinRotation: PinRotation): Point[] {
  const start = getTeeBox(hole, teeSet);
  const end = getPinPosition(hole, pinRotation);
  return start && end ? [start, ...(hole.waypoints ?? []), end] : [];
}
function clubhouse(course: Course): Point | null {
  const building = course.buildings.find((item) => item.type === "clubhouse");
  return building ? { x: building.x + 1, y: building.y + 1 } : null;
}
function angle(a: Point, b: Point): number {
  const value = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
  return value < 0 ? value + 360 : value;
}
function angleDifference(a: number, b: number): number {
  const delta = Math.abs(a - b) % 360;
  return Math.min(delta, 360 - delta);
}
function orientation(a: Point, b: Point, c: Point): number {
  return (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);
}
function segmentsCross(a: Point, b: Point, c: Point, d: Point): boolean {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);
  return o1 * o2 < 0 && o3 * o4 < 0;
}
function component(id: ArchitectureComponentId, label: string, score: number, explanation: string, raw: Record<string, number>): ArchitectureComponent {
  return { id, label, score: round(clamp(score)), weight: WEIGHTS[id], explanation, raw };
}
function routeSegments(points: Point[]): Array<[Point, Point]> {
  return points.slice(1).map((point, index) => [points[index], point]);
}

function routedTransfer(course: Course, from: Point, to: Point): { length: number; path: Point[] | null } {
  if (!course.estate) return { length: distance(from, to), path: [from, to] };
  // Architecture advice runs in demand and editor flows, so keep the route
  // survey bounded. Nearby transfers resolve exactly; sprawling or blocked
  // ones safely fall back to their geometric penalty instead of stalling play.
  const routed = findWalkPath(course, from, to, 1_500);
  const path = routed ? [from, ...routed] : null;
  return { length: path ? computePathDistanceTiles(path) : distance(from, to) * 1.4, path };
}

function analyzeNaturalFit(course: Course, warnings: ArchitectureWarning[]): ArchitectureComponent {
  const expected = course.width * course.height;
  const terrain = course.estate ? decodeTerrainBaseline(course.estate.naturalBaseline.terrainRle, expected) : null;
  const elevation = course.estate ? decodeElevationBaseline(course.estate.naturalBaseline.elevationRle, expected) : null;
  if (!terrain || !elevation) return component("naturalFit", "Natural fit", 60, "No surveyed baseline is available, so natural fit is neutral.", { retainedTerrainPercent: 60, earthworkStepsPer100Tiles: 0 });
  let retained = 0;
  let earthwork = 0;
  let changed = 0;
  for (let index = 0; index < expected; index++) {
    if (course.tiles[index] === terrain[index]) retained++;
    else changed++;
    earthwork += Math.abs((course.elevations[index] ?? 0) - elevation[index]);
  }
  const retainedPercent = retained / expected * 100;
  const earthworkPer100 = earthwork / expected * 100;
  const score = retainedPercent * .72 + clamp(100 - earthworkPer100 * 13) * .28;
  if (earthworkPer100 > 2.5) warnings.push({ id: "earthwork-heavy", kind: "earthwork", severity: "warning", message: "Extensive earthwork weakens the course's relationship with its surveyed contours.", holeIds: [], measurement: `${round(earthworkPer100)} elevation steps per 100 tiles` });
  if (retainedPercent < 72) warnings.push({ id: "terrain-retention", kind: "terrain", severity: "info", message: "A large share of the natural surface has been rebuilt.", holeIds: [], measurement: `${round(retainedPercent)}% natural terrain retained` });
  return component("naturalFit", "Natural fit", score, `${round(retainedPercent)}% of surveyed terrain remains; earthwork averages ${round(earthworkPer100)} steps per 100 tiles.`, { retainedTerrainPercent: round(retainedPercent), changedTiles: changed, earthworkSteps: earthwork, earthworkStepsPer100Tiles: round(earthworkPer100) });
}

function analyzeVariety(course: Course, teeSet: TeeSet, pinRotation: PinRotation): ArchitectureComponent {
  const holes = course.holes.filter((hole) => analysisPath(hole, teeSet, pinRotation).length >= 2);
  const pars = new Set<number>();
  const lengthBands = new Set<number>();
  const directions = new Set<number>();
  const shapes = new Set<string>();
  const hazardMix = new Set<Terrain>();
  const sceneryMix = new Set<Terrain>();
  for (const hole of holes) {
    const points = analysisPath(hole, teeSet, pinRotation);
    const length = computePathDistanceTiles(points);
    pars.add(hole.parMode === "MANUAL" && hole.parManual ? hole.parManual : computeAutoPar(length));
    lengthBands.add(length < 16 ? 0 : length < 28 ? 1 : length < 40 ? 2 : 3);
    directions.add(Math.floor(angle(points[0], points[points.length - 1]) / 45) % 8);
    const direct = distance(points[0], points[points.length - 1]);
    shapes.add(points.length > 2 && length > direct * 1.12 ? "dogleg" : "straight");
    for (const [a, b] of routeSegments(points)) {
      const steps = Math.max(1, Math.ceil(distance(a, b)));
      for (let step = 0; step <= steps; step++) {
        const x = Math.max(0, Math.min(course.width - 1, Math.round(a.x + (b.x - a.x) * step / steps)));
        const y = Math.max(0, Math.min(course.height - 1, Math.round(a.y + (b.y - a.y) * step / steps)));
        const terrain = course.tiles[y * course.width + x];
        if (terrain === "water" || terrain === "wetland" || terrain === "sand" || terrain === "waste_area") hazardMix.add(terrain);
        if (terrain === "water" || terrain === "wetland" || terrain === "deep_rough" || terrain === "sand") sceneryMix.add(terrain);
      }
    }
  }
  const score = holes.length === 0 ? 0 :
    clamp((pars.size / 3 * 22) + (lengthBands.size / 4 * 18) + (directions.size / 6 * 24) + (shapes.size / 2 * 14) + (hazardMix.size / 4 * 12) + (sceneryMix.size / 4 * 10));
  return component("variety", "Variety", score, `${pars.size} par types, ${lengthBands.size} length bands, ${directions.size} directions, and ${shapes.size} routing shapes create the playing mix.`, { parTypes: pars.size, lengthBands: lengthBands.size, directionBuckets: directions.size, shapeTypes: shapes.size, hazardTypes: hazardMix.size, sceneryTypes: sceneryMix.size });
}

function analyzeFlow(course: Course, teeSet: TeeSet, pinRotation: PinRotation, warnings: ArchitectureWarning[]): { routing: ArchitectureComponent; walkability: ArchitectureComponent } {
  const holes = course.holes.filter((hole) => analysisPath(hole, teeSet, pinRotation).length >= 2);
  const home = clubhouse(course);
  const transfers: number[] = [];
  let routedTransfers = 0;
  for (let index = 0; index < holes.length - 1; index++) {
    const from = lastItem(analysisPath(holes[index], teeSet, pinRotation))!;
    const to = analysisPath(holes[index + 1], teeSet, pinRotation)[0]!;
    const transfer = routedTransfer(course, from, to);
    const length = transfer.length;
    if (transfer.path) routedTransfers++;
    transfers.push(length);
    if (length > 18) warnings.push({ id: `transfer-${holes[index].id}-${holes[index + 1].id}`, kind: "transfer", severity: length > 30 ? "warning" : "info", message: `The transfer from ${holes[index].name ?? `hole ${index + 1}`} to ${holes[index + 1].name ?? `hole ${index + 2}`} is long.`, holeIds: [holes[index].id!, holes[index + 1].id!], location: midpoint(from, to), geometry: transfer.path ?? [from, to], measurement: `${round(length)} routed tiles` });
  }
  const firstTee = holes.length ? analysisPath(holes[0], teeSet, pinRotation)[0]! : null;
  const finalGreen = holes.length ? lastItem(analysisPath(holes[holes.length - 1], teeSet, pinRotation))! : null;
  const ninthGreen = holes.length >= 9 ? lastItem(analysisPath(holes[8], teeSet, pinRotation))! : null;
  const firstDistance = home && firstTee ? routedTransfer(course, home, firstTee).length : 0;
  const finalDistance = home && finalGreen ? routedTransfer(course, finalGreen, home).length : 0;
  const ninthDistance = home && ninthGreen ? routedTransfer(course, ninthGreen, home).length : 0;
  const averageTransfer = transfers.length ? transfers.reduce((sum, value) => sum + value, 0) / transfers.length : 0;
  const totalWalk = transfers.reduce((sum, value) => sum + value, 0) + firstDistance + finalDistance;
  const transferScore = clamp(100 - Math.max(0, averageTransfer - 6) * 3.2);
  const homeScore = home ? clamp(100 - (firstDistance + finalDistance) * 1.6 - Math.max(0, ninthDistance - 14) * 1.2) : 55;
  const compactScore = holes.length ? clamp(100 - totalWalk / holes.length * 2.1) : 0;
  const routingScore = transferScore * .42 + homeScore * .38 + compactScore * .20;
  const walkabilityScore = transferScore * .58 + compactScore * .27 + (routedTransfers / Math.max(1, transfers.length) * 100) * .15;
  if (home && firstTee && firstDistance > 18) warnings.push({ id: "clubhouse-first", kind: "clubhouse", severity: "warning", message: "The first tee sits far from the shared clubhouse.", holeIds: holes[0]?.id ? [holes[0].id] : [], location: firstTee, geometry: [home, firstTee], measurement: `${round(firstDistance)} routed tiles` });
  if (home && finalGreen && finalDistance > 18) warnings.push({ id: "clubhouse-final", kind: "clubhouse", severity: "warning", message: "The final green finishes far from the shared clubhouse.", holeIds: lastItem(holes)?.id ? [lastItem(holes)!.id!] : [], location: finalGreen, geometry: [finalGreen, home], measurement: `${round(finalDistance)} routed tiles` });
  return {
    routing: component("routing", "Routing", routingScore, `Published order averages ${round(averageTransfer)} tiles between holes; first/final clubhouse access totals ${round(firstDistance + finalDistance)} tiles.`, { averageTransferTiles: round(averageTransfer), firstTeeClubhouseTiles: round(firstDistance), finalGreenClubhouseTiles: round(finalDistance), ninthGreenClubhouseTiles: round(ninthDistance), totalTransferTiles: round(totalWalk), compactnessScore: round(compactScore) }),
    walkability: component("walkability", "Walkability", walkabilityScore, `${routedTransfers} of ${transfers.length} green-to-tee transfers use playable routed paths; total off-hole walking is ${round(totalWalk)} tiles.`, { routedTransfers, transferCount: transfers.length, averageTransferTiles: round(averageTransfer), totalWalkingTiles: round(totalWalk) }),
  };
}

function analyzeSafety(course: Course, teeSet: TeeSet, pinRotation: PinRotation, warnings: ArchitectureWarning[]): ArchitectureComponent {
  const holes = course.holes.filter((hole) => analysisPath(hole, teeSet, pinRotation).length >= 2);
  let crossings = 0;
  let parallels = 0;
  let repetitions = 0;
  for (let index = 1; index < holes.length; index++) {
    const previous = analysisPath(holes[index - 1], teeSet, pinRotation);
    const current = analysisPath(holes[index], teeSet, pinRotation);
    const directionDelta = angleDifference(angle(previous[0], lastItem(previous)!), angle(current[0], lastItem(current)!));
    const lengthDelta = Math.abs(computePathDistanceTiles(previous) - computePathDistanceTiles(current));
    if (directionDelta < 18 && lengthDelta < 5) {
      repetitions++;
      warnings.push({ id: `repeat-${holes[index - 1].id}-${holes[index].id}`, kind: "repetition", severity: "info", message: "Consecutive holes repeat a similar direction and length.", holeIds: [holes[index - 1].id!, holes[index].id!], location: midpoint(previous[0], current[0]), measurement: `${round(directionDelta)}° direction and ${round(lengthDelta)}-tile length difference` });
    }
  }
  for (let a = 0; a < holes.length; a++) for (let b = a + 1; b < holes.length; b++) {
    for (const [a0, a1] of routeSegments(analysisPath(holes[a], teeSet, pinRotation))) for (const [b0, b1] of routeSegments(analysisPath(holes[b], teeSet, pinRotation))) {
      if (segmentsCross(a0, a1, b0, b1)) {
        crossings++;
        const location = midpoint(midpoint(a0, a1), midpoint(b0, b1));
        warnings.push({ id: `cross-${holes[a].id}-${holes[b].id}-${crossings}`, kind: "crossing", severity: "warning", message: "Shot corridors cross and may expose golfers to play from another hole.", holeIds: [holes[a].id!, holes[b].id!], location, geometry: [a0, a1, b0, b1], measurement: `Hole ${a + 1} × hole ${b + 1}` });
      } else {
        const delta = angleDifference(angle(a0, a1), angle(b0, b1));
        const separation = distance(midpoint(a0, a1), midpoint(b0, b1));
        if (delta < 14 && separation < 6 && separation > 1.5) {
          parallels++;
          warnings.push({ id: `parallel-${holes[a].id}-${holes[b].id}-${parallels}`, kind: "parallel", severity: "warning", message: "Parallel shot corridors run close enough for wayward shots to overlap.", holeIds: [holes[a].id!, holes[b].id!], location: midpoint(midpoint(a0, a1), midpoint(b0, b1)), geometry: [a0, a1, b0, b1], measurement: `${round(separation)} tiles apart` });
        }
      }
    }
  }
  const score = clamp(100 - crossings * 18 - parallels * 8 - repetitions * 5);
  return component("safety", "Safety", score, `${crossings} corridor crossings, ${parallels} close parallel relationships, and ${repetitions} repetitive transitions were found.`, { crossings, parallelDangerZones: parallels, repetitions });
}

export function analyzeArchitecture(course: Course, setup: ArchitectureAnalysisSetup = {}): ArchitectureReport {
  const sourceCourse = course;
  const teeSet = setup.teeSet ?? "member";
  const pinRotation = setup.pinRotation ?? "A";
  let reports = cache.get(sourceCourse);
  if (!reports) { reports = new Map(); cache.set(sourceCourse, reports); }
  const setupKey = `${teeSet}:${pinRotation}`;
  const cached = reports.get(setupKey);
  if (cached) return cached;
  course = courseWithEffectiveSurfaces(course);
  const completeCount = course.holes.filter((hole) => analysisPath(hole, teeSet, pinRotation).length >= 2).length;
  // Architecture is a published-course judgment. Keeping incomplete editor
  // states lightweight avoids surveying 30,800 tiles on every brush stroke.
  if (completeCount < 9) {
    const pending: ArchitectureReport = {
      total: 0,
      components: {
        routing: component("routing", "Routing", 0, "Complete a published nine to analyze routing.", { averageTransferTiles: 0, firstTeeClubhouseTiles: 0, finalGreenClubhouseTiles: 0, ninthGreenClubhouseTiles: 0, totalTransferTiles: 0, compactnessScore: 0 }),
        naturalFit: component("naturalFit", "Natural fit", 0, "Complete a published nine to compare construction with the survey.", { retainedTerrainPercent: 0, changedTiles: 0, earthworkSteps: 0, earthworkStepsPer100Tiles: 0 }),
        variety: component("variety", "Variety", 0, "Complete a published nine to analyze variety.", { parTypes: 0, lengthBands: 0, directionBuckets: 0, shapeTypes: 0, hazardTypes: 0, sceneryTypes: 0 }),
        safety: component("safety", "Safety", 0, "Complete a published nine to analyze safety.", { crossings: 0, parallelDangerZones: 0, repetitions: 0 }),
        walkability: component("walkability", "Walkability", 0, "Complete a published nine to analyze walking routes.", { routedTransfers: 0, transferCount: 0, averageTransferTiles: 0, totalWalkingTiles: 0 }),
      },
      warnings: [],
      generatedFor: { courseId: course.activeCourseId, holeIds: course.holes.map((hole) => hole.id!).filter(Boolean) },
    };
    reports.set(setupKey, pending);
    return pending;
  }
  const warnings: ArchitectureWarning[] = [];
  const flow = analyzeFlow(course, teeSet, pinRotation, warnings);
  const naturalFit = analyzeNaturalFit(course, warnings);
  const variety = analyzeVariety(course, teeSet, pinRotation);
  const safety = analyzeSafety(course, teeSet, pinRotation, warnings);
  const components: ArchitectureReport["components"] = { routing: flow.routing, naturalFit, variety, safety, walkability: flow.walkability };
  const baseTotal = round(Object.values(components).reduce((sum, item) => sum + item.score * item.weight, 0));
  const strategic = buildStrategicPortfolio(course);
  // M48 replaces the old single difficulty/ease intuition without erasing the
  // established routing, safety, and natural-fit report. The blend is bounded
  // and explainable, while `strategic` exposes the cohort facts to newer UI.
  const total = round(strategic.evaluation.holes.length ? baseTotal * .58 + strategic.summary.total * .42 : baseTotal);
  const report = { total, components, strategic, warnings: warnings.sort((a, b) => Number(b.severity === "warning") - Number(a.severity === "warning") || a.id.localeCompare(b.id)), generatedFor: { courseId: course.activeCourseId, holeIds: course.holes.map((hole) => hole.id!).filter(Boolean) } } satisfies ArchitectureReport;
  reports.set(setupKey, report);
  return report;
}

/** Architecture guidance never gates opening. It only nudges demand within a configured bound. */
export function architectureDemandMultiplier(course: Course): number {
  const score = analyzeArchitecture(course).total;
  const max = BALANCE.architecture.demandEffectMax;
  return 1 + ((score - 50) / 50) * max;
}
