import type { ArchitectureMobilityOverlay, ArchitectureOverlayRender } from "../architecture/reviewTypes";
import type { Course, Point, World } from "../models/types";
import { activeWeather } from "../seasons/seasons";
import { mobilityGeometryVersion, planTimedMobilityLeg, TimedMobilityLegCache, type MobilityRouteConditions } from "./travelRouter";
import type { MobilityMode } from "./types";

const MAX_TRACES = 320;
const MAX_CELLS = 180;
const MAX_WARNINGS = 24;
const cache = new TimedMobilityLegCache();
const compare = (a: string, b: string) => a.localeCompare(b);

function conditionsFor(course: Course, world: World): MobilityRouteConditions {
  const weather = activeWeather(world, course, 0);
  if (weather.kind === "heavy_rain" || weather.kind === "storm") return { weather: "cart_path_only", cartPathOnly: true, restrictionId: `${weather.kind}:${weather.absoluteDay}` };
  if (weather.kind === "rain") return { weather: "wet", cartPathOnly: true, restrictionId: `${weather.kind}:${weather.absoluteDay}` };
  return { weather: "dry", restrictionId: `dry:${weather.absoluteDay}` };
}

function bounded<T>(rows: T[], max: number): T[] {
  if (rows.length <= max) return rows;
  const stride = rows.length / max;
  return Array.from({ length: max }, (_, index) => rows[Math.floor(index * stride)]);
}

/**
 * Produces only forecast geometry. The shared timed router is cache-backed and
 * this function neither allocates fleet nor reads/writes economic evidence.
 */
export function buildArchitectureMobilityOverlay(args: {
  course: Course; world: World; courseId: string; modes: MobilityMode[];
}): { render: ArchitectureOverlayRender; mobility: ArchitectureMobilityOverlay } {
  const { course, world, courseId } = args;
  const modes = [...new Set(args.modes)].sort(compare) as MobilityMode[];
  const conditions = conditionsFor(course, world);
  const geometryVersion = mobilityGeometryVersion(course);
  const holes = course.holes.filter((hole) => hole.id && hole.tee && hole.green);
  const traces: ArchitectureOverlayRender["traces"] = [];
  const cells = new Map<string, { id: string; x: number; y: number; value: number; current: boolean }>();
  const inaccessible: ArchitectureMobilityOverlay["inaccessibleDestinations"] = [];
  const warnings: string[] = [];
  let transfers = 0;

  const route = (mode: MobilityMode, from: Point, to: Point, id: string, transfer: boolean) => {
    const input = { course, courseId, layoutId: courseId, mode, from, to, conditions, geometryVersion, allowWalkFallback: false } as const;
    const leg = planTimedMobilityLeg(input, cache);
    if (!leg) {
      const walk = mode === "walk" ? null : planTimedMobilityLeg({ ...input, mode: "walk", allowWalkFallback: false }, cache);
      const reason = walk ? "prohibited" : "unreachable";
      inaccessible.push({ id, mode, reason });
      warnings.push(reason === "prohibited" ? `${mode} is prohibited on ${id} by terrain, slope, or ${conditions.weather} restrictions.` : `${id} is unreachable even on the authoritative walking network.`);
      return;
    }
    if (transfer) transfers++;
    for (let index = 1; index < leg.waypoints.length; index++) traces.push({ id: `${id}:${mode}:${index}`, from: leg.waypoints[index - 1], to: leg.waypoints[index], current: true, emphasized: transfer });
    for (const point of leg.cells) {
      const key = `${point.x}:${point.y}`;
      const prior = cells.get(key);
      if (prior) prior.value++;
      else cells.set(key, { id: `mobility-${key}`, x: point.x, y: point.y, value: 1, current: true });
    }
  };

  for (const mode of modes) {
    holes.forEach((hole, index) => {
      route(mode, hole.tee!, hole.green!, `${hole.id}:hole`, false);
      const next = holes[index + 1];
      if (next) route(mode, hole.green!, next.tee!, `${hole.id}:to:${next.id}`, true);
    });
  }
  const pathCells = [...cells.values()].sort((a, b) => b.value - a.value || compare(a.id, b.id));
  return {
    render: { kind: "mobility", traces: bounded(traces, MAX_TRACES), cells: bounded(pathCells, MAX_CELLS), points: inaccessible.slice(0, MAX_WARNINGS).map((row) => ({ id: `mobility-${row.id}-${row.mode}`, x: 0, y: 0, value: 1, current: false, label: `${row.mode} ${row.reason}` })) },
    mobility: { evidence: "predicted", modes, weather: conditions.weather ?? "dry", transfers, inaccessibleDestinations: inaccessible.slice(0, MAX_WARNINGS), missingLinkWarnings: [...new Set(warnings)].sort(compare).slice(0, MAX_WARNINGS), pathUtilization: pathCells.reduce((sum, row) => sum + row.value, 0) },
  };
}
