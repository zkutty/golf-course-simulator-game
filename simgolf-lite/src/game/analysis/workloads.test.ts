import { describe, expect, it } from "vitest";
import { createRenderPerfCourse } from "../testing/referenceCourse";
import {
  analysisOutputDigest,
  runAnalysisWorkload,
  type SurfaceHabitatPayload,
} from "./workloads";

describe("analysis Worker workloads", () => {
  it("runs the production architecture analyzer without mutating its snapshot", () => {
    const course = createRenderPerfCourse("parkland");
    const tiles = course.tiles.slice();

    const output = runAnalysisWorkload({ workload: "architecture-routing", course });

    expect(output.workload).toBe("architecture-routing");
    if (output.workload !== "architecture-routing") throw new Error("Unexpected workload output.");
    expect(output.total).toBeGreaterThan(0);
    expect(output.componentScores).toHaveProperty("routing");
    expect(course.tiles).toEqual(tiles);
  });

  it("produces byte-stable slope and habitat proxy output", () => {
    const payload: SurfaceHabitatPayload = {
      workload: "surface-habitat",
      width: 4,
      height: 4,
      yardsPerTile: 10,
      worldSeed: 681,
      elevations: Float64Array.from([0, 1, 2, 3, 0, 1, 2, 3, 1, 2, 3, 4, 1, 2, 3, 4]),
      samples: [
        { from: { x: 1, y: 1 }, to: { x: 3, y: 3 }, handedness: "right" },
        { from: { x: 2, y: 2 }, to: { x: 0, y: 1 }, handedness: "left" },
      ],
      habitats: [{
        frame: "parkland_tree_oak",
        obstacle: { type: "tree", x: 2, y: 2 },
        scale: 1,
      }],
      repetitions: 2,
    };

    const first = runAnalysisWorkload(payload);
    const second = runAnalysisWorkload(structuredClone(payload));

    expect(second).toEqual(first);
    expect(analysisOutputDigest(second)).toBe(analysisOutputDigest(first));
    if (first.workload !== "surface-habitat") throw new Error("Unexpected workload output.");
    expect(first.slopeSamples).toBe(4);
    expect(first.habitatSamples).toBe(2);
  });
});
