import { expect, it } from "vitest";
import {
  architectureReferencePlanDiagnostics,
  architectureReferencePlans,
  resetArchitectureReferencePlanDiagnostics,
} from "../architecture/referencePlan";
import { ARCHITECTURE_REVIEW_INTERACTIVE_BUDGET_MS } from "../architecture/review";
import { buildM62FullEstateCourse } from "./m62Certification";

it("ZK-765 cold-solves 36 reference plans inside the editor interaction budget", () => {
  const course = structuredClone(buildM62FullEstateCourse());
  resetArchitectureReferencePlanDiagnostics();
  const started = performance.now();
  const plans = architectureReferencePlans(course, "member", "A");
  const elapsedMs = performance.now() - started;

  expect(plans).toHaveLength(36);
  expect(architectureReferencePlanDiagnostics()).toEqual({ requests: 36, cacheHits: 0, retainedHits: 0, solves: 36 });
  expect(elapsedMs).toBeLessThan(ARCHITECTURE_REVIEW_INTERACTIVE_BUDGET_MS);
}, 120_000);
