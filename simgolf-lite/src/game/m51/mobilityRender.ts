import type { GolferRenderData } from "../live/types";
import type { Course } from "../models/types";
import { normalizeM51CourseMobilityState } from "./mobility";

export type MobilityUnitVisualState = "riding_cart" | "pushcart" | "parked" | "walking_connection";
export interface MobilityRenderUnit {
  id: string;
  mode: "walk" | "pushcart" | "riding_cart";
  state: MobilityUnitVisualState;
  x: number;
  y: number;
  riderIds: number[];
  assignmentId?: string;
}

/** Renderer contract for reduced-motion and color-independent fallbacks. */
export const MOBILITY_VISUAL_FALLBACK = Object.freeze({
  optionalAssets: false,
  reducedMotion: "static",
  colorIndependentShapes: ["cart-body-and-wheels", "pushcart-wheels-and-handle", "walking-ring-and-line"],
});

/** Shared-unit view model: every fleet unit is emitted once, independent of riders. */
export function mobilityRenderUnits(course: Course, golfers: readonly GolferRenderData[]): MobilityRenderUnit[] {
  const active = new Map<string, GolferRenderData[]>();
  const walking = new Map<string, GolferRenderData[]>();
  for (const golfer of golfers) {
    if (golfer.mobilityUnitId && golfer.mobilityUnitMode && golfer.mobilityUnitMode !== "walk") {
      const group = active.get(golfer.mobilityUnitId) ?? [];
      group.push(golfer); active.set(golfer.mobilityUnitId, group);
    } else if (golfer.mobilityAssignmentId && golfer.mobilityUnitMode === "walk") {
      const group = walking.get(golfer.mobilityAssignmentId) ?? [];
      group.push(golfer); walking.set(golfer.mobilityAssignmentId, group);
    }
  }
  const units: MobilityRenderUnit[] = [];
  for (const [id, riders] of [...active.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const first = [...riders].sort((a, b) => a.id - b.id)[0];
    units.push({ id, mode: first.mobilityUnitMode!, state: first.mobilityUnitMode === "riding_cart" ? "riding_cart" : "pushcart", x: first.x, y: first.y, riderIds: riders.map((row) => row.id).sort((a, b) => a - b), assignmentId: first.mobilityAssignmentId });
  }
  for (const [assignmentId, riders] of [...walking.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const first = [...riders].sort((a, b) => a.id - b.id)[0];
    units.push({ id: `walk:${assignmentId}`, mode: "walk", state: "walking_connection", x: first.x, y: first.y, riderIds: riders.map((row) => row.id).sort((a, b) => a - b), assignmentId });
  }
  const used = new Set(active.keys());
  const state = normalizeM51CourseMobilityState(course.m51, course);
  const parkedByBuilding = new Map<string, number>();
  for (const unit of Object.values(state.fleet).filter((unit) => unit.state === "available" && !used.has(unit.id)).sort((a, b) => a.id.localeCompare(b.id))) {
    const building = course.buildings.find((candidate) => candidate.id === unit.buildingId);
    if (!building) continue;
    const index = parkedByBuilding.get(unit.buildingId) ?? 0;
    parkedByBuilding.set(unit.buildingId, index + 1);
    units.push({ id: unit.id, mode: unit.mode, state: "parked", x: building.x + .2 + (index % 3) * .25, y: building.y + .7 + Math.floor(index / 3) * .22, riderIds: [] });
  }
  return units.sort((a, b) => a.id.localeCompare(b.id));
}
