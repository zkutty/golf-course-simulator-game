import type { Course, Hole } from "../models/types";
import type { ArchitectureReferencePlan } from "./referencePlan";

export interface RetainedArchitectureReferencePlan {
  plan: ArchitectureReferencePlan;
  matches(course: Course): boolean;
}

export const retainedArchitectureReferencePlans = new WeakMap<
  Hole,
  Map<string, RetainedArchitectureReferencePlan>
>();
