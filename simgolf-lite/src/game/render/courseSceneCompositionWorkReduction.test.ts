import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { canonicalJson } from "../../utils/canonical";
import { createM27ReleaseReferenceCourse, createParklandVisualReferenceCourse, createM20TerrainReferenceCourse, createM23CourseSetupReferenceCourse } from "../testing/referenceCourse";
import { deriveCourseSceneComposition } from "./courseSceneComposition";
const compact = createParklandVisualReferenceCourse();
compact.width = 20;
compact.height = 16;
compact.tiles = Array(320).fill("deep_rough");
compact.elevations = Array(320).fill(0);
compact.holes = [];
compact.buildings = [];
compact.obstacles = [
  { type: "rock", x: 0, y: 0 },
  { type: "rock", x: 19, y: 15 },
  { type: "tree", x: 8, y: 8 },
  { type: "tree", x: 9, y: 8 },
];
for (let y = 0; y < 16; y++) compact.tiles[y * 20 + 2] = "water";
const fractional = { ...compact, width: 20.5 };
const cases = [
  ["compact-boundary-ties", compact],
  ["fractional-dimensions", fractional],
  ["m27", createM27ReleaseReferenceCourse()],
  ["authored", createParklandVisualReferenceCourse()],
  ["terrain", createM20TerrainReferenceCourse()],
  ["setup", createM23CourseSetupReferenceCourse()],
] as const;

// Complete plans independently captured from adcfd92 before changing the producer.
// These hashes cover IDs, array order, geometry, evidence, exclusions and decisions.
const originalPlans = [
  [
    "compact-boundary-ties",
    0,
    "54c7558ab13fd64729067647ba60ee48637ebb7b2677b48bd249724d0c256788"
  ],
  [
    "compact-boundary-ties",
    1202,
    "a8bfac9901b4e99b99101d24bc5bb840cf69ff1d8f9490288a97c1a01f1dec60"
  ],
  [
    "fractional-dimensions",
    0,
    "b8f7aeefbeaf5424e6cf54a2c227b3d9497353e7c54b30c292cfaf49b3a8e5c6"
  ],
  [
    "fractional-dimensions",
    1202,
    "3c61bac6e106c8c4329c3c1e4ab204b28fb8917498537025af648570e7321efe"
  ],
  [
    "m27",
    0,
    "b436e01f87782f5c003a82d639cde3689f1a9821cc51ab25f1c3d7b017cd6bbb"
  ],
  [
    "m27",
    1202,
    "671fb53910683a9b7220ad1bc7f64129725b2d4d14b89c7198de08dd431a2eba"
  ],
  [
    "authored",
    0,
    "43832a88856d985565645efd8a921e9d80e3891051bc45a7de0e60782fcca21d"
  ],
  [
    "authored",
    1202,
    "068fd1ac30a55e4a8aeb79fcaccf9b0c639595e010b7b4ca3a79715c876192af"
  ],
  [
    "terrain",
    0,
    "0b7e0df8b4f65844e1ad477042b993a0e6ac55750a575866ed06dc569c6655cb"
  ],
  [
    "terrain",
    1202,
    "909eff15d58fcdb758224838e1dfd6957968d4881be43c7c85fa9b744deeebad"
  ],
  [
    "setup",
    0,
    "7de36abaa5a7ec20341cdf3c0b998e72c504975bf060c4b31ed2baaaa0ceb0b6"
  ],
  [
    "setup",
    1202,
    "4a1cfbf937e99797c8c5a0255cd0a25901adebbf382052d39cce0b00f162b6f6"
  ]
] as const;
for (const [name, seed, expected] of originalPlans) {
  it(`preserves the complete original ${name} plan for seed ${seed}`, () => {
    const course = cases.find(([caseName]) => caseName === name)![1];
    const plan = deriveCourseSceneComposition({ course, seed });
    expect(createHash("sha256").update(canonicalJson(plan)).digest("hex")).toBe(expected);
  });
}
