import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { normalizeCourseLayouts } from "../models/courseLayouts";
import type { Course, Terrain } from "../models/types";
import { createM27ReleaseReferenceCourse, createParklandVisualReferenceCourse } from "../testing/referenceCourse";
import { deriveCourseSceneComposition } from "./courseSceneComposition";
import { resolveHabitatFieldTopology, type HabitatFieldTopologyRequest } from "./habitatFieldTopology";

function edgeFixture(): Course {
  const width = 20;
  const height = 14;
  const tiles = new Array<Terrain>(width * height).fill("rough");
  for (let y = 1; y <= 5; y++) for (let x = 0; x <= 4; x++) tiles[y * width + x] = "deep_rough";
  for (let y = 10; y < height; y++) for (let x = 9; x <= 13; x++) tiles[y * width + x] = "water";
  return {
    width, height, tiles, elevations: new Array(tiles.length).fill(0), holes: [],
    obstacles: [{ x: width - 1, y: 0, type: "rock" }], buildings: [],
    yardsPerTile: 10, name: "Sparse exact edge cases", baseGreenFee: 1, condition: 1, theme: "parkland",
  };
}

function execute(course: Course, seed: number) {
  const calls: { request: HabitatFieldTopologyRequest; result: ReturnType<typeof resolveHabitatFieldTopology> }[] = [];
  const plan = deriveCourseSceneComposition({
    course,
    seed,
    topologyResolver: (request) => {
      const result = resolveHabitatFieldTopology(request);
      calls.push({ request, result });
      return result;
    },
  });
  return { plan, calls };
}

// Frozen plan hashes from the original full-grid implementation on EC.
it.each([
  {
    name: "the original 36-hole M27 fixture",
    create: () => normalizeCourseLayouts(createM27ReleaseReferenceCourse("parkland")),
    seed: 270252,
    originalPlanSHA256: "95f6044ee428ddfc00e71d5d4c055327bbff30a93a131b928d19723c0973ab8f",
    resolverCalls: 24,
  },
  {
    name: "the authored M19 fixture",
    create: createParklandVisualReferenceCourse,
    seed: 1202,
    originalPlanSHA256: "44e773c3117af95863e3da43a827a9bdcec7da23b334f2bde19d380eeb364c27",
    resolverCalls: 15,
  },
  {
    name: "wet, rock and deep rough labels against the course edge",
    create: edgeFixture,
    seed: 36,
    originalPlanSHA256: "4fd0bcff5b3000fb0573aa50e654b9cf3e466d25e30778f399a222603b428a97",
    resolverCalls: 5,
  },
])("matches legacy plans and ordered topology resolution for $name", ({ create, seed, originalPlanSHA256, resolverCalls }) => {
  const course = create();
  const width = course.width;
  // An accessor-backed dimension is outside sparse-grid admission. This uses
  // the real legacy traversal without changing the visible course geometry.
  let widthReads = 0;
  const legacy = { ...structuredClone(course), get width() { widthReads++; return width; } };
  const expected = execute(legacy, seed);
  const actual = execute(course, seed);
  expect(widthReads).toBeGreaterThan(0);
  expect(expected.calls).toHaveLength(resolverCalls);
  expect(createHash("sha256").update(JSON.stringify(expected.plan)).digest("hex")).toBe(originalPlanSHA256);
  expect(actual).toStrictEqual(expected);
});
