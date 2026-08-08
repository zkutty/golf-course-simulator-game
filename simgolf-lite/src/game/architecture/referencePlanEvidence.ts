import type { Course, Hole, PinRotation, TeeSet } from "../models/types";
import type { ArchitectureReferencePlan } from "./referencePlan";

interface RetainedPlan { plan: ArchitectureReferencePlan; geometry: unknown[] }
const retained = new WeakMap<Hole, Map<string, RetainedPlan>>();
const key = (teeSet: TeeSet, pinRotation: PinRotation) => `${teeSet}:${pinRotation}`;
const geometry = (course: Course) => [course.tiles, course.elevations, course.obstacles, course.buildings, course.yardsPerTile, course.theme];

export function retainArchitectureReferencePlan(course: Course, hole: Hole, plan: ArchitectureReferencePlan): void {
  let plans = retained.get(hole);
  if (!plans) retained.set(hole, plans = new Map());
  plans.set(key(plan.teeSet, plan.pinRotation), { plan, geometry: geometry(course) });
}

export function retainedArchitectureReferencePlan(course: Course, hole: Hole, teeSet: TeeSet, pinRotation: PinRotation): ArchitectureReferencePlan | undefined {
  const entry = retained.get(hole)?.get(key(teeSet, pinRotation));
  const current = geometry(course);
  return entry?.geometry.every((value, index) => value === current[index]) ? entry.plan : undefined;
}
