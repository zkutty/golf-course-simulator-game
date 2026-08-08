import type { Course, Hole, PinRotation, TeeSet } from "../models/types";
import type { ArchitectureReferencePlan } from "./referencePlan";
import { retainedArchitectureReferencePlans as retained } from "./referencePlanEvidenceStore";

const key = (teeSet: TeeSet, pinRotation: PinRotation) => `${teeSet}:${pinRotation}`;
const geometry = (course: Course) => [course.tiles, course.elevations, course.obstacles, course.buildings, course.yardsPerTile, course.theme];

export function retainArchitectureReferencePlan(course: Course, hole: Hole, plan: ArchitectureReferencePlan): void {
  let plans = retained.get(hole);
  if (!plans) retained.set(hole, plans = new Map());
  const retainedGeometry = geometry(course);
  plans.set(key(plan.teeSet, plan.pinRotation), {
    plan,
    matches: (candidate) => retainedGeometry.every((value, index) => value === geometry(candidate)[index]),
  });
}

export function retainedArchitectureReferencePlan(course: Course, hole: Hole, teeSet: TeeSet, pinRotation: PinRotation): ArchitectureReferencePlan | undefined {
  const entry = retained.get(hole)?.get(key(teeSet, pinRotation));
  return entry?.matches(course) ? entry.plan : undefined;
}
