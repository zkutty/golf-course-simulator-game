import type { Hole, PinRotation, TeeSet } from "../models/types";
import type { ArchitectureReferencePlan } from "./referencePlan";

const retained = new WeakMap<Hole, Map<string, ArchitectureReferencePlan>>();
const key = (teeSet: TeeSet, pinRotation: PinRotation) => `${teeSet}:${pinRotation}`;

export function retainArchitectureReferencePlan(hole: Hole, plan: ArchitectureReferencePlan): void {
  let plans = retained.get(hole);
  if (!plans) retained.set(hole, plans = new Map());
  plans.set(key(plan.teeSet, plan.pinRotation), plan);
}

export function retainedArchitectureReferencePlan(hole: Hole, teeSet: TeeSet, pinRotation: PinRotation): ArchitectureReferencePlan | undefined {
  return retained.get(hole)?.get(key(teeSet, pinRotation));
}
